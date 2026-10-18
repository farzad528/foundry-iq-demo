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

// These are planned deployment identities, not evidence of provisioned resources.
export const knowledgeBases = [
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
        detail: 'Remote cited summaries; allowed domains await operator approval',
        files: [],
      },
    ],
  },
];

export function publicCatalog(samples) {
  return [
    ...knowledgeBases.map(kb => ({ ...kb, execution: 'live' })),
    ...samples.map(({ fixture, answer, ...sample }) => ({ ...sample, execution: 'sample' })),
  ];
}
