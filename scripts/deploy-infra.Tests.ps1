BeforeAll {
  $deployScript = Join-Path $PSScriptRoot 'deploy-infra.ps1'
  $azState = @{}
  $originalExitCode = $global:LASTEXITCODE

  # Replace the CLI so these tests never contact Azure or change a subscription.
  function az {
    $azState.Calls.Add(@($args))
    $global:LASTEXITCODE = 0
    $operation = $args[0..1] -join ' '
    if ($operation -eq $azState.FailedOperation) {
      $global:LASTEXITCODE = 1
      return
    }
    switch ($operation) {
      'account set' { return }
      'account show' {
        return '{"name":"Test subscription","tenantDefaultDomain":"personal.example","user":{"name":"test"}}'
      }
      'group exists' { return $azState.GroupExists }
      'deployment group' {
        $args[2] | Should -Be 'list'
        return $azState.PreviousAccountName
      }
      'cosmosdb list' {
        return ConvertTo-Json -InputObject $azState.Accounts -Depth 5
      }
      'provider show' { return 'Registered' }
      'ad signed-in-user' { return 'test-principal' }
      'deployment sub' {
        $azState.DeploymentArguments = @($args)
        if ($args[2] -eq 'what-if') { return }
        $args[2] | Should -Be 'create'
        return '{"properties":{"outputs":{"cosmosEndpoint":{"value":"https://test.example"},"cosmosDatabase":{"value":"garage"},"cosmosContainer":{"value":"catalog"}}}}'
      }
      default { throw "Unexpected az call: $args" }
    }
  }
}

AfterAll {
  $global:LASTEXITCODE = $originalExitCode
}

Describe 'Infrastructure deployment Cosmos location' {
  BeforeEach {
    $azState.Calls = [System.Collections.Generic.List[object]]::new()
    $azState.DeploymentArguments = @()
    $azState.GroupExists = 'true'
    $azState.PreviousAccountName = 'garage-cosmos-test'
    $azState.Accounts = @(@{ name = 'garage-cosmos-test'; location = 'eastus2' })
    $azState.FailedOperation = ''
  }

  It 'reuses the existing account region without changing the resource group region' {
    & $deployScript -SubscriptionId test -SkipConfirm

    $azState.DeploymentArguments | Should -Contain 'cosmosLocation=eastus2'
    $azState.DeploymentArguments | Should -Contain 'location=eastus'
    $azState.DeploymentArguments | Should -Contain 'resourceGroupName=garage-inventory'
  }

  It 'uses the same existing region for what-if' {
    & $deployScript -SubscriptionId test -WhatIf

    $azState.DeploymentArguments | Should -Contain 'what-if'
    $azState.DeploymentArguments | Should -Contain 'cosmosLocation=eastus2'
  }

  It 'accepts an explicit matching location and normalizes display names' {
    $azState.Accounts[0].location = 'East US 2'

    & $deployScript -SubscriptionId test -CosmosLocation 'EAST US 2' -SkipConfirm

    $azState.DeploymentArguments | Should -Contain 'cosmosLocation=eastus2'
  }

  It 'rejects a conflicting explicit location before registration or deployment' {
    { & $deployScript -SubscriptionId test -CosmosLocation eastus -SkipConfirm } |
      Should -Throw '*already exists in*eastus2*'

    $azState.DeploymentArguments.Count | Should -Be 0
    @($azState.Calls | Where-Object { $_[0] -eq 'provider' }).Count | Should -Be 0
  }

  It 'defaults a new resource group to the requested group location' {
    $azState.GroupExists = 'false'

    & $deployScript -SubscriptionId test -Location westus2 -SkipConfirm

    $azState.DeploymentArguments | Should -Contain 'cosmosLocation=westus2'
    @($azState.Calls | Where-Object { $_[0] -eq 'cosmosdb' }).Count | Should -Be 0
  }

  It 'honors the explicitly chosen region for a new account' {
    $azState.GroupExists = 'false'

    & $deployScript -SubscriptionId test -CosmosLocation eastus2 -SkipConfirm

    $azState.DeploymentArguments | Should -Contain 'cosmosLocation=eastus2'
  }

  It 'does not adopt an unrelated account when there is no deployment history' {
    $azState.PreviousAccountName = ''

    & $deployScript -SubscriptionId test -SkipConfirm

    $azState.DeploymentArguments | Should -Contain 'cosmosLocation=eastus'
    @($azState.Calls | Where-Object { $_[0] -eq 'cosmosdb' }).Count | Should -Be 0
  }

  It 'allows a new region if the recorded account no longer exists' {
    $azState.Accounts = @(@{ name = 'garage-cosmos-unrelated'; location = 'westus2' })

    & $deployScript -SubscriptionId test -CosmosLocation centralus -SkipConfirm

    $azState.DeploymentArguments | Should -Contain 'cosmosLocation=centralus'
  }

  It 'selects the recorded account rather than another account in the group' {
    $azState.Accounts = @(@{ name = 'garage-cosmos-unrelated'; location = 'westus2' }) + $azState.Accounts

    & $deployScript -SubscriptionId test -SkipConfirm

    $azState.DeploymentArguments | Should -Contain 'cosmosLocation=eastus2'
  }

  It 'fails instead of defaulting the region when discovery fails' -ForEach @(
    @{ Operation = 'group exists'; Reason = 'check resource group' }
    @{ Operation = 'deployment group'; Reason = 'read previous Cosmos deployment' }
    @{ Operation = 'cosmosdb list'; Reason = 'read existing Cosmos accounts' }
  ) {
    $azState.FailedOperation = $Operation

    { & $deployScript -SubscriptionId test -SkipConfirm } | Should -Throw "Failed: $Reason"

    $azState.DeploymentArguments.Count | Should -Be 0
  }

  It 'rejects an unrecognized resource group existence response' {
    $azState.GroupExists = ''

    { & $deployScript -SubscriptionId test -SkipConfirm } |
      Should -Throw '*Could not determine whether resource group*'

    $azState.DeploymentArguments.Count | Should -Be 0
  }

  It 'rejects an existing account with no location' {
    $azState.Accounts[0].location = ''

    { & $deployScript -SubscriptionId test -SkipConfirm } |
      Should -Throw '*Could not read the location*'

    $azState.DeploymentArguments.Count | Should -Be 0
  }
}
