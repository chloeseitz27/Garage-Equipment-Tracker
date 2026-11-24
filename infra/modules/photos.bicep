param location string
@description('Globally unique Storage account name: 3-24 lowercase letters or digits.')
@minLength(3)
@maxLength(24)
param accountName string
param principalId string = ''

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
  }
}

resource service 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: service
  name: 'item-photos'
  properties: {
    publicAccess: 'None'
  }
}

var contributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
resource access 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(principalId)) {
  name: guid(container.id, principalId, contributorRole)
  scope: container
  properties: {
    roleDefinitionId: contributorRole
    principalId: principalId
  }
}

output endpoint string = account.properties.primaryEndpoints.blob
output containerName string = container.name
