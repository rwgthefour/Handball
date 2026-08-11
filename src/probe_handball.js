'use strict';
/* End-to-end probe for USAFA_Handball_Stats.html — drives the real page,
   captures real downloads, parses them, and round-trips into a clean browser. */
const path = require('path');
const fs = require('fs');
const SCRATCH = __dirname;
const XLSX = require(path.join(SCRATCH, 'xlsx.full.min.js'));
const REPO = '/Users/willgarrett/Desktop/ApolloDagger';
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const apolloChrome = require(path.join(REPO, 'apollo_chrome.js'));
const PAGE = 'file://' + path.join(REPO, 'Handball', 'USAFA_Handball_Stats.html');
const LEGACY = '/Users/willgarrett/Downloads/Handball Stats.xlsx';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '   [' + String(detail) + ']' : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: apolloChrome() });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('dialog', d => d.accept());
  const downloads = [];
  page.on('download', d => downloads.push(d));

  console.log('— load & fresh state —');
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#btn-start');
  ok('page loads with a title', (await page.title()).includes('Handball'));
  ok('AF crest image decodes', await page.evaluate(() => document.getElementById('crest').naturalWidth > 0));

  console.log('— roster —');
  await page.click('nav.tabs button[data-tab="roster"]');
  await page.click('#btn-demo-roster');
  ok('sample roster renders 12 players', await page.$$eval('#roster-table tr', r => r.length) === 13);
  // add a player through the form
  await page.fill('#r-num', '99'); await page.fill('#r-name', "O'Malley, Test");
  await page.click('#btn-addplayer');
  ok('form-added player appears', await page.$$eval('#roster-table tr', r => r.length) === 14);

  console.log('— start game —');
  await page.click('nav.tabs button[data-tab="game"]');
  await page.fill('#g-opp', 'Army');
  await page.fill('#g-loc', 'Cadet West Gym');
  await page.click('#btn-start');
  await page.waitForSelector('#scoreboard', { state: 'visible' });
  ok('scoreboard shows', true);
  ok('Army logo appears on the scoreboard', await page.evaluate(() => {
    const img = document.querySelector('#sb-opp-logo-slot img');
    return !!img && img.naturalWidth > 0;
  }));
  ok('13 player cards on the floor', await page.$$eval('#pgrid .pcard', c => c.length) === 13);
  const gkSelTxt = await page.$eval('#gk-sel', s => (s.options[s.selectedIndex] || {}).textContent || '');
  ok('keeper defaults to first GK (Corn)', /Corn/.test(gkSelTxt), gkSelTxt);

  console.log('— log events —');
  const hit = async (num, ev) => page.click('.pcard[data-num="' + num + '"] button[data-ev="' + ev + '"]');
  await hit(7, 'goal'); await hit(7, 'goal');            // Jack 2 goals
  await hit(11, 'ast');                                  // RJ assist
  await hit(23, 'g7');                                   // Ryan 7m goal
  await hit(23, 'd7');                                   // Ryan drew the 7
  await hit(18, 'p2');                                   // Evan 2 min
  await hit(21, 'stl');                                  // Barrett steal
  await hit(11, 'd2');                                   // RJ drew a 2-minute
  await page.click('.opp-panel button[data-oev="ogoal"]');
  await page.click('.opp-panel button[data-oev="osave"]');
  await page.click('.opp-panel button[data-oev="osavew"]');
  await page.fill('#note-in', 'Momentum swing after the steal');
  await page.click('#btn-note');
  ok('score reads 3–1', await page.$eval('#sb-us', e => e.textContent) === '3'
    && await page.$eval('#sb-them', e => e.textContent) === '1');
  const boxTxt = await page.$eval('#livebox', e => e.textContent);
  ok('box score has Jack with 2 goals', /Jack/.test(boxTxt));
  const jackRow = await page.$$eval('#livebox tr', rows => {
    for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
      if (c[1] === 'Jack') return c; } return null; });
  ok('Jack row: 2 goals on 2 shots', jackRow && jackRow[3] === '2' && jackRow[4] === '2', JSON.stringify(jackRow));
  const gk1 = await page.$eval('#livegk', e => e.textContent);
  ok('keeper table credits Corn', /Corn/.test(gk1));

  console.log('— goal map —');
  const gm = await page.$('#goalmap');
  const gb = await gm.boundingBox();
  // opponent shot, saved, low left
  await page.mouse.click(gb.x + gb.width * 0.30, gb.y + gb.height * 0.62);
  await page.waitForSelector('#gm-pop', { state: 'visible' });
  await page.click('#gm-opp-btn');
  await page.fill('#gm-onum', '9');
  await page.click('#gm-outcome button[data-v="saved"]');
  await page.click('#gm-save');
  await sleep(80);
  // our 7m goal top right by Jack (#7)
  await page.mouse.click(gb.x + gb.width * 0.78, gb.y + gb.height * 0.30);
  await page.waitForSelector('#gm-pop', { state: 'visible' });
  await page.click('#gm-team button[data-v="AFA"]');
  await page.selectOption('#gm-player', { label: '#7 Jack' });
  await page.click('#gm-outcome button[data-v="goal"]');
  await page.check('#gm-pen');
  await page.click('#gm-save');
  await sleep(80);
  ok('map markers drawn (2 shots)', await page.$$eval('#gm-marks circle', c => c.length) === 2);
  ok('marker carries the shooter number', await page.$eval('#gm-marks', g => g.textContent.includes('9') && g.textContent.includes('7')));
  ok('penalty badge P on the 7m marker', await page.$eval('#gm-marks', g => g.textContent.includes('P')));
  ok('map goal moved the score to 4–1', await page.$eval('#sb-us', e => e.textContent) === '4');
  const gk2 = await page.$$eval('#livegk tr', rows => {
    for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
      if (c[1] === 'Corn') return c; } return null; });
  ok('Corn: 3 faced, 2 saves, 1 after-whistle', gk2 && gk2[2] === '3' && gk2[3] === '2' && gk2[8] === '1', JSON.stringify(gk2));

  console.log('— undo —');
  await page.click('#btn-undo');
  ok('undo pulled the map 7m back to 3–1', await page.$eval('#sb-us', e => e.textContent) === '3');
  ok('marker removed with its event', await page.$$eval('#gm-marks circle', c => c.length) === 1);

  console.log('— map keeps a MISSED 7m honest —');
  await page.mouse.click(gb.x + gb.width * 0.5, gb.y + gb.height * 0.12);   // over the bar
  await page.waitForSelector('#gm-pop', { state: 'visible' });
  await page.click('#gm-team button[data-v="AFA"]');
  await page.selectOption('#gm-player', { label: '#23 Ryan' });
  await page.click('#gm-outcome button[data-v="missed"]');
  await page.check('#gm-pen');
  await page.click('#gm-save');
  await sleep(80);
  ok('missed 7m does not score (still 3–1)', await page.$eval('#sb-us', e => e.textContent) === '3');
  const gmChips = await page.$eval('#gm-list', e => e.textContent);
  ok('chip says 7m missed (off target), not saved', /7m missed/.test(gmChips) && /off target/.test(gmChips), gmChips);
  ok('missed marker drawn gray', await page.$$eval('#gm-marks circle', c => c.some(x => x.getAttribute('fill') === '#c8cbd2')));

  console.log('— mid-game renumber keeps stats (pid keying) —');
  await page.click('nav.tabs button[data-tab="roster"]');
  await page.evaluate(() => {
    for (const r of document.querySelectorAll('#roster-table tr')) {
      const name = r.querySelector('td:nth-child(2) input');
      if (name && name.value === 'Jack') {
        const num = r.querySelector('.num-in');
        num.value = '17';
        num.dispatchEvent(new Event('change'));
      }
    }
  });
  await page.click('nav.tabs button[data-tab="game"]');
  ok('Jack\'s card now reads #17', !!(await page.$('.pcard[data-num="17"]')));
  const jr2 = await page.$$eval('#livebox tr', rows => {
    for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
      if (c[1] === 'Jack') return c; } return null; });
  ok('Jack keeps his 2 goals under the new number', jr2 && jr2[0] === '17' && jr2[3] === '2', JSON.stringify(jr2));
  ok('scoreboard unchanged by the renumber (3–1)', await page.$eval('#sb-us', e => e.textContent) === '3');

  console.log('— clock —');
  await page.click('#btn-clock');
  await sleep(2300);
  const clk = await page.$eval('#sb-clock', e => e.textContent);
  ok('clock runs', clk !== '00:00', clk);
  await page.click('#btn-clock');

  console.log('— live export —');
  const dl0 = downloads.length;
  await page.click('#btn-export-live');
  await page.waitForFunction(() => true); await sleep(600);
  ok('export produced a download', downloads.length === dl0 + 1);
  const liveFile = path.join(SCRATCH, 'out_live.xlsx');
  await downloads[downloads.length - 1].saveAs(liveFile);
  const wb1 = XLSX.read(fs.readFileSync(liveFile));
  ok('workbook has all 7 sheets', JSON.stringify(wb1.SheetNames) ===
    JSON.stringify(['Game Info', 'Player Stats', 'Goalkeepers', 'Team Totals', 'Play-by-Play', 'Shot Map', 'Roster']), wb1.SheetNames.join(','));
  const info = Object.fromEntries(XLSX.utils.sheet_to_json(wb1.Sheets['Game Info'], { header: 1 }).filter(r => r.length >= 2));
  ok('Game Info: opponent Army, format mark', info['Opponent'] === 'Army' && info['Format'] === 'AFA-HB-1');
  ok('Game Info: score 3-1', info['Air Force goals'] === 3 && info['Opponent goals'] === 1);
  const ps = XLSX.utils.sheet_to_json(wb1.Sheets['Player Stats'], { header: 1 });
  const jack = ps.find(r => r[1] === 'Jack');
  ok('Player Stats: Jack 2 goals / 2 shots / 100%', jack && jack[3] === 2 && jack[4] === 2 && jack[5] === 100, JSON.stringify(jack));
  const ryan = ps.find(r => r[1] === 'Ryan');
  ok("Player Stats: Ryan 7's Made 1, Drawn 1, Missed 1", ryan && ryan[11] === 1 && ryan[10] === 1 && ryan[12] === 1, JSON.stringify(ryan));
  ok('Player Stats: renumbered Jack exports as #17', jack && jack[0] === 17, JSON.stringify(jack));
  const rj = ps.find(r => r[1] === 'RJ');
  ok("Player Stats: RJ assist 1, 2's Drawn 1", rj && rj[6] === 1 && rj[14] === 1, JSON.stringify(rj));
  const gks = XLSX.utils.sheet_to_json(wb1.Sheets['Goalkeepers'], { header: 1 });
  const corn = gks.find(r => r[1] === 'Corn');
  ok('Goalkeepers: Corn 3 faced / 2 saves / 1 GA / 1 after-whistle', corn && corn[2] === 3 && corn[3] === 2 && corn[5] === 1 && corn[8] === 1, JSON.stringify(corn));
  const sm = XLSX.utils.sheet_to_json(wb1.Sheets['Shot Map'], { header: 1 });
  ok('Shot Map has both surviving mapped shots with coords', sm.length === 3 && typeof sm[1][8] === 'number', JSON.stringify(sm[1]));
  ok('Shot Map records the 7m as Missed, not Saved', sm.slice(1).some(r => r[6] === 'Missed' && r[7] === 'Y'), JSON.stringify(sm.slice(1).map(r => [r[6], r[7]])));
  const rosterSheet = XLSX.utils.sheet_to_json(wb1.Sheets['Roster'], { header: 1 });
  ok('Roster sheet carries 13 players', rosterSheet.length === 14);
  await page.screenshot({ path: path.join(SCRATCH, 'shot_game.png'), fullPage: true });

  console.log('— end game —');
  await page.click('#btn-endgame');
  await sleep(700);
  ok('END GAME downloads the workbook', downloads.length === dl0 + 2);
  await page.waitForSelector('#setup-card', { state: 'visible' });
  ok('back on setup, game archived', await page.evaluate(() => JSON.parse(localStorage.getItem('afahb.games.v1') || '[]').length) === 1);

  console.log('— season: local + legacy import —');
  await page.click('nav.tabs button[data-tab="season"]');
  await sleep(200);
  const tiles1 = await page.$eval('#tiles', e => e.textContent);
  ok('tiles show a 1–0 record', /1–0/.test(tiles1), tiles1.slice(0, 80));
  ok('4 chart cards render', await page.$$eval('#charts .chartcard', c => c.length) === 4);
  ok('charts contain svg marks', await page.$$eval('#charts svg path, #charts svg circle', m => m.length > 4));
  if (fs.existsSync(LEGACY)) {
    await page.setInputFiles('#file-in', LEGACY);
    await sleep(700);
    const st = await page.$eval('#import-status', e => e.textContent);
    ok('legacy workbook imports 4 played games (empty sheet skipped)', /4 game\(s\) imported/.test(st), st);
    const seasonTxt = await page.$eval('#season-players', e => e.textContent);
    const jrow = await page.$$eval('#season-players tr', rows => {
      for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
        if (c[1] === 'Jack') return c; } return null; });
    // Jack: live 2 + legacy 10+12+6+14 = 44
    ok('season merges live + legacy: Jack 44 goals, 5 GP', jrow && jrow[3] === '44' && jrow[2] === '5', JSON.stringify(jrow));
    const glRows = await page.$$eval('#gamelog tr', r => r.length);
    ok('game log lists 5 games', glRows === 6, glRows);
    const krow = await page.$$eval('#season-gk tr', rows => {
      for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
        if (c[1] === 'Corn') return c; } return null; });
    // Corn: live faced 3 sv 2 + legacy 48/18 + 29/22 + 13/5 + 42/11 = faced 135, sv 58
    ok('season GK: Corn 135 faced / 58 saves', krow && krow[3] === '135' && krow[4] === '58', JSON.stringify(krow));
    // duplicate re-import is skipped
    await page.setInputFiles('#file-in', LEGACY);
    await sleep(600);
    const st2 = await page.$eval('#import-status', e => e.textContent);
    ok('re-importing the same file skips duplicates', /4 duplicate\(s\) skipped/.test(st2), st2);
    // a re-downloaded "(1)" copy must dedupe too — ids hash content, not filename
    const COPY = path.join(SCRATCH, 'Handball Stats (1).xlsx');
    fs.copyFileSync(LEGACY, COPY);
    await page.setInputFiles('#file-in', COPY);
    await sleep(600);
    const st3b = await page.$eval('#import-status', e => e.textContent);
    ok('a renamed copy of the same file also dedupes', /4 duplicate\(s\) skipped/.test(st3b), st3b);
  } else { console.log('  (legacy workbook not found — skipped)'); }
  await page.screenshot({ path: path.join(SCRATCH, 'shot_season.png'), fullPage: true });

  console.log('— season report export —');
  const dlBefore = downloads.length;
  await page.click('#btn-season-export');
  await sleep(600);
  ok('season report downloads', downloads.length === dlBefore + 1);
  const seasonFile = path.join(SCRATCH, 'out_season.xlsx');
  await downloads[downloads.length - 1].saveAs(seasonFile);
  const wb2 = XLSX.read(fs.readFileSync(seasonFile));
  ok('season report sheets', JSON.stringify(wb2.SheetNames) ===
    JSON.stringify(['Season Summary', 'Player Totals', 'Goalkeeper Totals', 'Game Log']), wb2.SheetNames.join(','));
  const pt = XLSX.utils.sheet_to_json(wb2.Sheets['Player Totals'], { header: 1 });
  const jackT = pt.find(r => r[1] === 'Jack');
  ok('report: Jack 44 goals over 5 GP', jackT && jackT[3] === 44 && jackT[2] === 5, JSON.stringify(jackT));

  console.log('— round-trip into a clean browser —');
  const ctx2 = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 950 } });
  const p2 = await ctx2.newPage();
  const p2err = []; p2.on('pageerror', e => p2err.push(String(e)));
  await p2.goto(PAGE);
  await p2.evaluate(() => localStorage.clear());
  await p2.reload();
  await p2.click('nav.tabs button[data-tab="season"]');
  await p2.setInputFiles('#file-in', liveFile);
  await sleep(700);
  const st3 = await p2.$eval('#import-status', e => e.textContent);
  ok('exported game imports on a machine with no saved data', /1 game\(s\) imported/.test(st3), st3);
  const jrow2 = await p2.$$eval('#season-players tr', rows => {
    for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
      if (c[1] === 'Jack') return c; } return null; });
  ok('round-trip preserves Jack 2 goals', jrow2 && jrow2[3] === '2', JSON.stringify(jrow2));
  const krow2 = await p2.$$eval('#season-gk tr', rows => {
    for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
      if (c[1] === 'Corn') return c; } return null; });
  ok('round-trip preserves Corn 2 saves + after-whistle', krow2 && krow2[4] === '2' && krow2[9] === '1', JSON.stringify(krow2));
  ok('round-trip tile record 1–0', /1–0/.test(await p2.$eval('#tiles', e => e.textContent)));

  console.log('— resume after reload (live game survives) —');
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p3 = await ctx3.newPage();
  p3.on('dialog', d => d.accept());
  await p3.goto(PAGE);
  await p3.evaluate(() => localStorage.clear());
  await p3.reload();
  await p3.click('nav.tabs button[data-tab="roster"]');
  await p3.click('#btn-demo-roster');
  await p3.click('nav.tabs button[data-tab="game"]');
  await p3.fill('#g-opp', 'Navy');
  await p3.click('#btn-start');
  await p3.click('.pcard[data-num="7"] button[data-ev="goal"]');
  await p3.reload();
  await p3.waitForSelector('#scoreboard', { state: 'visible' });
  ok('reload mid-game resumes with the score intact', await p3.$eval('#sb-us', e => e.textContent) === '1');
  ok('Navy logo resolves on the scoreboard', await p3.evaluate(() => {
    const img = document.querySelector('#sb-opp-logo-slot img');
    return !!img && img.naturalWidth > 0;
  }));

  console.log('— guards refuse dishonest states —');
  const ctx4 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p4 = await ctx4.newPage();
  await p4.goto(PAGE);
  await p4.evaluate(() => localStorage.clear());
  await p4.reload();
  await p4.click('nav.tabs button[data-tab="roster"]');
  await p4.click('#btn-demo-roster');
  await p4.fill('#r-name', 'Walk-on Nonum');            // no jersey number
  await p4.click('#btn-addplayer');
  await p4.click('nav.tabs button[data-tab="game"]');
  await p4.fill('#g-opp', 'Navy');
  await p4.click('#btn-start');
  const hint = await p4.$eval('#setup-hint', e => e.textContent);
  ok('numberless dressed player blocks the start, naming them',
    /Walk-on Nonum/.test(hint) && await p4.$eval('#scoreboard', e => getComputedStyle(e).display) === 'none', hint);
  ok('no page errors anywhere', pageErrors.length === 0 && p2err.length === 0, pageErrors.concat(p2err).join(' | '));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('PROBE CRASH:', e); process.exit(1); });
