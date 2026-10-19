targetScope = 'resourceGroup'

@description('Azure region for the new hosting resources.')
param location string

@description('Stable environment name used by the new hosting resource tags.')
param environmentName string

@description('New hosting session identifier retained in resource tags.')
param sessionId string

@description('Human-readable actor recorded in the new hosting resource tags.')
param deployedBy string

@description('ISO 8601 creation timestamp recorded in the new hosting resource tags.')
param createdAt string

@description('New Linux App Service plan name.')
param planName string

@description('New native Node App Service name.')
param appName string

@description('Existing Azure AI Search service name.')
param searchServiceName string

@description('Existing storage account name.')
param storageAccountName string

@description('Existing Key Vault name.')
param keyVaultName string

@description('Existing private quota container name.')
param quotaContainerName string

@description('Public live retrieval remains disabled unless the approved rollout explicitly enables it.')
param liveEnabled bool = false

var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: environmentName
  'deployed-by': deployedBy
}

var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource appServicePlan 'Microsoft.Web/serverfarms@2026-08-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: 'S1'
    tier: 'Standard'
    size: 'S1'
    family: 'S'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource appService 'Microsoft.Web/sites@2026-08-01' = {
  name: appName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      alwaysOn: true
      appCommandLine: 'npm start'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      remoteDebuggingEnabled: false
      healthCheckPath: '/healthz'
    }
  }
}

resource appSettings 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: appService
  name: 'appsettings'
  properties: {
    PUBLIC_ORIGIN: 'https://${appService.properties.defaultHostName}'
    AZURE_SEARCH_ENDPOINT: 'https://${searchServiceName}.search.windows.net'
    AZURE_SEARCH_API_KEY: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=search-api-key)'
    SESSION_SECRET: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=session-secret)'
    FOUNDRY_IQ_QUOTA_CONTAINER_URL: 'https://${storageAccountName}.blob.${environment().suffixes.storage}/${quotaContainerName}'
    FOUNDRY_IQ_LIVE_ENABLED: liveEnabled ? 'true' : 'false'
    FOUNDRY_IQ_MEDIUM_ENABLED: 'false'
    FOUNDRY_IQ_TRUST_APP_SERVICE_PROXY: 'false'
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
    ENABLE_ORYX_BUILD: 'false'
    NODE_ENV: 'production'
  }
  dependsOn: [
    appSearchApiKeyRole
    appSessionSecretRole
    appQuotaContainerRole
  ]
}

resource scmPublishingCredentialsPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = {
  parent: appService
  name: 'scm'
  properties: {
    allow: false
  }
}

resource ftpPublishingCredentialsPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = {
  parent: appService
  name: 'ftp'
  properties: {
    allow: false
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2026-05-15' existing = {
  name: keyVaultName
}

resource searchApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2026-05-15' existing = {
  parent: keyVault
  name: 'search-api-key'
}

resource sessionSecret 'Microsoft.KeyVault/vaults/secrets@2026-05-15' existing = {
  parent: keyVault
  name: 'session-secret'
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2026-09-01' existing = {
  name: storageAccountName
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2026-09-01' existing = {
  parent: storageAccount
  name: 'default'
}

resource quotaContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2026-09-01' existing = {
  parent: blobService
  name: quotaContainerName
}

resource appSearchApiKeyRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(searchApiKeySecret.id, appService.name, keyVaultSecretsUserRoleId)
  scope: searchApiKeySecret
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource appSessionSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(sessionSecret.id, appService.name, keyVaultSecretsUserRoleId)
  scope: sessionSecret
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource appQuotaContainerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(quotaContainer.id, appService.name, storageBlobDataContributorRoleId)
  scope: quotaContainer
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      storageBlobDataContributorRoleId
    )
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output hostingPlanName string = appServicePlan.name
output hostingAppName string = appService.name
output hostingAppPrincipalId string = appService.identity.principalId
output hostingDefaultHostName string = appService.properties.defaultHostName
