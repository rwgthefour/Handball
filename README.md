# USAFA Team Handball — Stat Tracker

One self-contained page — **index.html** — for tracking Air Force Academy team
handball: live game logging, a tap-on-goal shot map, an Excel workbook exported
per game, and season imports with tables and charts. Works fully offline;
nothing is ever uploaded — each browser keeps its own saved games, and the
exported .xlsx files are how data moves between people.

## Hosting
Static host, no build step. On Netlify: **Add new site → Import an existing
project → this repo**, leave the build command empty, publish directory = repo
root. Every push then deploys automatically.

## Editing
The page is generated — do not hand-edit index.html.
1. Edit `src/part_head.html` (markup/CSS), `src/part_core.js` (engine),
   `src/part_xlsx.js` (Excel in/out), or `src/part_charts.js` (charts/season).
2. `python3 src/build.py` — rewrites index.html.
3. `node src/probe_handball.js` — 60 end-to-end assertions in real Chrome
   (drives the page, captures and parses the actual Excel downloads, round-trips
   them). Uses the Playwright install from the ApolloDagger repo on this machine.

Events are the single source of truth and are keyed by a stable player id
(pid), never by jersey number — see the header comments in src/part_core.js.
SheetJS (Apache-2.0) is embedded; the source copy is src/xlsx.full.min.js.
