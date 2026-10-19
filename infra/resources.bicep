targetScope = 'resourceGroup'

@description('Azure region for all resources.')
param location string

@description('The five session tags from main.bicep.')
param tags object

@description('Object ID of the approved operator receiving narrow demo-resource roles.')
param deployerObjectId string

var searchServiceName = 'srch-foundryiq-customer-demos'
var storageAccountName = 'stfoundryiqcustomerdemos'
var keyVaultName = 'kv-fiq-customer-demos'
var foundryAccountName = 'ai-foundryiq-customer-demos'
var foundryProjectName = 'proj-foundryiq-customer-demos'
var retrievalDeploymentName = 'foundryiq-customer-demos-retrieval'
var embeddingDeploymentName = 'foundryiq-customer-demos-embedding'

var storageEndpoint = 'https://${storageAccountName}.blob.${environment().suffixes.storage}'
var searchEndpoint = 'https://${searchServiceName}.search.windows.net'

resource storage 'Microsoft.Storage/storageAccounts@2026-09-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2026-09-01' = {
  parent: storage
  name: 'default'
  properties: {}
}

resource demoContentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2026-09-01' = {
  parent: blobService
  name: 'demo-content'
  properties: {
    publicAccess: 'None'
  }
}

resource demoQuotasContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2026-09-01' = {
  parent: blobService
  name: 'demo-quotas'
  properties: {
    publicAccess: 'None'
  }
}

resource searchService 'Microsoft.Search/searchServices@2025-05-01' = {
  name: searchServiceName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'basic'
  }
  properties: {
    authOptions: {
      aadOrApiKey: {
        aadAuthFailureMode: 'http401WithBearerChallenge'
      }
    }
    disableLocalAuth: false
    hostingMode: 'Default'
    partitionCount: 1
    publicNetworkAccess: 'Enabled'
    replicaCount: 1
    semanticSearch: 'standard'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2026-05-15' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
    publicNetworkAccess: 'Enabled'
  }
}

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: foundryAccountName
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    allowProjectManagement: true
    customSubDomainName: foundryAccountName
    disableLocalAuth: true
    dynamicThrottlingEnabled: false
    publicNetworkAccess: 'Enabled'
    restrictOutboundNetworkAccess: false
  }
}

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: foundryAccount
  name: foundryProjectName
  // Model and project mutations share the parent account's operation lock.
  dependsOn: [
    embeddingDeployment
  ]
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: 'Foundry IQ customer demos'
    description: 'New Microsoft Foundry project for the Foundry IQ customer demos.'
  }
}

resource retrievalDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: foundryAccount
  name: retrievalDeploymentName
  tags: tags
  sku: {
    name: 'Standard'
    capacity: 100
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-5.1'
      version: '2025-11-13'
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: foundryAccount
  name: embeddingDeploymentName
  // Keep account child deployment operations serial to avoid provider races.
  dependsOn: [
    retrievalDeployment
  ]
  tags: tags
  sku: {
    name: 'Standard'
    capacity: 20
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'text-embedding-3-small'
      version: '1'
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

var keyVaultSecretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageBlobDataReaderRoleId = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
var searchServiceContributorRoleId = '7ca78c08-252a-4471-8644-bb5ff32d4ba0'
var searchIndexDataContributorRoleId = '8ebe5a00-799e-43f5-93ac-243d3dce84a7'
var cognitiveServicesOpenAIUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
var foundryUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

resource operatorKeyVaultSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, deployerObjectId, keyVaultSecretsOfficerRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsOfficerRoleId)
    principalId: deployerObjectId
    principalType: 'User'
  }
}

resource operatorContentBlobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(demoContentContainer.id, deployerObjectId, storageBlobDataContributorRoleId)
  scope: demoContentContainer
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      storageBlobDataContributorRoleId
    )
    principalId: deployerObjectId
    principalType: 'User'
  }
}

resource operatorQuotaBlobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(demoQuotasContainer.id, deployerObjectId, storageBlobDataContributorRoleId)
  scope: demoQuotasContainer
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      storageBlobDataContributorRoleId
    )
    principalId: deployerObjectId
    principalType: 'User'
  }
}

resource operatorSearchServiceContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(searchService.id, deployerObjectId, searchServiceContributorRoleId)
  scope: searchService
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', searchServiceContributorRoleId)
    principalId: deployerObjectId
    principalType: 'User'
  }
}

resource operatorSearchIndexDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(searchService.id, deployerObjectId, searchIndexDataContributorRoleId)
  scope: searchService
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      searchIndexDataContributorRoleId
    )
    principalId: deployerObjectId
    principalType: 'User'
  }
}

resource operatorFoundryInference 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, deployerObjectId, cognitiveServicesOpenAIUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      cognitiveServicesOpenAIUserRoleId
    )
    principalId: deployerObjectId
    principalType: 'User'
  }
}

resource searchContentBlobReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(demoContentContainer.id, searchService.name, storageBlobDataReaderRoleId)
  scope: demoContentContainer
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataReaderRoleId)
    principalId: searchService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource searchFoundryInference 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, searchService.name, cognitiveServicesOpenAIUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      cognitiveServicesOpenAIUserRoleId
    )
    principalId: searchService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource searchServiceContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(searchService.id, searchService.name, searchServiceContributorRoleId)
  scope: searchService
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', searchServiceContributorRoleId)
    principalId: searchService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource searchIndexDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(searchService.id, searchService.name, searchIndexDataContributorRoleId)
  scope: searchService
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      searchIndexDataContributorRoleId
    )
    principalId: searchService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryProjectUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, foundryProject.name, foundryUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', foundryUserRoleId)
    principalId: foundryProject.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output searchServiceName string = searchService.name
output searchEndpoint string = searchEndpoint
output storageAccountName string = storage.name
output contentContainerUrl string = '${storageEndpoint}/demo-content'
output quotaContainerUrl string = '${storageEndpoint}/demo-quotas'
output keyVaultName string = keyVault.name
output foundryAccountName string = foundryAccount.name
output foundryProjectName string = foundryProject.name
output retrievalDeploymentName string = retrievalDeployment.name
output embeddingDeploymentName string = embeddingDeployment.name
