const manuals = {
  name: 'foundryiq-customer-demos-manuals',
  kind: 'azureBlob',
  title: 'Equipment manuals',
  detail: 'Indexed public synthetic manuals and checklists',
  files: [],
};
const maintenance = {
  name: 'foundryiq-customer-demos-maintenance',
  kind: 'searchIndex',
  title: 'Maintenance records',
  detail: 'Hybrid keyword + vector index of public synthetic records',
  files: [],
};

// Protected legacy resources remain available to their repository-only operators.
export const legacyKnowledgeBases = [
  {
    id: 'foundryiq-customer-demos-indexed',
    name: 'Indexed operations',
    description: 'Compare public equipment manuals with maintenance records.',
    question: 'Which restart checks and approvals are still pending for pump P-104?',
    sources: [manuals, maintenance],
  },
  {
    id: 'foundryiq-customer-demos-web',
    name: 'Indexed + Web guidance',
    description: 'Compare the same indexed sources with approved public web guidance.',
    question: 'Compare the P-104 maintenance record with public guidance on documenting equipment inspections.',
    sources: [
      manuals,
      maintenance,
      {
        name: 'foundryiq-customer-demos-web-guidance',
        kind: 'web',
        title: 'Public Web guidance',
        detail: 'Remote cited summaries; domains configured and approved by the operator',
        files: [],
      },
    ],
  },
];

export const knowledgeBases = [
  {
    id: 'zava-hr-policy',
    name: 'Zava-HR Policy Knowledge Base',
    description: 'Resolve employee-policy questions across leave, travel and international remote work.',
    question: 'Can a UK employee with eight months of service work remotely from Portugal for 20 consecutive workdays after parental leave? Explain eligibility, limits and approvals.',
    suggestions: [
      { label: 'Resolve a policy edge case', question: 'Can a UK employee with eight months of service work remotely from Portugal for 20 consecutive workdays after parental leave? Explain eligibility, limits and approvals.' },
      { label: 'Check the current revision', question: 'What changed in the international remote-work notice period in revision 4, and can a manager waive the other requirements?' },
    ],
    sources: [{ name: 'zava-hr-policy-source', kind: 'azureBlob', title: 'Zava HR policies', files: [] }],
  },
  {
    id: 'zava-finance-documents',
    name: 'Zava-Finance Documents Knowledge Base',
    description: 'Reconcile purchasing controls, committed spend and the current budget snapshot.',
    question: 'Can ENG-420 approve an $18,500 subscription plus $6,000 onboarding from its 15 October 2026 budget? Include approval thresholds, available budget and the status of BR-017.',
    suggestions: [
      { label: 'Reconcile the real commitment', question: 'Can ENG-420 approve an $18,500 subscription plus $6,000 onboarding from its 15 October 2026 budget? Include approval thresholds, available budget and the status of BR-017.' },
      { label: 'Build an approval checklist', question: 'What approvals, competing quotes and data-protection checks does a new $24,500 SaaS vendor need before purchase?' },
    ],
    sources: [{ name: 'zava-finance-documents-source', kind: 'azureBlob', title: 'Zava finance documents', files: [] }],
  },
  {
    id: 'zava-technical-manuals',
    name: 'Zava-Technical-Manuals Knowledge Base',
    description: 'Reason through checkout incidents, safe rollbacks and payment integration.',
    question: 'After release 2026.10.3, one checkout sample shows p95 1.4 seconds and 8% payment timeouts. Does this justify rollback or a database restore? State the missing evidence and safe sequence.',
    suggestions: [
      { label: 'Choose a safe incident response', question: 'After release 2026.10.3, one checkout sample shows p95 1.4 seconds and 8% payment timeouts. Does this justify rollback or a database restore? State the missing evidence and safe sequence.' },
      { label: 'Avoid duplicate payments', question: 'How should an integration retry a timed-out payment without duplicate charges? Explain idempotency lifetime and conflicting-payload behavior.' },
    ],
    sources: [{ name: 'zava-technical-manuals-source', kind: 'azureBlob', title: 'Zava technical manuals', files: [] }],
  },
  {
    id: 'zava-state-of-ai-report',
    name: 'Zava-State-of-AI-Report Knowledge Base',
    description: 'Explore the State of AI Report 2026 and browse its original PDF pages.',
    question: 'Why does the report say that agent harnesses change model comparisons? Summarize the quantitative evidence and cite the original PDF pages.',
    suggestions: [
      { label: 'Look beyond the model leaderboard', question: 'Why does the report say that agent harnesses change model comparisons? Summarize the quantitative evidence and cite the original PDF pages.' },
      { label: 'Separate findings from forecasts', question: 'Which predictions does the report make for the next year, and how do those differ from its observed results? Cite the original PDF pages.' },
    ],
    sources: [{ name: 'zava-state-of-ai-report-source', kind: 'azureBlob', title: 'State of AI Report 2026 · extracted text', files: [] }],
    report: { version: '93f9a0202726d904', pageCount: 244 },
  },
];

export function publicCatalog() {
  return knowledgeBases.map(kb => ({ ...kb, execution: 'live' }));
}
