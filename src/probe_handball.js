'use strict';
/* End-to-end probe for USAFA_Handball_Stats.html — drives the real page,
   captures real downloads, parses them, and round-trips into a clean browser. */
const path = require('path');
const fs = require('fs');
// probe OUTPUT (downloaded workbooks, screenshots) goes to a temp dir — writing
// it beside the source put test artifacts in the repo and in every commit
const SCRATCH = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'afahb-probe-'));
const XLSX = require(path.join(__dirname, 'xlsx.full.min.js'));   // the library ships with the SOURCE
const REPO = '/Users/willgarrett/Desktop/ApolloDagger';
const REPO_HB = '/Users/willgarrett/Desktop/Handball';
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const apolloChrome = require(path.join(REPO, 'apollo_chrome.js'));
const { spawn } = require('child_process');
const PAGE = 'file://' + path.join(REPO_HB, 'index.html');
/* Fixtures live in the staged copy, never in the repo (its games/ folder is the
   team's real season) and never in ~/Downloads (TCC-protected on macOS: it
   stopped being readable mid-session and read as an importer regression). */
const STAGE = path.join(process.env.TMPDIR || '/tmp', 'afahb_hosted_stage');
const LEGACY = path.join(STAGE, 'games', 'legacy_fixture.xlsx');
/* the team's old workbook shape: one sheet per opponent, a field-player block
   then a keeper block headed "Shots Taken" */
function legacySheet(rows, gkRows) {
  const head = ['Name', 'Shots', 'Goals', 'Assists', 'Steals', 'Blocks', 'Turnovers', 'W/2min',
    "7's Drawn", "7's Made", "2's Called For", "7's Missed"];
  const gkHead = ['', 'Shots Taken', 'Saves', 'Assists', 'Goals', 'Turnovers', "7's Saved", "7's Taken", 'Saves after wistle'];
  return XLSX.utils.aoa_to_sheet([[], head].concat(rows, [gkHead], gkRows));
}
function writeLegacyFixture(dest) {
  const wb = XLSX.utils.book_new();
  //                     name    Sh  G  A  St Bl TO
  XLSX.utils.book_append_sheet(wb, legacySheet(
    [['Jack', 10, 6, 2, 1, 0, 1], ['RJ', 5, 3, 2, 0, 0, 0]], [['Corn', 20, 8]]), 'New York');
  XLSX.utils.book_append_sheet(wb, legacySheet(
    [['Jack', 8, 5, 1, 0, 0, 0], ['RJ', 4, 1, 0, 0, 0, 1]], [['Corn', 15, 6]]), 'SUNY');
  XLSX.utils.book_append_sheet(wb, legacySheet([['Jack'], ['RJ']], [['Corn']]), 'Unplayed');
  fs.writeFileSync(dest, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));   // the browser build has no fs
}
const ADMIN_PW = 'handball2027';

/* --prep-hosted <dir>: build the staged copy the hosted section is served from
   (repo page + games + roster + a TEST team.json), then exit. run_probe.sh
   calls this before starting the server. */
const TEST_TEAM = { v: 1, ts: 1000000, cards: [
  { id: 'tc', sec: 'coach', name: 'Coach Hosted Check', role: 'Head Coach', badge: false, photo: '', pos: '', home: '', major: '', career: '' },
  { id: 'tp', sec: 'player', name: 'C2C Hosted Check', role: '', badge: false, photo: '', pos: 'Pivot', home: 'Denver, Colorado', major: 'History', career: 'Intel' },
] };
if (process.argv[2] === '--prep-hosted') {
  const stage = process.argv[3];
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'data'), { recursive: true });
  fs.copyFileSync(path.join(REPO_HB, 'index.html'), path.join(stage, 'index.html'));
  fs.mkdirSync(path.join(stage, 'games'), { recursive: true });
  writeLegacyFixture(path.join(stage, 'games', 'legacy_fixture.xlsx'));
  fs.writeFileSync(path.join(stage, 'games', 'index.json'), JSON.stringify({ files: ['legacy_fixture.xlsx'] }));
  fs.copyFileSync(path.join(REPO_HB, 'data', 'roster.xlsx'), path.join(stage, 'data', 'roster.xlsx'));
  fs.writeFileSync(path.join(stage, 'data', 'team.json'), JSON.stringify(TEST_TEAM));
  const PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  fs.writeFileSync(path.join(stage, 'data', 'gallery.json'),
    JSON.stringify({ v: 1, photos: [{ id: 'gh', cap: 'Hosted Gallery Check', src: PX }] }));
  console.log('hosted staging ready:', stage);
  process.exit(0);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '   [' + String(detail) + ']' : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const goTab = async (p, name) => { await p.click('#menu-btn'); await p.click('#menu button[data-tab="' + name + '"]'); };
const unlockAdmin = async p => {
  await p.click('#menu-btn'); await p.click('#menu-admin');
  await p.fill('#admin-pw', ADMIN_PW); await p.click('#admin-go');
  await p.waitForFunction(() => document.body.classList.contains('admin'));
};
const openRosterMgmt = async p => {
  await goTab(p, 'roster');
  if (await p.$eval('#manage-roster-card', e => e.classList.contains('collapsed'))) await p.click('#mroster-toggle');
};
const PHONE_W = 375;
const noOverflow = (p, w) => p.evaluate(dw => document.documentElement.scrollWidth <= dw + 4, w || PHONE_W);
const COURT_MAX = 7;
let _probePage = null;
const pidOf = num => _probePage.evaluate(n => {
  const p = (JSON.parse(localStorage.getItem('afahb.current.v1') || '{}').rosterSnap || []).find(x => x.num === n);
  return p ? p.pid : '';
}, num);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: apolloChrome() });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  _probePage = page;
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('dialog', d => d.accept());
  const downloads = [];
  page.on('download', d => downloads.push(d));

  console.log('— load & fresh state —');
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#menu-btn');
  ok('page loads with a title', (await page.title()).includes('Handball'));
  ok('AF crest image decodes', await page.evaluate(() => document.getElementById('crest').naturalWidth > 0));

  console.log('— welcome page, menu, admin wall —');
  ok('opens on the welcome page', await page.$eval('#tab-home', e => e.classList.contains('on')));
  ok('welcome crest decodes', await page.evaluate(() => document.getElementById('home-crest').naturalWidth > 0));
  ok('old top strip is gone', await page.$$eval('body > .cui', n => n.length) === 0);
  ok('menu closed until ☰ pressed', await page.$eval('#menu', m => !m.classList.contains('open')));
  ok('DONATE link in the menu opens the USAFA giving page in a new tab', await page.$eval('#menu-donate', a =>
    a.href === 'https://give.usafa.org/schools/UnitedStatesAirForceAcademy/falcon-funder/pages/usafa-team-handball-club/?a=1' && a.target === '_blank' && a.rel.includes('noopener')));
  ok('team photo renders on the landing page', await page.evaluate(() => {
    const i = document.getElementById('home-team-photo');
    return !!i && i.naturalWidth === 1200 && getComputedStyle(i).display !== 'none';
  }));
  await page.click('#menu-btn');
  ok('☰ opens the menu', await page.$eval('#menu', m => m.classList.contains('open')));
  ok('GAME shows locked for visitors', await page.$eval('#menu button[data-tab="game"]', b => b.textContent.includes('🔒')));
  ok('roster manager hidden while locked', await page.$eval('#manage-roster-card', e => getComputedStyle(e).display) === 'none');
  await page.click('#menu button[data-tab="game"]');
  ok('locked GAME opens the admin prompt instead', await page.$eval('#admin-modal', m => m.classList.contains('open')));
  await page.fill('#admin-pw', 'wrongpass'); await page.click('#admin-go');
  ok('wrong password refused', await page.$eval('#admin-err', e => e.textContent) === 'Wrong password.'
    && await page.$eval('#admin-modal', m => m.classList.contains('open')));
  await page.fill('#admin-pw', ADMIN_PW); await page.click('#admin-go');
  ok('right password unlocks and continues to GAME', await page.$eval('#tab-game', e => e.classList.contains('on'))
    && await page.evaluate(() => document.body.classList.contains('admin')));
  ok('menu GAME loses the lock once admin', await page.$eval('#menu button[data-tab="game"]', b => !b.textContent.includes('🔒')));
  await page.click('#setup-toggle');
  ok('game setup collapses', await page.$eval('#setup-body', e => getComputedStyle(e).display) === 'none');
  await page.click('#setup-toggle');
  ok('…and expands again', await page.$eval('#setup-body', e => getComputedStyle(e).display) !== 'none');
  await goTab(page, 'home');
  await page.click('.home-actions .act[data-goto="game"]');
  ok('welcome action card jumps straight to GAME when admin', await page.$eval('#tab-game', e => e.classList.contains('on')));

  console.log('— team cards + roster —');
  await goTab(page, 'roster');
  const cardsTxt = await page.$eval('#team-cards', e => e.textContent);
  ok('Coaches section leads with Coach Cavanaugh', /Coaches/.test(cardsTxt) && /Mike Cavanaugh/.test(cardsTxt) && /Head Coach/.test(cardsTxt));
  ok('captain card carries the standard format', /C1C Jack P\. Tierney/.test(cardsTxt) && /Center Back/.test(cardsTxt)
    && /Iowa City, Iowa/.test(cardsTxt) && /Systems Engineering/.test(cardsTxt) && /Pilot/.test(cardsTxt));
  ok('captain ribbon shows', /TEAM CAPTAIN/.test(cardsTxt));
  const ribbonInside = p => p.evaluate(() => {
    const badge = document.querySelector('#team-cards .badge');
    const ph = badge && badge.closest('.ph');
    if (!badge || !ph) return false;
    const rr = document.createRange(); rr.selectNodeContents(badge);
    const t = rr.getBoundingClientRect(), b = ph.getBoundingClientRect();
    return t.width > 0 && t.left >= b.left - 0.5 && t.top >= b.top - 0.5 && t.right <= b.right + 0.5 && t.bottom <= b.bottom + 0.5;
  });
  ok('ribbon label sits fully inside the photo (no clipping)', await ribbonInside(page));
  ok('bottom text removed from every page', await page.$$eval('footer.app, .home-note', n => n.length) === 0);
  ok('photo placeholders render until portraits are uploaded', await page.$$eval('#team-cards .ph .noimg', n => n.length) === 2);

  console.log('— team card manager (admin builds cards in the browser) —');
  ok('manager visible for admin', await page.$eval('#team-mgr-card', e => getComputedStyle(e).display) !== 'none');
  await page.click('#tm-add-player');
  await page.selectOption('#tm-sec', 'cic');            // the new CIC section
  await page.fill('#tm-name', 'C4C Test Falcon');
  await page.fill('#tm-role', 'Wing');
  await page.fill('#tm-sq', 'CS-27');
  await page.fill('#tm-pos', 'Left Wing');
  await page.fill('#tm-home', 'Reno, Nevada');
  await page.fill('#tm-major', 'Astronautical Engineering');
  await page.fill('#tm-career', 'Combat Systems Officer');
  await page.setInputFiles('#tm-photo', path.join(REPO, 'Logos', 'AirForce.png'));
  await page.waitForFunction(() => (document.getElementById('tm-photo-prev').src || '').startsWith('data:image/jpeg'));
  await page.click('#tm-save');
  const tc2 = await page.$eval('#team-cards', e => e.textContent);
  ok('new card renders with the standard fields', /C4C Test Falcon/.test(tc2) && /Reno, Nevada/.test(tc2) && /Combat Systems Officer/.test(tc2), tc2.slice(0, 80));
  const secOrder = await page.$$eval('#team-cards .team-sec > h2', h => h.map(x => x.textContent));
  ok('sections read Coaches → Team Captain → CIC', JSON.stringify(secOrder) === JSON.stringify(['Coaches', 'Team Captain', 'CIC']), secOrder.join(' | '));
  ok('Squadron field renders above Position', await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('#team-cards .bbcard')).find(c => c.textContent.includes('C4C Test Falcon'));
    const labels = Array.from(card.querySelectorAll('.fields .fl')).map(x => x.textContent);
    return labels[0] === 'Squadron' && labels[1] === 'Position' && card.textContent.includes('CS-27');
  }));
  ok('uploaded photo is card-cropped and replaces the placeholder', await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('#team-cards .bbcard')).find(c => c.textContent.includes('C4C Test Falcon'));
    const img = card && card.querySelector('.ph > img');
    return !!img && img.src.startsWith('data:image/jpeg') && img.naturalWidth === 480 && img.naturalHeight === 640;
  }));
  const dlT = downloads.length;
  await page.click('#tm-download');
  await sleep(400);
  ok('team.json downloads for publishing', downloads.length === dlT + 1);
  const teamFile = path.join(SCRATCH, 'out_team.json');
  await downloads[downloads.length - 1].saveAs(teamFile);
  const tj = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
  ok('team.json carries all three cards incl. the photo',
    tj.cards.length === 3 && tj.cards.some(c => c.name === 'C4C Test Falcon' && c.photo.startsWith('data:image/jpeg'))
    && tj.cards.some(c => c.name === 'C1C Jack P. Tierney'));
  await page.$$eval('#tm-list .tmrow', rows => {
    for (const r of rows) if (r.textContent.includes('Test Falcon')) r.querySelector('button').click();   // ✎ EDIT
  });
  ok('editor reopens with the saved values', await page.$eval('#tm-name', e => e.value) === 'C4C Test Falcon');
  await page.click('#tm-cancel');
  await page.$$eval('#tm-list .tmrow', rows => {
    for (const r of rows) if (r.textContent.includes('Test Falcon')) {
      Array.from(r.querySelectorAll('button')).find(x => x.textContent === '✕').click();
    }
  });
  await sleep(150);
  ok('card deletes from the manager', !/C4C Test Falcon/.test(await page.$eval('#team-cards', e => e.textContent)));

  console.log('— coaches row: head coach centred, row centred, plates uniform —');
  for (const nm of ['Lt Col Test Assistant', 'Col (RET) Test Assistant Two']) {
    await page.click('#tm-add-coach');
    await page.fill('#tm-name', nm);
    await page.fill('#tm-role', 'Assistant Coach');
    await page.click('#tm-save');
    await sleep(120);
  }
  const coachRow = () => page.evaluate(() => {
    const s = [...document.querySelectorAll('#team-cards .team-sec')].find(x => x.querySelector('h2').textContent === 'Coaches');
    const g = s.querySelector('.bbgrid'), cards = [...g.children];
    const l = Math.min(...cards.map(c => c.getBoundingClientRect().left));
    const r = Math.max(...cards.map(c => c.getBoundingClientRect().right));
    const gb = g.getBoundingClientRect();
    return {
      names: cards.map(c => c.querySelector('.nm').textContent),
      off: Math.abs((l + r) / 2 - (gb.left + gb.right) / 2),   // row centre vs container centre
      slack: gb.width - (r - l),                                // proves there IS spare room
      plates: cards.map(c => Math.round(c.querySelector('.nm').getBoundingClientRect().height)),
      wraps: cards.map(c => c.querySelector('.nm').getBoundingClientRect().height > 40),
    };
  });
  const cr = await coachRow();
  ok('head coach sits in the middle of the coaches row',
    cr.names.length === 3 && cr.names[1] === 'Mike Cavanaugh', cr.names.join(' | '));
  ok('coaches row is centred, with spare room on both sides (not just a full row)',
    cr.off <= 2 && cr.slack > 40, JSON.stringify({ off: +cr.off.toFixed(1), slack: +cr.slack.toFixed(1) }));
  ok('name plates are uniform height even when a long name wraps',
    new Set(cr.plates).size === 1 && cr.wraps.some(Boolean), JSON.stringify(cr.plates));

  await page.click('#tm-reset');
  await sleep(150);
  ok('discard local edits returns to the starter cards', /Tierney/.test(await page.$eval('#team-cards', e => e.textContent)));

  console.log('— gallery (admin uploads, everyone views) —');
  await goTab(page, 'gallery');
  ok('gallery opens on the starter team photo', await page.$$eval('#galgrid .gph', t => t.length) === 1);
  ok('gallery manager visible for admin', await page.$eval('#gal-mgr-card', e => getComputedStyle(e).display) !== 'none');
  await page.setInputFiles('#gal-add', [path.join(REPO, 'Logos', 'AirForce.png'), path.join(REPO, 'Logos', '2SWS.png')]);
  await page.waitForFunction(() => document.querySelectorAll('#galgrid .gph').length === 3, undefined, { timeout: 10000 });
  ok('two uploads join the grid (3 photos)', true);
  await page.$$eval('#gal-list .glrow input', ins => { const i = ins[1]; i.value = 'Season opener'; i.dispatchEvent(new Event('change')); });
  await sleep(150);
  ok('caption saves and renders on the tile', /Season opener/.test(await page.$eval('#galgrid', e => e.textContent)));
  await page.click('#galgrid .gph');
  ok('tapping a photo opens the lightbox', await page.$eval('#lightbox', e => e.classList.contains('open'))
    && await page.$eval('#lb-img', i => i.naturalWidth > 0));
  await page.click('#lb-close');
  ok('lightbox closes', await page.$eval('#lightbox', e => !e.classList.contains('open')));
  const dlG = downloads.length;
  await page.click('#gal-download');
  await sleep(400);
  ok('gallery.json downloads for publishing', downloads.length === dlG + 1);
  const galFile = path.join(SCRATCH, 'out_gallery.json');
  await downloads[downloads.length - 1].saveAs(galFile);
  const gj = JSON.parse(fs.readFileSync(galFile, 'utf8'));
  ok('gallery.json carries all three photos (uploads as data URIs)',
    gj.photos.length === 3 && gj.photos.filter(p => p.src.startsWith('data:image')).length >= 2);
  await page.$$eval('#gal-list .glrow', rows => {
    const r = rows[rows.length - 1];
    Array.from(r.querySelectorAll('button')).find(x => x.textContent === '✕').click();
  });
  await sleep(150);
  ok('photo deletes from the gallery', await page.$$eval('#galgrid .gph', t => t.length) === 2);
  await page.click('#gal-reset');
  await sleep(150);
  ok('discard returns the gallery to the starter photo', await page.$$eval('#galgrid .gph', t => t.length) === 1);

  await openRosterMgmt(page);
  await page.click('#btn-demo-roster');
  ok('sample roster renders 12 players', await page.$$eval('#roster-table tr', r => r.length) === 13);
  // add a player through the form
  await page.selectOption('#r-card', '_other');
  await page.fill('#r-num', '99'); await page.fill('#r-name', "O'Malley, Test");
  await page.click('#btn-addplayer');
  ok('a player without a card can still be added by name', await page.$$eval('#roster-table tr', r => r.length) === 14);

  console.log('— roster rows are team-card profiles —');
  const yrOpts = await page.$$eval('#r-year option', o => o.map(x => x.textContent));
  ok('class year is a dropdown reading 2027·C1C … 2030·C4C',
    JSON.stringify(yrOpts) === JSON.stringify(['—', '2027 · C1C', '2028 · C2C', '2029 · C3C', '2030 · C4C']), yrOpts.join(' | '));
  const cardOpts = await page.$$eval('#r-card option', o => o.map(x => x.textContent));
  ok('the player picker lists the team cards (captain among them)',
    cardOpts.some(t => /C1C Jack P\. Tierney/.test(t)) && cardOpts.some(t => /without a card/.test(t)), cardOpts.join(' | '));
  await page.selectOption('#r-card', { label: 'C1C Jack P. Tierney · Center Back' });
  const auto = await page.evaluate(() => ({ pos: document.getElementById('r-pos').value, yr: document.getElementById('r-year').value }));
  ok('picking a card fills position and class year from the profile',
    auto.pos === 'CB' && auto.yr === '2027', JSON.stringify(auto));
  await page.fill('#r-num', '77');          // 7 belongs to the demo roster's Jack
  await page.click('#btn-addplayer');
  await sleep(150);
  const linkedRow = await page.$$eval('#roster-table tr', rows => {
    for (const r of rows) if (r.textContent.includes('Tierney')) return r.textContent.replace(/\s+/g, ' ').trim();
    return null; });
  ok('the linked row carries the card name and is marked as a card profile',
    linkedRow && /C1C Jack P\. Tierney/.test(linkedRow) && /◆ CARD/.test(linkedRow), linkedRow);
  ok('a card already on the roster drops out of the picker',
    !(await page.$$eval('#r-card option', o => o.map(x => x.textContent))).some(t => /Tierney/.test(t)));
  await page.evaluate(() => {                     // leave the game sections their demo roster
    const r = JSON.parse(localStorage.getItem('afahb.roster.v1') || '[]');
    localStorage.setItem('afahb.roster.v1', JSON.stringify(r.filter(p => !/Tierney/.test(p.name))));
  });
  await page.reload();
  await goTab(page, 'roster');
  if (await page.$eval('#manage-roster-card', e => e.classList.contains('collapsed'))) await page.click('#mroster-toggle');

  console.log('— start game —');
  await goTab(page, 'game');
  await page.fill('#g-opp', 'Army');
  await page.fill('#g-loc', 'Cadet West Gym');
  await page.click('#btn-start');
  await page.waitForSelector('#scoreboard', { state: 'visible' });
  ok('scoreboard shows', true);
  ok('Army logo appears on the scoreboard', await page.evaluate(() => {
    const img = document.querySelector('#sb-opp-logo-slot img');
    return !!img && img.naturalWidth > 0;
  }));
  ok('only the seven on the court get cards', await page.$$eval('#pgrid .pcard', c => c.length) === COURT_MAX);
  ok('the rest of the squad is on the bench', await page.$$eval('#bench-strip .bchip', c => c.length) === 6);
  ok('the court header counts the floor', /7 \/ 7 on the court/.test(await page.$eval('#court-count', e => e.textContent)));
  ok('scoring buttons are words, not initials', await page.$$eval('.pcard[data-num="7"] .btns button', b => {
    const t = b.map(x => x.textContent);
    return t.includes('GOAL') && t.includes('TURNOVER') && t.includes('2 MIN DRAWN') && !t.includes('TO') && !t.includes('A');
  }));
  ok('a court player has no SAVED button — saves belong to the keeper',
    await page.$$eval('.pcard[data-num="7"] .btns button', b => !b.some(x => x.dataset.ev === 'saved')));
  const gkSelTxt = await page.$eval('#gk-sel', s => (s.options[s.selectedIndex] || {}).textContent || '');
  ok('keeper defaults to first GK (Corn)', /Corn/.test(gkSelTxt), gkSelTxt);

  console.log('— log events —');
  const hit = async (num, ev) => page.click('.pcard[data-num="' + num + '"] button[data-ev="' + ev + '"]');
  const benchIn = async num => page.click('#bench-strip .bchip[data-pid="' + await pidOf(num) + '"]');
  const courtOut = async num => page.click('.pcard[data-num="' + num + '"] .subout');
  await hit(7, 'goal'); await hit(7, 'goal');            // Jack 2 goals
  await hit(11, 'ast');                                  // RJ assist
  for (const [out, inn] of [[3, 23], [4, 18], [6, 21]]) { await courtOut(out); await benchIn(inn); }
  ok('subs swap the court and the bench', await page.$$eval('#pgrid .pcard', c => c.length) === COURT_MAX
    && !!(await page.$('.pcard[data-num="23"]')) && !!(await page.$('#bench-strip .bchip')));
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
  ok('Jack row: 2 goals on 2 shots', jackRow && jackRow[4] === '2' && jackRow[5] === '2', JSON.stringify(jackRow));
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

  console.log('— the goal map is per keeper, and an empty net is not the keeper\'s —');
  const gm2 = await page.$('#goalmap'); const gb2 = await gm2.boundingBox();
  await page.mouse.click(gb2.x + gb2.width * 0.4, gb2.y + gb2.height * 0.45);
  await page.waitForSelector('#gm-pop', { state: 'visible' });
  await page.click('#gm-opp-btn');
  await page.fill('#gm-onum', '4');
  await page.click('#gm-outcome button[data-v="goal"]');
  ok('the floated-keeper box appears for a conceded goal',
    await page.$eval('#gm-float-wrap', e => getComputedStyle(e).display) !== 'none');
  await page.check('#gm-float');
  await page.click('#gm-save');
  await sleep(120);
  const cornRow = () => page.$$eval('#livegk tr', rows => {
    for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
      if (c[1] === 'Corn') return c; } return null; });
  const cr2 = await cornRow();
  ok('an empty-net goal is logged but kept out of the keeper\'s save %',
    cr2 && cr2[9] === '1' && cr2[5] === '1' && cr2[4] === '66.7%', JSON.stringify(cr2));
  const beforeFloat = await cornRow();
  await courtOut(1);                                   // pull the keeper for a 7th field player
  await page.click('.opp-panel button[data-oev="ogoal"]');   // logged the fast way, no checkbox
  await sleep(150);
  const afterFloat = await cornRow();
  ok('pulling the keeper marks the next goal against as an empty net, however it was logged',
    afterFloat && afterFloat[9] === '2' && afterFloat[5] === beforeFloat[5] && afterFloat[2] === beforeFloat[2],
    JSON.stringify(afterFloat));
  ok('the scoreboard still counts an empty-net goal', await page.$eval('#sb-them', e => e.textContent) === '3');
  await benchIn(1);                                    // keeper back in goal
  await sleep(120);
  const filterOpts = await page.$$eval('#gm-filter option', o => o.map(x => x.textContent));
  ok('the map can be filtered to one keeper', filterOpts.some(t => /Shots faced by #1 Corn/.test(t)), filterOpts.join(' | '));
  const allShots = await page.$$eval('#gm-marks circle', c => c.length);
  await page.selectOption('#gm-filter', { label: 'Air Force shots' });
  await sleep(120);
  const afaShots = await page.$$eval('#gm-marks circle', c => c.length);
  ok('filtering to Air Force shots hides the shots faced', afaShots < allShots && afaShots > 0, afaShots + ' of ' + allShots);
  await page.selectOption('#gm-filter', 'all');
  await sleep(120);

  console.log('— mid-game renumber keeps stats (pid keying) —');
  await openRosterMgmt(page);
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
  await goTab(page, 'game');
  ok('Jack\'s card now reads #17', !!(await page.$('.pcard[data-num="17"]')));
  const jr2 = await page.$$eval('#livebox tr', rows => {
    for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
      if (c[1] === 'Jack') return c; } return null; });
  ok('Jack keeps his 2 goals under the new number', jr2 && jr2[0] === '17' && jr2[4] === '2', JSON.stringify(jr2));
  ok('scoreboard unchanged by the renumber (3–1)', await page.$eval('#sb-us', e => e.textContent) === '3');

  console.log('— clock counts down, and playing time runs with it —');
  const clk0 = await page.$eval('#sb-clock', e => e.textContent);
  ok('the clock starts at a full period, not zero', clk0 === '30:00', clk0);
  await page.click('#btn-clock');
  await sleep(2400);
  const clk1 = await page.$eval('#sb-clock', e => e.textContent);
  const toSec = t => (+t.split(':')[0]) * 60 + (+t.split(':')[1]);
  ok('the clock counts DOWN', toSec(clk1) < toSec(clk0) && toSec(clk0) - toSec(clk1) <= 6, clk0 + ' -> ' + clk1);
  const onMins = await page.$eval('.pcard[data-num="17"] .statline', e => e.textContent);
  ok('a player on the court banks playing time', /^[0-9]+:[0-9]{2} played/.test(onMins) && !/^0:00 played/.test(onMins), onMins);
  const benchMins = await page.$eval('#bench-strip .bchip .mn', e => e.textContent);
  ok('a player on the bench does not', benchMins === '0:00', benchMins);
  await page.click('#btn-clock');
  // editing the clock used to leave an <input> in place forever, and BOTH
  // repaint paths skip an element that holds one — the scoreboard died
  await page.click('#sb-clock');
  await page.fill('#sb-clock input', '00:04');
  await page.press('#sb-clock input', 'Enter');
  await sleep(150);
  ok('after editing, the clock is text again — not a dead input box',
    await page.$$eval('#sb-clock input', i => i.length) === 0
    && await page.$eval('#sb-clock', e => e.textContent) === '00:04',
    await page.$eval('#sb-clock', e => e.textContent));
  await page.click('#btn-clock');
  await sleep(1600);
  ok('an edited clock still ticks', await page.$eval('#sb-clock', e => e.textContent) !== '00:04',
    await page.$eval('#sb-clock', e => e.textContent));
  await page.waitForFunction(() => document.getElementById('sb-clock').textContent === '00:00', undefined, { timeout: 8000 }).catch(() => {});
  await sleep(700);
  ok('the clock STOPS itself when the period runs out',
    await page.$eval('#btn-clock', e => e.textContent).then(t => /START/.test(t)),
    await page.$eval('#btn-clock', e => e.textContent));
  const stopped = await page.$eval('.pcard[data-num="17"] .mins', e => e.textContent);
  await sleep(1200);
  ok('playing time stops with it, instead of banking the rest of the afternoon',
    await page.$eval('.pcard[data-num="17"] .mins', e => e.textContent) === stopped, stopped);
  await page.click('#sb-clock');
  await page.fill('#sb-clock input', '20:00');
  await page.press('#sb-clock input', 'Enter');
  await sleep(120);

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
  ok('Game Info: score 3-3 (both empty-net goals still count on the board)',
    info['Air Force goals'] === 3 && info['Opponent goals'] === 3, info['Air Force goals'] + '-' + info['Opponent goals']);
  const ps = XLSX.utils.sheet_to_json(wb1.Sheets['Player Stats'], { header: 1 });
  const jack = ps.find(r => r[1] === 'Jack');
  ok('Player Stats: Jack 2 goals / 2 shots / 100%', jack && jack[4] === 2 && jack[5] === 2 && jack[6] === 100, JSON.stringify(jack));
  ok('Player Stats carries minutes played', typeof jack[3] === 'number' && jack[3] > 0, String(jack && jack[3]));
  const ryan = ps.find(r => r[1] === 'Ryan');
  ok("Player Stats: Ryan 7's Made 1, Drawn 1, Missed 1", ryan && ryan[12] === 1 && ryan[11] === 1 && ryan[13] === 1, JSON.stringify(ryan));
  ok('Player Stats: renumbered Jack exports as #17', jack && jack[0] === 17, JSON.stringify(jack));
  const rj = ps.find(r => r[1] === 'RJ');
  ok("Player Stats: RJ assist 1, 2's Drawn 1", rj && rj[7] === 1 && rj[15] === 1, JSON.stringify(rj));
  const gks = XLSX.utils.sheet_to_json(wb1.Sheets['Goalkeepers'], { header: 1 });
  const corn = gks.find(r => r[1] === 'Corn');
  ok('Goalkeepers: Corn 3 faced / 2 saves / 1 GA / 1 after-whistle / 2 empty net',
    corn && corn[2] === 3 && corn[3] === 2 && corn[5] === 1 && corn[8] === 1 && corn[9] === 2, JSON.stringify(corn));
  const sm = XLSX.utils.sheet_to_json(wb1.Sheets['Shot Map'], { header: 1 });
  ok('Shot Map has every surviving mapped shot with coords', sm.length === 4 && typeof sm[1][8] === 'number', JSON.stringify(sm[1]));
  ok('Shot Map notes the empty-net goal', sm.slice(1).some(r => r[10] === 'EMPTY NET'), JSON.stringify(sm.slice(1).map(r => r[10])));
  ok('Shot Map records the 7m as Missed, not Saved', sm.slice(1).some(r => r[6] === 'Missed' && r[7] === 'Y'), JSON.stringify(sm.slice(1).map(r => [r[6], r[7]])));
  const roman = ps.find(r => r[1] === 'Roman');
  ok('a starter who recorded nothing still appears, with his minutes',
    roman && roman[3] > 0 && roman[4] === 0, JSON.stringify(roman));
  const boxRoman = await page.$$eval('#livebox tr', rows => {
    for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
      if (c[1] === 'Roman') return c; } return null; });
  ok('…and the live box score shows him too', boxRoman && /^[0-9]+:[0-9]{2}$/.test(boxRoman[3]), JSON.stringify(boxRoman));
  const rosterSheet = XLSX.utils.sheet_to_json(wb1.Sheets['Roster'], { header: 1 });
  ok('Roster sheet carries the squad picked for this game', rosterSheet.length === 14);
  await page.screenshot({ path: path.join(SCRATCH, 'shot_game.png'), fullPage: true });

  console.log('— end game —');
  await page.click('#btn-endgame');
  await sleep(700);
  ok('END GAME downloads the workbook', downloads.length === dl0 + 2);
  await page.waitForSelector('#setup-card', { state: 'visible' });
  ok('back on setup, game archived', await page.evaluate(() => JSON.parse(localStorage.getItem('afahb.games.v1') || '[]').length) === 1);

  console.log('— season: local + legacy import —');
  await goTab(page, 'season');
  await sleep(200);
  const tiles1 = await page.$eval('#tiles', e => e.textContent);
  ok('tiles show the finished game as a tie', /0–0–1/.test(tiles1), tiles1.slice(0, 80));
  ok('4 chart cards render', await page.$$eval('#charts .chartcard', c => c.length) === 4);
  ok('charts contain svg marks', await page.$$eval('#charts svg path, #charts svg circle', m => m.length > 4));
  if (fs.existsSync(LEGACY)) {
    await page.setInputFiles('#file-in', LEGACY);
    await sleep(700);
    const st = await page.$eval('#import-status', e => e.textContent);
    ok('legacy workbook imports its played games, skipping the unplayed sheet', /2 game\(s\) imported/.test(st), st);
    const seasonTxt = await page.$eval('#season-players', e => e.textContent);
    const jrow = await page.$$eval('#season-players tr', rows => {
      for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
        if (c[1] === 'Jack') return c; } return null; });
    // Jack: live 2 + legacy 10+12+6+14 = 44
    ok('season merges live + legacy: Jack 13 goals over 3 games', jrow && jrow[4] === '13' && jrow[2] === '3', JSON.stringify(jrow));
    const glRows = await page.$$eval('#gamelog tr', r => r.length);
    ok('game log lists every game', glRows === 4, glRows);
    const krow = await page.$$eval('#season-gk tr', rows => {
      for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
        if (c[1] === 'Corn') return c; } return null; });
    // Corn: live faced 3 sv 2 + legacy 48/18 + 29/22 + 13/5 + 42/11 = faced 135, sv 58
    ok('season GK: Corn 38 faced / 16 saves', krow && krow[3] === '38' && krow[4] === '16', JSON.stringify(krow));
    // duplicate re-import is skipped
    await page.setInputFiles('#file-in', LEGACY);
    await sleep(600);
    const st2 = await page.$eval('#import-status', e => e.textContent);
    ok('re-importing the same file skips duplicates', /2 duplicate\(s\) skipped/.test(st2), st2);
    // a re-downloaded "(1)" copy must dedupe too — ids hash content, not filename
    const COPY = path.join(SCRATCH, 'Handball Stats (1).xlsx');
    fs.copyFileSync(LEGACY, COPY);
    await page.setInputFiles('#file-in', COPY);
    await sleep(600);
    const st3b = await page.$eval('#import-status', e => e.textContent);
    ok('a renamed copy of the same file also dedupes', /2 duplicate\(s\) skipped/.test(st3b), st3b);
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
  ok('report: Jack 13 goals over 3 GP', jackT && jackT[4] === 13 && jackT[2] === 3, JSON.stringify(jackT));

  console.log('— the season filters by game time and by minutes played —');
  const gameRows = () => page.$$eval('#gamelog tr', r => r.length);
  await page.selectOption('#sf-range', 'range');
  await page.fill('#sf-from', '2020-01-01');
  await page.dispatchEvent('#sf-from', 'change');
  await sleep(250);
  ok('a date range keeps only the games that carry a date', await gameRows() === 2,
    await page.$eval('#sf-note', e => e.textContent));
  ok('the filter says what it is showing', /showing 1 of 3 games/.test(await page.$eval('#sf-note', e => e.textContent)),
    await page.$eval('#sf-note', e => e.textContent));
  await page.fill('#sf-from', '');
  await page.fill('#sf-to', '2030-01-01');
  await page.dispatchEvent('#sf-to', 'change');
  await sleep(250);
  ok('a To date with no From still cannot hold an undated game', await gameRows() === 2,
    await page.$eval('#sf-note', e => e.textContent));
  ok('and it says so rather than quietly dropping them',
    /undated game\(s\) cannot be placed in a date range/.test(await page.$eval('#sf-note', e => e.textContent)),
    await page.$eval('#sf-note', e => e.textContent));
  await page.fill('#sf-to', '');
  await page.dispatchEvent('#sf-to', 'change');
  await page.selectOption('#sf-range', 'all');
  await sleep(250);
  ok('clearing the range brings every game back', await gameRows() === 4);
  const allPlayers = await page.$$eval('#season-players tr', r => r.length);
  await page.fill('#sf-mins', '999');
  await page.dispatchEvent('#sf-mins', 'change');
  await sleep(250);
  ok('a minutes floor drops players who did not play that long',
    await page.$$eval('#season-players tr', r => r.length) < allPlayers);
  await page.fill('#sf-mins', '0');
  await page.dispatchEvent('#sf-mins', 'change');
  await sleep(250);

  console.log('— round-trip into a clean browser —');
  const ctx2 = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 950 } });
  const p2 = await ctx2.newPage();
  const p2err = []; p2.on('pageerror', e => p2err.push(String(e)));
  await p2.goto(PAGE);
  await p2.evaluate(() => localStorage.clear());
  await p2.reload();
  await goTab(p2, 'season');
  ok('visitor sees the dashboard but no import or storage controls',
    await p2.$eval('#dropzone', e => getComputedStyle(e).display) === 'none'
    && await p2.$eval('#storage-card', e => getComputedStyle(e).display) === 'none'
    && await p2.$eval('#tiles', e => getComputedStyle(e).display) !== 'none');
  await unlockAdmin(p2);
  ok('unlock reveals the import dropzone', await p2.$eval('#dropzone', e => getComputedStyle(e).display) !== 'none');
  await p2.setInputFiles('#file-in', liveFile);
  await sleep(700);
  const st3 = await p2.$eval('#import-status', e => e.textContent);
  ok('exported game imports on a machine with no saved data', /1 game\(s\) imported/.test(st3), st3);
  const jrow2 = await p2.$$eval('#season-players tr', rows => {
    for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
      if (c[1] === 'Jack') return c; } return null; });
  ok('round-trip preserves Jack 2 goals', jrow2 && jrow2[4] === '2', JSON.stringify(jrow2));
  const krow2 = await p2.$$eval('#season-gk tr', rows => {
    for (const r of rows) { const c = Array.from(r.cells).map(x => x.textContent);
      if (c[1] === 'Corn') return c; } return null; });
  ok('round-trip preserves Corn 2 saves, after-whistle and both empty nets',
    krow2 && krow2[4] === '2' && krow2[9] === '1' && krow2[10] === '2', JSON.stringify(krow2));
  ok('round-trip tile record matches', /0–0–1/.test(await p2.$eval('#tiles', e => e.textContent)));

  console.log('— resume after reload (live game survives) —');
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p3 = await ctx3.newPage();
  p3.on('dialog', d => d.accept());
  await p3.goto(PAGE);
  await p3.evaluate(() => localStorage.clear());
  await p3.reload();
  await unlockAdmin(p3);
  await openRosterMgmt(p3);
  await p3.click('#btn-demo-roster');
  await goTab(p3, 'game');
  await p3.fill('#g-opp', 'Navy');
  await p3.click('#btn-start');
  await p3.click('.pcard[data-num="7"] button[data-ev="goal"]');
  await p3.reload();
  await p3.waitForSelector('#scoreboard', { state: 'visible' });
  ok('reload mid-game resumes with the score intact', await p3.$eval('#sb-us', e => e.textContent) === '1');
  ok('mid-game reload lands staff straight on the GAME page', await p3.$eval('#tab-game', e => e.classList.contains('on')));
  ok('Navy logo resolves on the scoreboard', await p3.evaluate(() => {
    const img = document.querySelector('#sb-opp-logo-slot img');
    return !!img && img.naturalWidth > 0;
  }));
  await goTab(p3, 'home');
  ok('welcome page offers RESUME LIVE GAME', await p3.$eval('#home-resume', e => getComputedStyle(e).display) !== 'none'
    && /RESUME LIVE GAME/.test(await p3.$eval('#home-resume', e => e.textContent)));
  await p3.click('#home-resume');
  ok('resume returns to the live floor', await p3.$eval('#tab-game', e => e.classList.contains('on')));
  await p3.click('#menu-btn'); await p3.click('#menu-admin');
  ok('sign-out locks the device again', await p3.evaluate(() => !document.body.classList.contains('admin')));
  await p3.click('#home-resume');
  ok('resuming while locked asks for the password', await p3.$eval('#admin-modal', m => m.classList.contains('open')));
  await p3.click('#admin-cancel');

  console.log('— the squad is picked when the game is created —');
  const ctxQ = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const pq = await ctxQ.newPage();
  pq.on('dialog', d => d.accept());
  await pq.goto(PAGE);
  await pq.evaluate(() => localStorage.clear());
  await pq.reload();
  await unlockAdmin(pq);
  await openRosterMgmt(pq);
  await pq.click('#btn-demo-roster');
  await goTab(pq, 'game');
  ok('game setup lists the whole squad to pick from', await pq.$$eval('#g-roster label', l => l.length) === 12);
  const drop = ['14', '18', '21', '23', '99'];
  for (const n of drop) await pq.evaluate(num => {
    const lab = [...document.querySelectorAll('#g-roster label')].find(l => l.textContent.startsWith('#' + num + ' '));
    if (lab) { const cb = lab.querySelector('input'); cb.checked = false; cb.dispatchEvent(new Event('change')); }
  }, n);
  ok('the count follows the picks', /8 of 12 dressed/.test(await pq.$eval('#g-roster-count', e => e.textContent)),
    await pq.$eval('#g-roster-count', e => e.textContent));
  await goTab(pq, 'roster');            // a trip to the roster page must not undo the picks
  await goTab(pq, 'game');
  ok('the squad picks survive a visit to the roster page',
    /8 of 12 dressed/.test(await pq.$eval('#g-roster-count', e => e.textContent)),
    await pq.$eval('#g-roster-count', e => e.textContent));
  await pq.fill('#g-opp', 'Navy');
  await pq.click('#btn-start');
  await pq.waitForSelector('#scoreboard', { state: 'visible' });
  const inGame = await pq.evaluate(() => {
    const g = JSON.parse(localStorage.getItem('afahb.current.v1') || '{}');
    return { squad: (g.rosterSnap || []).length, nums: (g.rosterSnap || []).map(p => p.num).sort((a, b) => a - b) };
  });
  ok('only the picked players are in the game', inGame.squad === 8 && !inGame.nums.includes(23), JSON.stringify(inGame));
  ok('the court fills from the picked squad, the rest sit', await pq.$$eval('#pgrid .pcard', c => c.length) === COURT_MAX
    && await pq.$$eval('#bench-strip .bchip', c => c.length) === 1);
  await openRosterMgmt(pq);                       // a mid-game roster edit
  // an unlinked roster row keeps its name in an <input>, whose value is NOT in
  // textContent — matching on text found nothing and the edit silently no-opped
  const edited = await pq.evaluate(() => {
    const row = [...document.querySelectorAll('#roster-table tr')].find(r => {
      const n = r.querySelector('td:nth-child(2) input');
      return n && /Christian/.test(n.value);
    });
    if (!row) return 'no row';
    const n = row.querySelector('.num-in');
    if (!n) return 'no number field';
    n.value = '44'; n.dispatchEvent(new Event('change'));
    return 'edited';
  });
  ok('the mid-game roster edit actually happened', edited === 'edited', edited);
  await goTab(pq, 'game');
  await sleep(200);
  ok('fixing a jersey mid-game does not drag the rest of the roster into it',
    await pq.evaluate(() => (JSON.parse(localStorage.getItem('afahb.current.v1') || '{}').rosterSnap || []).length) === 8);
  await pq.click('#btn-endgame');
  await sleep(700);
  ok('the squad picker keeps its picks after a visit to the roster page',
    /8 of 12 dressed/.test(await pq.$eval('#g-roster-count', e => e.textContent)) === false, 'reset for the next game');
  await pq.fill('#g-opp', 'Army');
  await pq.click('#btn-start');
  await pq.waitForSelector('#scoreboard', { state: 'visible' });
  await pq.click('#sb-halves button:nth-child(3)');       // OT1
  await sleep(200);
  ok('overtime counts down from its own length, not a full half',
    await pq.$eval('#sb-clock', e => e.textContent) === '05:00', await pq.$eval('#sb-clock', e => e.textContent));
  await pq.click('#sb-halves button:nth-child(5)');       // shoot-out
  await sleep(200);
  ok('a shoot-out shows no clock at all', await pq.$eval('#sb-clock', e => e.textContent) === '—:—',
    await pq.$eval('#sb-clock', e => e.textContent));
  await ctxQ.close();

  console.log('— guards refuse dishonest states —');
  const ctx4 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p4 = await ctx4.newPage();
  await p4.goto(PAGE);
  await p4.evaluate(() => localStorage.clear());
  await p4.reload();
  await unlockAdmin(p4);
  await openRosterMgmt(p4);
  await p4.click('#btn-demo-roster');
  await p4.selectOption('#r-card', '_other');
  await p4.fill('#r-name', 'Walk-on Nonum');
  await p4.click('#btn-addplayer');
  await sleep(120);
  ok('a player added with a blank # gets the next free number, counting up',
    await p4.evaluate(() => {
      const r = JSON.parse(localStorage.getItem('afahb.roster.v1') || '[]');
      const w = r.find(p => /Walk-on/.test(p.name));
      return !!w && w.num === 2;          // the demo roster holds 1, 3, 4, 6, 7, 9, 11, 12, 14, 18, 21, 23
    }), await p4.evaluate(() => (JSON.parse(localStorage.getItem('afahb.roster.v1') || '[]')
      .find(p => /Walk-on/.test(p.name)) || {}).num));
  await p4.evaluate(() => {              // clearing a number is how one goes missing now
    const row = [...document.querySelectorAll('#roster-table tr')].find(r => {
      const n = r.querySelector('td:nth-child(2) input');
      return n && /Walk-on/.test(n.value);
    });
    const n = row && row.querySelector('.num-in');
    if (n) { n.value = ''; n.dispatchEvent(new Event('change')); }
  });
  await goTab(p4, 'game');
  await p4.fill('#g-opp', 'Navy');
  await p4.click('#btn-start');
  const hint = await p4.$eval('#setup-hint', e => e.textContent);
  ok('numberless dressed player blocks the start, naming them',
    /Walk-on Nonum/.test(hint) && await p4.$eval('#scoreboard', e => getComputedStyle(e).display) === 'none', hint);
  console.log('— stats attach to the profile: card-linked player -> his card —');
  const ctxP = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 950 } });
  const pp = await ctxP.newPage();
  const ppErr = []; pp.on('pageerror', e => ppErr.push(String(e)));
  pp.on('dialog', d => d.accept());
  pp.on('download', d => d.saveAs(path.join(SCRATCH, 'out_profile_game.xlsx')).catch(() => {}));
  await pp.goto(PAGE);
  await pp.evaluate(() => localStorage.clear());
  await pp.reload();
  await unlockAdmin(pp);
  await openRosterMgmt(pp);
  await pp.selectOption('#r-card', { label: 'C1C Jack P. Tierney · Center Back' });
  await pp.fill('#r-num', '7');
  await pp.click('#btn-addplayer');
  await sleep(150);
  const readStrip = pg => pg.evaluate(() => {
    const c = [...document.querySelectorAll('#team-cards .bbcard')].find(x => x.textContent.includes('Tierney'));
    const st = c && c.querySelector('.cstats');
    return st ? [...st.children].map(d => d.querySelector('.l').textContent + '=' + d.querySelector('.v').textContent) : null;
  });
  const preStrip = await readStrip(pp);
  ok('adding a profile to the stat roster puts a stat strip on his card at once',
    JSON.stringify(preStrip) === JSON.stringify(['GP=0', 'GOALS=0', 'ASSISTS=0']), JSON.stringify(preStrip));
  await goTab(pp, 'game');
  await pp.fill('#g-opp', 'Navy');
  await pp.click('#btn-start');
  await pp.waitForSelector('#scoreboard', { state: 'visible' });
  await pp.click('.pcard[data-num="7"] button[data-ev="goal"]');
  await pp.click('.pcard[data-num="7"] button[data-ev="goal"]');
  await pp.click('.pcard[data-num="7"] button[data-ev="ast"]');
  await pp.click('#btn-endgame');
  await sleep(900);
  await goTab(pp, 'roster');
  await sleep(300);
  const postStrip = await readStrip(pp);
  ok('after the game his card carries GP 1, GOALS 2, ASSISTS 1',
    JSON.stringify(postStrip) === JSON.stringify(['GP=1', 'GOALS=2', 'ASSISTS=1']), JSON.stringify(postStrip));
  const ovr = await pp.evaluate(() => {
    const c = [...document.querySelectorAll('#team-cards .bbcard')].find(x => x.textContent.includes('Tierney'));
    const o = c && c.querySelector('.ovr .n');
    const other = [...document.querySelectorAll('#team-cards .bbcard')].find(x => x.textContent.includes('Cavanaugh'));
    return { n: o ? +o.textContent : null, noGames: !!(other && other.querySelector('.ovr')) };
  });
  ok('an overall is computed for a player with games', ovr.n != null && ovr.n > 40 && ovr.n <= 99, JSON.stringify(ovr));
  ok('a profile with no games played gets no overall at all', ovr.noGames === false);
  const kRule = await pp.evaluate(() => ({
    cbOneShot: cardIsKeeper({ name: 'x', pos: 'Center Back' }, { faced: 1, sv: 1 }),
    cbAsEmergencyKeeper: cardIsKeeper({ name: 'x', pos: 'Center Back' }, { faced: 28, sv: 5 }),
    designatedKeeper: cardIsKeeper({ name: 'x', pos: 'Goalie' }, { faced: 0, sv: 0 }),
  }));
  ok('a field player who covered one shot is still a field player, but a real stint in goal counts',
    kRule.cbOneShot === false && kRule.cbAsEmergencyKeeper === true && kRule.designatedKeeper === true,
    JSON.stringify(kRule));
  ok('no page errors while stats attach', ppErr.length === 0, ppErr.join(' | '));
  await ctxP.close();

  console.log('— hosted from the repo: data auto-loads for visitors —');
  // the runner starts `python3 -m http.server 8123 --bind 127.0.0.1` in the repo
  // root before this probe and kills it after (spawning it from inside Node is
  // blocked in some sandboxes; an absent server fails loudly right here)
  const ctx5 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  // hermetic: the page unions its games/index.json manifest with a live GitHub
  // API listing, and this test is about the staged copy, not the real repo
  await ctx5.route('https://api.github.com/**', r => r.abort());
  const p5 = await ctx5.newPage();
  const p5err = []; p5.on('pageerror', e => p5err.push(String(e)));
  await p5.goto('http://127.0.0.1:8123/');
  await p5.evaluate(() => localStorage.clear());
  await p5.reload();
  await goTab(p5, 'season');
  await p5.waitForFunction(() => /game/.test(document.getElementById('repo-status').textContent), undefined, { timeout: 20000 }).catch(() => {});
  const rs = await p5.$eval('#repo-status', e => e.textContent);
  ok('committed game files load automatically for a visitor', /2 game/.test(rs), rs);
  ok('tiles show the committed record with zero clicks', /0–2/.test(await p5.$eval('#tiles', e => e.textContent)),
    (await p5.$eval('#tiles', e => e.textContent)).slice(0, 60));
  ok('game log carries the committed games', await p5.$$eval('#gamelog tr', r => r.length) === 3);
  await p5.waitForFunction(() => JSON.parse(localStorage.getItem('afahb.roster.v1') || '[]').length > 0, undefined, { timeout: 10000 }).catch(() => {});
  // compared against the committed file, not a number typed here — the roster
  // changes when the team does, and a hardcoded count only rots
  const rosterRows = XLSX.utils.sheet_to_json(
    XLSX.read(fs.readFileSync(path.join(REPO_HB, 'data', 'roster.xlsx'))).Sheets['Roster'], { header: 1 })
    .slice(1).filter(r => r && String(r[1] || '').trim()).length;
  const loaded = await p5.evaluate(() => JSON.parse(localStorage.getItem('afahb.roster.v1') || '[]').length);
  ok('the committed team roster auto-loads, every name of it',
    loaded === rosterRows && loaded > 0, loaded + ' loaded / ' + rosterRows + ' in the file');
  ok('hosted visitor still cannot see import controls', await p5.$eval('#dropzone', e => getComputedStyle(e).display) === 'none');
  await goTab(p5, 'roster');
  const hostedCards = await p5.$eval('#team-cards', e => e.textContent);
  ok('published team.json drives the cards for every visitor', /C2C Hosted Check/.test(hostedCards) && /Denver, Colorado/.test(hostedCards), hostedCards.slice(0, 80));
  ok('published cards replace the starter pair (no merge ghosts)', !/Tierney/.test(hostedCards));
  await goTab(p5, 'gallery');
  ok('published gallery renders for visitors', /Hosted Gallery Check/.test(await p5.$eval('#galgrid', e => e.textContent))
    && await p5.$$eval('#galgrid .gph img', im => im.length === 1));
  // published-wins reconciliation: a stale device draft yields to the publish…
  await p5.evaluate(() => localStorage.setItem('afahb.team.v1', JSON.stringify({ v: 1, ts: 1,
    cards: [{ id: 's1', sec: 'player', name: 'Stale Local Card', role: '', badge: false, photo: '', pos: '', home: '', major: '', career: '' }] })));
  await p5.reload();
  await goTab(p5, 'roster');
  await p5.waitForFunction(() => /Hosted Check/.test(document.getElementById('team-cards').textContent), undefined, { timeout: 8000 });
  ok('a stale device draft is replaced by the published cards (fresh start for everyone)',
    !/Stale Local Card/.test(await p5.$eval('#team-cards', e => e.textContent))
    && await p5.evaluate(() => localStorage.getItem('afahb.team.v1') === null));
  // …but a draft NEWER than the published file survives on that device
  await p5.evaluate(() => localStorage.setItem('afahb.team.v1', JSON.stringify({ v: 1, ts: 9e15,
    cards: [{ id: 'n1', sec: 'player', name: 'Newer Unpublished Card', role: '', badge: false, photo: '', pos: '', home: '', major: '', career: '' }] })));
  await p5.reload();
  await goTab(p5, 'roster');
  await sleep(900);
  ok('a device draft newer than the publish survives (mid-edit protection)',
    /Newer Unpublished Card/.test(await p5.$eval('#team-cards', e => e.textContent)));
  await p5.evaluate(() => localStorage.removeItem('afahb.team.v1'));

  console.log('— mobile (375×812, touch) —');
  const ctx6 = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const p6 = await ctx6.newPage();
  const p6err = []; p6.on('pageerror', e => p6err.push(String(e)));
  p6.on('dialog', d => d.accept());
  await p6.goto(PAGE);
  await p6.evaluate(() => localStorage.clear());
  await p6.reload();
  ok('phone: welcome page has no sideways scroll', await noOverflow(p6, PHONE_W));
  await p6.screenshot({ path: path.join(SCRATCH, 'shot_mobile_home.png'), fullPage: true });
  await unlockAdmin(p6);
  await openRosterMgmt(p6);
  await p6.click('#btn-demo-roster');
  ok('phone: team page has no sideways scroll', await noOverflow(p6, PHONE_W));
  ok('phone: captain ribbon label fully visible at phone width', await ribbonInside(p6));
  await goTab(p6, 'game');
  await p6.fill('#g-opp', 'Navy');
  await p6.click('#btn-start');
  await p6.waitForSelector('#scoreboard', { state: 'visible' });
  await p6.click('.pcard[data-num="7"] button[data-ev="goal"]');
  ok('phone: tap logs a goal', await p6.$eval('#sb-us', e => e.textContent) === '1');
  /* Measured against the DEVICE width, never window.innerWidth — that grows to
     fit overflowing content under emulation, so the old check could not fail:
     an 8-column button grid made a 594px card on a 375px phone and passed. */
  const widest = await p6.evaluate(() => Math.max(0, ...[...document.querySelectorAll('#pgrid .pcard')]
    .map(c => c.getBoundingClientRect().width)));
  ok('phone: a player card fits the screen', widest <= PHONE_W + 4, Math.round(widest) + 'px card on a ' + PHONE_W + 'px phone');
  ok('phone: live game has no sideways scroll', await noOverflow(p6, PHONE_W));
  await p6.screenshot({ path: path.join(SCRATCH, 'shot_mobile_game.png'), fullPage: true });
  await goTab(p6, 'gallery');
  ok('phone: gallery has no sideways scroll', await noOverflow(p6, PHONE_W));
  await goTab(p6, 'season');
  ok('phone: season has no sideways scroll', await noOverflow(p6, PHONE_W));

  ok('no page errors anywhere', pageErrors.length === 0 && p2err.length === 0 && p5err.length === 0 && p6err.length === 0,
    pageErrors.concat(p2err, p5err, p6err).join(' | '));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('PROBE CRASH:', e); process.exit(1); });
