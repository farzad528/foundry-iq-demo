// AFTER-arm visuals for native Foundry IQ graph search: the S08 entity graph and the S09 topic map.
// The entity graph draws the rows Foundry IQ returned: each entity once per role, each relationship once per entity pair,
// laid out left to right along the query pattern. The topic map draws the topic hierarchy as nested bubbles whose area is
// the theme's share of passages, so groupings never look like relationships. Layouts are deterministic and use returned
// data only; nothing is added for visual density. Motion is a one-time reveal plus pulses on the highlighted neighbourhood
// while it is active, all in CSS, and prefers-reduced-motion turns it off.

const SVG_NS = 'http://www.w3.org/2000/svg';
export const PALETTE_SIZE = 6;
let instances = 0;
const watched = new Set();

function svgEl(tag, attributes = {}, className) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  if (className) element.setAttribute('class', className);
  return element;
}
function htmlEl(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
const round = value => Math.round(value * 10) / 10;
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const percent = value => `${Math.round(value * 100)}%`;
export const humanizeRole = role => String(role ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Truncates text to an approximate pixel width (system UI font), with an ellipsis. */
export function fitText(text, width, size = 12) {
  const value = String(text ?? '');
  const max = Math.floor(width / (size * 0.58));
  if (max < 3) return '';
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Wraps text into at most maxLines lines of an approximate pixel width; the last line is ellipsized if text remains. */
export function wrapText(text, width, size, maxLines) {
  const perLine = Math.floor(width / (size * 0.56));
  if (perLine < 4 || maxLines < 1) return [];
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    let line = words[index].length > perLine ? `${words[index].slice(0, perLine - 1)}…` : words[index];
    index += 1;
    while (index < words.length && `${line} ${words[index]}`.length <= perLine) line += ` ${words[index++]}`;
    lines.push(line);
  }
  if (index < words.length && lines.length && !lines.at(-1).endsWith('…')) {
    const last = lines.at(-1);
    lines[lines.length - 1] = last.length < perLine ? `${last}…` : `${last.slice(0, perLine - 1)}…`;
  }
  return lines;
}

// Redraws on width changes (debounced to one frame) and stops observing once a drawn view leaves the document.
// A view is built before it is attached, so only views that have been seen in the document are pruned.
function watchWidth(element, onWidth) {
  for (const entry of watched) if (entry.seen && !entry.target.isConnected) { entry.observer.disconnect(); watched.delete(entry); }
  let last = 0;
  let frame = 0;
  const entry = { target: element, seen: false };
  const run = () => {
    frame = 0;
    if (!element.isConnected) {
      if (entry.seen) { entry.observer.disconnect(); watched.delete(entry); }
      return;
    }
    entry.seen = true;
    const width = Math.floor(element.clientWidth);
    if (width > 0 && Math.abs(width - last) >= 4) { last = width; onWidth(width); }
  };
  entry.observer = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(run); });
  entry.observer.observe(element);
  watched.add(entry);
}

// Shared SVG paint servers: a soft glow and a luminous core per palette colour, and an arrowhead per colour.
function paintDefs(id, colors) {
  const defs = svgEl('defs');
  const stop = (offset, className, opacity) => svgEl('stop', { offset, 'stop-opacity': opacity }, className);
  for (const color of colors) {
    const glow = svgEl('radialGradient', { id: `${id}-glow-${color}` });
    glow.append(stop(0, `kg-s-c${color}`, 0.6), stop(0.35, `kg-s-c${color}`, 0.2), stop(1, `kg-s-c${color}`, 0));
    const core = svgEl('radialGradient', { id: `${id}-core-${color}`, cx: 0.36, cy: 0.34, r: 0.72 });
    core.append(stop(0, 'kg-s-hi', 1), stop(0.5, `kg-s-c${color}`, 1), stop(1, `kg-s-c${color}`, 1));
    const arrow = svgEl('marker', { id: `${id}-arrow-${color}`, viewBox: '0 0 8 8', refX: 7.2, refY: 4, markerWidth: 7, markerHeight: 7,
      markerUnits: 'userSpaceOnUse', orient: 'auto' });
    arrow.append(svgEl('path', { d: 'M0 0.6 L8 4 L0 7.4 Z' }, `kg-fill-c${color}`));
    defs.append(glow, core, arrow);
  }
  return defs;
}

// Keyboard and pointer behaviour shared by both views: roving focus, hover and focus preview, click or Enter to pin.
// Visible labels sit in their own aria-hidden layer and point at their item, so pointing at a label acts on its item.
function interactive(svg, { nodes, order, move, onChange, state }) {
  const nodeOf = target => {
    const element = target?.closest?.('[data-node],[data-label-for]');
    return element ? nodes.get(element.dataset.node ?? element.dataset.labelFor) ?? null : null;
  };
  svg.addEventListener('pointerover', event => { const item = nodeOf(event.target); if (item !== state.hover) { state.hover = item; onChange(); } });
  svg.addEventListener('pointerleave', () => { if (state.hover) { state.hover = null; onChange(); } });
  svg.addEventListener('click', event => {
    const item = nodeOf(event.target);
    state.pinned = item ? (state.pinned === item ? null : item) : null;
    if (item) state.current = item;
    onChange();
  });
  svg.addEventListener('focusin', event => { const item = nodeOf(event.target); if (item) { state.focus = item; state.current = item; onChange(); } });
  svg.addEventListener('keydown', event => {
    const item = nodeOf(event.target);
    if (!item) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      state.pinned = state.pinned === item ? null : item;
      onChange();
    } else if (event.key === 'Escape') {
      if (state.pinned) { event.preventDefault(); state.pinned = null; onChange(); }
    } else {
      const next = move(item, event.key);
      if (!next || next === item) return;
      event.preventDefault();
      state.current = next;
      onChange();
      svg.querySelector(`[data-node="${next.id}"]`)?.focus();
    }
  });
  // Roving tab stop: only the current item is in the tab order.
  return () => {
    const current = state.current && nodes.has(state.current.id) ? state.current : order[0];
    svg.querySelectorAll('[data-node]').forEach(element => element.setAttribute('tabindex', element.dataset.node === current?.id ? '0' : '-1'));
  };
}

// A one-line readout docked at the bottom of the stage, in room the layouts reserve, so it never covers an item. It is
// decorative (the item's aria-label carries the same facts); pinned details go to the panel below, so hovering never shifts the page.
const READOUT = 34;
function hoverCard() {
  const card = htmlEl('div', undefined, 'kg-tip');
  card.setAttribute('aria-hidden', 'true');
  card.hidden = true;
  return card;
}
function placeCard(card, item, fill) {
  if (!item) { card.hidden = true; delete card.dataset.for; return; }
  if (card.dataset.for !== item.id) {
    card.className = `kg-tip kg-c${item.color}`;
    card.replaceChildren(...fill(item));
    card.dataset.for = item.id;
  }
  card.hidden = false;
}

// A polite status line that speaks only when the pinned item changes; hover and focus previews stay silent.
function announcer() {
  const element = htmlEl('p', '', 'sr-only');
  element.setAttribute('role', 'status');
  let last = null;
  element.say = (pinned, message) => {
    if (pinned === last) return;
    element.textContent = pinned ? message(pinned) : last ? 'Unpinned.' : '';
    last = pinned;
  };
  return element;
}

// The focus preview lasts while focus stays in the view (an item or its inspector), so the inspector's buttons stay reachable.
function keepFocusPreview(root, state, update) {
  root.addEventListener('focusout', event => { if (state.focus && !root.contains(event.relatedTarget)) { state.focus = null; update(); } });
}

// Re-renders the inspector only when what it shows changes, so a button inside it is never replaced mid-click.
function showInInspector(state, active, render) {
  const key = active ? `${active.id}|${state.pinned === active}` : '';
  if (key === state.shown) return;
  state.shown = key;
  render(active);
}

// Each item's visible text lives outside its button (whose accessible name is the full aria-label) and follows its emphasis.
function markLabels(svg, nodes, near, active) {
  svg.querySelectorAll('[data-label-for]').forEach(element => {
    const item = nodes.get(element.dataset.labelFor);
    element.classList.toggle('is-near', near.has(item));
    element.classList.toggle('is-active', item === active);
  });
}

function inspectorHead(roleText, color, pinned, onUnpin) {
  const head = htmlEl('div', undefined, 'kg-inspector-head');
  const role = htmlEl('span', undefined, `kg-role kg-c${color}`);
  role.append(htmlEl('span', undefined, 'kg-dot'), roleText);
  head.append(role);
  if (pinned) {
    const unpin = htmlEl('button', 'Unpin', 'kg-unpin');
    unpin.type = 'button';
    unpin.addEventListener('click', onUnpin);
    head.append(htmlEl('span', 'Pinned', 'kg-pinned'), unpin);
  }
  return head;
}

// ---------------------------------------------------------------------------------------------------------------------
// S08 entity graph

/** The entity graph of one native graph statement: the union of its returned rows. Returns null without rows or a pattern. */
export function entityGraphModel(statement) {
  const hops = (Array.isArray(statement?.hops) ? statement.hops : []).filter(hop => typeof hop?.from === 'string' && typeof hop?.to === 'string' && hop.from !== hop.to);
  const rows = Array.isArray(statement?.rows) ? statement.rows : [];
  if (!hops.length || !rows.length) return null;
  const roles = [];
  for (const hop of hops) for (const role of [hop.from, hop.to]) if (!roles.includes(role)) roles.push(role);
  // Columns: breadth-first along the pattern from the first returned column, ignoring direction (arrows keep it);
  // a disconnected part of the pattern continues to the right.
  const depth = new Map();
  let offset = 0;
  for (const start of [...new Set([...(statement.columns || []).filter(column => roles.includes(column)), ...roles])]) {
    if (depth.has(start)) continue;
    depth.set(start, offset);
    const queue = [start];
    let deepest = offset;
    while (queue.length) {
      const role = queue.shift();
      for (const hop of hops) {
        const other = hop.from === role ? hop.to : hop.to === role ? hop.from : null;
        if (other !== null && !depth.has(other)) { depth.set(other, depth.get(role) + 1); deepest = Math.max(deepest, depth.get(other)); queue.push(other); }
      }
    }
    offset = deepest + 1;
  }
  const present = value => (typeof value === 'string' && value.trim() !== '') || Number.isFinite(value);
  const nodes = new Map();
  const edges = new Map();
  const nodeFor = (role, value, row) => {
    const key = `${role}\u0000${value}`;
    let item = nodes.get(key);
    if (!item) {
      item = { id: `n${nodes.size}`, role, value: String(value), color: roles.indexOf(role) % PALETTE_SIZE, depth: depth.get(role), rows: [], edges: [] };
      nodes.set(key, item);
    }
    if (!item.rows.includes(row)) item.rows.push(row);
    return item;
  };
  rows.forEach((row, index) => {
    for (const hop of hops) {
      const from = row?.values?.[hop.from];
      const to = row?.values?.[hop.to];
      if (!present(from) || !present(to)) continue;
      const source = nodeFor(hop.from, from, index);
      const target = nodeFor(hop.to, to, index);
      const relation = String(hop.relation || 'related to');
      const key = `${source.id}\u0000${relation}\u0000${target.id}`;
      let edge = edges.get(key);
      if (!edge) {
        edge = { id: `e${edges.size}`, source, target, relation, rows: [] };
        edges.set(key, edge);
        source.edges.push(edge);
        target.edges.push(edge);
      }
      if (!edge.rows.includes(index)) edge.rows.push(index);
    }
  });
  if (!edges.size) return null;
  return { hops: hops.map(({ from, relation, to }) => ({ from, relation: String(relation || 'related to'), to })),
    roles: roles.map((role, index) => ({ role, color: index % PALETTE_SIZE, depth: depth.get(role) })),
    nodes: [...nodes.values()], edges: [...edges.values()], rowCount: rows.length };
}

// Columns with many entities draw them as small points (labels on hover and in the inspector), like the reference's facts.
const COMPACT_AFTER = 12;

/** Deterministic left-to-right layout for a given pixel width. Mutates the model's nodes with x, y and r. */
export function layoutEntityGraph(model, width) {
  const W = Math.max(280, Math.floor(width));
  const roleIndex = node => model.roles.findIndex(item => item.role === node.role);
  const depths = [...new Set(model.nodes.map(node => node.depth))].sort((a, b) => a - b);
  const columns = depths.map(depth => model.nodes.filter(node => node.depth === depth)
    .sort((a, b) => roleIndex(a) - roleIndex(b) || a.rows[0] - b.rows[0] || a.value.localeCompare(b.value)));
  // Fewer crossings: a few barycentre sweeps, left to right then right to left.
  const position = new Map();
  const index = column => column.forEach((node, i) => position.set(node, column.length > 1 ? i / (column.length - 1) : 0.5));
  columns.forEach(index);
  const neighbours = node => node.edges.map(edge => (edge.source === node ? edge.target : edge.source));
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    for (const column of forward ? columns.slice(1) : columns.slice(0, -1).reverse()) {
      const depth = column[0].depth;
      const centre = new Map(column.map(node => {
        const reference = neighbours(node).filter(other => (forward ? other.depth < depth : other.depth > depth));
        return [node, reference.length ? reference.reduce((sum, other) => sum + position.get(other), 0) / reference.length : position.get(node)];
      }));
      column.sort((a, b) => centre.get(a) - centre.get(b) || roleIndex(a) - roleIndex(b));
      index(column);
    }
  }
  const compact = column => column.length > COMPACT_AFTER;
  const maxDegree = Math.max(1, ...model.nodes.map(node => node.edges.length));
  const radius = (node, column) => (compact(column) ? 3.6 : 5 + 4.5 * Math.sqrt((node.edges.length - 1) / Math.max(1, maxDegree - 1)));
  const gap = column => (compact(column) ? 13 : column.length > 7 ? 27 : 36);
  const top = 46;
  const left = 22;
  const last = columns.length - 1;
  // The last column keeps only the room its labels need (labels there extend to the right edge).
  const lastChars = last ? Math.max(...columns[last].map(node => node.value.length)) : 0;
  const lastLabel = last ? Math.round(Math.min(200, W * 0.3, Math.max(64, lastChars * 6.7 + 24))) : 0;
  const step = last ? (W - left - 12 - lastLabel) / last : 0;
  const xs = columns.map((_, i) => (last ? left + i * step : Math.round(W * 0.35)));
  const heights = columns.map(column => (column.length - 1) * gap(column));
  const inner = Math.max(0, ...heights);
  const height = Math.round(top + inner + 24 + READOUT);
  columns.forEach((column, i) => {
    const y0 = top + 8 + (inner - heights[i]) / 2;
    column.forEach((node, j) => { node.x = round(xs[i]); node.y = round(y0 + j * gap(column)); node.r = round(radius(node, column)); node.compact = compact(column); });
  });
  const labelWidth = i => Math.floor(i === last ? lastLabel - 16 : step - 28);
  const edges = model.edges.map(edge => ({ edge, ...edgeGeometry(edge.source, edge.target) }));
  return {
    width: W, height,
    columns: columns.map((column, i) => ({ x: xs[i], nodes: column, compact: compact(column), labelWidth: labelWidth(i),
      roles: [...new Set(column.map(node => node.role))] })),
    edges,
    // Relation labels sit between columns, so they get at most one column step.
    relWidth: last ? Math.max(0, Math.min(150, step - 12)) : 150,
    // Small graphs show every relationship label; larger ones show them for the highlighted neighbourhood.
    labelled: model.edges.length <= 8 && (!last || step >= 150),
  };
}

function edgeGeometry(source, target) {
  if (Math.abs(target.x - source.x) < 1) {
    // Same column: a bow to the right.
    const bulge = 38 + Math.abs(target.y - source.y) * 0.22;
    const x0 = source.x + source.r;
    const x3 = target.x + target.r + 3;
    return { d: `M${round(x0)} ${source.y} C${round(source.x + bulge)} ${source.y} ${round(target.x + bulge)} ${target.y} ${round(x3)} ${target.y}`,
      mid: [round(source.x + bulge * 0.75), round((source.y + target.y) / 2)] };
  }
  const direction = target.x > source.x ? 1 : -1;
  const x0 = source.x + direction * source.r;
  const x3 = target.x - direction * (target.r + 3);
  const handle = (x3 - x0) * 0.5;
  const c1 = x0 + handle;
  const c2 = x3 - handle;
  return { d: `M${round(x0)} ${source.y} C${round(c1)} ${source.y} ${round(c2)} ${target.y} ${round(x3)} ${target.y}`,
    mid: [round((x0 + 3 * c1 + 3 * c2 + x3) / 8), round((source.y + target.y) / 2)] };
}

// The query pattern as a readable legend: role —relation→ role, one chain per connected path.
function patternLegend(model) {
  const legend = htmlEl('p', undefined, 'kg-pattern');
  legend.append(htmlEl('span', 'Pattern', 'kg-pattern-label'));
  const colorOf = role => model.roles.find(item => item.role === role)?.color ?? 0;
  const role = name => {
    const chip = htmlEl('span', undefined, `kg-role kg-c${colorOf(name)}`);
    chip.append(htmlEl('span', undefined, 'kg-dot'), humanizeRole(name));
    return chip;
  };
  const chains = [];
  for (const hop of model.hops) {
    const last = chains.at(-1);
    if (last && last.at(-1).to === hop.from) last.push(hop); else chains.push([hop]);
  }
  for (const chain of chains) {
    const part = htmlEl('span', undefined, 'kg-chain');
    part.append(role(chain[0].from));
    for (const hop of chain) part.append(htmlEl('span', `${hop.relation} →`, 'kg-rel-text'), role(hop.to));
    legend.append(part);
  }
  return legend;
}

/**
 * Renders the entity graph for one statement, or null when the statement has no rows or pattern.
 * display(value) gives the display form of an entity name; citations(ids) returns citation link elements.
 */
export function renderEntityGraph(statement, { display = value => value, citations } = {}) {
  const model = entityGraphModel(statement);
  if (!model) return null;
  const id = `kg${++instances}`;
  const nodes = new Map(model.nodes.map(node => [node.id, node]));
  const root = htmlEl('div', undefined, 'kg');
  const stage = htmlEl('div', undefined, 'kg-stage');
  const inspector = htmlEl('div', undefined, 'kg-inspector');
  const card = hoverCard();
  const status = announcer();
  root.append(patternLegend(model), stage, inspector, status, htmlEl('p', `Drawn from the ${plural(model.rowCount, 'row')} Foundry IQ returned: `
    + `${plural(model.nodes.length, 'entity', 'entities')} and ${plural(model.edges.length, 'relationship')}. An entity with the same name and role is drawn once.`, 'kg-caption'));
  const state = { hover: null, focus: null, pinned: null, current: null, intro: true, layout: null, svg: null, order: [] };

  const show = value => String(display(value) ?? value);
  const roleName = node => capitalize(humanizeRole(node.role));
  const rowsText = node => `${plural(node.edges.length, 'relationship')} · in ${node.rows.length} of ${plural(model.rowCount, 'returned row')}`;
  const chip = node => { const role = htmlEl('span', undefined, `kg-role kg-c${node.color}`); role.append(htmlEl('span', undefined, 'kg-dot'), roleName(node)); return role; };
  const cardContent = node => [chip(node), htmlEl('span', show(node.value), 'kg-tip-name'), htmlEl('span', rowsText(node), 'kg-meta'),
    htmlEl('span', 'Click or press Enter to pin', 'kg-tip-hint')];

  function renderInspector(node) {
    inspector.replaceChildren();
    inspector.classList.toggle('is-empty', !node);
    if (!node) {
      inspector.append(htmlEl('p', 'Hover or focus an entity to trace its relationships. Click it, tap it or press Enter to pin its details and citations.', 'kg-hint'));
      return;
    }
    const pinned = state.pinned === node;
    inspector.append(inspectorHead(roleName(node), node.color, pinned, () => {
      state.pinned = null;
      update();
      state.svg?.querySelector(`[data-node="${node.id}"]`)?.focus();
    }));
    inspector.append(htmlEl('p', show(node.value), 'kg-name'), htmlEl('p', rowsText(node), 'kg-meta'));
    const list = htmlEl('ul', undefined, 'kg-relations');
    for (const edge of node.edges.slice(0, 10)) {
      const outgoing = edge.source === node;
      const other = outgoing ? edge.target : edge.source;
      const item = htmlEl('li');
      const jump = htmlEl('button', undefined, `kg-jump kg-c${other.color}`);
      jump.type = 'button';
      jump.append(htmlEl('span', undefined, 'kg-dot'), htmlEl('span', show(other.value), 'kg-jump-text'));
      jump.title = `${roleName(other)}: ${show(other.value)}. Pin it.`;
      jump.addEventListener('click', () => {
        state.pinned = other;
        state.current = other;
        update();
        state.svg?.querySelector(`[data-node="${other.id}"]`)?.focus();
      });
      item.append(htmlEl('span', outgoing ? `${edge.relation} →` : `← ${edge.relation}`, 'kg-rel-text'), jump);
      if (edge.rows.length > 1) item.append(htmlEl('span', `${edge.rows.length} rows`, 'kg-meta'));
      list.append(item);
    }
    inspector.append(list);
    if (node.edges.length > 10) inspector.append(htmlEl('p', `+${node.edges.length - 10} more relationships in the path rows`, 'kg-meta'));
    const ids = [...new Set(node.rows.flatMap(index => statement.rows[index]?.sources || []))];
    const cited = htmlEl('div', undefined, 'kg-cited');
    if (ids.length && typeof citations === 'function') {
      cited.append(htmlEl('span', 'Cited by the rows that include it', 'kg-cited-label'), ...citations(ids.slice(0, 8)));
      if (ids.length > 8) cited.append(htmlEl('span', `+${ids.length - 8} more`, 'kg-meta'));
    } else cited.append(htmlEl('span', 'Citation unavailable: Foundry IQ returned no evidence for these rows. Nothing was substituted.', 'kg-cited-label'));
    inspector.append(cited);
  }

  function update() {
    const svg = state.svg;
    if (!svg) return;
    const active = state.pinned || state.hover || state.focus;
    const near = new Set(active ? [active, ...active.edges.map(edge => (edge.source === active ? edge.target : edge.source))] : []);
    const nearEdges = new Set(active ? active.edges : []);
    svg.classList.toggle('kg-has-active', !!active);
    // Relation labels for a highlighted hub would pile up where its edges meet; the pattern legend names the relation instead.
    svg.classList.toggle('kg-hub', nearEdges.size > 3);
    svg.querySelectorAll('[data-node]').forEach(element => {
      const node = nodes.get(element.dataset.node);
      element.classList.toggle('is-near', near.has(node));
      element.classList.toggle('is-active', node === active);
      element.setAttribute('aria-pressed', String(node === state.pinned));
    });
    svg.querySelectorAll('[data-edge]').forEach(element => element.classList.toggle('is-near', nearEdges.has(state.layout.edgeById.get(element.dataset.edge))));
    markLabels(svg, nodes, near, active);
    // A ripple on the highlighted entity and light pulses along its relationships, started once per highlight (finite in CSS).
    if (state.animated !== active || state.animatedSvg !== svg) {
      state.animated = active;
      state.animatedSvg = svg;
      svg.querySelectorAll('.kg-ripple').forEach(ripple => ripple.remove());
      const flows = svg.querySelector('.kg-flows');
      flows.replaceChildren();
      if (active && !reducedMotion()) {
        const pop = svg.querySelector(`[data-node="${active.id}"] .kg-pop`);
        for (const delay of [0, 0.9]) {
          const ripple = svgEl('circle', { r: active.r + 3 }, `kg-ripple kg-stroke-c${active.color}`);
          ripple.style.setProperty('animation-delay', `${delay}s`);
          pop?.prepend(ripple);
        }
        for (const geometry of state.layout.edges.filter(item => nearEdges.has(item.edge))) {
          const color = geometry.edge.source === active ? geometry.edge.target.color : geometry.edge.source.color;
          flows.append(svgEl('path', { d: geometry.d, pathLength: 1 }, `kg-flow kg-stroke-c${color}`));
        }
      }
    }
    state.roving?.();
    status.say(state.pinned, node => `Pinned ${roleName(node)}: ${show(node.value)}. Its details follow the graph.`);
    showInInspector(state, state.pinned, renderInspector);
    const preview = state.hover || state.focus;
    placeCard(card, preview !== state.pinned ? preview : null, cardContent);
  }

  function move(node, key) {
    const columns = state.layout.columns;
    let c = columns.findIndex(column => column.nodes.includes(node));
    let r = columns[c].nodes.indexOf(node);
    if (key === 'ArrowDown') r = Math.min(columns[c].nodes.length - 1, r + 1);
    else if (key === 'ArrowUp') r = Math.max(0, r - 1);
    else if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const next = c + (key === 'ArrowRight' ? 1 : -1);
      if (next < 0 || next >= columns.length) return node;
      r = columns[next].nodes.reduce((best, other, i) => (Math.abs(other.y - node.y) < Math.abs(columns[next].nodes[best].y - node.y) ? i : best), 0);
      c = next;
    } else if (key === 'Home') { c = 0; r = 0; } else if (key === 'End') { c = columns.length - 1; r = columns[c].nodes.length - 1; } else return null;
    return columns[c].nodes[r];
  }

  function draw(width) {
    const layout = layoutEntityGraph(model, width);
    layout.edgeById = new Map(layout.edges.map(item => [item.edge.id, item.edge]));
    state.layout = layout;
    state.order = layout.columns.flatMap(column => column.nodes);
    const svg = svgEl('svg', { width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}`, role: 'group',
      'aria-label': `Entity graph: ${plural(model.nodes.length, 'entity', 'entities')} and ${plural(model.edges.length, 'relationship')} from ${plural(model.rowCount, 'returned row')}. `
        + 'Arrow keys move between entities; Enter pins one.' },
    `kg-svg${state.intro ? ' kg-intro' : ''}${layout.labelled ? ' kg-labelled' : ''}`);
    svg.append(paintDefs(id, [...new Set(model.nodes.map(node => node.color))]));
    // Column guides and role headers.
    const guides = svgEl('g', { 'aria-hidden': 'true' }, 'kg-guides');
    layout.columns.forEach((column, i) => {
      guides.append(svgEl('line', { x1: column.x, x2: column.x, y1: 28, y2: layout.height - READOUT - 4 }, 'kg-guide'));
      const header = svgEl('text', { x: column.x - (i ? 0 : 8), y: 16, 'text-anchor': i ? 'middle' : 'start' }, 'kg-col');
      const room = layout.columns.length > 1 ? layout.columns[1].x - layout.columns[0].x - 12 : layout.width - 24;
      const width = Math.max(40, i ? room : room + 4);
      const roles = column.roles.map(humanizeRole);
      const full = roles.join(' · ');
      // A column holding several roles that don't fit names the first and counts the rest; the pattern legend lists them all.
      header.textContent = roles.length > 1 && fitText(full, width, 11) !== full ? fitText(`${roles[0]} +${roles.length - 1}`, width, 11) : fitText(full, width, 11);
      guides.append(header);
    });
    const edges = svgEl('g', { 'aria-hidden': 'true' }, 'kg-edges');
    const labels = svgEl('g', { 'aria-hidden': 'true' }, 'kg-rels');
    layout.edges.forEach(({ edge, d, mid }, i) => {
      const gradient = svgEl('linearGradient', { id: `${id}-edge-${edge.id}`, gradientUnits: 'userSpaceOnUse',
        x1: edge.source.x, y1: edge.source.y, x2: edge.target.x === edge.source.x ? edge.source.x + 1 : edge.target.x, y2: edge.target.y });
      gradient.append(svgEl('stop', { offset: 0 }, `kg-s-c${edge.source.color}`), svgEl('stop', { offset: 1 }, `kg-s-c${edge.target.color}`));
      svg.querySelector('defs').append(gradient);
      const path = svgEl('path', { d, pathLength: 1, stroke: `url(#${id}-edge-${edge.id})`, 'stroke-width': round(1.1 + Math.min(1.8, 0.45 * (edge.rows.length - 1))),
        'marker-end': `url(#${id}-arrow-${edge.target.color})`, 'data-edge': edge.id }, 'kg-edge');
      path.style.setProperty('--kg-delay', `${Math.min(900, 120 + edge.source.depth * 110 + i * 6)}ms`);
      edges.append(path);
      const label = svgEl('text', { x: mid[0], y: mid[1] + 13, 'text-anchor': 'middle', 'data-edge': edge.id }, 'kg-rel');
      label.textContent = fitText(edge.relation, layout.relWidth, 10.5);
      // A label cut to a few letters says nothing; the pattern legend and the inspector name the relation.
      if (label.textContent.length >= Math.min(6, edge.relation.length)) labels.append(label);
    });
    const flows = svgEl('g', { 'aria-hidden': 'true' }, 'kg-flows');
    const layer = svgEl('g', undefined, 'kg-nodes');
    const names = svgEl('g', { 'aria-hidden': 'true' }, 'kg-names');
    layout.columns.forEach((column, c) => column.nodes.forEach((node, j) => {
      const group = svgEl('g', { transform: `translate(${node.x} ${node.y})`, role: 'button', tabindex: -1, 'data-node': node.id, 'aria-pressed': 'false',
        'aria-label': `${roleName(node)}: ${show(node.value)}. ${plural(node.edges.length, 'relationship')}.` }, `kg-node kg-c${node.color}${node.compact ? ' kg-point' : ''}`);
      const pop = svgEl('g', undefined, 'kg-pop');
      const delay = `${Math.min(1000, c * 110 + j * 14)}ms`;
      pop.style.setProperty('--kg-delay', delay);
      pop.append(svgEl('circle', { r: round(node.r * (node.compact ? 3.4 : 3.6)), fill: `url(#${id}-glow-${node.color})` }, 'kg-halo'),
        svgEl('circle', { r: node.r, fill: `url(#${id}-core-${node.color})` }, `kg-core kg-stroke-c${node.color}`),
        svgEl('circle', { r: round(node.r + 4.5) }, 'kg-ring'));
      // Hit area for small points.
      if (node.compact) pop.append(svgEl('circle', { r: 7 }, 'kg-hit'));
      group.append(pop);
      layer.append(group);
      const text = fitText(show(node.value), column.labelWidth, 11.5);
      if (text) {
        // Above its outgoing line (the relation label sits below it); centred on the node in the last column and for points.
        const above = c < layout.columns.length - 1 && !node.compact;
        const label = svgEl('text', { x: round(node.x + node.r + (above ? 4 : 7)), y: round(node.y + (above ? -6 : 4)), 'data-label-for': node.id },
          `kg-label${node.compact ? ' kg-point-label' : ''}`);
        label.style.setProperty('--kg-delay', delay);
        label.textContent = text;
        names.append(label);
      }
    }));
    svg.append(guides, edges, flows, labels, layer, names);
    state.roving = interactive(svg, { nodes, order: state.order, move, onChange: update, state });
    const hadFocus = stage.contains(document.activeElement) ? document.activeElement.dataset?.node : null;
    stage.replaceChildren(svg, card);
    state.svg = svg;
    if (state.intro) {
      state.intro = false;
      setTimeout(() => svg.classList.remove('kg-intro'), 2200);
    }
    update();
    if (hadFocus) svg.querySelector(`[data-node="${hadFocus}"]`)?.focus();
  }

  renderInspector(null);
  keepFocusPreview(root, state, update);
  watchWidth(stage, draw);
  return root;
}

// ---------------------------------------------------------------------------------------------------------------------
// S09 topic map

/** Greedy deterministic circle packing around the origin. squash < 1 spreads circles horizontally. */
export function packCircles(radii, { gap = 0, squash = 1 } = {}) {
  const order = radii.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r || a.i - b.i);
  const placed = [];
  for (const circle of order) {
    if (!placed.length) { Object.assign(circle, { x: 0, y: 0 }); placed.push(circle); continue; }
    let best = null;
    for (const anchor of placed) {
      for (let k = 0; k < 48; k++) {
        const angle = (k / 48) * Math.PI * 2;
        const distance = anchor.r + circle.r + gap;
        const x = anchor.x + Math.cos(angle) * distance;
        const y = anchor.y + Math.sin(angle) * distance;
        if (placed.some(other => Math.hypot(other.x - x, other.y - y) < other.r + circle.r + gap - 1e-6)) continue;
        const score = Math.hypot(x * squash, y);
        if (!best || score < best.score - 1e-9) best = { x, y, score };
      }
    }
    Object.assign(circle, { x: best.x, y: best.y });
    placed.push(circle);
  }
  return radii.map((_, i) => { const circle = order.find(item => item.i === i); return { x: circle.x, y: circle.y, r: circle.r }; });
}

const validTopic = topic => topic && typeof topic.title === 'string' && topic.title.trim() && Number.isFinite(topic.proportion) && topic.proportion > 0;

/** Topic map model: the returned root themes and their direct sub-themes, with coverage by these results. */
export function topicMapModel(topics, coverage) {
  const covered = new Set(Array.isArray(coverage?.covered) ? coverage.covered : []);
  const roots = (Array.isArray(topics?.hierarchy) ? topics.hierarchy : []).filter(validTopic).map((topic, index) => {
    const root = { id: String(topic.id ?? `root-${index}`), title: topic.title, description: topic.description || '', proportion: topic.proportion,
      color: index % PALETTE_SIZE, depth: 0, covered: covered.has(topic.id), parent: null, children: [] };
    root.children = (Array.isArray(topic.children) ? topic.children : []).filter(validTopic).map((child, i) => ({
      id: String(child.id ?? `${root.id}-${i}`), title: child.title, description: child.description || '', proportion: child.proportion, color: root.color,
      depth: 1, covered: covered.has(child.id), parent: root, children: [], grandchildren: (child.children || []).filter(validTopic).length }));
    return root;
  });
  if (!roots.length) return null;
  return { roots, coverage: coverage && Array.isArray(coverage.covered) ? { covered: covered.size } : null, moreRoots: Number.isInteger(topics?.moreRoots) ? topics.moreRoots : 0 };
}

/** Pixel layout: root bubbles with area proportional to share, sub-themes packed inside their root. */
export function layoutTopicMap(model, width) {
  const W = Math.max(280, Math.floor(width));
  const units = model.roots.map(root => Math.sqrt(root.proportion));
  const maxUnit = Math.max(...units);
  const packed = packCircles(units, { gap: maxUnit * 0.07, squash: W < 520 ? 1 : 0.6 });
  const inner = model.roots.map((root, i) => {
    if (!root.children.length) return [];
    const R = units[i];
    const childRadii = root.children.map(child => R * Math.sqrt(child.proportion / root.proportion) * 0.8);
    const spots = packCircles(childRadii, { gap: R * 0.04 });
    // Centre the packed group on its bounding box before fitting it inside the theme.
    const cx = (Math.min(...spots.map(spot => spot.x - spot.r)) + Math.max(...spots.map(spot => spot.x + spot.r))) / 2;
    const cy = (Math.min(...spots.map(spot => spot.y - spot.r)) + Math.max(...spots.map(spot => spot.y + spot.r))) / 2;
    const extent = Math.max(...spots.map(spot => Math.hypot(spot.x - cx, spot.y - cy) + spot.r));
    const fit = Math.min(1, (R * 0.74) / extent);
    // Leave the top of the root bubble for its curved title.
    return spots.map(spot => ({ x: (spot.x - cx) * fit, y: (spot.y - cy) * fit + R * 0.12, r: spot.r * fit }));
  });
  const minX = Math.min(...packed.map(c => c.x - c.r));
  const maxX = Math.max(...packed.map(c => c.x + c.r));
  const minY = Math.min(...packed.map(c => c.y - c.r));
  const maxY = Math.max(...packed.map(c => c.y + c.r));
  const pad = 14;
  const maxHeight = Math.min(420, Math.max(230, W * 0.56));
  const scale = Math.min((W - 2 * pad) / (maxX - minX), (maxHeight - 2 * pad - READOUT) / (maxY - minY));
  const height = Math.round((maxY - minY) * scale + 2 * pad + READOUT);
  const offsetX = (W - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = pad - minY * scale;
  const items = [];
  model.roots.forEach((root, i) => {
    Object.assign(root, { x: round(packed[i].x * scale + offsetX), y: round(packed[i].y * scale + offsetY), r: round(packed[i].r * scale) });
    items.push(root);
    root.children.forEach((child, j) => {
      Object.assign(child, { x: round(root.x + inner[i][j].x * scale), y: round(root.y + inner[i][j].y * scale), r: round(inner[i][j].r * scale) });
      items.push(child);
    });
  });
  return { width: W, height, items };
}

/** Renders the topic map, or null when the hierarchy has no themes with a share. */
export function renderTopicMap(topics, coverage) {
  const model = topicMapModel(topics, coverage);
  if (!model) return null;
  const id = `tm${++instances}`;
  const all = model.roots.flatMap(root => [root, ...root.children]);
  const nodes = new Map(all.map(item => [item.id, item]));
  const root = htmlEl('div', undefined, 'kg tm');
  const stage = htmlEl('div', undefined, 'kg-stage tm-stage');
  const inspector = htmlEl('div', undefined, 'kg-inspector');
  const card = hoverCard();
  const status = announcer();
  const subCount = all.length - model.roots.length;
  root.append(stage, inspector, status, htmlEl('p', `Bubble area is each theme’s share of passages in the Foundry IQ topic graph${subCount ? '; sub-themes sit inside their theme' : ''}.`
    + `${model.coverage ? ' A ✓ marks themes these results cover.' : ''}`, 'kg-caption'));
  const state = { hover: null, focus: null, pinned: null, current: null, intro: true, layout: null, svg: null };
  const facts = item => [`${percent(item.proportion)} of passages`, ...(item.children.length ? [plural(item.children.length, 'sub-theme')] : []),
    ...(item.grandchildren ? [`${plural(item.grandchildren, 'deeper theme')} in the list`] : [])].join(' · ');
  const coverageText = item => {
    const coveredChildren = item.children.filter(child => child.covered).length;
    return { text: item.covered ? '✓ Appears in these results.' : item.children.length ? `${coveredChildren} of ${plural(item.children.length, 'sub-theme')} appear in these results.`
      : 'Not in these results.', on: item.covered || coveredChildren > 0 };
  };
  const cardContent = item => {
    const role = htmlEl('span', undefined, `kg-role kg-c${item.color}`);
    role.append(htmlEl('span', undefined, 'kg-dot'), item.parent ? 'Sub-theme' : 'Theme');
    const parts = [role, htmlEl('span', item.title, 'kg-tip-name'), htmlEl('span', `${percent(item.proportion)} of passages`, 'kg-meta')];
    if (model.coverage) parts.push(htmlEl('span', item.covered ? '✓ in these results' : 'not in these results', `kg-meta${item.covered ? ' tm-in' : ''}`));
    parts.push(htmlEl('span', 'Click or press Enter to pin', 'kg-tip-hint'));
    return parts;
  };

  function renderInspector(item) {
    inspector.replaceChildren();
    inspector.classList.toggle('is-empty', !item);
    if (!item) {
      inspector.append(htmlEl('p', 'Hover or focus a theme to see its share. Click it, tap it or press Enter to pin its details.', 'kg-hint'));
      return;
    }
    inspector.append(inspectorHead(item.parent ? `Sub-theme of ${item.parent.title}` : 'Theme', item.color, state.pinned === item, () => {
      state.pinned = null;
      update();
      state.svg?.querySelector(`[data-node="${item.id}"]`)?.focus();
    }));
    inspector.append(htmlEl('p', item.title, 'kg-name'), htmlEl('p', facts(item), 'kg-meta'));
    if (item.description) inspector.append(htmlEl('p', item.description, 'kg-desc'));
    if (model.coverage) {
      const { text, on } = coverageText(item);
      inspector.append(htmlEl('p', text, `kg-meta${on ? ' tm-in' : ''}`));
    }
    if (item.children.length) {
      const list = htmlEl('ul', undefined, 'kg-relations');
      for (const child of item.children) {
        const jump = htmlEl('button', undefined, `kg-jump kg-c${child.color}`);
        jump.type = 'button';
        jump.append(htmlEl('span', undefined, 'kg-dot'), htmlEl('span', `${child.title} · ${percent(child.proportion)}`, 'kg-jump-text'));
        jump.addEventListener('click', () => { state.pinned = child; state.current = child; update(); state.svg?.querySelector(`[data-node="${child.id}"]`)?.focus(); });
        const entry = htmlEl('li');
        entry.append(jump);
        list.append(entry);
      }
      inspector.append(list);
    }
  }

  function update() {
    const svg = state.svg;
    if (!svg) return;
    const active = state.pinned || state.hover || state.focus;
    const near = new Set(active ? [active, ...(active.parent ? [active.parent] : []), ...active.children] : []);
    svg.classList.toggle('kg-has-active', !!active);
    svg.querySelectorAll('[data-node]').forEach(element => {
      const item = nodes.get(element.dataset.node);
      element.classList.toggle('is-near', near.has(item));
      element.classList.toggle('is-active', item === active);
      element.setAttribute('aria-pressed', String(item === state.pinned));
    });
    markLabels(svg, nodes, near, active);
    state.roving?.();
    status.say(state.pinned, item => `Pinned ${item.title}, ${percent(item.proportion)} of passages. Its details follow the map.`);
    showInInspector(state, state.pinned, renderInspector);
    const preview = state.hover || state.focus;
    placeCard(card, preview !== state.pinned ? preview : null, cardContent);
  }

  const order = all;
  const move = (item, key) => {
    const at = order.indexOf(item);
    if (key === 'ArrowRight' || key === 'ArrowDown') return order[Math.min(order.length - 1, at + 1)];
    if (key === 'ArrowLeft' || key === 'ArrowUp') return order[Math.max(0, at - 1)];
    if (key === 'Home') return order[0];
    if (key === 'End') return order.at(-1);
    return null;
  };

  function label(group, item, { lines: maxLines, size }) {
    const lines = wrapText(item.title, item.r * 1.55, size, maxLines);
    const pct = percent(item.proportion);
    const rows = lines.length ? [...lines, pct] : item.r >= 13 ? [pct] : [];
    const lineHeight = size * 1.18;
    const text = svgEl('text', { 'text-anchor': 'middle', y: round(-((rows.length - 1) * lineHeight) / 2 + size * 0.36) }, `tm-label${item.depth ? ' tm-label-sub' : ''}`);
    rows.forEach((line, i) => {
      const span = svgEl('tspan', { x: 0, dy: i ? round(lineHeight) : 0 }, i === rows.length - 1 ? 'tm-pct' : undefined);
      span.textContent = line;
      text.append(span);
    });
    if (rows.length) group.append(text);
  }

  function draw(width) {
    const layout = layoutTopicMap(model, width);
    state.layout = layout;
    const svg = svgEl('svg', { width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}`, role: 'group',
      'aria-label': `Topic map: ${plural(model.roots.length, 'theme')}${subCount ? ` and ${plural(subCount, 'sub-theme')}` : ''}, sized by share of passages. Arrow keys move between themes; Enter pins one.` },
    `kg-svg tm-svg${state.intro ? ' kg-intro' : ''}`);
    const defs = paintDefs(id, [...new Set(all.map(item => item.color))]);
    for (const color of new Set(all.map(item => item.color))) {
      const bubble = svgEl('radialGradient', { id: `${id}-bubble-${color}`, cx: 0.5, cy: 0.4, r: 0.62 });
      bubble.append(svgEl('stop', { offset: 0, 'stop-opacity': 0.04 }, `kg-s-c${color}`), svgEl('stop', { offset: 0.72, 'stop-opacity': 0.12 }, `kg-s-c${color}`),
        svgEl('stop', { offset: 1, 'stop-opacity': 0.3 }, `kg-s-c${color}`));
      const sub = svgEl('radialGradient', { id: `${id}-sub-${color}`, cx: 0.4, cy: 0.35, r: 0.7 });
      sub.append(svgEl('stop', { offset: 0, 'stop-opacity': 0.42 }, `kg-s-c${color}`), svgEl('stop', { offset: 1, 'stop-opacity': 0.2 }, `kg-s-c${color}`));
      defs.append(bubble, sub);
    }
    svg.append(defs);
    const layer = svgEl('g', undefined, 'kg-nodes');
    const names = svgEl('g', { 'aria-hidden': 'true' }, 'kg-names tm-names');
    layout.items.forEach((item, i) => {
      const group = svgEl('g', { transform: `translate(${item.x} ${item.y})`, role: 'button', tabindex: -1, 'data-node': item.id, 'aria-pressed': 'false',
        'aria-label': `${item.parent ? `Sub-theme of ${item.parent.title}` : 'Theme'}: ${item.title}, ${percent(item.proportion)} of passages`
          + `${item.covered ? ', appears in these results' : ''}.` }, `kg-node tm-node kg-c${item.color}${item.depth ? ' tm-sub' : ' tm-root'}${item.covered ? ' tm-covered' : ''}`);
      const pop = svgEl('g', undefined, 'kg-pop');
      const delay = `${Math.min(900, item.depth * 260 + i * 60)}ms`;
      pop.style.setProperty('--kg-delay', delay);
      if (!item.depth) pop.append(svgEl('circle', { r: round(item.r * 1.12), fill: `url(#${id}-glow-${item.color})` }, 'kg-halo tm-halo'));
      pop.append(svgEl('circle', { r: item.r, fill: `url(#${id}-${item.depth ? 'sub' : 'bubble'}-${item.color})` }, `tm-bubble kg-stroke-c${item.color}`),
        svgEl('circle', { r: round(item.r + 4) }, 'kg-ring'));
      if (item.covered) pop.append(svgEl('circle', { r: round(item.r + 2.5) }, 'tm-covered-ring'));
      group.append(pop);
      layer.append(group);
      // Visible text sits outside the button (named by its full aria-label) and follows the item's emphasis.
      const set = svgEl('g', { transform: `translate(${item.x} ${item.y})`, 'data-label-for': item.id }, 'kg-labelset');
      set.style.setProperty('--kg-delay', delay);
      if (item.covered) {
        const badge = svgEl('g', { transform: `translate(${round(item.r * 0.7)} ${round(-item.r * 0.7)})` }, 'tm-badge');
        badge.append(svgEl('circle', { r: 8 }), Object.assign(svgEl('text', { 'text-anchor': 'middle', y: 3.6 }), { textContent: '✓' }));
        set.append(badge);
      }
      if (!item.depth && item.children.length) {
        // The title follows the top edge of the bubble, above its sub-themes; the share sits at the bottom.
        const radius = item.r - 13;
        const start = (200 * Math.PI) / 180;
        const end = (340 * Math.PI) / 180;
        const arcId = `${id}-arc-${i}`;
        defs.append(svgEl('path', { id: arcId, d: `M${round(Math.cos(start) * radius)} ${round(Math.sin(start) * radius)} A${round(radius)} ${round(radius)} 0 0 1 ${round(Math.cos(end) * radius)} ${round(Math.sin(end) * radius)}` }));
        const title = svgEl('text', { 'text-anchor': 'middle' }, 'tm-label tm-arc');
        const path = svgEl('textPath', { href: `#${arcId}`, startOffset: '50%' });
        path.textContent = fitText(item.title, radius * 2.3, 12);
        title.append(path);
        set.append(title, Object.assign(svgEl('text', { 'text-anchor': 'middle', y: round(item.r - 8) }, 'tm-label tm-pct'), { textContent: percent(item.proportion) }));
      } else label(set, item, item.depth ? { lines: item.r >= 30 ? 3 : 0, size: 11 } : { lines: item.r >= 44 ? 3 : item.r >= 30 ? 2 : 0, size: 12 });
      if (set.childNodes.length) names.append(set);
    });
    svg.append(layer, names);
    state.roving = interactive(svg, { nodes, order, move, onChange: update, state });
    const hadFocus = stage.contains(document.activeElement) ? document.activeElement.dataset?.node : null;
    stage.replaceChildren(svg, card);
    state.svg = svg;
    if (state.intro) {
      state.intro = false;
      setTimeout(() => svg.classList.remove('kg-intro'), 2200);
    }
    update();
    if (hadFocus) svg.querySelector(`[data-node="${hadFocus}"]`)?.focus();
  }

  renderInspector(null);
  keepFocusPreview(root, state, update);
  watchWidth(stage, draw);
  return root;
}
