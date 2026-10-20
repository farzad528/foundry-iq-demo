export const archiveFiles = Object.freeze([
  'page.html', 'server.template.mjs', 'package.json', 'package-lock.json', 'README.md', 'AGENTS.md', '.env.example', '.gitignore', 'LICENSE',
  'config/scenarios.json', 'config/knowledge-bases.mjs',
  'lib/protocol.mjs', 'lib/normalize.mjs', 'lib/quota.mjs', 'lib/http.mjs', 'lib/report-pages.mjs',
  'assets/client.mjs', 'assets/request.mjs', 'assets/source-icons.mjs', 'assets/blob.svg', 'assets/search.svg', 'assets/web.svg', 'assets/fabric.svg', 'assets/sharepoint.svg', 'assets/source.svg', 'assets/PROVENANCE.md', 'assets/explorer-preview.png',
  'assets/sql.svg', 'assets/file.svg', 'assets/mcp.svg', 'assets/workiq.svg',
  'scripts/build.mjs', 'scripts/build.sh', 'scripts/dev.mjs', 'scripts/start.mjs', 'scripts/verify.mjs', 'scripts/validate-artifact.mjs',
  'scripts/source-files.mjs', 'scripts/test-support.mjs', 'scripts/fixtures/published-response.json',
  'samples/comparison-guidelines.md', 'samples/contoso-disclosure.md', 'samples/p104-restart.md',
  'samples/popup-policy.md', 'samples/popup-safety.md', 'samples/recovery-plan.md',
  'samples/regional-performance.csv', 'samples/seal-inspection.md', 'samples/wo104.md', 'samples/public-corpus.json',
  'samples/zava/hr/employee-handbook.md', 'samples/zava/hr/leave-and-benefits.md',
  'samples/zava/hr/international-remote-work.md', 'samples/zava/hr/business-travel.md',
  'samples/zava/finance/purchasing-and-approvals.md', 'samples/zava/finance/expense-reimbursement.md',
  'samples/zava/finance/fy2027-quarter-one-budget.md', 'samples/zava/finance/month-end-close.md',
  'samples/zava/technical/checkout-architecture.md', 'samples/zava/technical/incident-and-rollback-runbook.md',
  'samples/zava/technical/checkout-api-integration.md', 'samples/zava/technical/security-and-recovery.md',
]);

export const operationalFiles = Object.freeze([
  'config/knowledge-definitions.json', 'scripts/provision-search.mjs',
  'scripts/package-appservice.mjs', 'scripts/capture-canary.mjs',
  'scripts/local-live.mjs', 'scripts/public-hosting.mjs',
]);
