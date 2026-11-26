import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { products, documents, graph, topics, datasetVersion } from '../config/studio-corpus.mjs';

export const scaleTargets = {
  dev: { products: 40, images: 12, inventory: 100, orders: 20, cases: 40, policies: 30, manuals: 12,
    tables: 12, incidents: 12, bulletins: 12, contracts: 10, edges: 100, topics: 10, policyRevisions: 10 },
  full: { products: 2000, images: 500, inventory: 5000, orders: 1000, cases: 3000, policies: 30, manuals: 200,
    tables: 200, incidents: 250, bulletins: 100, contracts: 100, edges: 4000, topics: 150, policyRevisions: 100 },
};
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const fill = (count, make) => Array.from({ length: count }, (_, i) => make(i));
const ident = (prefix, i) => `${prefix}-${String(i + 1).padStart(5, '0')}`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function illustrationPng(index = 0) {
  const width = 240, height = 180;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  const colors = [[40, 85, 160], [163, 53, 53], [56, 115, 78]];
  const color = colors[index % colors.length];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const brim = ((x - 120) / 90) ** 2 + ((y - 123) / 22) ** 2 <= 1;
      const crown = y >= 55 && y <= 120 && Math.abs(x - 120) <= 44 + (y - 55) * 0.27;
      const bowl = y >= 90 && ((x - 120) / 82) ** 2 + ((y - 85) / 65) ** 2 <= 1;
      const tool = x >= 65 && x <= 175 && y >= 60 && y <= 95 || x >= 125 && x <= 155 && y >= 95 && y <= 145;
      const shape = index % 5 === 3 ? bowl : index % 5 === 4 ? tool : brim || crown;
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      pixels.set(shape ? [...color, 255] : [244, 245, 246, 255], offset);
    }
  }
  const crc = data => {
    let value = 0xffffffff;
    for (const byte of data) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export function makeManualPdf() {
  const escape = text => text.replace(/[\\()]/g, '\\$&');
  const text = (x, top, value) => `BT /F1 11 Tf ${x} ${792 - top} Td (${escape(value)}) Tj ET\n`;
  const page1 = text(60, 60, 'Zava Retail - ORIGINAL FICTIONAL MANUAL')
    + text(60, 90, 'MAN-DRILL-1001. Synthetic demonstration, not real product specifications.')
    + text(60, 120, 'Battery: DRILL-1001 uses BAT-18V-A. DRILL-1002 uses BAT-18V-B.')
    + text(60, 150, 'For charging failures contact support; never bypass a safety circuit.');
  let page2 = text(60, 60, 'MAN-DRILL-1001 - Table T-1 - synthetic specifications')
    + text(60, 100, 'Model          Concrete (mm)       Wood (mm)       Steel (mm)');
  const rows = [['DCD796', '13', '40', '13'], ['DCD797', '16', '38', '13']];
  rows.forEach((row, i) => {
    const top = 120 + i * 24;
    page2 += `60 ${792 - top - 24} 470 24 re S\n`;
    row.forEach((value, j) => { page2 += text([70, 200, 330, 440][j], top + 16, value); });
  });
  page2 += text(60, 205, 'Top-left row rectangles in points: (60,120,470,24) and (60,144,470,24).')
    + text(60, 230, 'Adjacent rows deliberately differ. These are invented model values.');
  const stream = content => `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', stream(page1), stream(page2),
  ];
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
export function extractManualPdf(pdf) {
  // Deliberately narrow extractor for OUR uncompressed original PDF, not arbitrary upload parsing.
  const source = pdf.toString('ascii');
  if (!source.startsWith('%PDF-1.4') || !source.includes('/Count 2')) throw new Error('Expected canonical original two-page PDF.');
  const streams = [...source.matchAll(/stream\n([\s\S]*?)endstream/g)].map(match => match[1]);
  if (streams.length !== 2) throw new Error('Unexpected canonical PDF page streams.');
  const cells = streams.map(stream => [...stream.matchAll(/BT \/F1 11 Tf (\d+) (\d+) Td \((.*?)\) Tj ET/g)]
    .map(match => ({ x: Number(match[1]), y: 792 - Number(match[2]), text: match[3].replace(/\\([\\()])/g, '$1') })));
  const rectangles = [...streams[1].matchAll(/(\d+) (\d+) (\d+) (\d+) re S/g)].map(match => ({
    page: 2, unit: 'pt', x: Number(match[1]), y: 792 - Number(match[2]) - Number(match[4]), width: Number(match[3]), height: Number(match[4]),
  }));
  const rows = rectangles.map((coordinates, i) => {
    const rowCells = cells[1].filter(cell => cell.y > coordinates.y && cell.y < coordinates.y + coordinates.height).sort((a, b) => a.x - b.x);
    if (rowCells.length !== 4 || !/^DCD\d+$/.test(rowCells[0].text) || rowCells.slice(1).some(cell => !/^\d+$/.test(cell.text))) throw new Error('Unexpected canonical table row.');
    return { sku: rowCells[0].text, row: i + 1, concrete: Number(rowCells[1].text), wood: Number(rowCells[2].text), steel: Number(rowCells[3].text), coordinates };
  });
  if (rows.length !== 2) throw new Error('Expected adjacent synthetic table rows.');
  return {
    sourceId: 'MAN-DRILL-1001', sourceUrl: '/samples/zava-manual.pdf', sourceHash: sha(pdf),
    extractionLabel: 'Deterministically extracted from original canonical uncompressed PDF; NOT Azure Content Understanding.',
    basic: { version: 'zava-basic-v1', pages: cells.map((page, i) => ({ page: i + 1, text: page.map(cell => cell.text).join(' ') })),
      limitation: 'Flattened reading-order text; cell coordinates and row association removed.' },
    layout: { version: 'zava-layout-v1', page: 2, tableId: 'T-1', rows,
      coordinateSystem: 'top-left PDF points; page size 612 x 792' },
  };
}
export function buildStudio(scale = 'dev') {
  if (!Object.hasOwn(scaleTargets, scale)) throw new Error('Scale must be dev or full.');
  const target = scaleTargets[scale];
  const records = {};
  records.products = [...structuredClone(products), ...fill(target.products - products.length, i => ({
    id: ident('ZAVA-P', i), sku: ident('ZAVA-SKU', i), title: `Zava fictional product ${i + 1}`,
    category: ['drill', 'battery', 'hat', 'appliance'][i % 4], content: 'Original synthetic catalog filler, no real customer content.',
    price: 25 + (i * 17 % 400), scope: 'public', datasetVersion,
    embeddingStatus: 'not generated; no compatible model configured',
  }))];
  records.images = fill(target.images, i => {
    const category = i % 5 === 3 ? 'appliance' : i % 5 === 4 ? 'drill' : 'hat';
    const anchor = ['HAT-001', 'HAT-002', null, 'BOWL-001', 'DRILL-1001'][i];
    const candidates = records.products.filter(item => item.category === category && item.id.startsWith('ZAVA-P-'));
    return { id: ident('ZAVA-IMAGE', i), productId: anchor || candidates[i % candidates.length].id,
      category, path: `images/${ident('zava-image', i)}.png`, mimeType: 'image/png', sha256: sha(illustrationPng(i)),
      license: 'Original illustrative geometry', encoderStatus: 'not encoded' };
  });
  records.inventory = fill(target.inventory, i => ({ id: ident('ZAVA-STOCK', i), productId: records.products[i % records.products.length].id,
    city: ['London', 'Manchester', 'Bristol'][i % 3], stock: i % 21, latitude: 51.5 + (i % 30) / 1000, longitude: -0.12 }));
  records.orders = fill(target.orders, i => ({ id: ident('ZAVA-ORDER', i), productId: records.products[i % records.products.length].id,
    purchaseDate: '2026-08-01', principal: 'synthetic-only', scope: 'public' }));
  records.cases = fill(target.cases, i => ({ id: ident('ZAVA-CASE', i), productId: i % 2 ? 'DRILL-1002' : 'DRILL-1001',
    orderId: records.orders[i % records.orders.length].id, lotId: i % 2 ? 'LOT-2501-C' : 'LOT-2407-A',
    content: i % 2 ? 'Synthetic water damage case, unrelated to B-17.' : 'Synthetic charging assessment pending; no automatic refund.', scope: 'public' }));
  records.policies = fill(target.policies, i => ({ id: ident('ZAVA-POLICY', i), title: 'Fictional policy supplement',
    content: 'Ordinary returns 30 days. Defective goods assessment is separate. Warranty exclusions apply.', revision: String(i + 1), scope: 'public' }));
  records.manuals = fill(target.manuals, i => ({ id: i === 0 ? 'MAN-DRILL-1001' : ident('ZAVA-MANUAL', i),
    path: `manuals/${ident('zava-manual', i)}.pdf`, originalSourceHash: sha(makeManualPdf()),
    contentKind: 'Original two-page illustrative table PDF; intentionally repeated scale filler', scope: 'public' }));
  records.tables = fill(target.tables, i => ({ id: ident('ZAVA-TABLE', i), sourceId: records.manuals[i % records.manuals.length].id,
    page: 2, rows: structuredClone(documents.find(d => d.id === 'MAN-DRILL-1001').rows), scope: 'public' }));
  records.incidents = fill(target.incidents, i => ({ id: i === 0 ? 'INC-2026-017' : ident('ZAVA-INCIDENT', i),
    componentId: i === 0 ? 'CELL-B17' : ident('ZAVA-CELL', i), lotIds: i === 0 ? ['LOT-2407-A', 'LOT-2407-B'] : [],
    scope: 'public', content: i === 0 ? 'B-17 confirmed for selected lots only.' : 'Unrelated fictional incident, no anchor defect.' }));
  records.bulletins = fill(target.bulletins, i => ({ id: i === 0 ? 'SUP-BUL-017' : ident('ZAVA-BULLETIN', i),
    supplierId: i === 0 ? 'SUP-017' : ident('ZAVA-SUP', i), content: 'Original synthetic supplier bulletin. Different parts are not automatically defective.', scope: 'public' }));
  records.contracts = fill(target.contracts, i => ({ id: i === 0 ? 'CON-SUP-017' : ident('ZAVA-CONTRACT', i),
    supplierId: i === 0 ? 'SUP-017' : ident('ZAVA-SUP', i), content: 'Contained fictional restricted contract, never anonymous evidence.', scope: 'procurement' }));
  records.edges = [...structuredClone(graph), ...fill(target.edges - graph.length, i => ({
    id: ident('ZAVA-EDGE', i), from: records.products[i % records.products.length].id, relation: 'documented_in',
    to: records.manuals[i % records.manuals.length].id, sourceId: records.manuals[i % records.manuals.length].id,
    scope: 'public', version: datasetVersion, syntheticScaleFiller: true,
  }))];
  records.topics = [...structuredClone(topics), ...fill(target.topics - topics.length, i => ({
    id: ident('ZAVA-TOPIC', i), title: 'Experimental synthetic topic', summary: 'No anchor defect claim.',
    sourceDocumentIds: [records.manuals[i % records.manuals.length].id], entities: [],
    lastRefreshedAt: '2026-09-01T00:00:00Z', revision: '1', accessScope: 'public', datasetVersion,
  }))];
  records.policyRevisions = fill(target.policyRevisions, i => ({
    id: ident('ZAVA-POLICY-REV', i), revision: String(i + 1), effectiveAt: '2026-09-01T00:00:00Z',
    indexedAt: null, ingestionStatus: 'not ingested', sourceId: records.policies[i % records.policies.length].id,
  }));
  const gold = JSON.parse(readFileSync(join(root, 'config', 'studio-gold.json'), 'utf8'));
  const fileHashes = Object.fromEntries(Object.entries(records).map(([kind, rows]) => [`${kind}.json`, sha(json(rows))]));
  return {
    records, gold,
    manifest: { datasetVersion, scale, seed: 'zava-fixed-v1', generatedAt: '2026-09-01T00:00:00Z',
      synthetic: true, indexed: false, scope: 'fictional original illustrative corpus',
      targets: target, actualCounts: Object.fromEntries(Object.entries(records).map(([kind, rows]) => [kind, rows.length])),
      curatedGoldTarget: 100, curatedGoldCount: gold.length, fileHashes,
      sourcePdfHash: sha(makeManualPdf()), embeddings: 'none; no paid calls, no fabricated text/image embeddings',
      extraction: { basic: 'local flattened text illustrative mechanism', standard: 'local authored row association; not Content Understanding service' },
      limits: ['Scale filler is not distinct customer evidence.', 'No ingestion/provisioning or readiness implied.', 'PNGs are original illustrations, not photographs.'] },
  };
}
export function generateStudio({ scale = 'dev', outputDir = `samples${sep}zava-generated-${scale}` } = {}) {
  if (isAbsolute(outputDir)) throw new Error('Use a project-relative owned output directory.');
  const output = resolve(root, outputDir);
  const rel = relative(join(root, 'samples'), output);
  if (rel.startsWith('..') || isAbsolute(rel) || !/^zava-generated-(?:dev|full)$/.test(rel)) throw new Error('Output must be samples\\zava-generated-dev or samples\\zava-generated-full.');
  for (let path = output; path !== root; path = dirname(path)) if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Symlink outputs are forbidden.');
  mkdirSync(output, { recursive: true });
  const data = buildStudio(scale);
  const write = (path, content) => {
    const file = join(output, path);
    for (let ancestor = dirname(file); ancestor !== output; ancestor = dirname(ancestor)) {
      if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) throw new Error('Symlink output directory forbidden.');
    }
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('Symlink output forbidden.');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  for (const [kind, rows] of Object.entries(data.records)) write(`${kind}.json`, json(rows));
  write('gold.json', json(data.gold));
  const pdf = makeManualPdf();
  for (const manual of data.records.manuals) write(manual.path, pdf);
  for (let i = 0; i < data.records.images.length; i++) {
    write(data.records.images[i].path, illustrationPng(i));
  }
  write('manifest.json', json(data.manifest));
  return data.manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--scale', 'dev', 'full', '--canonical'].includes(arg))) throw new Error('Usage: node scripts\\generate-studio.mjs --scale dev|full [--canonical]');
  const index = args.indexOf('--scale');
  const scale = index === -1 ? 'dev' : args[index + 1];
  if (args.includes('--canonical')) {
    const pdf = makeManualPdf();
    writeFileSync(join(root, 'samples', 'zava-manual.pdf'), pdf);
    writeFileSync(join(root, 'config', 'studio-extraction.json'), json(extractManualPdf(pdf)));
    const csv = ['id,sku,title,category,price,stock,city', ...products.map(p => [p.id, p.sku, p.title, p.category, p.price, p.stock, p.city].map(v => `"${String(v).replaceAll('"', '""')}"`).join(','))].join('\n') + '\n';
    writeFileSync(join(root, 'samples', 'zava-catalog.csv'), csv);
  } else console.log(json(generateStudio({ scale })));
}
