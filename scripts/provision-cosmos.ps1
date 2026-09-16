<#
.SYNOPSIS
  Provisions Cosmos DB for Garage Inventory on the free tier.

.DESCRIPTION
  Creates a resource group, a free-tier Cosmos account, a database, and a single
  container partitioned on /type.

  Design notes:
    - Free tier gives 1000 RU/s + 25 GB, one account per subscription, and must
      be opted into at creation. It cannot be applied afterward.
    - One container at 400 RU/s, not four. Four containers would each need a
      400 RU/s minimum, totalling 1600 and exceeding the free grant.
    - Total account throughput is capped as a hard stop against surprise charges.

.EXAMPLE
  .\scripts\provision-cosmos.ps1 -SubscriptionId <guid> -Location eastus
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$SubscriptionId,
  [string]$ResourceGroup = 'garage-inventory',
  [string]$Location = 'eastus',
  [string]$AccountName = "garage-cosmos-$((New-Guid).ToString('N').Substring(0,6))",
  [string]$DatabaseName = 'garage',
  [string]$ContainerName = 'catalog'
)

$ErrorActionPreference = 'Stop'

# Guard: this repo's CLI defaults to a Microsoft corporate subscription. Require
# the target to be named explicitly so a deploy can't land on the wrong one.
az account set --subscription $SubscriptionId | Out-Null
$account = az account show --query "{name:name, id:id, tenant:tenantDefaultDomain, user:user.name}" -o json | ConvertFrom-Json

Write-Host "Target subscription : $($account.name)"
Write-Host "Subscription id     : $($account.id)"
Write-Host "Tenant              : $($account.tenant)"
Write-Host "Signed in as        : $($account.user)"
Write-Host ''

if ($account.tenant -eq 'microsoft.onmicrosoft.com') {
  throw "Refusing to provision into the Microsoft corporate tenant. Run 'az login --tenant <your-tenant>' first."
}

$confirm = Read-Host "Provision Cosmos DB here? (y/N)"
if ($confirm -ne 'y') { Write-Host 'Aborted.'; exit 1 }

Write-Host "`nCreating resource group $ResourceGroup..."
az group create --name $ResourceGroup --location $Location --output none

Write-Host "Creating free-tier Cosmos account $AccountName (this takes a few minutes)..."
az cosmosdb create `
  --name $AccountName `
  --resource-group $ResourceGroup `
  --locations regionName=$Location failoverPriority=0 isZoneRedundant=False `
  --enable-free-tier true `
  --default-consistency-level Session `
  --output none

Write-Host "Creating database $DatabaseName..."
az cosmosdb sql database create `
  --account-name $AccountName `
  --resource-group $ResourceGroup `
  --name $DatabaseName `
  --output none

Write-Host "Creating container $ContainerName (partition key /type, 400 RU/s)..."
az cosmosdb sql container create `
  --account-name $AccountName `
  --resource-group $ResourceGroup `
  --database-name $DatabaseName `
  --name $ContainerName `
  --partition-key-path '/type' `
  --throughput 400 `
  --output none

$endpoint = az cosmosdb show --name $AccountName --resource-group $ResourceGroup --query documentEndpoint -o tsv

# Cosmos data-plane RBAC is separate from Azure RBAC. Subscription Owner grants
# no data access at all, so this assignment is required even for the person who
# just created the account.
Write-Host "Granting yourself Cosmos DB Built-in Data Contributor..."
$principalId = az ad signed-in-user show --query id -o tsv
az cosmosdb sql role assignment create `
  --account-name $AccountName `
  --resource-group $ResourceGroup `
  --role-definition-id '00000000-0000-0000-0000-000000000002' `
  --principal-id $principalId `
  --scope '/' `
  --output none

Write-Host "`nDone.`n"
Write-Host "Add to .env:"
Write-Host "  STORAGE=cosmos"
Write-Host "  COSMOS_ENDPOINT=$endpoint"
Write-Host "  COSMOS_DATABASE=$DatabaseName"
Write-Host "  COSMOS_CONTAINER=$ContainerName"
Write-Host ''
Write-Host "Then import the seed data:"
Write-Host "  npm run seed:cosmos"
Write-Host ''
Write-Host "Later, for App Service, assign the same role to its managed identity:"
Write-Host "  az cosmosdb sql role assignment create --account-name $AccountName --resource-group $ResourceGroup ``"
Write-Host "    --role-definition-id 00000000-0000-0000-0000-000000000002 --principal-id <app-identity> --scope '/'"
