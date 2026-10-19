targetScope = 'subscription'

@description('Explicit Azure subscription selected for this hosting-only scaffold.')
param subscriptionId string = 'ee787b9b-a25f-4d20-86e9-45fcea5253dd'

@description('Stable environment name used by the new hosting resource tags.')
param environmentName string = 'foundryiq-customer-demos'

@description('Azure region for the new hosting resources.')
param location string = 'westus2'

@description('New hosting session identifier retained in resource tags.')
param sessionId string = 'd432e314-2aaa-47fc-ae17-779393c6dc8d'

@description('Human-readable actor recorded in the new hosting resource tags.')
param deployedBy string = 'Farzad Sunavala'

@description('ISO 8601 creation timestamp recorded in the new hosting resource tags.')
param createdAt string

@description('Existing resource group reused by the hosting scaffold.')
param resourceGroupName string = 'rg-foundryiq-customer-demos'

@description('New Linux App Service plan name.')
param planName string = 'plan-foundryiq-customer-demos'

@description('New native Node App Service name.')
param appName string = 'app-foundryiq-customer-demos'

@description('Existing Azure AI Search service name.')
param searchServiceName string = 'srch-foundryiq-customer-demos'

@description('Existing storage account name.')
param storageAccountName string = 'stfoundryiqcustomerdemos'

@description('Existing Key Vault name.')
param keyVaultName string = 'kv-fiq-customer-demos'

@description('Existing private quota container name.')
param quotaContainerName string = 'demo-quotas'

@description('Enable public live retrieval only after separate rollout approval and dependency verification.')
param liveEnabled bool = false

resource existingResourceGroup 'Microsoft.Resources/resourceGroups@2023-07-01' existing = {
  name: resourceGroupName
  scope: subscription(subscriptionId)
}

module hostingResources './hosting-resources.bicep' = {
  name: 'foundryiq-customer-demos-hosting'
  scope: existingResourceGroup
  params: {
    location: location
    environmentName: environmentName
    sessionId: sessionId
    deployedBy: deployedBy
    createdAt: createdAt
    planName: planName
    appName: appName
    searchServiceName: searchServiceName
    storageAccountName: storageAccountName
    keyVaultName: keyVaultName
    quotaContainerName: quotaContainerName
    liveEnabled: liveEnabled
  }
}

output resourceGroupName string = existingResourceGroup.name
output hostingPlanName string = hostingResources.outputs.hostingPlanName
output hostingAppName string = hostingResources.outputs.hostingAppName
output hostingAppPrincipalId string = hostingResources.outputs.hostingAppPrincipalId
output hostingDefaultHostName string = hostingResources.outputs.hostingDefaultHostName
