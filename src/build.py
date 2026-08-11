#!/usr/bin/env python3
"""Assemble USAFA_Handball_Stats.html from the part files (idempotent)."""
import json, os, re, sys

D = os.path.dirname(os.path.abspath(__file__))
def rd(p): return open(os.path.join(D, p), encoding='utf-8').read()

head, core, xlsxjs, charts = rd('part_head.html'), rd('part_core.js'), rd('part_xlsx.js'), rd('part_charts.js')
lib = rd('xlsx.full.min.js')
logos = json.load(open(os.path.join(D, 'logos.json')))

def esc(s): return s.replace('</script', '<\\/script')
lib, core, xlsxjs, charts = esc(lib), esc(core), esc(xlsxjs), esc(charts)

out = (head
  + '\n<script>/* SheetJS Community Edition — Apache-2.0 — https://sheetjs.com */\n' + lib + '\n</script>\n'
  + '<script>const LOGOS = ' + json.dumps(logos) + ';</script>\n'
  + '<script>\n' + core + '\n</script>\n'
  + '<script>\n' + xlsxjs + '\n</script>\n'
  + '<script>\n' + charts + '\n</script>\n'
  + '</body>\n</html>\n')

dest = os.path.dirname(D)   # the repo root above src/
os.makedirs(dest, exist_ok=True)
path = os.path.join(dest, 'index.html')
open(path, 'w', encoding='utf-8').write(out)
print('WROTE', path, os.path.getsize(path), 'bytes')
