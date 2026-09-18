/*
  Cosmos DB for Garage Inventory.

  Layout is a single container partitioned on /type. Four containers would each
  need a 400 RU/s minimum — 1600 total, over the free tier's 1000 RU/s grant.
*/

@description('Azure region for the account.')
param location string

@description('Globally unique Cosmos account name (lowercase, 3-44 chars).')
@minLength(3)
@maxLength(44)
param accountName string

param databaseName string = 'garage'
param containerName string = 'catalog'

@description('Object id granted Cosmos data-plane access. Leave empty to skip.')
param principalId string = ''

@description('''
Free tier gives 1000 RU/s + 25 GB. One account per subscription, and it can only
be set at creation — an existing account cannot be converted.
''')
param enableFreeTier bool = true

@description('Container throughput. 400 is the minimum and fits inside the free grant.')
@minValue(400)
param throughput int = 400

@description('Hard ceiling on account throughput, so a stray autoscale change cannot run up a bill.')
param totalThroughputLimit int = 1000

@description('''
Disables key-based auth so every caller must use Entra ID. The app authenticates
with DefaultAzureCredential, so there is no key to leak or rotate.
''')
param disableLocalAuth bool = true

/** Cosmos DB Built-in Data Contributor. Data-plane RBAC, entirely separate from Azure RBAC. */
var dataContributorRoleId = '00000000-0000-0000-0000-000000000002'

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: enableFreeTier
    disableLocalAuth: disableLocalAuth
    minimalTlsVersion: 'Tls12'
    consistencyPolicy: {
      // Session is the right default for a single-writer kiosk: a staff edit is
      // immediately visible to the session that made it.
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capacity: {
      totalThroughputLimit: totalThroughputLimit
    }
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: account
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: ['/type']
        kind: 'Hash'
      }
    }
    options: {
      throughput: throughput
    }
  }
}

/*
  Without this, nobody can read or write data — not even the account's creator.
  Cosmos data-plane RBAC is separate from Azure RBAC, so Subscription Owner
  grants no data access whatsoever.
*/
resource dataAccess 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = if (!empty(principalId)) {
  parent: account
  name: guid(account.id, principalId, dataContributorRoleId)
  properties: {
    roleDefinitionId: '${account.id}/sqlRoleDefinitions/${dataContributorRoleId}'
    principalId: principalId
    scope: account.id
  }
}

output accountName string = account.name
output endpoint string = account.properties.documentEndpoint
output databaseName string = databaseName
output containerName string = containerName
output dataContributorRoleId string = dataContributorRoleId
