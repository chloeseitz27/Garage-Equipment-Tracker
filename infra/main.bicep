/*
  Garage Inventory infrastructure.

  Subscription-scoped so it owns the resource group too, making the whole
  deployment reproducible from nothing:

    az deployment sub create --location eastus --template-file infra/main.bicep --parameters infra/main.bicepparam

  Idempotent — re-running reconciles rather than duplicating.
*/
targetScope = 'subscription'

@description('Azure region for the resource group.')
param location string = 'eastus'

@description('''
Region for Cosmos. Kept separate from the group's location because Cosmos
capacity varies by region — popular regions return ServiceUnavailable for new
accounts, and a group's location cannot be changed after creation.
''')
param cosmosLocation string = location

@description('Resource group to create or reuse.')
param resourceGroupName string = 'garage-inventory'

@description('''
Object id granted Cosmos data-plane access — normally your own user.
Get it with: az ad signed-in-user show --query id -o tsv
''')
param principalId string = ''

@description('Set false if the subscription has already used its one free-tier Cosmos account.')
param enableFreeTier bool = true

/*
  Cosmos account names are globally unique. Deriving from the subscription and
  group keeps redeploys stable — a random suffix would orphan the old account
  and burn the one free-tier slot.
*/
var cosmosAccountName = 'garage-cosmos-${uniqueString(subscription().subscriptionId, resourceGroupName)}'

resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: resourceGroupName
  location: location
}

module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  scope: rg
  params: {
    location: cosmosLocation
    accountName: cosmosAccountName
    principalId: principalId
    enableFreeTier: enableFreeTier
  }
}

output resourceGroupName string = rg.name
output cosmosAccountName string = cosmos.outputs.accountName
output cosmosLocation string = cosmosLocation
output cosmosEndpoint string = cosmos.outputs.endpoint
output cosmosDatabase string = cosmos.outputs.databaseName
output cosmosContainer string = cosmos.outputs.containerName
