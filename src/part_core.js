'use strict';
/* ================================================================
   USAFA Team Handball Stat Tracker — core engine
   All stats derive from the event log (single source of truth), so
   undo / delete are always exactly right. Events are keyed by a
   STABLE player id (pid) — never by jersey number — so renumbering
   a jersey or benching a player mid-game can never orphan or
   double-count logged stats. User-entered strings are only ever
   inserted with textContent — never innerHTML.
   ================================================================ */

/* ---------- tiny DOM helpers ---------- */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'text') n.textContent = attrs[k];
    else if (k === 'cls') n.className = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  for (const kid of kids) if (kid != null) n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  return n;
}
function svgel(tag, attrs, ...kids) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const k in attrs) {
    if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
  }
  for (const kid of kids) if (kid != null) n.appendChild(kid);
  return n;
}
let toastT = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1800);
}

/* ---------- storage (failures are loud, not silent) ---------- */
const LS = { roster: 'afahb.roster.v1', cur: 'afahb.current.v1', games: 'afahb.games.v1' };
let _storageWarned = false;
function storageFail() {
  if (_storageWarned) return; _storageWarned = true;
  const b = el('div', { cls: 'cui', style: 'background:#5a1212;color:#ffb3b3',
    text: '⚠ BROWSER STORAGE UNAVAILABLE — games are NOT being saved in this browser. Export the Excel file after the game and keep it.' });
  document.body.insertBefore(b, document.body.firstChild);
  toast('Warning: browser storage is unavailable');
}
function lsGet(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
function lsSet(k, v) {
  try {
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch (e) { storageFail(); return false; }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const GK_NONE = '(no keeper credited)';   // ONE sentinel everywhere: live table, export, import, season filter

/* ---------- state ---------- */
let roster = lsGet(LS.roster, []);          // [{id,num,name,pos,year,active}]
let game   = lsGet(LS.cur, null);           // live game or null
let archived = lsGet(LS.games, []);         // finished games (full record)
let seasonImports = [];                     // games parsed from imported files (this session)

// migrate any pre-timestamp clock shape {sec,running} -> {base,at}
function migrateClock(g) {
  if (g && g.clock && g.clock.sec !== undefined) {
    g.clock = { base: g.clock.sec, at: g.clock.running ? Date.now() : null };
  }
  return g;
}
game = migrateClock(game);

const HALVES = ['H1', 'H2', 'OT1', 'OT2', 'SO'];
const HALF_LABEL = { H1: '1st half', H2: '2nd half', OT1: 'OT 1', OT2: 'OT 2', SO: 'Shoot-out' };

/* ---------- event catalog ----------
   team: which side the event belongs to. gk: attributed to the AFA keeper in
   goal (by pid). Player events carry .pid; an opponent shooter from the goal
   map carries .onum (their jersey, free text). Map events also carry
   .x/.y (percent of the goal image) and .res ('goal'|'saved'|'missed') so the
   scout's outcome choice is never lost even when two outcomes share a type. */
const EV = {
  goal:   { team: 'AFA', lab: 'GOAL',            pl: 1 },
  saved:  { team: 'AFA', lab: 'shot saved',      pl: 1 },
  miss:   { team: 'AFA', lab: 'shot missed',     pl: 1 },
  blocked:{ team: 'AFA', lab: 'shot blocked',    pl: 1 },
  g7:     { team: 'AFA', lab: '7m GOAL',         pl: 1 },
  x7:     { team: 'AFA', lab: '7m missed',       pl: 1 },
  d7:     { team: 'AFA', lab: '7m drawn',        pl: 1 },
  ast:    { team: 'AFA', lab: 'assist',          pl: 1 },
  to:     { team: 'AFA', lab: 'turnover',        pl: 1 },
  stl:    { team: 'AFA', lab: 'steal',           pl: 1 },
  blk:    { team: 'AFA', lab: 'block',           pl: 1 },
  p2:     { team: 'AFA', lab: '2-minute',        pl: 1 },
  d2:     { team: 'AFA', lab: 'drew a 2-minute', pl: 1 },
  yc:     { team: 'AFA', lab: 'yellow card',     pl: 1 },
  rc:     { team: 'AFA', lab: 'RED CARD',        pl: 1 },
  timeout:{ team: 'AFA', lab: 'team timeout' },
  note:   { team: 'AFA', lab: 'note' },
  ogoal:  { team: 'OPP', lab: 'GOAL',            gk: 1 },
  og7:    { team: 'OPP', lab: '7m GOAL',         gk: 1 },
  osave:  { team: 'OPP', lab: 'shot saved — Air Force save', gk: 1 },
  os7:    { team: 'OPP', lab: '7m saved — Air Force save',   gk: 1 },
  osavew: { team: 'OPP', lab: 'save after the whistle',      gk: 1 },
  omiss:  { team: 'OPP', lab: 'shot missed',     gk: 1 },
  o7miss: { team: 'OPP', lab: '7m missed',       gk: 1 },
  oto:    { team: 'OPP', lab: 'turnover' },
  op2:    { team: 'OPP', lab: '2-minute' },
  oyc:    { team: 'OPP', lab: 'yellow card' },
  orc:    { team: 'OPP', lab: 'RED CARD' },
  otimeout:{ team: 'OPP', lab: 'team timeout' },
};
const PLAYER_BTNS = [
  ['goal', 'GOAL'], ['saved', 'SV'], ['miss', 'MS'], ['blocked', 'BL'],
  ['g7', '7G'], ['x7', '7X'], ['d7', '7D'],
  ['ast', 'A'], ['to', 'TO'], ['stl', 'ST'], ['blk', 'BK'],
  ['p2', "2'"], ['d2', '2D'], ['yc', 'YC'], ['rc', 'RC'],
];

/* ---------- derivation: events -> stats ---------- */
function blankP() { return { fgG:0, fgSv:0, fgMs:0, fgBl:0, g7:0, x7:0, d7:0,
  ast:0, to:0, stl:0, blk:0, p2:0, d2:0, yc:0, rc:0 }; }
function blankK() { return { ga:0, sv:0, ms:0, ga7:0, sv7:0, ms7:0, savew:0 }; }

function derive(g) {
  const P = new Map(), K = new Map();       // by player pid ('-' = uncredited keeper)
  const team = { toUs: 0, toThem: 0, us2: 0, them2: 0, usYC: 0, themYC: 0,
    usRC: 0, themRC: 0, oppTo: 0 };
  let us = 0, them = 0;
  const halfScore = {};                     // half -> goals scored IN that half
  for (const h of HALVES) halfScore[h] = { us: 0, them: 0 };
  for (const e of g.events) {
    const d = EV[e.type]; if (!d) continue;
    if (d.pl && e.pid != null) {
      if (!P.has(e.pid)) P.set(e.pid, blankP());
      const p = P.get(e.pid);
      if (e.type === 'goal') p.fgG++; else if (e.type === 'saved') p.fgSv++;
      else if (e.type === 'miss') p.fgMs++; else if (e.type === 'blocked') p.fgBl++;
      else if (e.type in p) p[e.type]++;
    }
    if (d.gk) {
      const kn = e.gk != null ? e.gk : '-';
      if (!K.has(kn)) K.set(kn, blankK());
      const k = K.get(kn);
      if (e.type === 'ogoal') k.ga++; else if (e.type === 'og7') { k.ga++; k.ga7++; }
      else if (e.type === 'osave') k.sv++; else if (e.type === 'os7') { k.sv++; k.sv7++; }
      else if (e.type === 'omiss') k.ms++; else if (e.type === 'o7miss') k.ms7++;
      else if (e.type === 'osavew') k.savew++;
    }
    if (e.type === 'goal' || e.type === 'g7') { us++;  halfScore[e.half] && halfScore[e.half].us++; }
    if (e.type === 'ogoal' || e.type === 'og7') { them++; halfScore[e.half] && halfScore[e.half].them++; }
    if (e.type === 'timeout')  team.toUs++;
    if (e.type === 'otimeout') team.toThem++;
    if (e.type === 'p2')  team.us2++;   if (e.type === 'op2') team.them2++;
    if (e.type === 'yc')  team.usYC++;  if (e.type === 'oyc') team.themYC++;
    if (e.type === 'rc')  team.usRC++;  if (e.type === 'orc') team.themRC++;
    if (e.type === 'oto') team.oppTo++;
  }
  return { P, K, us, them, halfScore, team };
}
/* row shapers shared by live box, export and import */
function pRow(num, name, pos, p) {
  const goals = p.fgG + p.g7;
  const shots = p.fgG + p.fgSv + p.fgMs + p.fgBl + p.g7 + p.x7;
  return { num, name, pos: pos || '', goals, shots,
    pct: shots ? goals / shots : null,
    ast: p.ast, stl: p.stl, blk: p.blk, to: p.to,
    d7: p.d7, g7: p.g7, x7: p.x7, p2: p.p2, d2: p.d2, yc: p.yc, rc: p.rc,
    pts: goals + p.ast };
}
function kRow(num, name, k) {
  const faced = k.ga + k.sv + k.ms + k.ms7;
  return { num, name, faced, sv: k.sv, ga: k.ga,
    pct: (k.sv + k.ga) ? k.sv / (k.sv + k.ga) : null,
    f7: k.ga7 + k.sv7 + k.ms7, sv7: k.sv7, savew: k.savew };
}
const fmtPct = v => v == null ? '—' : (100 * v).toFixed(1) + '%';
/* how a map/shot event reads as an outcome — prefer the scout's explicit
   choice (e.res); the type only implies it when res is absent */
function shotOutcome(e) {
  if (e.res) return e.res;
  return ['goal', 'g7', 'ogoal', 'og7'].includes(e.type) ? 'goal'
    : ['saved', 'osave', 'os7'].includes(e.type) ? 'saved' : 'missed';
}

/* ---------- roster ---------- */
function dressed() { return roster.filter(p => p.active !== false); }
function saveRoster() { lsSet(LS.roster, roster); }
function snapOf(p) { return { pid: p.id, num: p.num, name: p.name, pos: p.pos, year: p.year || '' }; }
function snapByPid(pid) { return game ? game.rosterSnap.find(x => x.pid === pid) : null; }
function cleanNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function renderRoster() {
  const t = $('#roster-table'); t.textContent = '';
  const thr = el('tr');
  for (const h of ['#', 'Name', 'Position', 'Class', 'Dressed', '']) thr.appendChild(el('th', { text: h, cls: h === 'Name' ? 'l' : '' }));
  t.appendChild(thr);
  const sorted = roster.slice().sort((a, b) => (a.num ?? 999) - (b.num ?? 999));
  for (const p of sorted) {
    const tr = el('tr');
    const numIn = el('input', { cls: 'num-in', type: 'number', value: p.num ?? '' });
    numIn.addEventListener('change', () => { p.num = cleanNum(numIn.value === '' ? null : numIn.value); saveRoster(); renderRoster(); refreshGameUI(); });
    const nameIn = el('input', { value: p.name });
    nameIn.addEventListener('change', () => { p.name = nameIn.value.trim() || p.name; saveRoster(); renderRoster(); refreshGameUI(); });
    const posSel = el('select');
    for (const o of ['GK', 'LW', 'LB', 'CB', 'RB', 'RW', 'P']) posSel.appendChild(el('option', { text: o, value: o }));
    posSel.value = p.pos || 'CB';
    posSel.addEventListener('change', () => { p.pos = posSel.value; saveRoster(); renderRoster(); refreshGameUI(); });
    const yrIn = el('input', { value: p.year || '', style: 'width:70px' });
    yrIn.addEventListener('change', () => { p.year = yrIn.value.trim(); saveRoster(); });
    const chk = el('input', { type: 'checkbox' }); chk.checked = p.active !== false;
    chk.addEventListener('change', () => { p.active = chk.checked; saveRoster(); refreshGameUI(); });
    const del = el('button', { cls: 'evx', text: '✕', title: 'Remove player',
      onclick: () => { roster = roster.filter(x => x !== p); saveRoster(); renderRoster(); refreshGameUI(); } });
    tr.appendChild(el('td', { cls: 'c' }, numIn));
    tr.appendChild(el('td', { cls: 'l' }, nameIn));
    tr.appendChild(el('td', { cls: 'c' }, posSel));
    tr.appendChild(el('td', { cls: 'c' }, yrIn));
    tr.appendChild(el('td', { cls: 'c' }, chk));
    tr.appendChild(el('td', { cls: 'c' }, del));
    t.appendChild(tr);
  }
  if (!roster.length) {
    const tr = el('tr'); tr.appendChild(el('td', { colspan: '6', cls: 'l', text: 'No players yet — add the squad above, load a saved roster file, or start from the sample roster.' }));
    t.appendChild(tr);
  }
}
$('#btn-addplayer').addEventListener('click', () => {
  const num = $('#r-num').value === '' ? null : cleanNum($('#r-num').value);
  const name = $('#r-name').value.trim();
  if (!name) { toast('Enter a name'); return; }
  if (num != null && roster.some(p => p.num === num)) { toast('#' + num + ' is already taken'); return; }
  roster.push({ id: uid(), num, name, pos: $('#r-pos').value, year: $('#r-year').value.trim(), active: true });
  saveRoster(); renderRoster(); refreshGameUI();
  $('#r-num').value = ''; $('#r-name').value = ''; $('#r-year').value = '';
  toast(name + ' added');
});
$('#btn-clear-roster').addEventListener('click', () => {
  if (!confirm('Remove every player from the roster?')) return;
  roster = []; saveRoster(); renderRoster(); refreshGameUI();
});
$('#btn-demo-roster').addEventListener('click', () => {
  const demo = [[7,'Jack','CB'],[11,'RJ','LB'],[23,'Ryan','RW'],[9,'Roman','P'],[4,'Charlie','LW'],
    [18,'Evan','RB'],[21,'Barrett','LB'],[3,'Sean','LW'],[14,'Christian','RW'],[6,'Ben','P'],
    [1,'Corn','GK'],[12,'Crane','GK']];
  roster = demo.map(d => ({ id: uid(), num: d[0], name: d[1], pos: d[2], year: '', active: true }));
  saveRoster(); renderRoster(); refreshGameUI(); toast('Sample roster loaded');
});

/* ---------- admin wall ----------
   A courtesy gate, not a vault: the password lives in this public repo with
   the owner's explicit OK. It keeps visitors in the showcase (home, team,
   season dashboard) and puts everything that CHANGES data — game tracking,
   the stat roster, imports, stored-game management — behind one unlock that
   persists on the staff member's device. */
const ADMIN_PW = 'handball2027';
let adminOn = lsGet('afahb.admin.v1', false) === true;
let _adminAfter = null;
function applyAdminUI() {
  document.body.classList.toggle('admin', adminOn);
  $('#menu button[data-tab="game"]').textContent = adminOn ? 'GAME' : 'GAME 🔒';
  $('#menu-admin').textContent = adminOn ? 'ADMIN — SIGN OUT' : 'ADMIN SIGN IN';
}
function openAdminModal(after) {
  _adminAfter = after || null;
  $('#admin-err').textContent = ''; $('#admin-pw').value = '';
  $('#admin-modal').classList.add('open');
  $('#admin-pw').focus();
}
$('#admin-cancel').addEventListener('click', () => $('#admin-modal').classList.remove('open'));
$('#admin-go').addEventListener('click', () => {
  if ($('#admin-pw').value === ADMIN_PW) {
    adminOn = true; lsSet('afahb.admin.v1', true); applyAdminUI();
    $('#admin-modal').classList.remove('open');
    toast('Admin unlocked on this device');
    const f = _adminAfter; _adminAfter = null; if (f) f();
  } else $('#admin-err').textContent = 'Wrong password.';
});
$('#admin-pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#admin-go').click(); });
$('#menu-admin').addEventListener('click', () => {
  $('#menu').classList.remove('open');
  if (adminOn) { adminOn = false; lsSet('afahb.admin.v1', false); applyAdminUI(); showTab('home'); toast('Admin locked'); }
  else openAdminModal();
});

/* ---------- navigation: ☰ menu + welcome page ---------- */
function showTab(name) {
  if (name === 'game' && !adminOn) {
    $('#menu').classList.remove('open');
    openAdminModal(() => showTab('game'));
    return;
  }
  $$('#menu button').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
  $$('section.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + name));
  $('#menu').classList.remove('open');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
  if (name === 'season') renderSeason();
  if (name === 'roster') { renderTeamCards(); renderRoster(); }
  if (name === 'home') renderHome();
  window.scrollTo(0, 0);
}
$('#menu-btn').addEventListener('click', ev => {
  ev.stopPropagation();
  const open = $('#menu').classList.toggle('open');
  $('#menu-btn').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', ev => {
  if (!ev.target.closest('.menu-wrap')) { $('#menu').classList.remove('open'); $('#menu-btn').setAttribute('aria-expanded', 'false'); }
});
$$('#menu button[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$$('[data-goto]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.goto)));
function renderHome() {
  const r = $('#home-resume');
  if (game && !game.done) {
    const d = derive(game);
    r.style.display = 'block';
    r.textContent = '▶ RESUME LIVE GAME — Air Force ' + d.us + '–' + d.them + ' vs ' + game.info.opponent;
  } else if (archived.length) {
    r.style.display = 'block';
    r.textContent = '📊 ' + archived.length + ' game(s) saved in this browser — open the season dashboard';
  } else r.style.display = 'none';
}
$('#home-resume').addEventListener('click', () => showTab(game && !game.done ? 'game' : 'season'));

/* collapsible game setup + roster manager */
$('#setup-toggle').addEventListener('click', () => {
  const c = $('#setup-card').classList.toggle('collapsed');
  $('#setup-arrow').textContent = c ? '▸' : '▾';
});
$('#mroster-toggle').addEventListener('click', () => {
  const c = $('#manage-roster-card').classList.toggle('collapsed');
  $('#mroster-arrow').textContent = c ? '▸' : '▾';
});

/* ---------- the team page: baseball cards ----------
   Standard player format (owner, 11 Aug 2026): Position / Title (rank + name) /
   Hometown / Major / Intended Career Field. Coaches section leads.
   The cards are DATA, built in the admin Team card manager: photos upload in
   the browser (auto-cropped to card size), edits save on that device, and
   publishing = downloading team.json and committing it to the repo's data/
   folder, where the site loads it for every visitor. Display precedence:
   this device's working copy → the published data/team.json → the built-in
   starter pair. A card's photo is a data URI once uploaded; the starter
   cards may instead name a key in the build-time PHOTOS bundle. */
const DEFAULT_TEAM = { v: 1, cards: [
  { id: 'c-cav', sec: 'coach', name: 'Mike Cavanaugh', role: 'Head Coach', badge: false,
    photo: 'cavanaugh', pos: '', home: '', major: '', career: '' },
  { id: 'p-tie', sec: 'player', name: 'C1C Jack P. Tierney', role: 'Team Captain', badge: true,
    photo: 'tierney', pos: 'Center Back', home: 'Iowa City, Iowa', major: 'Systems Engineering', career: 'Pilot' },
] };
let teamLocal = sanitizeTeam(lsGet('afahb.team.v1', null));   // this device's working copy
let repoTeam = null;                                          // published data/team.json
function sanitizeTeam(t) {
  if (!t || !Array.isArray(t.cards)) return null;
  const cards = t.cards.filter(c => c && String(c.name || '').trim()).map(c => ({
    id: String(c.id || uid()), sec: c.sec === 'coach' ? 'coach' : 'player',
    name: String(c.name), role: String(c.role || ''), badge: !!c.badge,
    photo: String(c.photo || ''), pos: String(c.pos || ''), home: String(c.home || ''),
    major: String(c.major || ''), career: String(c.career || '') }));
  return cards.length ? { v: 1, cards } : null;
}
function activeTeam() { return teamLocal || repoTeam || DEFAULT_TEAM; }
function cardPhotoSrc(c) {
  if (c.photo && c.photo.startsWith('data:')) return c.photo;
  if (c.photo && typeof PHOTOS !== 'undefined' && PHOTOS && PHOTOS[c.photo]) return PHOTOS[c.photo];
  return null;
}
function bbCard(c) {
  const ph = el('div', { cls: 'ph' });
  const src = cardPhotoSrc(c);
  if (src) ph.appendChild(el('img', { src, alt: c.name }));
  else ph.appendChild(el('div', { cls: 'noimg' },
    el('img', { src: LOGOS.airforce, alt: '' }),
    el('span', { text: 'PHOTO COMING SOON' })));
  if (c.badge) ph.appendChild(el('div', { cls: 'badge', text: 'TEAM CAPTAIN' }));
  const frame = el('div', { cls: 'frame' }, ph,
    el('div', { cls: 'nm', text: c.name }),
    el('div', { cls: 'role', text: c.role || '' }));
  const entries = [['Position', c.pos], ['Hometown', c.home], ['Major', c.major], ['Intended Career Field', c.career]]
    .filter(e => String(e[1] || '').trim());
  if (entries.length) {
    const fields = el('div', { cls: 'fields' });
    for (const [k, v] of entries)
      fields.appendChild(el('div', { cls: 'fr' }, el('span', { cls: 'fl', text: k }), el('span', { cls: 'fv', text: v })));
    frame.appendChild(fields);
  }
  return el('div', { cls: 'bbcard' }, frame);
}
function renderTeamCards() {
  const host = $('#team-cards'); host.textContent = '';
  const cards = activeTeam().cards;
  const sec = (title, list) => {
    if (!list.length) return;
    const s = el('div', { cls: 'team-sec' }, el('h2', { text: title }));
    const g = el('div', { cls: 'bbgrid' + (list.length < 3 ? ' solo' : '') });
    for (const c of list) g.appendChild(bbCard(c));
    s.appendChild(g); host.appendChild(s);
  };
  sec('Coaches', cards.filter(c => c.sec === 'coach'));
  sec('Players', cards.filter(c => c.sec !== 'coach'));
  renderTmList();
}

/* ---------- team card manager (admin) ---------- */
let tmEditing = null;     // card id being edited, or null
let tmPhoto = '';         // pending photo data URI for the editor
function ensureTeamLocal() {
  if (!teamLocal) teamLocal = JSON.parse(JSON.stringify(activeTeam()));
  return teamLocal;
}
function saveTeamLocal() { lsSet('afahb.team.v1', teamLocal); renderTeamCards(); }
function renderTmList() {
  const host = $('#tm-list'); if (!host) return;
  host.textContent = '';
  const cards = activeTeam().cards;
  cards.forEach((c, i) => {
    const row = el('div', { cls: 'tmrow' },
      el('span', { cls: 'sec', text: c.sec.toUpperCase() }),
      el('b', { text: c.name + (c.badge ? ' ★' : '') }),
      el('span', { cls: 'small muted', text: cardPhotoSrc(c) ? 'photo ✓' : 'no photo' }),
      el('button', { text: '✎ EDIT', onclick: () => tmOpenEditor(c.id) }),
      el('button', { text: '↑', title: 'Move up', onclick: () => tmMove(i, -1) }),
      el('button', { text: '↓', title: 'Move down', onclick: () => tmMove(i, 1) }),
      el('button', { text: '✕', title: 'Remove card', onclick: () => {
        if (!confirm('Remove the card for ' + c.name + '?')) return;
        ensureTeamLocal();
        teamLocal.cards = teamLocal.cards.filter(x => x.id !== c.id);
        saveTeamLocal();
      } }));
    host.appendChild(row);
  });
  if (!cards.length) host.appendChild(el('div', { cls: 'small muted', text: 'No cards yet — add a coach or a player below.' }));
}
function tmMove(i, dir) {
  ensureTeamLocal();
  const a = teamLocal.cards, j = i + dir;
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  saveTeamLocal();
}
function tmOpenEditor(id) {
  ensureTeamLocal();
  const c = id ? teamLocal.cards.find(x => x.id === id) : null;
  tmEditing = c ? c.id : null;
  tmPhoto = c ? (cardPhotoSrc(c) || '') : '';
  $('#tm-sec').value = c ? c.sec : 'player';
  $('#tm-name').value = c ? c.name : '';
  $('#tm-role').value = c ? c.role : '';
  $('#tm-badge').checked = c ? c.badge : false;
  $('#tm-pos').value = c ? c.pos : '';
  $('#tm-home').value = c ? c.home : '';
  $('#tm-major').value = c ? c.major : '';
  $('#tm-career').value = c ? c.career : '';
  const prev = $('#tm-photo-prev');
  if (tmPhoto) prev.src = tmPhoto; else prev.removeAttribute('src');
  $('#tm-photo').value = '';
  $('#tm-editor').style.display = 'block';
  $('#tm-name').focus();
}
$('#tm-add-coach').addEventListener('click', () => { tmOpenEditor(null); $('#tm-sec').value = 'coach'; });
$('#tm-add-player').addEventListener('click', () => { tmOpenEditor(null); $('#tm-sec').value = 'player'; });
$('#tm-cancel').addEventListener('click', () => { $('#tm-editor').style.display = 'none'; tmEditing = null; });
$('#tm-save').addEventListener('click', () => {
  const name = $('#tm-name').value.trim();
  if (!name) { toast('Enter the title / name'); return; }
  ensureTeamLocal();
  const card = {
    id: tmEditing || uid(), sec: $('#tm-sec').value === 'coach' ? 'coach' : 'player',
    name, role: $('#tm-role').value.trim(), badge: $('#tm-badge').checked,
    photo: tmPhoto || '', pos: $('#tm-pos').value.trim(), home: $('#tm-home').value.trim(),
    major: $('#tm-major').value.trim(), career: $('#tm-career').value.trim(),
  };
  const ix = teamLocal.cards.findIndex(x => x.id === card.id);
  if (ix >= 0) teamLocal.cards[ix] = card; else teamLocal.cards.push(card);
  saveTeamLocal();
  $('#tm-editor').style.display = 'none'; tmEditing = null;
  toast(card.name + ' saved — publish with DOWNLOAD team.json when ready');
});
/* photo upload: cover-crop to the card's 3:4 in the browser, ~50 KB JPEG */
$('#tm-photo').addEventListener('change', async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej;
      i.src = URL.createObjectURL(f);
    });
    const W = 480, H = 640, s = Math.max(W / img.width, H / img.height);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d').drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
    tmPhoto = cv.toDataURL('image/jpeg', 0.82);
    $('#tm-photo-prev').src = tmPhoto;
  } catch (e) { toast('Could not read that image'); }
});
$('#tm-photo-clear').addEventListener('click', () => { tmPhoto = ''; $('#tm-photo-prev').removeAttribute('src'); });
$('#tm-download').addEventListener('click', () => {
  const data = JSON.stringify(activeTeam(), null, 1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = 'team.json';
  a.click();
  toast('team.json downloaded — upload it to the repo\'s data/ folder to publish');
});
$('#tm-load-published').addEventListener('click', async () => {
  if (!(location.protocol === 'http:' || location.protocol === 'https:')) { toast('Open the team website to load the published cards'); return; }
  try {
    const r = await fetch('data/team.json', { cache: 'no-cache' });
    if (!r.ok) { toast('No published team.json yet'); return; }
    const t = sanitizeTeam(await r.json());
    if (!t) { toast('Published team.json is empty'); return; }
    teamLocal = t; saveTeamLocal();
    toast('Published cards loaded for editing');
  } catch (e) { toast('Could not load the published cards'); }
});
$('#tm-reset').addEventListener('click', () => {
  if (!confirm('Discard the edits on this device and show the published cards?')) return;
  teamLocal = null; lsSet('afahb.team.v1', null);
  renderTeamCards();
});

/* ---------- game lifecycle ---------- */
function newGameFromForm() {
  return {
    id: uid(), fmt: 'AFA-HB-1', done: false,
    info: {
      opponent: $('#g-opp').value.trim() || 'Opponent',
      date: $('#g-date').value || new Date().toISOString().slice(0, 10),
      location: $('#g-loc').value.trim(),
      ha: $('#g-ha').value, comp: $('#g-comp').value,
      notes: $('#g-notes').value.trim(),
      halfLen: Math.max(5, +$('#g-halflen').value || 30),
    },
    half: 'H1', clock: { base: 0, at: null }, gk: null,
    events: [], seq: 0,
    rosterSnap: dressed().map(snapOf),
  };
}
$('#btn-start').addEventListener('click', () => {
  if (!dressed().length) { toast('Add your roster first (ROSTER tab)'); $('#setup-hint').textContent = 'Add players on the ROSTER tab, then start the game.'; return; }
  // numbers are how a scout identifies players live; require unique ones at tip-off
  const noNum = dressed().filter(p => p.num == null);
  if (noNum.length) {
    $('#setup-hint').textContent = 'These dressed players need a jersey number before live tracking: ' +
      noNum.map(p => p.name).join(', ') + ' — add numbers on the ROSTER tab (or untick Dressed).';
    toast('Every dressed player needs a jersey number'); return;
  }
  const seen = new Map();
  for (const p of dressed()) {
    if (seen.has(p.num)) {
      $('#setup-hint').textContent = 'Jersey #' + p.num + ' is worn by both ' + seen.get(p.num) + ' and ' + p.name + ' — fix it on the ROSTER tab.';
      toast('Duplicate jersey number #' + p.num); return;
    }
    seen.set(p.num, p.name);
  }
  game = newGameFromForm();
  const gk = dressed().find(p => p.pos === 'GK');
  if (gk) game.gk = gk.id;
  saveGame(); enterLiveMode();
  toast('Game started — good luck, Falcons!');
});
function saveGame() { if (game) lsSet(LS.cur, game); }

function enterLiveMode() {
  $('#setup-card').style.display = 'none';
  $('#scoreboard').style.display = 'flex';
  $('#live-area').style.display = 'block';
  $('#opp-panel-title').textContent = game.info.opponent + ' — opponent events (credit the keeper in goal)';
  buildHalfButtons(); buildPlayerGrid(); buildGkSel(); renderGoalMap();
  startClockTicker();
  refreshLive();
}
function exitLiveMode() {
  $('#setup-card').style.display = 'block';
  $('#setup-card').classList.remove('collapsed');   // the next thing to do is set up a game
  $('#setup-arrow').textContent = '▾';
  $('#scoreboard').style.display = 'none';
  $('#live-area').style.display = 'none';
  stopClockTimer();
  renderSetupHint();
}
function renderSetupHint() {
  const h = $('#setup-hint'); h.textContent = '';
  if (archived.length) {
    const last = archived[archived.length - 1];
    h.appendChild(document.createTextNode(archived.length + ' game(s) archived in this browser. Last: vs ' + last.info.opponent + ' (' + last.info.date + '). '));
    const b = el('button', { cls: 'btn', text: 'REOPEN LAST GAME', style: 'padding:4px 10px;font-size:11.5px',
      onclick: () => { game = archived.pop(); game.done = false; lsSet(LS.games, archived); saveGame(); enterLiveMode(); toast('Game reopened'); } });
    h.appendChild(b);
  }
}

/* ---------- events ---------- */
function addEvent(type, extra) {
  if (!game || game.done) return;
  const d = EV[type]; if (!d) return;
  const e = Object.assign({ id: uid(), seq: ++game.seq, type, half: game.half,
    clock: fmtClock(clockSec()), ts: new Date().toISOString() }, extra || {});
  if (d.gk && e.gk === undefined) e.gk = game.gk;
  game.events.push(e);
  saveGame(); refreshLive();
  const who = d.pl && e.pid != null ? playerLabel(e.pid) + ' — ' : (d.team === 'OPP' ? game.info.opponent + ' — ' : '');
  toast(who + d.lab);
  return e;
}
function playerLabel(pid) {
  const p = snapByPid(pid);
  return p ? ('#' + (p.num ?? '—') + ' ' + p.name) : '#?';
}
$('#btn-undo').addEventListener('click', () => {
  if (!game || !game.events.length) { toast('Nothing to undo'); return; }
  const e = game.events.pop(); saveGame(); refreshLive();
  toast('Removed: ' + (EV[e.type] ? EV[e.type].lab : e.type));
});
function deleteEvent(id) {
  game.events = game.events.filter(e => e.id !== id);
  saveGame(); refreshLive();
}
$('#btn-us-timeout').addEventListener('click', () => addEvent('timeout'));
$('#btn-note').addEventListener('click', () => {
  const v = $('#note-in').value.trim(); if (!v) return;
  addEvent('note', { note: v }); $('#note-in').value = '';
});
$$('.opp-panel .btns button').forEach(b => b.addEventListener('click', () => addEvent(b.dataset.oev)));

/* ---------- player grid ---------- */
function buildPlayerGrid() {
  const grid = $('#pgrid'); grid.textContent = '';
  const list = game.rosterSnap.slice().sort((a, b) => (a.num ?? 999) - (b.num ?? 999));
  for (const p of list) {
    const card = el('div', { cls: 'pcard' + (p.pos === 'GK' ? ' gkon' : ''), 'data-pid': p.pid, 'data-num': p.num ?? '' });
    const hd = el('div', { cls: 'hd' },
      el('span', { cls: 'no', text: p.num != null ? '#' + p.num : '—' }),
      el('span', { cls: 'nm', text: p.name }),
      el('span', { cls: 'pos', text: p.pos || '' }));
    const sl = el('div', { cls: 'statline', text: '' });
    const btns = el('div', { cls: 'btns' });
    for (const [type, lab] of PLAYER_BTNS) {
      const b = el('button', { text: lab, 'data-ev': type, title: EV[type].lab });
      if (type === 'goal') b.className = 'goal';
      if (type === 'p2' || type === 'yc') b.classList.add('warnb');
      if (type === 'rc') b.classList.add('redb');
      b.addEventListener('click', () => addEvent(type, { pid: p.pid }));
      btns.appendChild(b);
    }
    card.appendChild(hd); card.appendChild(sl); card.appendChild(btns);
    grid.appendChild(card);
  }
  $('#pgrid-hint').textContent = list.length ? '' : 'No dressed players — tick "Dressed" on the ROSTER tab.';
}
function buildGkSel() {
  const sel = $('#gk-sel'); sel.textContent = '';
  sel.appendChild(el('option', { value: '', text: '— no keeper credited —' }));
  const gks = game.rosterSnap.filter(p => p.pos === 'GK');
  const rest = game.rosterSnap.filter(p => p.pos !== 'GK');
  for (const p of gks.concat(rest)) sel.appendChild(el('option', { value: p.pid, text: '#' + (p.num ?? '—') + ' ' + p.name + (p.pos === 'GK' ? '' : ' (' + (p.pos || 'field') + ')') }));
  // if the credited keeper left the snapshot entirely, fall back to uncredited
  if (game.gk != null && !snapByPid(game.gk)) { game.gk = null; saveGame(); }
  sel.value = game.gk != null ? game.gk : '';
  sel.onchange = () => { game.gk = sel.value === '' ? null : sel.value; saveGame(); };
}

/* ---------- scoreboard / halves / clock ---------- */
function buildHalfButtons() {
  const w = $('#sb-halves'); w.textContent = '';
  for (const h of HALVES) {
    const b = el('button', { text: h, onclick: () => {
      if (game.half === h) return;
      if (clockSec() > 0 && !confirm('Switch to ' + HALF_LABEL[h] + '? The clock resets to 00:00.')) return;
      game.half = h; game.clock.base = 0; game.clock.at = null;
      addEvent('note', { note: 'Start of ' + HALF_LABEL[h] });
      refreshLive();
    } });
    w.appendChild(b);
  }
}
const fmtClock = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
/* The clock DERIVES from a timestamp anchor — a backgrounded tab or locked
   phone cannot freeze it, and the ticker below only paints, never mutates. */
function clockSec() {
  if (!game) return 0;
  const c = game.clock;
  return Math.max(0, Math.floor(c.at != null ? c.base + (Date.now() - c.at) / 1000 : c.base));
}
let clockTimer = null;
function stopClockTimer() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }
function startClockTicker() {
  stopClockTimer();
  clockTimer = setInterval(() => {
    const w = $('#sb-clock');
    if (game && !w.querySelector('input')) w.textContent = fmtClock(clockSec());
  }, 500);
}
function setClockRunning(run) {
  if (!game) return;
  const c = game.clock;
  if (run && c.at == null) c.at = Date.now();
  if (!run && c.at != null) { c.base = clockSec(); c.at = null; }
  $('#btn-clock').textContent = c.at != null ? '❚❚ PAUSE CLOCK' : '▶ START CLOCK';
  saveGame();
}
$('#btn-clock').addEventListener('click', () => setClockRunning(game.clock.at == null));
$('#sb-clock').addEventListener('click', () => {
  const wrap = $('#sb-clock');
  if (wrap.querySelector('input')) return;         // already editing
  const cur = fmtClock(clockSec());
  const inp = el('input', { value: cur, style: 'width:74px;font-size:18px;text-align:center' });
  wrap.textContent = ''; wrap.appendChild(inp); inp.focus(); inp.select();
  const commit = () => {
    const m = inp.value.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      game.clock.base = (+m[1]) * 60 + (+m[2]);
      if (game.clock.at != null) game.clock.at = Date.now();   // keep running from the new value
    }
    saveGame(); refreshLive();
  };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') inp.blur(); });
  inp.addEventListener('blur', commit);
});

/* ---------- goal map ---------- */
/* Goal drawn front-on: 3m x 2m goal inside a margin for misses.
   Stored x/y are percentages of the FULL svg box (0-100), so misses
   outside the frame round-trip through Excel too. */
const GM = { W: 360, H: 250, gx: 45, gy: 38, gw: 270, gh: 180 };  // frame rect
let gmPending = null;                                             // {x,y} awaiting popover
function renderGoalMap() {
  const svg = $('#goalmap'); svg.textContent = '';
  const { gx, gy, gw, gh } = GM;
  svg.appendChild(svgel('rect', { x: 0, y: 0, width: GM.W, height: GM.H, fill: '#f2f4f8' }));
  // net
  for (let i = 1; i < 9; i++) svg.appendChild(svgel('line', { x1: gx + gw * i / 9, y1: gy, x2: gx + gw * i / 9, y2: gy + gh, stroke: '#dfe2e8', 'stroke-width': 1 }));
  for (let i = 1; i < 6; i++) svg.appendChild(svgel('line', { x1: gx, y1: gy + gh * i / 6, x2: gx + gw, y2: gy + gh * i / 6, stroke: '#dfe2e8', 'stroke-width': 1 }));
  // 9-zone hint
  for (let i = 1; i < 3; i++) {
    svg.appendChild(svgel('line', { x1: gx + gw * i / 3, y1: gy, x2: gx + gw * i / 3, y2: gy + gh, stroke: '#c8cdd6', 'stroke-width': 1 }));
    svg.appendChild(svgel('line', { x1: gx, y1: gy + gh * i / 3, x2: gx + gw, y2: gy + gh * i / 3, stroke: '#c8cdd6', 'stroke-width': 1 }));
  }
  // striped posts + crossbar (classic red/white)
  const seg = 30;
  const stripes = (x, y, w, h, horiz) => {
    const n = Math.ceil((horiz ? w : h) / seg);
    for (let i = 0; i < n; i++) {
      const attrs = horiz
        ? { x: x + i * seg, y, width: Math.min(seg, w - i * seg), height: h }
        : { x, y: y + i * seg, width: w, height: Math.min(seg, h - i * seg) };
      attrs.fill = i % 2 ? '#fff' : '#c8102e'; attrs.stroke = '#9aa0ab'; attrs['stroke-width'] = .5;
      svg.appendChild(svgel('rect', attrs));
    }
  };
  stripes(gx - 8, gy - 8, gw + 16, 8, true);          // crossbar
  stripes(gx - 8, gy, 8, gh + 8, false);              // left post
  stripes(gx + gw, gy, 8, gh + 8, false);             // right post
  // ground line
  svg.appendChild(svgel('line', { x1: 0, y1: gy + gh + 8, x2: GM.W, y2: gy + gh + 8, stroke: '#9aa0ab', 'stroke-width': 2 }));
  svg.appendChild(svgel('text', { x: GM.W / 2, y: 16, 'text-anchor': 'middle', 'font-size': 11, fill: '#898781', text: 'outside the frame = miss' }));
  // markers from events
  const g = svgel('g', { id: 'gm-marks' });
  svg.appendChild(g);
  drawGmMarks();
}
function drawGmMarks() {
  const g = $('#gm-marks'); if (!g) return;
  g.textContent = '';
  const list = $('#gm-list'); list.textContent = '';
  if (!game) return;
  for (const e of game.events) {
    if (e.x == null) continue;
    const isAfa = EV[e.type].team === 'AFA';
    const col = isAfa ? '#2a78d6' : '#eb6834';
    const outcome = shotOutcome(e);
    const cx = e.x / 100 * GM.W, cy = e.y / 100 * GM.H;
    const pen = ['g7', 'x7', 'og7', 'os7', 'o7miss'].includes(e.type);
    const fill = outcome === 'goal' ? col : outcome === 'saved' ? '#fff' : '#c8cbd2';
    const stroke = outcome === 'missed' ? '#9aa0ab' : col;
    g.appendChild(svgel('circle', { cx, cy, r: 9, fill, stroke, 'stroke-width': 2.5 }));
    const sp = isAfa ? snapByPid(e.pid) : null;
    const numTxt = isAfa ? (sp && sp.num != null ? String(sp.num) : '') : (e.onum || '');
    const tcol = outcome === 'goal' ? '#fff' : (outcome === 'saved' ? col : '#3a3d44');
    if (numTxt) g.appendChild(svgel('text', { x: cx, y: cy + 3.4, 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: tcol, text: numTxt }));
    if (pen) g.appendChild(svgel('text', { x: cx + 9, y: cy - 8, 'font-size': 9, 'font-weight': 800, fill: '#8a6502', text: 'P' }));
    // list chip
    const who = isAfa ? playerLabel(e.pid) : game.info.opponent + (e.onum ? ' #' + e.onum : '');
    const it = el('span', { cls: 'it' },
      el('span', { cls: 'dot', style: 'background:' + (outcome === 'missed' ? '#c8cbd2' : col) + (outcome === 'saved' ? ';background:#fff;border:2px solid ' + col : '') }),
      el('span', { text: who + ' · ' + EV[e.type].lab + (pen ? ' · 7m' : '') + (e.res === 'missed' && pen && isAfa ? ' (off target)' : '') }),
      el('button', { text: '✕', title: 'Remove this shot', onclick: () => deleteEvent(e.id) }));
    list.appendChild(it);
  }
}
$('#goalmap').addEventListener('click', ev => {
  if (!game || game.done) return;
  const svg = $('#goalmap');
  const r = svg.getBoundingClientRect();
  const x = (ev.clientX - r.left) / r.width * 100;
  const y = (ev.clientY - r.top) / r.height * 100;
  gmPending = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  openGmPop(ev.clientX - r.left, ev.clientY - r.top);
});
function openGmPop(px, py) {
  const pop = $('#gm-pop');
  // refresh shooter list; reset outcome/pen (keep the team choice — streaks are common)
  const sel = $('#gm-player'); sel.textContent = '';
  for (const p of game.rosterSnap) sel.appendChild(el('option', { value: p.pid, text: '#' + (p.num ?? '—') + ' ' + p.name }));
  $$('#gm-outcome button').forEach(x => x.classList.toggle('on', x.dataset.v === 'goal'));
  $('#gm-pen').checked = false;
  $('#gm-onum').value = '';
  pop.style.display = 'block';
  const wrap = $('#goalmap-wrap').getBoundingClientRect();
  pop.style.left = Math.min(px, wrap.width - 260) + 'px';
  pop.style.top = Math.min(py + 8, wrap.height - 40) + 'px';
}
$('#gm-cancel').addEventListener('click', () => { $('#gm-pop').style.display = 'none'; gmPending = null; });
$$('#gm-team button').forEach(b => b.addEventListener('click', () => {
  $$('#gm-team button').forEach(x => x.classList.toggle('on', x === b));
  const afa = b.dataset.v === 'AFA';
  $('#gm-afa-shooter').style.display = afa ? '' : 'none';
  $('#gm-opp-shooter').style.display = afa ? 'none' : '';
}));
$$('#gm-outcome button').forEach(b => b.addEventListener('click', () => {
  $$('#gm-outcome button').forEach(x => x.classList.toggle('on', x === b));
}));
$('#gm-save').addEventListener('click', () => {
  if (!gmPending) return;
  const afa = $('#gm-team button.on').dataset.v === 'AFA';
  const outcome = $('#gm-outcome button.on').dataset.v;
  const pen = $('#gm-pen').checked;
  let type;
  if (afa) type = pen ? (outcome === 'goal' ? 'g7' : 'x7') : (outcome === 'goal' ? 'goal' : outcome === 'saved' ? 'saved' : 'miss');
  else type = pen ? (outcome === 'goal' ? 'og7' : outcome === 'saved' ? 'os7' : 'o7miss')
             : (outcome === 'goal' ? 'ogoal' : outcome === 'saved' ? 'osave' : 'omiss');
  const extra = { x: gmPending.x, y: gmPending.y, res: outcome };
  if (afa) extra.pid = $('#gm-player').value;
  else { const on = $('#gm-onum').value.trim(); if (on) extra.onum = on; }
  addEvent(type, extra);
  $('#gm-pop').style.display = 'none'; gmPending = null;
});

/* ---------- live rendering ---------- */
function oppLogoFor(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('army') || n.includes('west point')) return LOGOS.army;
  if (n.includes('navy') || n.includes('annapolis')) return LOGOS.navy;
  if (n.includes('air force') || n.includes('usafa')) return LOGOS.airforce;
  return null;
}
function refreshLive() {
  if (!game) return;
  const d = derive(game);
  $('#sb-us').textContent = d.us;
  $('#sb-them').textContent = d.them;
  $('#sb-us-to').textContent = Math.max(0, 3 - d.team.toUs);
  $('#sb-them-to').textContent = Math.max(0, 3 - d.team.toThem);
  $('#sb-opp-name').textContent = game.info.opponent.toUpperCase();
  const cw = $('#sb-clock');
  if (!cw.querySelector('input')) cw.textContent = fmtClock(clockSec());
  $('#btn-clock').textContent = game.clock.at != null ? '❚❚ PAUSE CLOCK' : '▶ START CLOCK';
  $$('#sb-halves button').forEach(b => b.classList.toggle('on', b.textContent === game.half));
  // opponent logo
  const slot = $('#sb-opp-logo-slot'); slot.textContent = '';
  const lg = oppLogoFor(game.info.opponent);
  if (lg) slot.appendChild(el('img', { cls: 'tl', src: lg, alt: game.info.opponent }));
  else slot.appendChild(el('span', { cls: 'gen', text: (game.info.opponent || '?').slice(0, 2).toUpperCase() }));
  // per-card stat lines
  for (const card of $$('#pgrid .pcard')) {
    const p = d.P.get(card.dataset.pid) || blankP();
    const r = pRow(null, '', '', p);
    card.querySelector('.statline').textContent =
      'G ' + r.goals + ' · Sh ' + r.shots + ' · A ' + r.ast + ' · ST ' + r.stl +
      ' · TO ' + r.to + " · 2' " + r.p2;
  }
  renderLiveBox(d); renderLog(); drawGmMarks();
}
function statTable(target, headers, rows) {
  const t = el('table', { cls: 'stats' });
  const thr = el('tr');
  headers.forEach(h => thr.appendChild(el('th', { text: h.lab, cls: h.l ? 'l' : '' })));
  t.appendChild(thr);
  for (const r of rows) {
    const tr = el('tr', r.cls ? { cls: r.cls } : null);
    r.cells.forEach((c, i) => tr.appendChild(el('td', { text: c == null ? '' : String(c), cls: headers[i] && headers[i].l ? 'l' : '' })));
    t.appendChild(tr);
  }
  target.textContent = ''; target.appendChild(t);
}
const P_HEADERS = [{ lab: '#' }, { lab: 'Player', l: 1 }, { lab: 'Pos' }, { lab: 'Goals' }, { lab: 'Shots' },
  { lab: 'Shot %' }, { lab: 'Ast' }, { lab: 'Stl' }, { lab: 'Blk' }, { lab: 'TO' },
  { lab: '7m Drawn' }, { lab: '7m Made' }, { lab: '7m Miss' }, { lab: "2 Min" }, { lab: '2 Drawn' },
  { lab: 'YC' }, { lab: 'RC' }, { lab: 'Pts' }];
function pCells(r) {
  return [r.num ?? '', r.name, r.pos, r.goals, r.shots, fmtPct(r.pct), r.ast, r.stl, r.blk, r.to,
    r.d7, r.g7, r.x7, r.p2, r.d2, r.yc, r.rc, r.pts];
}
const K_HEADERS = [{ lab: '#' }, { lab: 'Keeper', l: 1 }, { lab: 'Shots Faced' }, { lab: 'Saves' },
  { lab: 'Save %' }, { lab: 'GA' }, { lab: '7m Faced' }, { lab: '7m Saved' }, { lab: 'After Whistle' }];
function kCells(r) { return [r.num ?? '', r.name, r.faced, r.sv, fmtPct(r.pct), r.ga, r.f7, r.sv7, r.savew]; }

function renderLiveBox(d) {
  const rows = [];
  const tot = blankP();
  for (const p of game.rosterSnap) {
    const raw = d.P.get(p.pid); if (!raw) continue;
    for (const k in tot) tot[k] += raw[k];
    rows.push({ cells: pCells(pRow(p.num, p.name, p.pos, raw)) });
  }
  rows.sort((a, b) => (b.cells[3] - a.cells[3]) || (b.cells[17] - a.cells[17]));
  if (rows.length) rows.push({ cls: 'tot', cells: pCells(pRow(null, 'TEAM', '', tot)) });
  statTable($('#livebox'), P_HEADERS, rows);
  const krows = [];
  for (const [pid, k] of d.K) {
    const sp = pid === '-' ? null : snapByPid(pid);
    krows.push({ cells: kCells(kRow(sp ? sp.num : null, sp ? sp.name : GK_NONE, k)) });
  }
  statTable($('#livegk'), K_HEADERS, krows.length ? krows : [{ cells: ['', 'No shots faced yet', '', '', '', '', '', '', ''] }]);
}
function renderLog() {
  const wrap = $('#elog'); wrap.textContent = '';
  const t = el('table');
  const evs = game.events.slice().reverse();
  let us = 0, them = 0;
  const scores = []; // running score AFTER each event, computed forward then read back
  for (const e of game.events) {
    if (e.type === 'goal' || e.type === 'g7') us++;
    if (e.type === 'ogoal' || e.type === 'og7') them++;
    scores.push(us + '–' + them);
  }
  evs.forEach((e, i) => {
    const idx = game.events.length - 1 - i;
    const d = EV[e.type];
    const who = d.pl && e.pid != null ? playerLabel(e.pid)
      : d.team === 'OPP' ? game.info.opponent + (e.onum ? ' #' + e.onum : '') : 'AIR FORCE';
    const desc = e.type === 'note' ? (e.note || '') : who + ' — ' + d.lab + (e.x != null ? ' (on map)' : '');
    const tr = el('tr', i === 0 ? { cls: 'flash' } : null,
      el('td', { text: e.half, style: 'width:36px' }),
      el('td', { text: e.clock, style: 'width:48px' }),
      el('td', { cls: d.team === 'OPP' ? 'tOPP' : 'tAFA', text: desc }),
      el('td', { text: scores[idx], style: 'width:52px;text-align:right' }),
      el('td', { style: 'width:26px' }, el('button', { cls: 'evx', text: '✕', title: 'Delete this event', onclick: () => deleteEvent(e.id) })));
    t.appendChild(tr);
  });
  if (!game.events.length) t.appendChild(el('tr', null, el('td', { text: 'No events yet — tap a player button, the opponent panel, or the goal map.' })));
  wrap.appendChild(t);
}
function refreshGameUI() {
  if (!game || game.done) return;
  // Re-snapshot so a late arrival appears mid-game — but NEVER drop a player
  // who already has logged events (or is the credited keeper): they stay in
  // the snapshot so their stats keep a row in the box score and the export.
  const used = new Set();
  for (const e of game.events) { if (e.pid != null) used.add(e.pid); if (e.gk != null) used.add(e.gk); }
  if (game.gk != null) used.add(game.gk);
  const cur = dressed().map(snapOf);
  const curIds = new Set(cur.map(p => p.pid));
  const retained = game.rosterSnap.filter(p => used.has(p.pid) && !curIds.has(p.pid));
  game.rosterSnap = cur.concat(retained);
  saveGame();
  buildPlayerGrid(); buildGkSel(); refreshLive();
}

/* ---------- cross-tab: adopt the other tab's writes instead of clobbering ---------- */
window.addEventListener('storage', ev => {
  if (ev.key !== LS.cur) return;
  try {
    const g = ev.newValue ? migrateClock(JSON.parse(ev.newValue)) : null;
    if (g && !g.done) {
      game = g;
      if ($('#live-area').style.display === 'block') { buildPlayerGrid(); buildGkSel(); refreshLive(); }
      else enterLiveMode();
    } else if (!g && game) { game = null; exitLiveMode(); }
  } catch (e) { /* malformed foreign write — ignore */ }
});

/* ---------- end game ---------- */
$('#btn-endgame').addEventListener('click', () => {
  if (!game) return;
  const d = derive(game);
  if (!confirm('End the game vs ' + game.info.opponent + ' at ' + d.us + '–' + d.them + '?\n\nThe game is archived in this browser and the Excel workbook downloads now.')) return;
  setClockRunning(false);
  game.done = true; game.endedAt = new Date().toISOString();
  exportGameXlsx(game);                       // the file downloads no matter what storage does
  archived.push(game);
  const okArch = lsSet(LS.games, archived);
  game = null; lsSet(LS.cur, null);
  exitLiveMode();
  toast(okArch ? 'Game archived + Excel downloaded' : '⚠ NOT archived in this browser — keep the downloaded Excel file!');
});
$('#btn-export-live').addEventListener('click', () => { if (game) exportGameXlsx(game); });
