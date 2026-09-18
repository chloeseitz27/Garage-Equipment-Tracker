<#
.SYNOPSIS
  Deploys Garage Inventory infrastructure from infra/main.bicep.

.DESCRIPTION
  Registers required resource providers, then runs an idempotent
  subscription-scoped Bicep deployment. Safe to re-run: the Cosmos account
  recorded by a previous deployment keeps its existing location.

  Note on error handling: PowerShell's $ErrorActionPreference does NOT apply to
  native commands like `az`. A failing az call sets $LASTEXITCODE but does not
  throw, so every invocation is checked explicitly. An earlier version of this
  script omitted that and cheerfully reported success after four failures.

.EXAMPLE
  .\scripts\deploy-infra.ps1 -SubscriptionId 368aada2-229f-4299-ac6f-a8e15a4d2589

.EXAMPLE
  .\scripts\deploy-infra.ps1 -SubscriptionId <guid> -WhatIf

.EXAMPLE
  .\scripts\deploy-infra.ps1 -SubscriptionId <guid> -CosmosLocation eastus2
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$SubscriptionId,
  [string]$Location = 'eastus',
  [string]$CosmosLocation = '',
  [string]$ResourceGroup = 'garage-inventory',
  [switch]$WhatIf,
  [switch]$SkipConfirm
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$template = Join-Path $repoRoot 'infra\main.bicep'

function Invoke-Az {
  param([string[]]$Arguments, [string]$Because)

  # stderr is captured to a file rather than merged with 2>&1. az writes
  # warnings (upgrade notices and similar) to stderr, and merging them into
  # stdout corrupts any JSON the caller is about to parse.
  $errFile = [System.IO.Path]::GetTempFileName()
  try {
    $output = & az @Arguments 2>$errFile
    if ($LASTEXITCODE -ne 0) {
      Get-Content $errFile -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host $_ -ForegroundColor DarkYellow
      }
      $output | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow }
      throw "Failed: $Because"
    }
    return $output
  }
  finally {
    Remove-Item $errFile -ErrorAction SilentlyContinue
  }
}

Invoke-Az @('account', 'set', '--subscription', $SubscriptionId) 'select subscription'
$account = (Invoke-Az @('account', 'show', '-o', 'json') 'read subscription') | ConvertFrom-Json

Write-Host "Subscription : $($account.name)"
Write-Host "Tenant       : $($account.tenantDefaultDomain)"
Write-Host "Signed in as : $($account.user.name)"
Write-Host ''

# This repo's CLI defaults to a Microsoft corporate subscription. Refuse to
# deploy a personal project there by accident.
if ($account.tenantDefaultDomain -eq 'microsoft.onmicrosoft.com') {
  throw "Refusing to deploy into the Microsoft corporate tenant. Run 'az login --tenant <your-tenant>' first."
}

# The module deployment records the exact deterministic account name, even
# when deployment failed after creating the account. Do not guess from a prefix
# or adopt another account that happens to be in the same resource group.
$groupExists = ((Invoke-Az @('group', 'exists', '--name', $ResourceGroup, '-o', 'json') 'check resource group') | Out-String).Trim()
if ($groupExists -notin @('true', 'false')) {
  throw "Could not determine whether resource group '$ResourceGroup' exists."
}
if ($groupExists -eq 'true') {
  $accountName = ((Invoke-Az @(
    'deployment', 'group', 'list', '--resource-group', $ResourceGroup,
    '--query', "[?name=='cosmos'].properties.parameters.accountName.value | [0]", '-o', 'tsv'
  ) 'read previous Cosmos deployment') | Out-String).Trim()

  if ($accountName) {
    $accounts = (Invoke-Az @(
      'cosmosdb', 'list', '--resource-group', $ResourceGroup,
      '--query', '[].{name:name,location:location}', '-o', 'json'
    ) 'read existing Cosmos accounts') | ConvertFrom-Json
    $existingAccount = $accounts | Where-Object { $_.name -eq $accountName }
    if ($existingAccount) {
      $existingLocation = $existingAccount.location
      if ([string]::IsNullOrWhiteSpace($existingLocation)) {
        throw "Could not read the location of existing Cosmos account '$accountName'."
      }
      # ARM can return display names (East US 2) rather than CLI names (eastus2).
      $existingLocation = $existingLocation.ToLowerInvariant() -replace '\s', ''
      if ($CosmosLocation -and ($CosmosLocation -replace '\s', '') -ne $existingLocation) {
        throw "Cosmos account '$accountName' already exists in '$existingLocation', not '$CosmosLocation'. Re-run without -CosmosLocation or use -CosmosLocation $existingLocation. This script cannot move an existing account."
      }
      $CosmosLocation = $existingLocation
      Write-Host "Reusing Cosmos account '$accountName' in $CosmosLocation."
    }
  }
}
if (-not $CosmosLocation) { $CosmosLocation = $Location }

if (-not $WhatIf -and -not $SkipConfirm) {
  if ((Read-Host 'Deploy here? (y/N)') -ne 'y') { Write-Host 'Aborted.'; exit 1 }
}

# A new subscription has almost no providers registered; Cosmos fails with
# MissingSubscriptionRegistration without this. Registration is idempotent.
Write-Host 'Ensuring resource providers are registered...'
foreach ($ns in @('Microsoft.DocumentDB', 'Microsoft.Web', 'Microsoft.Insights')) {
  $state = (Invoke-Az @('provider', 'show', '--namespace', $ns, '--query', 'registrationState', '-o', 'tsv') "read $ns") | Out-String
  if ($state.Trim() -ne 'Registered') {
    Write-Host "  registering $ns..."
    Invoke-Az @('provider', 'register', '--namespace', $ns, '--wait') "register $ns" | Out-Null
  }
  Write-Host "  $ns ok"
}

$principalId = ((Invoke-Az @('ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv') 'read signed-in user') | Out-String).Trim()

$parameters = @(
  "resourceGroupName=$ResourceGroup",
  "location=$Location",
  "cosmosLocation=$CosmosLocation",
  "principalId=$principalId"
)

if ($WhatIf) {
  Write-Host "`nRunning what-if (no changes will be made)..."
  & az deployment sub what-if --location $Location --template-file $template --parameters @parameters
  if ($LASTEXITCODE -ne 0) { throw 'what-if failed' }
  exit 0
}

Write-Host "`nDeploying Cosmos to $CosmosLocation (account creation takes a few minutes)..."
$deployArgs = @('deployment', 'sub', 'create', '--location', $Location, '--template-file', $template, '--parameters') + $parameters + @('-o', 'json')
$result = (Invoke-Az $deployArgs 'deploy infrastructure') | ConvertFrom-Json
$out = $result.properties.outputs

Write-Host "`nDeployed.`n" -ForegroundColor Green
Write-Host 'Add to .env:'
Write-Host '  STORAGE=cosmos'
Write-Host "  COSMOS_ENDPOINT=$($out.cosmosEndpoint.value)"
Write-Host "  COSMOS_DATABASE=$($out.cosmosDatabase.value)"
Write-Host "  COSMOS_CONTAINER=$($out.cosmosContainer.value)"
Write-Host ''
Write-Host 'Then import the seed data:'
Write-Host '  npm run seed:cosmos'
