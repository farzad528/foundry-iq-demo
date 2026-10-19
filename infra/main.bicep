targetScope = 'subscription'

@description('Stable environment name used by the session tags.')
@minLength(1)
@maxLength(64)
param environmentName string

@description('Azure region for the resource group and resources.')
@minLength(1)
param location string

@description('Onboarding session identifier retained in resource tags.')
param sessionId string

@description('Human-readable actor recorded in resource tags.')
param deployedBy string

@description('ISO 8601 creation timestamp retained in resource tags.')
param createdAt string

@description('Object ID of the approved operator who receives the narrow demo-resource roles.')
param deployerObjectId string

var resourceGroupName = 'rg-foundryiq-customer-demos'

var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: environmentName
  'deployed-by': deployedBy
}

resource resourceGroup 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module resources './resources.bicep' = {
  name: 'foundryiq-customer-demos-resources'
  scope: resourceGroup
  params: {
    location: location
    tags: tags
    deployerObjectId: deployerObjectId
  }
}

output resourceGroupName string = resourceGroup.name
output searchServiceName string = resources.outputs.searchServiceName
output searchEndpoint string = resources.outputs.searchEndpoint
output storageAccountName string = resources.outputs.storageAccountName
output contentContainerUrl string = resources.outputs.contentContainerUrl
output quotaContainerUrl string = resources.outputs.quotaContainerUrl
output keyVaultName string = resources.outputs.keyVaultName
output foundryAccountName string = resources.outputs.foundryAccountName
output foundryProjectName string = resources.outputs.foundryProjectName
output retrievalDeploymentName string = resources.outputs.retrievalDeploymentName
output embeddingDeploymentName string = resources.outputs.embeddingDeploymentName
