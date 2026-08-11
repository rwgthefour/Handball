# USAFA Handball Stat Tracker — source

The deliverable is ../USAFA_Handball_Stats.html — ONE self-contained file
(SheetJS + logos embedded), works offline from anywhere.

Rebuild after editing any part:   python3 build.py
Verify (60 assertions, real Chrome, real downloads):   node probe_handball.js
The probe needs the repo's Playwright (it resolves it and apollo_chrome.js
by absolute path) and reads the legacy workbook from ~/Downloads if present.

Parts: part_head.html (markup+CSS) · part_core.js (engine) ·
part_xlsx.js (Excel in/out) · part_charts.js (charts+season+boot).
Events are the single source of truth and are keyed by stable player id
(pid), never jersey number — see the review notes in each file's header.
