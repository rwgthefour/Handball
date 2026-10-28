'use strict';
/* ================================================================
   Charts — tiny SVG renderer, blue and grey.
   Air Force wears the blue; the opponent and the second measure wear the
   grey, the de-emphasis slot, so the eye lands on our side first and the
   legend plus direct labels carry identity (blue↔grey clears the CVD,
   normal-vision and 3:1 contrast checks on the white surface).
   Marks are thin: columns ≤20px with a 4px rounded data-end, square at
   the baseline, a 2px surface gap between neighbours; 2px lines with
   ringed 9px markers; solid hairline gridlines; axis text in the page
   font, muted. Values are labelled on the marks only while there is room
   for them; tooltips enhance — the tables below carry every value.
   ================================================================ */
const VIZ = {
  s1: '#1a4fb3', s2: '#8a8d8f', pos: '#1a4fb3', neg: '#8a8d8f',
  grid: '#e8e8e4', axis: '#cfcfca', ink: '#101010', ink2: '#3f3f3c', mut: '#5f5f5f', surf: '#ffffff',
};
const tipEl = () => $('#viz-tip');
function showTip(px, py, title, rows) {
  const t = tipEl(); t.textContent = '';
  t.appendChild(el('div', { cls: 't', text: title }));
  for (const r of rows) {
    const row = el('div', { cls: 'r' },
      el('span', { cls: 'key', style: 'background:' + r.color }),
      el('span', { text: r.name }),
      el('span', { cls: 'v', text: r.value }));
    t.appendChild(row);
  }
  t.style.display = 'block';
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.min(px + 14, window.innerWidth - w - 8) + 'px';
  t.style.top = Math.max(4, py - h - 10) + 'px';
}
function hideTip() { tipEl().style.display = 'none'; }

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function roundTopBar(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return 'M' + x + ',' + (y + h) + ' L' + x + ',' + (y + r) + ' Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
    ' L' + (x + w - r) + ',' + y + ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
    ' L' + (x + w) + ',' + (y + h) + ' Z';
}
function roundBotBar(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return 'M' + x + ',' + y + ' L' + (x + w) + ',' + y + ' L' + (x + w) + ',' + (y + h - r) +
    ' Q' + (x + w) + ',' + (y + h) + ' ' + (x + w - r) + ',' + (y + h) +
    ' L' + (x + r) + ',' + (y + h) + ' Q' + x + ',' + (y + h) + ' ' + x + ',' + (y + h - r) + ' Z';
}
function baseSvg(W, H) {
  return svgel('svg', { viewBox: '0 0 ' + W + ' ' + H, style: 'width:100%;display:block;overflow:visible' });
}
/* one text node with the chart typography: {size, fill, weight, anchor} */
function vtext(x, y, text, o) {
  o = o || {};
  return svgel('text', { x, y, 'font-size': o.size || 11, fill: o.fill || VIZ.mut, 'font-weight': o.weight || 400,
    'text-anchor': o.anchor || 'start', text });
}
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; };
/* a slot's hit target: spans the column, tints on hover, carries the tooltip */
function slotHit(svg, x, y, w, h, title, rows) {
  const hit = svgel('rect', { x, y, width: w, height: h, fill: 'transparent', rx: 4 });
  hit.addEventListener('pointerenter', () => hit.setAttribute('fill', 'rgba(16,16,16,.045)'));
  hit.addEventListener('pointermove', ev => showTip(ev.clientX, ev.clientY, title, rows()));
  hit.addEventListener('pointerleave', () => { hit.setAttribute('fill', 'transparent'); hideTip(); });
  svg.appendChild(hit);
}
/* x labels are two lines — the opponent over the date — and thin out when
   the slots get narrow so they never overlap */
function axisLabels(svg, labels, xOf, H, pad, slot) {
  const step = Math.ceil(labels.length / 12);
  const chars = Math.max(5, Math.floor((slot || 80) / 6.4));
  labels.forEach((lb, i) => {
    if (i % step) return;
    const a = typeof lb === 'object' ? lb.a : lb, b = typeof lb === 'object' ? lb.b : '';
    svg.appendChild(vtext(xOf(i), H - pad.b + 16, trunc(a, chars), { size: 11, fill: VIZ.ink2, weight: 500, anchor: 'middle' }));
    if (b) svg.appendChild(vtext(xOf(i), H - pad.b + 29, b, { size: 10, fill: VIZ.mut, anchor: 'middle' }));
  });
}
function gridY(svg, max, yOf, pad, W, fmt) {
  const ticks = Number.isInteger(max / 4) ? 4 : Number.isInteger(max / 5) ? 5 : 4;   // whole-number steps
  for (let i = 0; i <= ticks; i++) {
    const v = max * i / ticks, y = yOf(v);
    if (i > 0) svg.appendChild(svgel('line', { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: VIZ.grid, 'stroke-width': 1 }));
    svg.appendChild(vtext(pad.l - 8, y + 3.5, fmt ? fmt(v) : String(Math.round(v)), { size: 10.5, anchor: 'end' }));
  }
}

/* grouped columns: {labels, titles, series:[{name,color,values}], fmt} */
function chartGroupedBars(host, cfg) {
  const W = 600, H = 280, pad = { l: 40, r: 16, t: 22, b: 42 };
  const svg = baseSvg(W, H);
  const max = niceMax(Math.max(1, ...cfg.series.flatMap(s => s.values)));
  const yOf = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const n = cfg.labels.length, ns = cfg.series.length;
  const slot = (W - pad.l - pad.r) / n;
  const bw = Math.max(3, Math.min(20, (slot * .62) / ns - 2));
  const labelled = slot / ns >= 34;          // room for a value on every cap
  gridY(svg, max, yOf, pad, W, cfg.fmt);
  svg.appendChild(svgel('line', { x1: pad.l, y1: yOf(0), x2: W - pad.r, y2: yOf(0), stroke: VIZ.axis, 'stroke-width': 1 }));
  cfg.labels.forEach((lb, i) => {
    const cx = pad.l + slot * (i + .5);
    const totalW = ns * bw + (ns - 1) * 2;
    const title = cfg.titles ? cfg.titles[i] : (typeof lb === 'object' ? lb.a : lb);
    slotHit(svg, pad.l + slot * i + 2, pad.t, slot - 4, H - pad.t - pad.b, title,
      () => cfg.series.map(s => ({ name: s.name, color: s.color, value: cfg.fmt ? cfg.fmt(s.values[i] || 0) : String(s.values[i] || 0) })));
    cfg.series.forEach((s, si) => {
      const v = s.values[i] || 0;
      const x = cx - totalW / 2 + si * (bw + 2);
      svg.appendChild(svgel('path', { d: roundTopBar(x, yOf(v), bw, yOf(0) - yOf(v), 4), fill: s.color, 'pointer-events': 'none' }));
      if (labelled && v) svg.appendChild(vtext(x + bw / 2, yOf(v) - 6, cfg.fmt ? cfg.fmt(v) : String(v),
        { size: 10.5, fill: VIZ.ink2, weight: 600, anchor: 'middle' }));
    });
  });
  axisLabels(svg, cfg.labels, i => pad.l + slot * (i + .5), H, pad, slot);
  host.appendChild(svg);
}

/* lines: {labels, titles, series:[{name,color,values(null ok)}], fmt, max?}
   The first series gets a light wash under its line; every point carries a
   ringed marker; the last point of each series is labelled directly. */
function chartLines(host, cfg) {
  const W = 600, H = 280, pad = { l: 44, r: 58, t: 22, b: 42 };
  const svg = baseSvg(W, H);
  const max = cfg.max || niceMax(Math.max(1, ...cfg.series.flatMap(s => s.values.filter(v => v != null))));
  const yOf = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const n = cfg.labels.length;
  const xOf = i => n === 1 ? (pad.l + (W - pad.l - pad.r) / 2) : pad.l + (W - pad.l - pad.r) * i / (n - 1);
  gridY(svg, max, yOf, pad, W, cfg.fmt);
  svg.appendChild(svgel('line', { x1: pad.l, y1: yOf(0), x2: W - pad.r, y2: yOf(0), stroke: VIZ.axis, 'stroke-width': 1 }));
  const cross = svgel('line', { x1: 0, y1: pad.t, x2: 0, y2: H - pad.b, stroke: VIZ.axis, 'stroke-width': 1, opacity: 0 });
  svg.appendChild(cross);
  const ends = [];
  cfg.series.forEach((s, si) => {
    let dPath = '', started = false, first = null, last = null;
    s.values.forEach((v, i) => {
      if (v == null) { started = false; return; }
      dPath += (started ? ' L' : ' M') + xOf(i) + ',' + yOf(v); started = true;
      if (first == null) first = i; last = i;
    });
    if (!dPath) return;
    if (si === 0 && first != null && last > first && s.values.slice(first, last + 1).every(v => v != null)) {
      const wash = dPath + ' L' + xOf(last) + ',' + yOf(0) + ' L' + xOf(first) + ',' + yOf(0) + ' Z';
      svg.appendChild(svgel('path', { d: wash, fill: s.color, opacity: .08, 'pointer-events': 'none' }));
    }
    svg.appendChild(svgel('path', { d: dPath, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'pointer-events': 'none' }));
    s.values.forEach((v, i) => {
      if (v == null) return;
      svg.appendChild(svgel('circle', { cx: xOf(i), cy: yOf(v), r: 4.5, fill: s.color, stroke: VIZ.surf, 'stroke-width': 2, 'pointer-events': 'none' }));
    });
    ends.push({ x: xOf(last) + 9, y: yOf(s.values[last]) + 3.5, text: cfg.fmt ? cfg.fmt(s.values[last]) : String(s.values[last]) });
  });
  // endpoint labels: nudge apart when two land on the same spot
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  for (const e of ends) svg.appendChild(vtext(e.x, e.y, e.text, { size: 11, fill: VIZ.ink2, weight: 700 }));
  axisLabels(svg, cfg.labels, xOf, H, pad, n > 1 ? (W - pad.l - pad.r) / (n - 1) : 200);
  const hit = svgel('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' });
  hit.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect();
    const mx = (ev.clientX - r.left) / r.width * W;
    let best = 0, bd = 1e9;
    for (let i = 0; i < n; i++) { const dd = Math.abs(xOf(i) - mx); if (dd < bd) { bd = dd; best = i; } }
    cross.setAttribute('x1', xOf(best)); cross.setAttribute('x2', xOf(best)); cross.setAttribute('opacity', 1);
    const lb = cfg.labels[best];
    showTip(ev.clientX, ev.clientY, cfg.titles ? cfg.titles[best] : (typeof lb === 'object' ? lb.a : lb),
      cfg.series.filter(s => s.values[best] != null).map(s => ({ name: s.name, color: s.color, value: cfg.fmt ? cfg.fmt(s.values[best]) : String(s.values[best]) })));
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); hideTip(); });
  svg.appendChild(hit);
  host.appendChild(svg);
}

/* horizontal bars: {items:[{label,value,sub}], name, fmt} — one series, the
   value at the tip with the sub-note in muted text beside it; the label
   column is sized to the longest name so nothing is cut short */
function chartHBar(host, cfg) {
  const rowH = 28, bar = 16, W = 600;
  const longest = Math.max(6, ...cfg.items.map(i => String(i.label).length));
  const pad = { l: Math.min(210, Math.round(longest * 6.6) + 14), r: 86, t: 8, b: 8 };
  const H = pad.t + pad.b + cfg.items.length * rowH;
  const svg = baseSvg(W, H);
  const max = niceMax(Math.max(1, ...cfg.items.map(i => i.value)));
  const wOf = v => (W - pad.l - pad.r) * v / max;
  svg.appendChild(svgel('line', { x1: pad.l, y1: pad.t, x2: pad.l, y2: H - pad.b, stroke: VIZ.axis, 'stroke-width': 1 }));
  cfg.items.forEach((it, i) => {
    const y = pad.t + i * rowH + (rowH - bar) / 2;
    const w = wOf(it.value), r = 4;
    // rounded data-end on the right, square at the baseline
    const dd = 'M' + pad.l + ',' + y + ' L' + (pad.l + Math.max(0, w - r)) + ',' + y +
      ' Q' + (pad.l + w) + ',' + y + ' ' + (pad.l + w) + ',' + (y + Math.min(r, bar / 2)) +
      ' L' + (pad.l + w) + ',' + (y + bar - r) + ' Q' + (pad.l + w) + ',' + (y + bar) + ' ' + (pad.l + Math.max(0, w - r)) + ',' + (y + bar) +
      ' L' + pad.l + ',' + (y + bar) + ' Z';
    slotHit(svg, 0, pad.t + i * rowH, W, rowH, it.label,
      () => [{ name: cfg.name || '', color: VIZ.s1, value: (cfg.fmt ? cfg.fmt(it.value) : String(it.value)) + (it.sub ? ' · ' + it.sub : '') }]);
    if (w > 0) svg.appendChild(svgel('path', { d: dd, fill: VIZ.s1, 'pointer-events': 'none' }));
    svg.appendChild(vtext(pad.l - 10, y + bar / 2 + 4, it.label, { size: 12, fill: VIZ.ink2, weight: 500, anchor: 'end' }));
    const val = vtext(pad.l + w + 8, y + bar / 2 + 4, cfg.fmt ? cfg.fmt(it.value) : String(it.value), { size: 12, fill: VIZ.ink, weight: 700 });
    if (it.sub) val.appendChild(svgel('tspan', { 'font-weight': 400, fill: VIZ.mut, 'font-size': 11, text: '  ' + it.sub }));
    svg.appendChild(val);
  });
  host.appendChild(svg);
}

/* diverging columns around 0: {labels, titles, values} — blue above the
   line (won by), grey below it (lost by), the margin on each cap */
function chartDivBar(host, cfg) {
  const W = 600, H = 280, pad = { l: 40, r: 16, t: 22, b: 42 };
  const svg = baseSvg(W, H);
  const ext = niceMax(Math.max(1, ...cfg.values.map(v => Math.abs(v))));
  const yOf = v => pad.t + (H - pad.t - pad.b) * (1 - (v + ext) / (2 * ext));
  const n = cfg.labels.length;
  const slot = (W - pad.l - pad.r) / n;
  const bw = Math.max(3, Math.min(20, slot * .5));
  const labelled = slot >= 34;
  const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
  [ext, ext / 2, 0, -ext / 2, -ext].forEach(v => {
    const y = yOf(v);
    if (v !== 0) svg.appendChild(svgel('line', { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: VIZ.grid, 'stroke-width': 1 }));
    svg.appendChild(vtext(pad.l - 8, y + 3.5, signed(v), { size: 10.5, anchor: 'end' }));
  });
  svg.appendChild(svgel('line', { x1: pad.l, y1: yOf(0), x2: W - pad.r, y2: yOf(0), stroke: VIZ.ink, 'stroke-width': 1 }));
  cfg.labels.forEach((lb, i) => {
    const v = cfg.values[i] || 0;
    const x = pad.l + slot * (i + .5) - bw / 2;
    const title = cfg.titles ? cfg.titles[i] : (typeof lb === 'object' ? lb.a : lb);
    slotHit(svg, pad.l + slot * i + 2, pad.t, slot - 4, H - pad.t - pad.b, title,
      () => [{ name: v > 0 ? 'Won by' : v < 0 ? 'Lost by' : 'Drawn', color: v >= 0 ? VIZ.pos : VIZ.neg, value: signed(v) }]);
    if (v >= 0) svg.appendChild(svgel('path', { d: roundTopBar(x, yOf(v), bw, Math.max(0.0001, yOf(0) - yOf(v)), 4), fill: VIZ.pos, 'pointer-events': 'none' }));
    else svg.appendChild(svgel('path', { d: roundBotBar(x, yOf(0), bw, yOf(v) - yOf(0), 4), fill: VIZ.neg, 'pointer-events': 'none' }));
    if (labelled && v) svg.appendChild(vtext(x + bw / 2, v > 0 ? yOf(v) - 6 : yOf(v) + 14, signed(v),
      { size: 10.5, fill: VIZ.ink2, weight: 600, anchor: 'middle' }));
  });
  axisLabels(svg, cfg.labels, i => pad.l + slot * (i + .5), H, pad, slot);
  host.appendChild(svg);
}

/* the card: title and note on the left, the legend on the right */
function chartCard(title, sub, legend) {
  const c = el('div', { cls: 'chartcard' });
  const head = el('div', { cls: 'chead' },
    el('div', {}, el('h3', { text: title }), sub ? el('div', { cls: 'sub', text: sub }) : null));
  if (legend && legend.length > 1) {
    const lg = el('div', { cls: 'legend' });
    for (const it of legend) lg.appendChild(el('span', { cls: 'k' },
      el('span', { cls: it.line ? 'ln' : 'sw', style: 'background:' + it.color }),
      el('span', { text: it.name })));
    head.appendChild(lg);
  }
  c.appendChild(head);
  return c;
}

/* ================================================================
   SEASON rendering
   ================================================================ */
const nameKey = s => String(s || '').trim().toLowerCase();
let sortP = { col: 'goals', dir: -1 }, sortK = { col: 'sv', dir: -1 };

let seasonFilter = { range: 'all', from: '', to: '', minMins: 0 };
function filteredSeasonGames() {
  let g = allSeasonGames();
  if (seasonFilter.range === 'range') {
    // a game with no date cannot be placed in a range — dropping it is honest,
    // but silently keeping it (an empty date sorts BELOW any 'To') is not
    if (seasonFilter.from || seasonFilter.to) g = g.filter(x => !!x.date);
    if (seasonFilter.from) g = g.filter(x => x.date >= seasonFilter.from);
    if (seasonFilter.to) g = g.filter(x => x.date <= seasonFilter.to);
  } else if (seasonFilter.range !== 'all') {
    g = g.slice(-Math.max(1, +seasonFilter.range || 1));
  }
  return g;
}
function wireSeasonFilter() {
  const r = $('#sf-range'), f = $('#sf-from'), t = $('#sf-to'), m = $('#sf-mins');
  if (!r || r._wired) return;
  r._wired = true;
  const sync = () => {
    seasonFilter = { range: r.value, from: f.value, to: t.value, minMins: Math.max(0, +m.value || 0) };
    $$('.sf-dates').forEach(e => { e.style.display = r.value === 'range' ? '' : 'none'; });
    renderSeason();
  };
  [r, f, t, m].forEach(x => x.addEventListener('change', sync));
}
function renderSeason() {
  wireSeasonFilter();
  const games = filteredSeasonGames();
  const total = allSeasonGames().length;
  const note = $('#sf-note');
  const undated = allSeasonGames().filter(x => !x.date).length;
  if (note) note.textContent = (games.length === total ? total + ' game(s)'
    : 'showing ' + games.length + ' of ' + total + ' games')
    + (seasonFilter.range === 'range' && undated ? ' · ' + undated + ' undated game(s) cannot be placed in a date range' : '')
    + (seasonFilter.minMins ? ' · players with ' + seasonFilter.minMins + '+ minutes' : '');
  $('#season-count').textContent = games.length + ' game(s) in view · ' + archived.length + ' saved in this browser · ' + seasonImports.length + ' from files';
  renderTiles(games); renderCharts(games); renderGameLog(games);
  renderSeasonPlayers(games); renderSeasonGK(games); renderStorageList();
}

function seasonAgg(games) {
  const P = new Map(), K = new Map();
  for (const g of games) {
    for (const p of g.players) {
      const k = nameKey(p.name);
      if (!P.has(k)) P.set(k, { name: p.name, num: p.num, gp: 0, mins: 0, goals: 0, shots: 0, ast: 0, stl: 0, blk: 0, to: 0, d7: 0, g7: 0, x7: 0, p2: 0, d2: 0, yc: 0, rc: 0 });
      const a = P.get(k); a.gp++;
      if (p.num != null) a.num = p.num;
      for (const f of ['mins', 'goals', 'shots', 'ast', 'stl', 'blk', 'to', 'd7', 'g7', 'x7', 'p2', 'd2', 'yc', 'rc']) a[f] += p[f] || 0;
    }
    for (const kp of g.keepers) {
      const k = nameKey(kp.name);
      if (!K.has(k)) K.set(k, { name: kp.name, num: kp.num, gp: 0, faced: 0, sv: 0, ga: 0, f7: 0, sv7: 0, savew: 0, en: 0 });
      const a = K.get(k); a.gp++;
      if (kp.num != null) a.num = kp.num;
      for (const f of ['faced', 'sv', 'ga', 'f7', 'sv7', 'savew', 'en']) a[f] += kp[f] || 0;
    }
  }
  return { P: Array.from(P.values()), K: Array.from(K.values()) };
}

function renderTiles(games) {
  const w = games.filter(g => g.result === 'W').length,
        l = games.filter(g => g.result === 'L').length,
        t = games.filter(g => g.result === 'T').length;
  const gf = games.reduce((s, g) => s + g.us, 0), ga = games.reduce((s, g) => s + g.them, 0);
  const { P, K } = seasonAgg(games);
  const shots = P.reduce((s, p) => s + p.shots, 0), goals = P.reduce((s, p) => s + p.goals, 0);
  const sv = K.reduce((s, k) => s + k.sv, 0), kga = K.reduce((s, k) => s + k.ga, 0);
  const m7 = P.reduce((s, p) => s + p.g7, 0), a7 = P.reduce((s, p) => s + p.g7 + p.x7, 0);
  const host = $('#tiles'); host.textContent = '';
  const tile = (lab, val, sub) => host.appendChild(el('div', { cls: 'tile' },
    el('div', { cls: 'lab', text: lab }), el('div', { cls: 'val', text: val }),
    sub ? el('div', { cls: 'sub', text: sub }) : null));
  if (!games.length) { tile('Season', '—', 'End a game or import files to see season stats'); return; }
  tile('Record', w + '–' + l + (t ? '–' + t : ''), games.length + ' games');
  tile('Goals for', String(gf), (gf / games.length).toFixed(1) + ' per game');
  tile('Goals against', String(ga), (ga / games.length).toFixed(1) + ' per game');
  tile('Shooting %', shots ? (100 * goals / shots).toFixed(1) + '%' : '—', goals + ' of ' + shots + ' shots');
  tile('Save %', (sv + kga) ? (100 * sv / (sv + kga)).toFixed(1) + '%' : '—', sv + ' saves');
  tile('7m conversion', a7 ? (100 * m7 / a7).toFixed(0) + '%' : '—', m7 + ' of ' + a7);
}

/* a game's two-line axis label (opponent over the date) and its tooltip title */
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function gShortDate(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? (+m[3]) + ' ' + MON3[+m[2] - 1] : '';
}
function gLabel(g) { return { a: g.opponent || '?', b: gShortDate(g.date) }; }
function gTitle(g) {
  return (g.ha === 'Away' ? 'at ' : 'vs ') + g.opponent + (g.date ? ' · ' + fmtGameDate(g.date) : '') + (g.est ? ' (imported)' : '');
}
const cadetName = s => String(s || '').replace(/^C[1-4]C\s+/i, '');
function renderCharts(games) {
  const host = $('#charts'); host.textContent = '';
  if (!games.length) return;
  const labels = games.map(gLabel), titles = games.map(gTitle);
  // 1 — goals for / against
  const c1 = chartCard('Goals for and against', 'per game',
    [{ name: 'Air Force', color: VIZ.s1 }, { name: 'Opponent', color: VIZ.s2 }]);
  chartGroupedBars(c1, { labels, titles, series: [
    { name: 'Air Force', color: VIZ.s1, values: games.map(g => g.us) },
    { name: 'Opponent', color: VIZ.s2, values: games.map(g => g.them) }] });
  host.appendChild(c1);
  // 2 — margin
  const c2 = chartCard('Margin', 'goal difference per game — blue won, grey lost', []);
  chartDivBar(c2, { labels, titles, values: games.map(g => g.us - g.them) });
  host.appendChild(c2);
  // 3 — shooting % + save %
  const shootPct = games.map(g => {
    const s = g.players.reduce((a, p) => a + p.shots, 0), go = g.players.reduce((a, p) => a + p.goals, 0);
    return s ? +(100 * go / s).toFixed(1) : null;
  });
  const savePct = games.map(g => {
    const sv = g.keepers.reduce((a, k) => a + k.sv, 0), ga = g.keepers.reduce((a, k) => a + k.ga, 0);
    return (sv + ga) ? +(100 * sv / (sv + ga)).toFixed(1) : null;
  });
  const c3 = chartCard('Shooting and saves', 'team shooting % and save %, per game',
    [{ name: 'Shooting %', color: VIZ.s1, line: 1 }, { name: 'Save %', color: VIZ.s2, line: 1 }]);
  chartLines(c3, { labels, titles, max: 100, fmt: v => v.toFixed(0) + '%', series: [
    { name: 'Shooting %', color: VIZ.s1, values: shootPct },
    { name: 'Save %', color: VIZ.s2, values: savePct }] });
  host.appendChild(c3);
  // 4 — top scorers
  const { P } = seasonAgg(games);
  const top = P.slice().sort((a, b) => b.goals - a.goals).filter(p => p.goals > 0).slice(0, 10)
    .map(p => ({ label: cadetName(p.name), value: p.goals, sub: p.gp + ' GP' }));
  const c4 = chartCard('Top scorers', 'season goals, up to ten', []);
  if (top.length) chartHBar(c4, { items: top, name: 'Goals' });
  else c4.appendChild(el('div', { cls: 'sub', text: 'No goals recorded yet.' }));
  host.appendChild(c4);
}

function renderGameLog(games) {
  const rows = games.map(g => ({ cells: [g.date || '—', g.opponent, g.ha || '—', g.comp || '—',
    g.result + (g.est ? ' (est.)' : ''), g.us + '–' + g.them,
    topScorerOf(g), g.source] }));
  statTable($('#gamelog'),
    [{ lab: 'Date' }, { lab: 'Opponent', l: 1 }, { lab: 'H/A' }, { lab: 'Competition', l: 1 },
     { lab: 'Result' }, { lab: 'Score' }, { lab: 'Top scorer', l: 1 }, { lab: 'Source', l: 1 }],
    rows.length ? rows : [{ cells: ['No games yet', '', '', '', '', '', '', ''] }]);
}
/* ---------- the match report ----------
   Three paragraphs written from the game's own numbers, so every game
   published gets a recap without anyone typing one. Every clause is guarded:
   a thin record (an old workbook with no shot counts) simply says less. */
function fmtGameDate(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(d);
  const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1];
}
const joinList = a => a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const NUMWORD = ['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
const capNum = n => { const w = n <= 10 ? NUMWORD[n] : String(n); return w.charAt(0).toUpperCase() + w.slice(1); };
function gameRecap(g) {
  if (!g) return [];
  const P = g.players.slice().sort((a, b) => b.goals - a.goals || b.ast - a.ast);
  const K = g.keepers.filter(k => k.faced > 0 && nameKey(k.name) !== nameKey(GK_NONE))
    .sort((a, b) => b.faced - a.faced);
  const sum = f => P.reduce((s, p) => s + (p[f] || 0), 0);
  const goals = sum('goals'), shots = sum('shots'), asts = sum('ast');
  const m7 = sum('g7'), a7 = m7 + sum('x7'), tos = sum('to'), stls = sum('stl'), blks = sum('blk'), p2 = sum('p2');
  const F = g.flow || null;
  const margin = Math.abs(g.us - g.them);
  const won = g.result === 'W', lost = g.result === 'L';
  const verb = won ? 'beat' : lost ? 'lost to' : 'drew with';
  const where = g.ha === 'Home' ? ' at home' : g.ha === 'Away' ? ' on the road' : '';
  const when = fmtGameDate(g.date);
  const COMP = { 'Regular season': 'in a regular-season game', 'Tournament': 'in a tournament game',
    'Nationals': 'at nationals', 'Scrimmage': 'in a scrimmage', 'Exhibition': 'in an exhibition' };
  const comp = g.comp ? (COMP[g.comp] || 'in the ' + g.comp.toLowerCase()) : '';
  const ht = /^\d+-\d+$/.test(g.ht || '') ? g.ht.split('-').map(Number) : null;

  /* 1 — the result, and how the game turned */
  const HALFNAME = { H1: 'in the first half', H2: 'in the second half', OT1: 'in overtime', OT2: 'in overtime', SO: 'in the shoot-out' };
  const inHalf = h => HALFNAME[h] ? ' ' + HALFNAME[h] : '';
  const winner = won ? 'Air Force' : g.opponent;
  const htLine = ht ? 'Air Force ' + (ht[0] > ht[1] ? 'took a ' + (ht[0] - ht[1]) + '-goal lead into the break at '
    : ht[0] < ht[1] ? 'went in ' + (ht[1] - ht[0]) + ' down at the break at ' : 'was level at the break at ')
    + ht[0] + '–' + ht[1] : '';
  const a = ['Air Force ' + verb + ' ' + g.opponent + ' ' + g.us + '–' + g.them + where
    + (comp ? ' ' + comp : '') + (when ? ' on ' + when : '') + '.'];
  /* A one-sided score can hide a close start, so a wide margin never claims
     the game was never in doubt: it says when it was last level and names the
     run that broke it open — or that the winner led throughout, when it did. */
  if (margin >= 6 && F && g.result !== 'T') {
    const loserLed = won ? F.maxThem > 0 : F.maxUs > 0;
    if (F.lastEqual) {
      a.push((F.leadChanges > 2 || F.ties > 4)
        ? 'It was a contest early: the lead changed hands ' + plural(F.leadChanges, 'time') + ' and the scores were level on '
          + plural(F.ties, 'occasion') + ', the last of them at ' + F.lastEqual + inHalf(F.lastEqualHalf) + '.'
        : 'The scores were last level at ' + F.lastEqual + inHalf(F.lastEqualHalf) + '.');
      const R = F.bestRun;
      a.push(R && R.n >= 4 && R.mine === won && R.i > F.lastEqualI
        ? 'From there ' + winner + ' pulled away, with a ' + R.n + '–0 run' + inHalf(R.half) + ' that took the score from ' + R.from + ' to ' + R.to + '.'
        : 'From there ' + winner + ' pulled away.');
    } else if (!loserLed) a.push(winner + ' led from the first goal to the last.');
    if (htLine) a.push(htLine + ', and the final margin was ' + plural(margin, 'goal') + '.');
    else a.push('The final margin was ' + plural(margin, 'goal') + '.');
  } else {
    if (margin === 1) a.push('One goal separated the sides at the final whistle.');
    else if (margin >= 6) a.push('The final margin was ' + plural(margin, 'goal') + '.');
    else if (margin > 1) a.push('It finished ' + plural(margin, 'goal') + ' apart.');
    if (htLine) a.push(htLine + '.');
    if (F) {
      if (F.leadChanges > 2) a.push('The lead changed hands ' + plural(F.leadChanges, 'time')
        + (F.ties ? ' and the score was level on ' + plural(F.ties, 'occasion') : '') + '.');
      else if (F.ties > 4) a.push('Neither side could pull clear — the scores were level ' + plural(F.ties, 'time') + '.');
      const biggest = Math.max(F.maxUs, F.maxThem);
      if (biggest >= 3) a.push(F.maxUs >= F.maxThem
        ? 'Air Force led by as many as ' + plural(F.maxUs, 'goal') + '.'
        : g.opponent + ' led by as many as ' + plural(F.maxThem, 'goal') + '.');
      else if (biggest <= 2) a.push('Neither team led by more than ' + plural(biggest, 'goal') + ' all afternoon.');
      if (F.lastEqual && margin <= 3) a.push('The last time the game was level was ' + F.lastEqual + '.');
      if (F.last) a.push('The last goal of the game ' + (F.last.mine ? 'was Air Force\'s' + (F.last.player ? ', through ' + F.last.player : '') : 'went to ' + g.opponent)
        + inHalf(F.last.half) + '.');
    }
  }

  /* 2 — the attack */
  const b = [];
  const scorers = P.filter(p => p.goals > 0);
  if (scorers.length) {
    const lead = scorers[0], tied = scorers.filter(p => p.goals === lead.goals);
    const hg = F && F.halfGoals ? F.halfGoals[nameKey(lead.name)] : null;
    b.push(joinList(tied.map(p => p.name)) + (tied.length > 1 ? ' shared top scoring on ' : ' led the scoring with ')
      + plural(lead.goals, 'goal') + (lead.shots ? ' from ' + plural(lead.shots, 'shot') : '')
      + (lead.shots ? ', a ' + Math.round(100 * lead.goals / lead.shots) + ' per cent return' : '') + '.');
    if (hg && (hg.H1 || hg.H2)) b.push((hg.H2 > hg.H1 ? capNum(hg.H2) + ' of them came after the break'
      : hg.H1 > hg.H2 ? capNum(hg.H1) + ' of them came in the first half'
      : 'They were split evenly across the halves') + '.');
    const next = scorers.filter(p => p !== lead && p.goals < lead.goals).slice(0, 3);
    if (next.length) b.push(joinList(next.map(p => p.name + ' added ' + p.goals)) + '.');
    if (scorers.length > 4) b.push(capNum(scorers.length) + ' players got on the scoresheet.');
  } else b.push('No individual scoring was recorded for this game.');
  if (shots) b.push('As a team Air Force scored ' + goals + ' from ' + plural(shots, 'shot')
    + ', a shooting rate of ' + Math.round(100 * goals / shots) + ' per cent.');
  if (asts) b.push('The passing produced ' + plural(asts, 'assist') + '.');
  if (a7) b.push('From seven metres the Falcons converted ' + m7 + ' of ' + a7
    + (m7 < a7 ? ' — ' + plural(a7 - m7, 'chance') + ' left behind' : ', a perfect record') + '.');

  /* 3 — the other end */
  const c = [];
  if (K.length) {
    const k = K[0], pct = (k.sv + k.ga) ? Math.round(100 * k.sv / (k.sv + k.ga)) : 0;
    c.push('In goal, ' + k.name + ' faced ' + plural(k.faced, 'shot') + ' and kept out ' + k.sv
      + ', a save rate of ' + pct + ' per cent'
      + (k.savew ? ', with ' + plural(k.savew, 'further save') + ' after the whistle' : '') + '.');
    if (K.length > 1) c.push(joinList(K.slice(1).map(x => x.name + ' faced ' + plural(x.faced, 'shot')
      + ' and saved ' + x.sv)) + ' in his turn between the posts.');
    const en = K.reduce((s, x) => s + (x.en || 0), 0);
    if (en) c.push('With the keeper pulled late, ' + plural(en, 'goal') + ' went into an empty net.');
  }
  const def = [];
  if (stls) def.push(plural(stls, 'steal'));
  if (blks) def.push(plural(blks, 'block'));
  if (def.length) c.push('The defence produced ' + joinList(def) + '.');   // 'him' was ambiguous once two keepers were named
  if (tos) c.push('Air Force turned the ball over ' + plural(tos, 'time')
    + (tos >= 8 ? ', the one number the staff will want back' : '') + '.');
  if (p2) c.push('The Falcons served ' + plural(p2, 'two-minute suspension') + '.');
  if (!c.length) c.push('Nothing was recorded at the defensive end for this game.');

  return [a.join(' '), b.join(' '), c.join(' ')];
}
function topScorerOf(g) {
  let best = null;
  for (const p of g.players) if (!best || p.goals > best.goals) best = p;
  return best && best.goals ? best.name + ' (' + best.goals + ')' : '—';
}

const SP_COLS = [
  { k: 'num', lab: '#' }, { k: 'name', lab: 'Player', l: 1 }, { k: 'gp', lab: 'GP' },
  { k: 'mins', lab: 'Minutes' },
  { k: 'goals', lab: 'Goals' }, { k: 'shots', lab: 'Shots' }, { k: 'pct', lab: 'Shot %' },
  { k: 'gpg', lab: 'G/Gm' }, { k: 'ast', lab: 'Ast' }, { k: 'stl', lab: 'Stl' }, { k: 'blk', lab: 'Blk' },
  { k: 'to', lab: 'TO' }, { k: 'd7', lab: '7m Drawn' }, { k: 'g7', lab: '7m Made' }, { k: 'x7', lab: '7m Miss' },
  { k: 'p2', lab: '2 Min' }, { k: 'd2', lab: '2 Drawn' }, { k: 'yc', lab: 'YC' }, { k: 'rc', lab: 'RC' },
  { k: 'pts', lab: 'Pts' }];
function renderSeasonPlayers(games) {
  const { P } = seasonAgg(games);
  const rows = P.map(p => Object.assign({}, p, {
    pct: p.shots ? p.goals / p.shots : null,
    gpg: p.gp ? p.goals / p.gp : 0, pts: p.goals + p.ast }))
    .filter(p => (p.mins || 0) >= seasonFilter.minMins);
  rows.sort((a, b) => {
    const va = a[sortP.col], vb = b[sortP.col];
    if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
    return typeof va === 'string' ? sortP.dir * va.localeCompare(vb) : sortP.dir * (va - vb);
  });
  const host = $('#season-players'); host.textContent = '';
  const t = el('table', { cls: 'stats' });
  const thr = el('tr');
  for (const c of SP_COLS) {
    const th = el('th', { text: c.lab + (sortP.col === c.k ? (sortP.dir < 0 ? ' ▼' : ' ▲') : ''), cls: c.l ? 'l' : '' });
    th.addEventListener('click', () => {
      if (sortP.col === c.k) sortP.dir *= -1; else { sortP.col = c.k; sortP.dir = -1; }
      renderSeasonPlayers(games);
    });
    thr.appendChild(th);
  }
  t.appendChild(thr);
  for (const r of rows) {
    const tr = el('tr');
    for (const c of SP_COLS) {
      let v = r[c.k];
      if (c.k === 'pct') v = fmtPct(v);
      else if (c.k === 'gpg') v = v.toFixed(1);
      else if (c.k === 'mins') v = (v || 0).toFixed(0);
      else if (v == null) v = '';
      tr.appendChild(el('td', { text: String(v), cls: c.l ? 'l' : '' }));
    }
    t.appendChild(tr);
  }
  if (!rows.length) t.appendChild(el('tr', null, el('td', { colspan: String(SP_COLS.length), cls: 'l',
    text: !P.length ? 'No player data yet'
      : seasonFilter.minMins ? 'No player reaches ' + seasonFilter.minMins + ' minutes in these games — games tracked before playing time was recorded carry no minutes.'
      : 'No player data yet' })));
  host.appendChild(t);
}
const SK_COLS = [
  { k: 'num', lab: '#' }, { k: 'name', lab: 'Keeper', l: 1 }, { k: 'gp', lab: 'GP' },
  { k: 'faced', lab: 'Shots Faced' }, { k: 'sv', lab: 'Saves' }, { k: 'pct', lab: 'Save %' },
  { k: 'ga', lab: 'Goals Allowed' }, { k: 'f7', lab: '7m Faced' }, { k: 'sv7', lab: '7m Saved' },
  { k: 'savew', lab: 'Saves After Whistle' }, { k: 'en', lab: 'Empty Net' }];
function renderSeasonGK(games) {
  const { K } = seasonAgg(games);
  const rows = K.filter(k => nameKey(k.name) !== nameKey(GK_NONE))
    .map(k => Object.assign({}, k, { pct: (k.sv + k.ga) ? k.sv / (k.sv + k.ga) : null }));
  rows.sort((a, b) => {
    const va = a[sortK.col], vb = b[sortK.col];
    if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
    return typeof va === 'string' ? sortK.dir * va.localeCompare(vb) : sortK.dir * (va - vb);
  });
  const host = $('#season-gk'); host.textContent = '';
  const t = el('table', { cls: 'stats' });
  const thr = el('tr');
  for (const c of SK_COLS) {
    const th = el('th', { text: c.lab + (sortK.col === c.k ? (sortK.dir < 0 ? ' ▼' : ' ▲') : ''), cls: c.l ? 'l' : '' });
    th.addEventListener('click', () => {
      if (sortK.col === c.k) sortK.dir *= -1; else { sortK.col = c.k; sortK.dir = -1; }
      renderSeasonGK(games);
    });
    thr.appendChild(th);
  }
  t.appendChild(thr);
  for (const r of rows) {
    const tr = el('tr');
    for (const c of SK_COLS) {
      let v = r[c.k];
      if (c.k === 'pct') v = fmtPct(v); else if (v == null) v = '';
      tr.appendChild(el('td', { text: String(v), cls: c.l ? 'l' : '' }));
    }
    t.appendChild(tr);
  }
  if (!rows.length) t.appendChild(el('tr', null, el('td', { text: 'No goalkeeper data yet', cls: 'l' })));
  host.appendChild(t);
}
function renderStorageList() {
  const host = $('#storage-list'); host.textContent = '';
  const t = el('table', { cls: 'stats' });
  const thr = el('tr');
  for (const h of ['Date', 'Opponent', 'Score', '', '']) thr.appendChild(el('th', { text: h, cls: h === 'Opponent' ? 'l' : '' }));
  t.appendChild(thr);
  archived.forEach((g, i) => {
    const d = derive(g);
    const tr = el('tr',null,
      el('td', { text: g.info.date }),
      el('td', { cls: 'l', text: g.info.opponent }),
      el('td', { text: d.us + '–' + d.them }),
      el('td', null, el('button', { cls: 'btn', text: '⬇ RE-EXPORT', style: 'padding:3px 9px;font-size:11px', onclick: () => exportGameXlsx(g) })),
      el('td', null, el('button', { cls: 'evx', text: '✕', title: 'Delete from this browser',
        onclick: () => { if (confirm('Delete the archived game vs ' + g.info.opponent + ' from this browser? Exported files are not affected.')) { archived.splice(i, 1); lsSet(LS.games, archived); renderSeason(); renderSetupHint(); } } })));
    t.appendChild(tr);
  });
  if (!archived.length) t.appendChild(el('tr', null, el('td', { text: 'No games archived in this browser yet.', cls: 'l' })));
  host.appendChild(t);
}

/* ---------- season report export ---------- */
$('#btn-season-export').addEventListener('click', () => {
  const games = filteredSeasonGames();
  if (!games.length) { toast('No season data to export yet'); return; }
  const wb = XLSX.utils.book_new();
  const w = games.filter(g => g.result === 'W').length, l = games.filter(g => g.result === 'L').length,
        t = games.filter(g => g.result === 'T').length;
  const gf = games.reduce((s, g) => s + g.us, 0), ga = games.reduce((s, g) => s + g.them, 0);
  const sum = [
    ['USAFA TEAM HANDBALL — SEASON REPORT'],
    ['Generated', new Date().toLocaleString()],
    ['Games', games.length], ['Record', w + '-' + l + '-' + t],
    ['Goals for', gf], ['Goals against', ga], ['Goal differential', gf - ga],
    ['Goals for / game', +(gf / games.length).toFixed(2)],
    ['Goals against / game', +(ga / games.length).toFixed(2)],
    ['Filter — games', seasonFilter.range === 'range'
      ? ('date range ' + (seasonFilter.from || 'start') + ' to ' + (seasonFilter.to || 'now'))
      : (seasonFilter.range === 'all' ? 'all games' : 'last ' + seasonFilter.range + ' games')],
    ['Filter — minimum minutes', seasonFilter.minMins || 0],
  ];
  const wsS = XLSX.utils.aoa_to_sheet(sum); wsS['!cols'] = [{ wch: 26 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsS, 'Season Summary');
  const agg0 = seasonAgg(games);
  // the report is what the screen says it is: the same minutes floor applies
  const P = agg0.P.filter(p => (p.mins || 0) >= seasonFilter.minMins), K = agg0.K;
  const pAoa = [['No', 'Player', 'GP', 'Minutes', 'Goals', 'Shots', 'Shot %', 'Goals per Game', 'Assists', 'Steals', 'Blocks', 'Turnovers',
    "7's Drawn", "7's Made", "7's Missed", '2 Min', "2's Drawn", 'Yellow', 'Red', 'Points']];
  for (const p of P.slice().sort((a, b) => b.goals - a.goals))
    pAoa.push([p.num ?? '', p.name, p.gp, +(p.mins || 0).toFixed(1), p.goals, p.shots, p.shots ? +(100 * p.goals / p.shots).toFixed(1) : '',
      p.gp ? +(p.goals / p.gp).toFixed(2) : '', p.ast, p.stl, p.blk, p.to, p.d7, p.g7, p.x7, p.p2, p.d2, p.yc, p.rc, p.goals + p.ast]);
  const wsP = XLSX.utils.aoa_to_sheet(pAoa);
  wsP['!cols'] = [{ wch: 5 }, { wch: 18 }].concat(pAoa[0].slice(2).map(() => ({ wch: 10 })));
  XLSX.utils.book_append_sheet(wb, wsP, 'Player Totals');
  const kAoa = [['No', 'Keeper', 'GP', 'Shots Faced', 'Saves', 'Save %', 'Goals Allowed', "7's Faced", "7's Saved", 'Saves After Whistle', 'Empty Net Goals']];
  for (const k of K.filter(x => nameKey(x.name) !== nameKey(GK_NONE)).sort((a, b) => b.sv - a.sv))
    kAoa.push([k.num ?? '', k.name, k.gp, k.faced, k.sv, (k.sv + k.ga) ? +(100 * k.sv / (k.sv + k.ga)).toFixed(1) : '', k.ga, k.f7, k.sv7, k.savew, k.en || 0]);
  const wsK = XLSX.utils.aoa_to_sheet(kAoa);
  wsK['!cols'] = [{ wch: 5 }, { wch: 18 }].concat(kAoa[0].slice(2).map(() => ({ wch: 12 })));
  XLSX.utils.book_append_sheet(wb, wsK, 'Goalkeeper Totals');
  const gAoa = [['Date', 'Opponent', 'Home/Away', 'Competition', 'Result', 'AF', 'Opp', 'Margin', 'Top scorer', 'Source']];
  for (const g of games) gAoa.push([g.date || '', g.opponent, g.ha || '', g.comp || '', g.result + (g.est ? ' (est.)' : ''),
    g.us, g.them, g.us - g.them, topScorerOf(g), g.source]);
  const wsG = XLSX.utils.aoa_to_sheet(gAoa);
  wsG['!cols'] = [{ wch: 11 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 5 }, { wch: 5 }, { wch: 7 }, { wch: 18 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(wb, wsG, 'Game Log');
  XLSX.writeFile(wb, 'AFA_Handball_Season_Report.xlsx');
  toast('Season report downloaded');
});

/* ================================================================
   BOOT
   ================================================================ */
(function boot() {
  $('#crest').src = LOGOS.airforce;
  $('#home-crest').src = LOGOS.airforce;
  $('#about-crest').src = LOGOS.airforce;
  if (LOGOS.teamphoto) $('#home-team-photo').src = LOGOS.teamphoto;
  else ($('#home-team-photo').closest('.home-photo') || $('#home-team-photo')).style.display = 'none';
  $('#sb-us-logo').src = LOGOS.airforce;
  $('#g-date').value = new Date().toISOString().slice(0, 10);
  renderRoster(); renderSetupHint(); applyAdminUI(); renderGamePick();
  if (game && !game.done) {
    enterLiveMode();   // a running clock keeps counting via its timestamp anchor
    if (adminOn) showTab('game');   // mid-game reload lands staff back on the floor
    else renderHome();              // a locked device resumes through the gate
    if (adminOn) toast('Resumed the game vs ' + game.info.opponent);
  } else {
    renderHome();
  }
  loadRepoRoster();     // all of these are best-effort async — offline copies skip them
  loadRepoGames();
  loadRepoTeam();
  loadRepoGallery();
})();
