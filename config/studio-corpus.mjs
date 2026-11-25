// Original fictional data. These are local illustrative features, not embeddings.
export const datasetVersion = 'zava-studio-2026-01';
export const resourceVersion = 'local-mechanisms-v1';
const product = (id, sku, title, snippet, price, stock, features, extra = {}) => ({
  id, sku, title, snippet, price, stock, features, category: 'drill', city: 'London',
  distance: 2, updatedAt: '2026-09-01', tags: ['renovation'], scope: 'public',
  sourceType: 'synthetic-product', sourceId: id, url: '/samples/zava-catalog.csv', ...extra,
});
export const products = [
  product('DRILL-1001', 'DCD796', 'Zava DCD796 compact hammer drill',
    '18V cordless lightweight hammer drill for brick masonry and small home renovation. Battery BAT-18V-A.', 179, 8, [1, 1, 1, 0, 0, 0]),
  product('DRILL-1002', 'DCD797', 'Zava DCD797 brushless drill',
    '18V cordless compact home renovation drill. Battery BAT-18V-B uses a different lot, not subject to B-17.', 189, 12, [1, 0.6, 1, 0, 0, 0], { distance: 1 }),
  product('DRILL-1003', 'MASON-L', 'Zava Mason Lite',
    'Lightweight rotary tool for making holes in brick walls and concrete masonry.', 149, 5, [1, 1, 0.8, 0, 0, 0]),
  product('DRILL-1004', 'PRO-500', 'Zava professional masonry drill',
    '18V cordless lightweight masonry drill, professional home renovation marketing.', 329, 3, [1, 1, 1, 0, 0, 0]),
  product('DRILL-1005', 'HOME-18', 'Zava Home 18 drill',
    '18V cordless lightweight masonry drill for home renovation, temporarily out of stock.', 159, 0, [1, 1, 1, 0, 0, 0], { updatedAt: '2026-01-01' }),
  product('DRILL-1006', 'DCD796-LABEL', 'Zava exact identifier label printer',
    'DCD796 asset label printer. Not a drill. Prints identifiers only.', 79, 5, [0, 0, 0, 0, 0, 0], { category: 'appliance', tags: [] }),
  product('DRILL-1007', 'NORTH-18', 'Zava North masonry drill',
    '18V cordless lightweight drill for brick walls.', 169, 7, [1, 1, 1, 0, 0, 0], { city: 'Manchester', distance: 260 }),
  product('BAT-18V-A', 'BAT-18V-A', 'Zava battery A',
    '18V rechargeable pack, CELL-B17, SUP-017, LOT-2407-A and LOT-2407-B. Charging troubleshooting.', 59, 10, [0, 0, 0, 1, 0, 0], { category: 'battery' }),
  product('BAT-18V-B', 'BAT-18V-B', 'Zava battery B',
    '18V pack with CELL-C20 and LOT-2501-C, unaffected by B-17.', 65, 10, [0, 0, 0, 1, 0, 0], { category: 'battery' }),
  product('HAT-001', 'HAT-001', 'Zava blue bucket hat', 'Blue cotton bucket hat with round brim.', 19, 8, [0, 0, 0, 0, 1, 0],
    { category: 'hat', thumbnailUrl: '/samples/zava-hat-blue.svg', visual: [1, 0, 1] }),
  product('HAT-002', 'HAT-002', 'Zava red bucket hat', 'Red cotton bucket hat with round brim.', 19, 8, [0, 0, 0, 0, 1, 0],
    { category: 'hat', thumbnailUrl: '/samples/zava-hat-red.svg', visual: [0, 1, 1] }),
  product('BOWL-001', 'BOWL-001', 'Zava blue mixing bowl', 'Blue round kitchen bowl, not apparel.', 12, 8, [0, 0, 0, 0, 0, 1],
    { category: 'appliance', thumbnailUrl: '/samples/zava-bowl-blue.svg', visual: [1, 0, 0.7] }),
];
const doc = (id, title, snippet, extra = {}) => ({
  id, title, snippet, sourceId: id, sourceType: 'synthetic-document', scope: 'public',
  url: '/samples/zava-support.md', updatedAt: '2026-09-01', ...extra,
});
export const documents = [
  doc('POL-RET-2026-01', 'Ordinary returns policy', 'Ordinary returns require proof of purchase within 30 days. After 45 days the ordinary return window has ended.'),
  doc('POL-DEF-2026-02', 'Defective goods process', 'Defective battery goods after 45 days are not automatically refused: contact support for assessment with receipt, serial number and battery lot. Defective-goods exception is a separate process, not an automatic refund.'),
  doc('WAR-BAT-2026-01', 'Battery warranty', 'Battery charging warranty eligibility depends on purchase date, model, receipt and exclusions. Coverage is 12 months for manufacturing defects; excludes water damage, misuse and normal wear.'),
  doc('MAN-CHARGE-1001', 'Battery charging manual', 'Battery stopped charging: inspect charger and BAT-18V-A lot; stop use if overheating and contact support. Never bypass a damaged battery safety circuit.'),
  doc('POL-RECALL-v1', 'Retired battery recall policy', 'Old battery failures policy: return every battery to store. RETIRED. Revision v1 effective 2026-01-01.', { scope: 'retired' }),
  doc('POL-RECALL-v2', 'Current battery recall policy', 'Current battery failures recall policy: isolate only LOT-2407-A and LOT-2407-B, stop use, contact support for assessment; DRILL-1002 is not automatically affected. Revision v2 effective 2026-09-01.'),
  doc('INC-2026-017', 'Battery B-17 incident', 'Supplier SUP-017 component CELL-B17 defect B-17 affects LOT-2407-A and LOT-2407-B installed in DRILL-1001 with BAT-18V-A. Recurring battery failures. DRILL-1002 uses a different battery lot and is not automatically affected.'),
  doc('BOM-2026-01', 'Sourced battery bill of materials', 'DRILL-1001 uses BAT-18V-A; contains CELL-B17 supplied by SUP-017. Lots LOT-2407-A and LOT-2407-B. DRILL-1002 uses BAT-18V-B with CELL-C20, LOT-2501-C.'),
  doc('SUP-BUL-017', 'Supplier bulletin B-17', 'SUP-017 confirms CELL-B17 charging failures only in LOT-2407-A and LOT-2407-B. A different component CELL-X10 from same supplier is unaffected.'),
  doc('CASE-001', 'Charging failure support case', 'DRILL-1001 BAT-18V-A LOT-2407-A stopped charging after 45 days; receipt collected, defective goods assessment pending.'),
  doc('CASE-002', 'Unrelated battery case', 'DRILL-1002 BAT-18V-B LOT-2501-C water damage, unrelated to supplier defect B-17.'),
  doc('CON-SUP-017', 'Procurement-only supplier contract', 'Restricted synthetic procurement contract. Cost terms must never be exposed to anonymous visitors.', { scope: 'procurement' }),
  doc('MAN-DRILL-1001', 'Zava drill specification manual', 'Concrete drilling diameter: DCD796 13 mm; adjacent DCD797 row 16 mm. Wood: DCD796 40 mm. Steel: DCD796 13 mm.',
    { url: '/samples/zava-manual.pdf', page: 2, tableId: 'T-1', rows: [
      { sku: 'DCD796', row: 1, concrete: 13, wood: 40, steel: 13, coordinates: { page: 2, unit: 'pt', x: 60, y: 120, width: 470, height: 24 } },
      { sku: 'DCD797', row: 2, concrete: 16, wood: 38, steel: 13, coordinates: { page: 2, unit: 'pt', x: 60, y: 144, width: 470, height: 24 } },
    ] }),
];
export const graph = [
  ['SUP-017', 'supplies', 'CELL-B17', 'SUP-BUL-017'],
  ['CELL-B17', 'contained_in', 'BAT-18V-A', 'BOM-2026-01'],
  ['BAT-18V-A', 'has_lot', 'LOT-2407-A', 'BOM-2026-01'],
  ['BAT-18V-A', 'has_lot', 'LOT-2407-B', 'BOM-2026-01'],
  ['LOT-2407-A', 'installed_in', 'DRILL-1001', 'BOM-2026-01'],
  ['LOT-2407-B', 'installed_in', 'DRILL-1001', 'BOM-2026-01'],
  ['INC-2026-017', 'affects', 'LOT-2407-A', 'INC-2026-017'],
  ['INC-2026-017', 'affects', 'LOT-2407-B', 'INC-2026-017'],
  ['SUP-017', 'supplies', 'CELL-X10', 'SUP-BUL-017'],
  ['BAT-18V-B', 'has_lot', 'LOT-2501-C', 'BOM-2026-01'],
  ['LOT-2501-C', 'installed_in', 'DRILL-1002', 'BOM-2026-01'],
].map(([from, relation, to, sourceId], i) => ({ id: `EDGE-${String(i + 1).padStart(4, '0')}`, from, relation, to, sourceId, scope: 'public', version: datasetVersion }));
export const topics = [{
  id: 'TOPIC-BATTERY-FAILURES', title: 'Recurring battery failures',
  summary: 'B-17: CELL-B17 from SUP-017 affects LOT-2407-A and LOT-2407-B. Assess charging failures; DRILL-1002 is not automatically affected.',
  entities: ['INC-2026-017', 'SUP-017', 'CELL-B17', 'DRILL-1001'],
  sourceDocumentIds: ['INC-2026-017', 'SUP-BUL-017', 'POL-RECALL-v2'],
  lastRefreshedAt: '2026-09-01T00:00:00Z', revision: '2', accessScope: 'public',
  datasetVersion, materialization: 'Hand-authored synthetic experimental projection; no measured service cost.',
}];
export const illustrativeModel = { id: 'local-feature-ontology-v1', dimensions: 6, kind: 'synthetic local feature vectors; NOT Azure embeddings' };
