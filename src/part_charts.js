'use strict';
/* ================================================================
   Charts — tiny SVG renderer.
   Mark specs: bars ≤24px with a 4px rounded data-end (square at the
   baseline), 2px gaps between touching bars, 2px lines with ≥8px
   surface-ringed markers, solid hairline gridlines, muted axis text.
   Tooltips enhance (tables below carry every value).
   ================================================================ */
const VIZ = {
  s1: '#2a78d6', s2: '#eb6834', pos: '#2a78d6', neg: '#e34948',
  grid: '#e1e0d9', axis: '#c3c2b7', ink2: '#52514e', mut: '#898781', surf: '#fcfcfb',
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
  return svgel('svg', { viewBox: '0 0 ' + W + ' ' + H, style: 'width:100%;display:block' });
}
function axisLabels(svg, labels, xOf, H, pad) {
  const step = Math.ceil(labels.length / 12);
  labels.forEach((lb, i) => {
    if (i % step) return;
    svg.appendChild(svgel('text', { x: xOf(i), y: H - pad.b + 16, 'text-anchor': 'middle',
      'font-size': 10.5, fill: VIZ.mut, text: lb }));
  });
}
function gridY(svg, max, yOf, pad, W, fmt) {
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = max * i / ticks, y = yOf(v);
    if (i > 0) svg.appendChild(svgel('line', { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: VIZ.grid, 'stroke-width': 1 }));
    svg.appendChild(svgel('text', { x: pad.l - 6, y: y + 3.5, 'text-anchor': 'end', 'font-size': 10.5, fill: VIZ.mut, text: fmt ? fmt(v) : String(Math.round(v)) }));
  }
}

/* grouped bars: {labels, series:[{name,color,values}], fmt} */
function chartGroupedBars(host, cfg) {
  const W = 560, H = 250, pad = { l: 34, r: 10, t: 12, b: 26 };
  const svg = baseSvg(W, H);
  const max = niceMax(Math.max(1, ...cfg.series.flatMap(s => s.values)));
  const yOf = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const slot = (W - pad.l - pad.r) / cfg.labels.length;
  const bw = Math.max(3, Math.min(24, (slot - 8) / cfg.series.length - 2));
  gridY(svg, max, yOf, pad, W);
  svg.appendChild(svgel('line', { x1: pad.l, y1: yOf(0), x2: W - pad.r, y2: yOf(0), stroke: VIZ.axis, 'stroke-width': 1 }));
  cfg.labels.forEach((lb, i) => {
    const cx = pad.l + slot * (i + .5);
    const totalW = cfg.series.length * bw + (cfg.series.length - 1) * 2;
    cfg.series.forEach((s, si) => {
      const v = s.values[i] || 0;
      const x = cx - totalW / 2 + si * (bw + 2);
      const p = svgel('path', { d: roundTopBar(x, yOf(v), bw, yOf(0) - yOf(v), 4), fill: s.color });
      svg.appendChild(p);
    });
    // hit target spans the slot
    const hit = svgel('rect', { x: pad.l + slot * i, y: pad.t, width: slot, height: H - pad.t - pad.b, fill: 'transparent' });
    hit.addEventListener('pointermove', ev => showTip(ev.clientX, ev.clientY, cfg.titles ? cfg.titles[i] : lb,
      cfg.series.map(s => ({ name: s.name, color: s.color, value: cfg.fmt ? cfg.fmt(s.values[i] || 0) : String(s.values[i] || 0) }))));
    hit.addEventListener('pointerleave', hideTip);
    svg.appendChild(hit);
  });
  axisLabels(svg, cfg.labels, i => pad.l + slot * (i + .5), H, pad);
  host.appendChild(svg);
}

/* lines: {labels, series:[{name,color,values(null ok)}], fmt, max?} */
function chartLines(host, cfg) {
  const W = 560, H = 250, pad = { l: 40, r: 46, t: 12, b: 26 };
  const svg = baseSvg(W, H);
  const max = cfg.max || niceMax(Math.max(1, ...cfg.series.flatMap(s => s.values.filter(v => v != null))));
  const yOf = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const n = cfg.labels.length;
  const xOf = i => n === 1 ? (pad.l + (W - pad.l - pad.r) / 2) : pad.l + (W - pad.l - pad.r) * i / (n - 1);
  gridY(svg, max, yOf, pad, W, cfg.fmt);
  svg.appendChild(svgel('line', { x1: pad.l, y1: yOf(0), x2: W - pad.r, y2: yOf(0), stroke: VIZ.axis, 'stroke-width': 1 }));
  const cross = svgel('line', { x1: 0, y1: pad.t, x2: 0, y2: H - pad.b, stroke: VIZ.axis, 'stroke-width': 1, opacity: 0 });
  svg.appendChild(cross);
  for (const s of cfg.series) {
    let dPath = '', started = false;
    s.values.forEach((v, i) => {
      if (v == null) { started = false; return; }
      dPath += (started ? ' L' : ' M') + xOf(i) + ',' + yOf(v); started = true;
    });
    if (dPath) svg.appendChild(svgel('path', { d: dPath, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    s.values.forEach((v, i) => {
      if (v == null) return;
      svg.appendChild(svgel('circle', { cx: xOf(i), cy: yOf(v), r: 4, fill: s.color, stroke: VIZ.surf, 'stroke-width': 2 }));
    });
    // endpoint direct label
    for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) {
      svg.appendChild(svgel('text', { x: xOf(i) + 8, y: yOf(s.values[i]) + 3.5, 'font-size': 10.5, 'font-weight': 700, fill: VIZ.ink2,
        text: cfg.fmt ? cfg.fmt(s.values[i]) : String(s.values[i]) }));
      break;
    }
  }
  axisLabels(svg, cfg.labels, xOf, H, pad);
  const hit = svgel('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' });
  hit.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect();
    const mx = (ev.clientX - r.left) / r.width * W;
    let best = 0, bd = 1e9;
    for (let i = 0; i < n; i++) { const dd = Math.abs(xOf(i) - mx); if (dd < bd) { bd = dd; best = i; } }
    cross.setAttribute('x1', xOf(best)); cross.setAttribute('x2', xOf(best)); cross.setAttribute('opacity', 1);
    showTip(ev.clientX, ev.clientY, cfg.titles ? cfg.titles[best] : cfg.labels[best],
      cfg.series.filter(s => s.values[best] != null).map(s => ({ name: s.name, color: s.color, value: cfg.fmt ? cfg.fmt(s.values[best]) : String(s.values[best]) })));
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); hideTip(); });
  svg.appendChild(hit);
  host.appendChild(svg);
}

/* horizontal bars: {items:[{label,value,sub}], fmt} — one series, value at tip */
function chartHBar(host, cfg) {
  const rowH = 26, W = 560, pad = { l: 118, r: 54, t: 6, b: 6 };
  const H = pad.t + pad.b + cfg.items.length * rowH;
  const svg = baseSvg(W, H);
  const max = niceMax(Math.max(1, ...cfg.items.map(i => i.value)));
  const wOf = v => (W - pad.l - pad.r) * v / max;
  svg.appendChild(svgel('line', { x1: pad.l, y1: pad.t, x2: pad.l, y2: H - pad.b, stroke: VIZ.axis, 'stroke-width': 1 }));
  cfg.items.forEach((it, i) => {
    const y = pad.t + i * rowH + (rowH - 18) / 2;
    // rounded data-end on the right, square at the baseline
    const w = wOf(it.value);
    const r = 4;
    const dd = 'M' + pad.l + ',' + y + ' L' + (pad.l + Math.max(0, w - r)) + ',' + y +
      ' Q' + (pad.l + w) + ',' + y + ' ' + (pad.l + w) + ',' + (y + Math.min(r, 9)) +
      ' L' + (pad.l + w) + ',' + (y + 18 - r) + ' Q' + (pad.l + w) + ',' + (y + 18) + ' ' + (pad.l + Math.max(0, w - r)) + ',' + (y + 18) +
      ' L' + pad.l + ',' + (y + 18) + ' Z';
    const p = svgel('path', { d: dd, fill: VIZ.s1 });
    svg.appendChild(p);
    const nm = svgel('text', { x: pad.l - 8, y: y + 13, 'text-anchor': 'end', 'font-size': 11.5, fill: VIZ.ink2, text: it.label });
    svg.appendChild(nm);
    svg.appendChild(svgel('text', { x: pad.l + w + 6, y: y + 13, 'font-size': 11.5, 'font-weight': 700, fill: VIZ.ink2,
      text: cfg.fmt ? cfg.fmt(it.value) : String(it.value) }));
    const hit = svgel('rect', { x: 0, y: pad.t + i * rowH, width: W, height: rowH, fill: 'transparent' });
    hit.addEventListener('pointermove', ev => showTip(ev.clientX, ev.clientY, it.label,
      [{ name: cfg.name || '', color: VIZ.s1, value: (cfg.fmt ? cfg.fmt(it.value) : String(it.value)) + (it.sub ? ' · ' + it.sub : '') }]));
    hit.addEventListener('pointerleave', hideTip);
    svg.appendChild(hit);
  });
  host.appendChild(svg);
}

/* diverging bars around 0: {labels, values, titles} */
function chartDivBar(host, cfg) {
  const W = 560, H = 250, pad = { l: 34, r: 10, t: 12, b: 26 };
  const svg = baseSvg(W, H);
  const ext = niceMax(Math.max(1, ...cfg.values.map(v => Math.abs(v))));
  const yOf = v => pad.t + (H - pad.t - pad.b) * (1 - (v + ext) / (2 * ext));
  const slot = (W - pad.l - pad.r) / cfg.labels.length;
  const bw = Math.max(3, Math.min(24, slot - 8));
  [ext, ext / 2, 0, -ext / 2, -ext].forEach(v => {
    const y = yOf(v);
    if (v !== 0) svg.appendChild(svgel('line', { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: VIZ.grid, 'stroke-width': 1 }));
    svg.appendChild(svgel('text', { x: pad.l - 6, y: y + 3.5, 'text-anchor': 'end', 'font-size': 10.5, fill: VIZ.mut, text: (v > 0 ? '+' : '') + v }));
  });
  svg.appendChild(svgel('line', { x1: pad.l, y1: yOf(0), x2: W - pad.r, y2: yOf(0), stroke: VIZ.axis, 'stroke-width': 1.5 }));
  cfg.labels.forEach((lb, i) => {
    const v = cfg.values[i] || 0;
    const x = pad.l + slot * (i + .5) - bw / 2;
    let p;
    if (v >= 0) p = svgel('path', { d: roundTopBar(x, yOf(v), bw, Math.max(0.0001, yOf(0) - yOf(v)), 4), fill: VIZ.pos });
    else p = svgel('path', { d: roundBotBar(x, yOf(0), bw, yOf(v) - yOf(0), 4), fill: VIZ.neg });
    svg.appendChild(p);
    const hit = svgel('rect', { x: pad.l + slot * i, y: pad.t, width: slot, height: H - pad.t - pad.b, fill: 'transparent' });
    hit.addEventListener('pointermove', ev => showTip(ev.clientX, ev.clientY, cfg.titles ? cfg.titles[i] : lb,
      [{ name: v >= 0 ? 'Won by' : 'Lost by', color: v >= 0 ? VIZ.pos : VIZ.neg, value: (v > 0 ? '+' : '') + v }]));
    hit.addEventListener('pointerleave', hideTip);
    svg.appendChild(hit);
  });
  axisLabels(svg, cfg.labels, i => pad.l + slot * (i + .5), H, pad);
  host.appendChild(svg);
}

function chartCard(title, sub, legend) {
  const c = el('div', { cls: 'chartcard' });
  c.appendChild(el('h3', { text: title }));
  if (sub) c.appendChild(el('div', { cls: 'sub', text: sub }));
  if (legend && legend.length > 1) {
    const lg = el('div', { cls: 'legend' });
    for (const it of legend) lg.appendChild(el('span', { cls: 'k' },
      el('span', { cls: it.line ? 'ln' : 'sw', style: 'background:' + it.color }),
      el('span', { text: it.name })));
    c.appendChild(lg);
  }
  return c;
}

/* ================================================================
   SEASON rendering
   ================================================================ */
const nameKey = s => String(s || '').trim().toLowerCase();
let sortP = { col: 'goals', dir: -1 }, sortK = { col: 'sv', dir: -1 };

function renderSeason() {
  const games = allSeasonGames();
  $('#season-count').textContent = games.length + ' game(s) in view · ' + archived.length + ' saved in this browser · ' + seasonImports.length + ' from files';
  renderTiles(games); renderCharts(games); renderGameLog(games);
  renderSeasonPlayers(games); renderSeasonGK(games); renderStorageList();
}

function seasonAgg(games) {
  const P = new Map(), K = new Map();
  for (const g of games) {
    for (const p of g.players) {
      const k = nameKey(p.name);
      if (!P.has(k)) P.set(k, { name: p.name, num: p.num, gp: 0, goals: 0, shots: 0, ast: 0, stl: 0, blk: 0, to: 0, d7: 0, g7: 0, x7: 0, p2: 0, d2: 0, yc: 0, rc: 0 });
      const a = P.get(k); a.gp++;
      if (p.num != null) a.num = p.num;
      for (const f of ['goals', 'shots', 'ast', 'stl', 'blk', 'to', 'd7', 'g7', 'x7', 'p2', 'd2', 'yc', 'rc']) a[f] += p[f] || 0;
    }
    for (const kp of g.keepers) {
      const k = nameKey(kp.name);
      if (!K.has(k)) K.set(k, { name: kp.name, num: kp.num, gp: 0, faced: 0, sv: 0, ga: 0, f7: 0, sv7: 0, savew: 0 });
      const a = K.get(k); a.gp++;
      if (kp.num != null) a.num = kp.num;
      for (const f of ['faced', 'sv', 'ga', 'f7', 'sv7', 'savew']) a[f] += kp[f] || 0;
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

function gLabel(g) { return (g.opponent || '?').slice(0, 9); }
function gTitle(g) { return 'vs ' + g.opponent + (g.date ? ' · ' + g.date : '') + (g.est ? ' (imported)' : ''); }

function renderCharts(games) {
  const host = $('#charts'); host.textContent = '';
  if (!games.length) return;
  const labels = games.map(gLabel), titles = games.map(gTitle);
  // 1 — goals for / against
  const c1 = chartCard('Goals for vs against', 'per game',
    [{ name: 'Air Force', color: VIZ.s1 }, { name: 'Opponent', color: VIZ.s2 }]);
  chartGroupedBars(c1, { labels, titles, series: [
    { name: 'Air Force', color: VIZ.s1, values: games.map(g => g.us) },
    { name: 'Opponent', color: VIZ.s2, values: games.map(g => g.them) }] });
  host.appendChild(c1);
  // 2 — margin
  const c2 = chartCard('Margin of victory', 'goal differential per game', []);
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
  const c3 = chartCard('Shooting % and save %', 'team, per game',
    [{ name: 'Shooting %', color: VIZ.s1, line: 1 }, { name: 'Save %', color: VIZ.s2, line: 1 }]);
  chartLines(c3, { labels, titles, max: 100, fmt: v => v.toFixed(0) + '%', series: [
    { name: 'Shooting %', color: VIZ.s1, values: shootPct },
    { name: 'Save %', color: VIZ.s2, values: savePct }] });
  host.appendChild(c3);
  // 4 — top scorers
  const { P } = seasonAgg(games);
  const top = P.slice().sort((a, b) => b.goals - a.goals).slice(0, 10)
    .map(p => ({ label: p.name.slice(0, 14), value: p.goals, sub: p.gp + ' GP' }));
  const c4 = chartCard('Top scorers', 'season goals (top 10)', []);
  if (top.length) chartHBar(c4, { items: top, name: 'Goals' });
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
function topScorerOf(g) {
  let best = null;
  for (const p of g.players) if (!best || p.goals > best.goals) best = p;
  return best && best.goals ? best.name + ' (' + best.goals + ')' : '—';
}

const SP_COLS = [
  { k: 'num', lab: '#' }, { k: 'name', lab: 'Player', l: 1 }, { k: 'gp', lab: 'GP' },
  { k: 'goals', lab: 'Goals' }, { k: 'shots', lab: 'Shots' }, { k: 'pct', lab: 'Shot %' },
  { k: 'gpg', lab: 'G/Gm' }, { k: 'ast', lab: 'Ast' }, { k: 'stl', lab: 'Stl' }, { k: 'blk', lab: 'Blk' },
  { k: 'to', lab: 'TO' }, { k: 'd7', lab: '7m Drawn' }, { k: 'g7', lab: '7m Made' }, { k: 'x7', lab: '7m Miss' },
  { k: 'p2', lab: '2 Min' }, { k: 'd2', lab: '2 Drawn' }, { k: 'yc', lab: 'YC' }, { k: 'rc', lab: 'RC' },
  { k: 'pts', lab: 'Pts' }];
function renderSeasonPlayers(games) {
  const { P } = seasonAgg(games);
  const rows = P.map(p => Object.assign({}, p, {
    pct: p.shots ? p.goals / p.shots : null,
    gpg: p.gp ? p.goals / p.gp : 0, pts: p.goals + p.ast }));
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
      else if (v == null) v = '';
      tr.appendChild(el('td', { text: String(v), cls: c.l ? 'l' : '' }));
    }
    t.appendChild(tr);
  }
  if (!rows.length) t.appendChild(el('tr', null, el('td', { text: 'No player data yet', cls: 'l' })));
  host.appendChild(t);
}
const SK_COLS = [
  { k: 'num', lab: '#' }, { k: 'name', lab: 'Keeper', l: 1 }, { k: 'gp', lab: 'GP' },
  { k: 'faced', lab: 'Shots Faced' }, { k: 'sv', lab: 'Saves' }, { k: 'pct', lab: 'Save %' },
  { k: 'ga', lab: 'GA' }, { k: 'f7', lab: '7m Faced' }, { k: 'sv7', lab: '7m Saved' }, { k: 'savew', lab: 'After Whistle' }];
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
  const games = allSeasonGames();
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
  ];
  const wsS = XLSX.utils.aoa_to_sheet(sum); wsS['!cols'] = [{ wch: 26 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsS, 'Season Summary');
  const { P, K } = seasonAgg(games);
  const pAoa = [['No', 'Player', 'GP', 'Goals', 'Shots', 'Shot %', 'Goals per Game', 'Assists', 'Steals', 'Blocks', 'Turnovers',
    "7's Drawn", "7's Made", "7's Missed", '2 Min', "2's Drawn", 'Yellow', 'Red', 'Points']];
  for (const p of P.slice().sort((a, b) => b.goals - a.goals))
    pAoa.push([p.num ?? '', p.name, p.gp, p.goals, p.shots, p.shots ? +(100 * p.goals / p.shots).toFixed(1) : '',
      p.gp ? +(p.goals / p.gp).toFixed(2) : '', p.ast, p.stl, p.blk, p.to, p.d7, p.g7, p.x7, p.p2, p.d2, p.yc, p.rc, p.goals + p.ast]);
  const wsP = XLSX.utils.aoa_to_sheet(pAoa);
  wsP['!cols'] = [{ wch: 5 }, { wch: 18 }].concat(pAoa[0].slice(2).map(() => ({ wch: 10 })));
  XLSX.utils.book_append_sheet(wb, wsP, 'Player Totals');
  const kAoa = [['No', 'Keeper', 'GP', 'Shots Faced', 'Saves', 'Save %', 'Goals Allowed', "7's Faced", "7's Saved", 'Saves After Whistle']];
  for (const k of K.filter(x => nameKey(x.name) !== nameKey(GK_NONE)).sort((a, b) => b.sv - a.sv))
    kAoa.push([k.num ?? '', k.name, k.gp, k.faced, k.sv, (k.sv + k.ga) ? +(100 * k.sv / (k.sv + k.ga)).toFixed(1) : '', k.ga, k.f7, k.sv7, k.savew]);
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
  $('#sb-us-logo').src = LOGOS.airforce;
  $('#g-date').value = new Date().toISOString().slice(0, 10);
  renderRoster(); renderSetupHint(); applyAdminUI();
  if (game && !game.done) {
    enterLiveMode();   // a running clock keeps counting via its timestamp anchor
    if (adminOn) showTab('game');   // mid-game reload lands staff back on the floor
    else renderHome();              // a locked device resumes through the gate
    if (adminOn) toast('Resumed the game vs ' + game.info.opponent);
  } else {
    renderHome();
  }
  loadRepoRoster();     // all three are best-effort async — offline copies skip them
  loadRepoGames();
  loadRepoTeam();
})();
