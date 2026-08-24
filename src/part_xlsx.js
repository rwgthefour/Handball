'use strict';
/* ================================================================
   Excel in / Excel out  (SheetJS)
   Export writes a workbook per game; import reads those workbooks
   back by HEADER NAME (not column position, so a coach inserting a
   column in Excel cannot shuffle stats) AND the team's legacy
   "Handball Stats.xlsx" layout (one sheet per opponent, GK block
   under the field-player block).
   ================================================================ */

const FMT_MARK = 'AFA-HB-1';
function cleanName(f) { return (f || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_'); }
function h32s(s) {          // tiny FNV-1a for content-derived ids
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
const num0 = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
/* Excel hands a date cell back as a string, a Date, or a raw serial number
   depending on who touched it last — normalize all three to YYYY-MM-DD */
function normDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && isFinite(v) && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  return String(v);
}

/* ---------- per-game workbook ---------- */
function gameWorkbook(g) {
  const d = derive(g);
  const wb = XLSX.utils.book_new();
  const res = d.us > d.them ? 'W' : d.us < d.them ? 'L' : 'T';
  const ht = d.halfScore.H1;

  // Game Info
  const info = [
    ['USAFA TEAM HANDBALL — GAME EXPORT'],
    ['Format', FMT_MARK],
    ['Game ID', g.id],
    ['Date', g.info.date],
    ['Opponent', g.info.opponent],
    ['Location', g.info.location || ''],
    ['Home/Away', g.info.ha],
    ['Competition', g.info.comp],
    ['Half length (min)', g.info.halfLen],
    ['Result', res],
    ['Air Force goals', d.us],
    ['Opponent goals', d.them],
    ['Halftime', ht.us + '-' + ht.them],
    ['Air Force timeouts used', d.team.toUs],
    ['Opponent timeouts used', d.team.toThem],
    ['Notes', g.info.notes || ''],
    ['Exported', new Date().toLocaleString()],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(info);
  wsInfo['!cols'] = [{ wch: 26 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Game Info');

  // Player Stats — every dressed player gets a row (the sheet doubles as the
  // game roster); import skips the all-zero rows so GP stays honest
  const pHead = ['No', 'Player', 'Pos', 'Minutes', 'Goals', 'Shots', 'Shot %', 'Assists', 'Steals', 'Blocks',
    'Turnovers', "7's Drawn", "7's Made", "7's Missed", '2 Min', "2's Drawn", 'Yellow', 'Red', 'Points'];
  const pAoa = [pHead];
  const tot = blankP();
  for (const p of g.rosterSnap) {
    const raw = d.P.get(p.pid) || blankP();
    for (const k in tot) tot[k] += raw[k];
    const r = pRow(p.num, p.name, p.pos, raw);
    pAoa.push([r.num ?? '', r.name, r.pos, +(minsIn(g, p.pid) / 60).toFixed(2),
      r.goals, r.shots, r.pct == null ? '' : +(100 * r.pct).toFixed(1),
      r.ast, r.stl, r.blk, r.to, r.d7, r.g7, r.x7, r.p2, r.d2, r.yc, r.rc, r.pts]);
  }
  const tr = pRow(null, 'TEAM', '', tot);
  pAoa.push(['', 'TEAM', '', '', tr.goals, tr.shots, tr.pct == null ? '' : +(100 * tr.pct).toFixed(1),
    tr.ast, tr.stl, tr.blk, tr.to, tr.d7, tr.g7, tr.x7, tr.p2, tr.d2, tr.yc, tr.rc, tr.pts]);
  const wsP = XLSX.utils.aoa_to_sheet(pAoa);
  wsP['!cols'] = [{ wch: 5 }, { wch: 18 }, { wch: 5 }].concat(pHead.slice(3).map(() => ({ wch: 9 })));
  XLSX.utils.book_append_sheet(wb, wsP, 'Player Stats');

  // Goalkeepers
  const kHead = ['No', 'Keeper', 'Shots Faced', 'Saves', 'Save %', 'Goals Allowed',
    "7's Faced", "7's Saved", 'Saves After Whistle', 'Empty Net Goals'];
  const kAoa = [kHead];
  for (const [pid, k] of d.K) {
    const sp = pid === '-' ? null : g.rosterSnap.find(x => x.pid === pid);
    const r = kRow(sp ? sp.num : null, sp ? sp.name : GK_NONE, k);
    kAoa.push([r.num ?? '', r.name, r.faced, r.sv, r.pct == null ? '' : +(100 * r.pct).toFixed(1),
      r.ga, r.f7, r.sv7, r.savew, r.en]);
  }
  const wsK = XLSX.utils.aoa_to_sheet(kAoa);
  wsK['!cols'] = [{ wch: 5 }, { wch: 22 }].concat(kHead.slice(2).map(() => ({ wch: 12 })));
  XLSX.utils.book_append_sheet(wb, wsK, 'Goalkeepers');

  // Team Totals
  const oppShots = g.events.filter(e => ['ogoal', 'og7', 'osave', 'os7', 'omiss', 'o7miss'].includes(e.type)).length;
  const opp7 = g.events.filter(e => ['og7', 'os7', 'o7miss'].includes(e.type)).length;
  const opp7g = g.events.filter(e => e.type === 'og7').length;
  const tAoa = [
    ['Metric', 'Air Force', g.info.opponent],
    ['Goals', d.us, d.them],
    ['Shots', tr.shots, oppShots],
    ['Shot %', tr.pct == null ? '' : +(100 * tr.pct).toFixed(1), oppShots ? +(100 * d.them / oppShots).toFixed(1) : ''],
    ["7m goals / attempts", tr.g7 + ' / ' + (tr.g7 + tr.x7), opp7g + ' / ' + opp7],
    ['Turnovers', tr.to, d.team.oppTo],
    ['Steals', tr.stl, ''],
    ['Blocks', tr.blk, ''],
    ['2-minute suspensions', d.team.us2, d.team.them2],
    ['Yellow cards', d.team.usYC, d.team.themYC],
    ['Red cards', d.team.usRC, d.team.themRC],
    ['Timeouts used', d.team.toUs, d.team.toThem],
  ];
  const wsT = XLSX.utils.aoa_to_sheet(tAoa);
  wsT['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsT, 'Team Totals');

  // Play-by-Play
  const pbAoa = [['#', 'Half', 'Clock', 'Team', 'No', 'Player', 'Event', 'Detail', 'Score', 'Goal X %', 'Goal Y %']];
  let us = 0, them = 0;
  g.events.forEach((e, i) => {
    if (e.type === 'goal' || e.type === 'g7') us++;
    if (e.type === 'ogoal' || e.type === 'og7') them++;
    const dd = EV[e.type];
    const sp = dd.pl && e.pid != null ? g.rosterSnap.find(x => x.pid === e.pid) : null;
    pbAoa.push([i + 1, e.half, e.clock, dd.team === 'OPP' ? g.info.opponent : 'Air Force',
      sp ? (sp.num ?? '') : (e.onum || ''), sp ? sp.name : (dd.team === 'OPP' ? g.info.opponent : ''),
      dd.lab, e.note || '', us + '-' + them,
      e.x != null ? e.x : '', e.y != null ? e.y : '']);
  });
  const wsPb = XLSX.utils.aoa_to_sheet(pbAoa);
  wsPb['!cols'] = [{ wch: 4 }, { wch: 5 }, { wch: 7 }, { wch: 14 }, { wch: 4 }, { wch: 14 }, { wch: 26 }, { wch: 22 }, { wch: 7 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, wsPb, 'Play-by-Play');

  // Shot Map — Result comes from the scout's explicit outcome (e.res)
  const smAoa = [['#', 'Half', 'Clock', 'Team', 'No', 'Player', 'Result', '7m?', 'X %', 'Y %', 'Note',
    '(X/Y are % of the goal-map image, from the keeper\'s left)']];
  let n = 0;
  for (const e of g.events) {
    if (e.x == null) continue; n++;
    const dd = EV[e.type];
    const isAfa = dd.team === 'AFA';
    const sp = isAfa ? g.rosterSnap.find(x => x.pid === e.pid) : null;
    const outcome = shotOutcome(e);
    smAoa.push([n, e.half, e.clock, isAfa ? 'Air Force' : g.info.opponent,
      isAfa ? (sp ? sp.num ?? '' : '') : (e.onum || ''), isAfa ? (sp ? sp.name : '') : g.info.opponent,
      outcome.charAt(0).toUpperCase() + outcome.slice(1),
      ['g7', 'x7', 'og7', 'os7', 'o7miss'].includes(e.type) ? 'Y' : '', e.x, e.y, e.float ? 'EMPTY NET' : '']);
  }
  const wsSm = XLSX.utils.aoa_to_sheet(smAoa);
  wsSm['!cols'] = [{ wch: 4 }, { wch: 5 }, { wch: 7 }, { wch: 14 }, { wch: 4 }, { wch: 14 }, { wch: 8 }, { wch: 5 }, { wch: 7 }, { wch: 7 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsSm, 'Shot Map');

  // Roster snapshot (also used by LOAD ROSTER)
  const rAoa = [['No', 'Name', 'Pos', 'Class', 'Dressed']];
  for (const p of g.rosterSnap) rAoa.push([p.num ?? '', p.name, p.pos || '', p.year || '', 'Y']);
  const wsR = XLSX.utils.aoa_to_sheet(rAoa);
  wsR['!cols'] = [{ wch: 5 }, { wch: 18 }, { wch: 6 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, wsR, 'Roster');
  return wb;
}
function exportGameXlsx(g) {
  const wb = gameWorkbook(g);
  const fname = 'AFA_Handball_vs_' + (cleanName(g.info.opponent) || 'Opponent') + '_' + (g.info.date || 'game') + '.xlsx';
  XLSX.writeFile(wb, fname);
  toast('Downloaded ' + fname);
}

/* ---------- header-mapped row reading ---------- */
function headerCols(aoa) {
  const H = Array.from(aoa[0] || [], c => String(c ?? '').trim().toLowerCase());
  return lab => H.indexOf(lab.toLowerCase());
}
function rowsOf(ws) { return ws ? XLSX.utils.sheet_to_json(ws, { header: 1 }) : []; }

/* ---------- roster file save / load ---------- */
$('#btn-roster-export').addEventListener('click', () => {
  if (!roster.length) { toast('Roster is empty'); return; }
  const wb = XLSX.utils.book_new();
  const aoa = [['No', 'Name', 'Pos', 'Class', 'Dressed']];
  for (const p of roster) aoa.push([p.num ?? '', p.name, p.pos || '', p.year || '', p.active === false ? 'N' : 'Y']);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 5 }, { wch: 20 }, { wch: 6 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Roster');
  XLSX.writeFile(wb, 'AFA_Handball_Roster.xlsx');
  toast('Roster saved to AFA_Handball_Roster.xlsx');
});
function parseRosterRows(rows) {
  const col = headerCols(rows);
  const cNo = col('No'), cName = col('Name'), cPos = col('Pos'), cClass = col('Class'), cDr = col('Dressed');
  const out = [];
  for (const r of rows.slice(1)) {
    if (!r || cName < 0 || !String(r[cName] ?? '').trim()) continue;
    const rawNo = String(r[cNo] ?? '').trim();
    const n = rawNo === '' ? NaN : Number(rawNo);      // a blank cell is NO number, not #0
    out.push({ id: uid(), num: Number.isFinite(n) ? n : null, name: String(r[cName]).trim(),
      pos: String(r[cPos] || 'CB').trim(), year: String((cClass >= 0 && r[cClass]) || '').trim(),
      active: String((cDr >= 0 && r[cDr]) || 'Y').trim().toUpperCase() !== 'N' });
  }
  return numberTheSquad(out);      // a roster file without jerseys still numbers itself
}
$('#roster-file').addEventListener('change', async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer());
    const ws = wb.Sheets['Roster'];
    if (!ws) { toast('No "Roster" sheet in that file (any exported game or roster file works)'); return; }
    const out = parseRosterRows(rowsOf(ws));
    if (!out.length) { toast('No players found in the Roster sheet'); return; }
    roster = out; saveRoster(); renderRoster(); refreshGameUI();
    toast('Loaded ' + out.length + ' players from ' + f.name);
  } catch (e) { toast('Could not read that file'); }
  ev.target.value = '';
});

/* ================================================================
   SEASON — imports, aggregation, report
   A "season game" is a normalized record whatever its source:
   { id, source, date, opponent, ha, comp, result, us, them,
     players:[{name,num,goals,shots,ast,stl,blk,to,d7,g7,x7,p2,d2,yc,rc}],
     keepers:[{name,num,faced,sv,ga,f7,sv7,savew}], est:bool }
   GP semantics everywhere: a player is "in" a game only if they
   recorded at least one stat — normFromLive skips event-less
   players and the importer skips all-zero rows, so the same game
   reads the same from the archive and from its own export.
   ================================================================ */
const P_FIELDS = ['mins', 'goals', 'shots', 'ast', 'stl', 'blk', 'to', 'd7', 'g7', 'x7', 'p2', 'd2', 'yc', 'rc'];
const K_FIELDS = ['faced', 'sv', 'ga', 'f7', 'sv7', 'savew', 'en'];

function normFromLive(g) {   // archived games -> season record
  const d = derive(g);
  const players = [], keepers = [];
  for (const p of g.rosterSnap) {
    // matches the box score and the export: minutes played is a record too, so
    // the archived game and its own workbook cannot disagree about who played
    const raw = d.P.get(p.pid) || (minsIn(g, p.pid) > 0 ? blankP() : null);
    if (!raw) continue;
    const r = pRow(p.num, p.name, p.pos, raw);
    players.push({ name: p.name, num: p.num, mins: +(minsIn(g, p.pid) / 60).toFixed(2),
      goals: r.goals, shots: r.shots, ast: r.ast, stl: r.stl,
      blk: r.blk, to: r.to, d7: r.d7, g7: r.g7, x7: r.x7, p2: r.p2, d2: r.d2, yc: r.yc, rc: r.rc });
  }
  for (const [pid, k] of d.K) {
    const sp = pid === '-' ? null : g.rosterSnap.find(x => x.pid === pid);
    const r = kRow(sp ? sp.num : null, sp ? sp.name : GK_NONE, k);
    keepers.push({ name: sp ? sp.name : GK_NONE, num: r.num, faced: r.faced, sv: r.sv, ga: r.ga,
      f7: r.f7, sv7: r.sv7, savew: r.savew, en: r.en });
  }
  return { id: g.id, source: 'this browser', date: g.info.date, opponent: g.info.opponent,
    ha: g.info.ha, comp: g.info.comp, result: d.us > d.them ? 'W' : d.us < d.them ? 'L' : 'T',
    us: d.us, them: d.them, players, keepers, est: false };
}

function parseOurFormat(wb, fname) {
  const wsI = wb.Sheets['Game Info']; if (!wsI) return null;
  const info = {};
  for (const row of rowsOf(wsI)) if (row && row.length >= 2) info[String(row[0])] = row[1];
  if (info['Format'] !== FMT_MARK) return null;
  const players = [], keepers = [];
  const pRows = rowsOf(wb.Sheets['Player Stats']);
  if (pRows.length) {
    const col = headerCols(pRows);
    const c = { no: col('No'), name: col('Player'), goals: col('Goals'), shots: col('Shots'),
      ast: col('Assists'), stl: col('Steals'), blk: col('Blocks'), to: col('Turnovers'),
      d7: col("7's Drawn"), g7: col("7's Made"), x7: col("7's Missed"), p2: col('2 Min'),
      d2: col("2's Drawn"), yc: col('Yellow'), rc: col('Red'), mins: col('Minutes') };
    for (const r of pRows.slice(1)) {
      if (!r || c.name < 0) continue;
      const name = String(r[c.name] ?? '').trim();
      if (!name || name === 'TEAM') continue;
      const g = ix => ix >= 0 ? num0(r[ix]) : 0;
      const p = { name, num: (() => { const n = Number(r[c.no]); return Number.isFinite(n) ? n : null; })(),
        mins: g(c.mins), goals: g(c.goals), shots: g(c.shots), ast: g(c.ast), stl: g(c.stl), blk: g(c.blk), to: g(c.to),
        d7: g(c.d7), g7: g(c.g7), x7: g(c.x7), p2: g(c.p2), d2: g(c.d2), yc: g(c.yc), rc: g(c.rc) };
      if (P_FIELDS.some(f => p[f])) players.push(p);      // all-zero row = dressed, didn't record — not a GP
    }
  }
  const kRows = rowsOf(wb.Sheets['Goalkeepers']);
  if (kRows.length) {
    const col = headerCols(kRows);
    const c = { no: col('No'), name: col('Keeper'), faced: col('Shots Faced'), sv: col('Saves'),
      ga: col('Goals Allowed'), f7: col("7's Faced"), sv7: col("7's Saved"),
      savew: col('Saves After Whistle'), en: col('Empty Net Goals') };
    for (const r of kRows.slice(1)) {
      if (!r || c.name < 0) continue;
      const name = String(r[c.name] ?? '').trim();
      if (!name) continue;
      const g = ix => ix >= 0 ? num0(r[ix]) : 0;
      const k = { name, num: (() => { const n = Number(r[c.no]); return Number.isFinite(n) ? n : null; })(),
        faced: g(c.faced), sv: g(c.sv), ga: g(c.ga), f7: g(c.f7), sv7: g(c.sv7), savew: g(c.savew), en: g(c.en) };
      if (K_FIELDS.some(f => k[f])) keepers.push(k);
    }
  }
  const date = normDate(info['Date']);
  const opponent = String(info['Opponent'] || '?');
  const id = String(info['Game ID'] || (opponent + '::' + (date || '') + '::' + h32s(JSON.stringify([players, keepers]))));
  return [{ id, source: fname, date, opponent,
    ha: String(info['Home/Away'] || ''), comp: String(info['Competition'] || ''),
    result: String(info['Result'] || ''), us: num0(info['Air Force goals']), them: num0(info['Opponent goals']),
    players, keepers, est: false }];
}

/* Legacy layout: one sheet per opponent; header row with Name/Shots/Goals…,
   then a second header containing "Shots Taken" starting the keeper block.
   The id hashes the CONTENT, so a re-downloaded "…(1).xlsx" copy dedupes. */
function parseLegacy(wb, fname) {
  const out = [];
  for (const sn of wb.SheetNames) {
    const aoa = rowsOf(wb.Sheets[sn]);
    let hd = -1, kd = -1, off = 0;
    aoa.forEach((r, i) => {
      if (!r) return;
      // sheet_to_json rows are SPARSE arrays — Array.from fills the holes so
      // every later index/find call sees a real string
      const cells = Array.from(r, c => String(c ?? '').trim().toLowerCase());
      if (hd < 0 && cells.includes('name') && cells.includes('shots') && cells.includes('goals')) { hd = i; off = cells.indexOf('name'); }
      if (kd < 0 && cells.some(c => c === 'shots taken')) kd = i;
    });
    if (hd < 0) continue;
    const H = Array.from(aoa[hd], c => String(c ?? '').trim().toLowerCase());
    const col = lab => H.indexOf(lab);                       // absolute col index
    const c = { shots: col('shots'), goals: col('goals'), ast: col('assists'), stl: col('steals'),
      blk: col('blocks'), to: col('turnovers'), w2: col('w/2min'), d7: col("7's drawn"),
      g7: col("7's made"), d2: col("2's called for"), x7: col("7's missed") };
    const players = [];
    for (let i = hd + 1; i < (kd < 0 ? aoa.length : kd); i++) {
      const r = aoa[i] || [];
      const name = String(r[off] ?? '').trim();
      if (!name) continue;
      const g = (ix) => ix >= 0 ? num0(r[ix]) : 0;
      players.push({ name, num: null, mins: 0, goals: g(c.goals), shots: g(c.shots), ast: g(c.ast), stl: g(c.stl),
        blk: g(c.blk), to: g(c.to), d7: g(c.d7), g7: g(c.g7), x7: g(c.x7),
        p2: g(c.w2), d2: g(c.d2), yc: 0, rc: 0 });
    }
    const keepers = [];
    if (kd >= 0) {
      const KH = Array.from(aoa[kd], x => String(x ?? '').trim().toLowerCase());
      const kc = { faced: KH.indexOf('shots taken'), sv: KH.indexOf('saves'), sv7: KH.indexOf("7's saved"),
        f7: KH.indexOf("7's taken"), savew: KH.findIndex(x => x.startsWith('saves after')) };
      for (let i = kd + 1; i < aoa.length; i++) {
        const r = aoa[i] || [];
        const name = String(r[off] ?? '').trim();
        if (!name) continue;
        const g = (ix) => ix >= 0 ? num0(r[ix]) : 0;
        const faced = g(kc.faced), sv = g(kc.sv);
        keepers.push({ name, num: null, faced, sv, ga: Math.max(0, faced - sv),
          f7: g(kc.f7), sv7: g(kc.sv7), savew: g(kc.savew), en: 0 });
      }
    }
    if (!players.length && !keepers.length) continue;
    // a sheet with names but no numbers at all is an unplayed game — skip it
    const anyStat = players.some(p => P_FIELDS.some(f => p[f])) || keepers.some(k => K_FIELDS.some(f => k[f]));
    if (!anyStat) continue;
    const kept = players.filter(p => P_FIELDS.some(f => p[f]));            // GP = recorded something
    const keptK = keepers.filter(k => K_FIELDS.some(f => k[f]));
    const us = kept.reduce((s, p) => s + p.goals, 0);
    const them = keptK.reduce((s, k) => s + k.ga, 0);
    out.push({ id: 'legacy::' + sn + '::' + h32s(JSON.stringify([kept, keptK])),
      source: fname + ' (legacy sheet)', date: null,
      opponent: sn, ha: '', comp: '', result: us > them ? 'W' : us < them ? 'L' : 'T',
      us, them, players: kept, keepers: keptK, est: true });
  }
  return out.length ? out : null;
}

async function importFiles(files) {
  let added = 0, dup = 0, bad = 0;
  const have = new Set(allSeasonGames().map(g => g.id));
  for (const f of files) {
    try {
      const wb = XLSX.read(await f.arrayBuffer());
      const games = parseOurFormat(wb, f.name) || parseLegacy(wb, f.name);
      if (!games) { bad++; continue; }
      for (const g of games) {
        if (have.has(g.id)) { dup++; continue; }
        have.add(g.id); seasonImports.push(g); added++;
      }
    } catch (e) { bad++; }
  }
  $('#import-status').textContent = added + ' game(s) imported' +
    (dup ? ', ' + dup + ' duplicate(s) skipped' : '') + (bad ? ', ' + bad + ' file(s) unreadable' : '') + '.';
  renderSeason();
}
$('#file-in').addEventListener('change', ev => { importFiles(Array.from(ev.target.files)); ev.target.value = ''; });
const dz = $('#dropzone');
dz.addEventListener('dragover', ev => { ev.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', ev => {
  ev.preventDefault(); dz.classList.remove('over');
  importFiles(Array.from(ev.dataTransfer.files).filter(f => /\.xlsx?$/i.test(f.name)));
});
$('#btn-clear-imports').addEventListener('click', () => {
  seasonImports = []; $('#import-status').textContent = 'Imported files cleared — showing games saved in this browser.';
  renderSeason();
});

/* ================================================================
   THE TEAM REPO IS A DATA SOURCE
   The site is served from the GitHub repo, so workbooks committed to
   games/ are same-origin fetches — every visitor gets the season
   automatically, no hand-importing. Two discovery paths, unioned:
   the committed games/index.json manifest (regenerated by build.py),
   and the GitHub contents API (so a coach who adds a file through the
   GitHub web UI on their phone needs no extra step). Both are
   best-effort: offline or file:// copies just skip them.
   ================================================================ */
const REPO_OWNER = 'rwgthefour', REPO_NAME = 'Handball', GAMES_DIR = 'games';
let repoGames = [];
const isHosted = () => location.protocol === 'http:' || location.protocol === 'https:';
async function loadRepoGames() {
  if (!isHosted()) return;
  const found = new Map();                      // filename -> url
  try {
    const r = await fetch(GAMES_DIR + '/index.json', { cache: 'no-cache' });
    if (r.ok) { const m = await r.json(); for (const f of (m.files || [])) found.set(f, GAMES_DIR + '/' + encodeURIComponent(f)); }
  } catch (e) { /* offline / no manifest */ }
  try {
    const r = await fetch('https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + GAMES_DIR);
    if (r.ok) {
      const api = await r.json();
      if (Array.isArray(api)) for (const it of api)
        if (/\.xlsx?$/i.test(it.name) && it.download_url && !found.has(it.name)) found.set(it.name, it.download_url);
    }
  } catch (e) { /* API unreachable — the manifest already covered committed files */ }
  const games = [];
  for (const [name, url] of found) {
    try {
      const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) continue;
      const wb = XLSX.read(await r.arrayBuffer());
      const gs = parseOurFormat(wb, name) || parseLegacy(wb, name);
      if (gs) for (const g of gs) { g.source = 'team repo · ' + name; games.push(g); }
    } catch (e) { /* one bad file must not sink the rest */ }
  }
  repoGames = games;
  const s = $('#repo-status');
  if (s) s.textContent = repoGames.length ? ('⛁ ' + repoGames.length + ' game(s) loaded automatically from the team GitHub repo.') : '';
  if ($('#tab-season').classList.contains('on')) renderSeason();
  renderTeamCards();      // the cards carry season stats, so they follow the data
  renderHome();
}
async function loadRepoTeam() {
  if (!isHosted()) return;
  try {
    const r = await fetch('data/team.json', { cache: 'no-cache' }); if (!r.ok) return;
    const t = sanitizeTeam(await r.json());
    if (t) { repoTeam = t; reconcileTeam(); renderTeamCards(); }
  } catch (e) { /* no published cards yet — the starter pair shows */ }
}
async function loadRepoGallery() {
  if (!isHosted()) return;
  try {
    const r = await fetch('data/gallery.json', { cache: 'no-cache' }); if (!r.ok) return;
    const t = sanitizeGallery(await r.json());
    if (t) { repoGallery = t; reconcileGallery(); if ($('#tab-gallery').classList.contains('on')) renderGallery(); }
  } catch (e) { /* no published gallery yet */ }
}
async function loadRepoRoster() {
  if (!isHosted() || roster.length) return;     // never overwrite a roster someone built
  try {
    const r = await fetch('data/roster.xlsx', { cache: 'no-cache' }); if (!r.ok) return;
    const wb = XLSX.read(await r.arrayBuffer());
    const ws = wb.Sheets['Roster']; if (!ws) return;
    const out = parseRosterRows(rowsOf(ws));
    if (out.length && !roster.length) {
      roster = out; saveRoster(); renderRoster();
      toast('Team roster loaded from the site');
    }
  } catch (e) { /* fine — the roster page explains how to add players */ }
}

function allSeasonGames() {
  const local = archived.map(normFromLive);
  const seen = new Set(local.map(g => g.id));
  const repo = repoGames.filter(g => !seen.has(g.id));
  repo.forEach(g => seen.add(g.id));
  const rest = seasonImports.filter(g => !seen.has(g.id));
  const all = local.concat(repo, rest);
  // dated games sort by date; undated (legacy) keep arrival order, first
  return all.map((g, i) => ({ g, i })).sort((a, b) => {
    const da = a.g.date || '', db = b.g.date || '';
    if (da && db) return da < db ? -1 : da > db ? 1 : a.i - b.i;
    if (!da && !db) return a.i - b.i;
    return da ? 1 : -1;
  }).map(x => x.g);
}
