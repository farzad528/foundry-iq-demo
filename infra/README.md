# Foundry IQ customer demos — local-first live-demo IaC

The backend files `main.bicep`, `resources.bicep`, `parameters.example.json`
and this guide describe the dedicated Azure resources required for a
loopback local live demo. They do not publish the application or modify the
repository's source/startup scripts. The parent session owns the local
entrypoint, secret-in-memory handling, ingestion, retrieval checks, and all
actual Azure operations.

## Resource inventory

The subscription-scope `main.bicep` creates the exact resource group
`rg-foundryiq-customer-demos` in `westus2`, applies all five session tags, and
calls the local `resources.bicep` file.

`resources.bicep` creates only:

- Azure AI Search `srch-foundryiq-customer-demos`, Basic, one partition and one
  replica, system-assigned identity, `authOptions.aadOrApiKey`,
  `disableLocalAuth: false`, and `semanticSearch: 'standard'` for the
  supported paid semantic ranker.
- StorageV2 `stfoundryiqcustomerdemos`, Standard_LRS/Hot, HTTPS-only, TLS 1.2,
  shared-key disabled, anonymous Blob access disabled, and private
  `demo-content` and `demo-quotas` containers.
- RBAC-enabled Key Vault `kv-fiq-customer-demos`, with no access policies and
  no `enablePurgeProtection` property.
- A **new** Microsoft Foundry `AIServices` S0 parent
  `ai-foundryiq-customer-demos` with `allowProjectManagement: true`,
  `disableLocalAuth: true`, and a system-assigned identity.
- A **new** child project `proj-foundryiq-customer-demos` with identity,
  display name, description, and tags only. It has no writable `kind` or
  `sku`.
- Two model deployments directly under the Foundry parent, never under the
  project: `foundryiq-customer-demos-retrieval` (`gpt-5.1`,
  `2025-11-13`, Standard capacity 100) and
  `foundryiq-customer-demos-embedding` (`text-embedding-3-small`, version `1`,
  Standard capacity 20). Both use `versionUpgradeOption: 'NoAutoUpgrade'`;
  neither uses deprecated `scaleSettings` or `raiPolicyName`.

Model and project child operations are serialized: retrieval deployment, then
embedding deployment, then project creation. The provider shares an account
operation lock across these children; depending only on the parent can fail
with `RequestConflict` even when the resource definitions are valid.

The backend entrypoint intentionally contains no App Service, hosting plan,
Application Insights, Log Analytics, agent host, project connection, legacy hub,
or standalone/OpenAI-kind resource. The separate additive `hosting.bicep`,
`hosting-resources.bicep` and `hosting.parameters.example.json` reuse the existing
backends for public hosting; see the root README. Never rerun the backend
entrypoint to publish code or update citation URLs.

## Authorized narrow role inventory

`deployerObjectId` is a required main-template parameter. The example uses a
non-secret placeholder; the actual operator object ID must be supplied by the
approved deployment path.

Operator (`principalType: 'User'`):

- Key Vault Secrets Officer on the dedicated Key Vault.
- Storage Blob Data Contributor on `demo-content` only.
- Storage Blob Data Contributor on `demo-quotas` only.
- Search Service Contributor and Search Index Data Contributor on this Search
  service only.
- Cognitive Services OpenAI User on the Foundry parent only for model
  inference. This role does **not** create or authorize an OpenAI resource.

Search managed identity (`principalType: 'ServicePrincipal'`):

- Storage Blob Data Reader on `demo-content` only.
- Cognitive Services OpenAI User on the Foundry parent only.
- Search Service Contributor and Search Index Data Contributor on this Search
  service only for managed ingestion.

Foundry project managed identity:

- Foundry User on its own Foundry parent only.

No role is assigned at tenant, subscription, resource-group, or unrelated
resource scope. No Storage keys, secret values, list-keys functions, or
secret outputs are present in the templates or parameter example.

## Local-first operator flow

After the separate new-resource preflight and approved deployment, the local
demo should use an explicit Azure CLI credential and the selected subscription
`ee787b9b-a25f-4d20-86e9-45fcea5253dd` for every cloud operation. The local
entrypoint owned by the parent session is responsible for:

1. Reading the operator-initialized Search credential and stable session secret
   from this dedicated Key Vault into process memory only.
2. Using the Search endpoint and the two Foundry model deployments from the
   deployment outputs.
3. Ingesting only the approved public fictional corpus into the private
   content container/Search indexes.
4. Creating the quota ledger only when it is missing and disabled; never
   resetting existing counters. Live enablement still requires the lease/ETag
   safety checks and the existing per-session, per-IP, concurrent, and daily
   limits.
5. Keeping Web terms/domain approval, indexed/Web contract acceptance, document
   change checks, and cost/latency evidence explicit.

This IaC revision does not write secrets, initialize a blob, issue queries, or
claim that the local app is already live. Secrets must not be committed,
placed in `parameters.example.json`, passed as command-line arguments, or
written to logs.

## Mandatory new-only preflight

ARM/Bicep cannot tell whether a same-named resource is intentionally new or
being adopted. Before any ARM upsert, perform a read-only preflight using
subscription `ee787b9b-a25f-4d20-86e9-45fcea5253dd` and verify:

- The resource group, Search service, Storage account, Key Vault, Foundry
  parent, child project, and model names are available and not being adopted.
- The Foundry parent is created as `AIServices`, never `OpenAI`; the child is
  created under that new parent.
- Current policy, role-scope, region, Search semantic-ranker support, exact
  model versions/capacities, quota, and deployment what-if all pass.
- The supplied operator object ID is the intended user principal and is
  authorized for the narrow grants above.

Numeric capacity evidence is not a reservation. Fresh availability and
what-if checks remain required, especially because the two model deployments
and semantic ranker are billable. After a partial deployment, repair only
resources verified as created by the same approved session; never adopt an
unrelated same-named resource. Preserve successful resources and stable
secrets/ledger state, review the repair preview, and never delete/recreate the
resource group to retry.

## Validation

Local syntax validation:

```powershell
az bicep build --file infra/main.bicep --stdout | Out-Null
```

It checks Bicep syntax/type diagnostics only; it does not prove names,
permissions, policy, model availability, secret existence, ingestion, or
live retrieval.
