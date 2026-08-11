#!/usr/bin/env python3
"""Assemble the USAFA handball tracker page from the part files (idempotent).

- Embeds SheetJS, the logos, and every portrait found in ROOT/photos/
  (key = lowercased filename without extension; used by TEAM_PAGE cards).
- Regenerates ROOT/games/index.json — the manifest the hosted site uses to
  auto-load committed game workbooks for every visitor.
- Writes ROOT/index.html.

ROOT is the folder above this script (the repo root)."""
import base64, io, json, os

D = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(D)
def rd(p): return open(os.path.join(D, p), encoding='utf-8').read()

head, core, xlsxjs, charts = rd('part_head.html'), rd('part_core.js'), rd('part_xlsx.js'), rd('part_charts.js')
lib = rd('xlsx.full.min.js')
logos = json.load(open(os.path.join(D, 'logos.json')))

# ---- photos/ -> data URIs (downscaled when Pillow is available) ----
photos = {}
pdir = os.path.join(ROOT, 'photos')
if os.path.isdir(pdir):
    for f in sorted(os.listdir(pdir)):
        ext = f.lower().rsplit('.', 1)[-1] if '.' in f else ''
        if ext not in ('jpg', 'jpeg', 'png', 'webp'):
            continue
        key = f.rsplit('.', 1)[0].lower()
        raw = open(os.path.join(pdir, f), 'rb').read()
        mime = {'png': 'image/png', 'webp': 'image/webp'}.get(ext, 'image/jpeg')
        try:
            from PIL import Image
            im = Image.open(io.BytesIO(raw)).convert('RGB')
            im.thumbnail((480, 640), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, 'JPEG', quality=82, optimize=True)
            raw, mime = buf.getvalue(), 'image/jpeg'
        except Exception:
            pass                      # no Pillow — embed the file as-is
        photos[key] = 'data:' + mime + ';base64,' + base64.b64encode(raw).decode()
        print('photo embedded:', key, len(raw), 'bytes')

# ---- games/ -> manifest ----
gdir = os.path.join(ROOT, 'games')
if os.path.isdir(gdir):
    files = sorted(f for f in os.listdir(gdir) if f.lower().endswith(('.xlsx', '.xls')))
    json.dump({'files': files}, open(os.path.join(gdir, 'index.json'), 'w'), indent=1)
    print('games/index.json:', len(files), 'file(s)')

# a literal "</script" inside any inline script would terminate the tag early
def esc(s): return s.replace('</script', '<\\/script')
lib, core, xlsxjs, charts = esc(lib), esc(core), esc(xlsxjs), esc(charts)

out = (head
  + '\n<script>/* SheetJS Community Edition — Apache-2.0 — https://sheetjs.com */\n' + lib + '\n</script>\n'
  + '<script>const LOGOS = ' + json.dumps(logos) + ';\nconst PHOTOS = ' + json.dumps(photos) + ';</script>\n'
  + '<script>\n' + core + '\n</script>\n'
  + '<script>\n' + xlsxjs + '\n</script>\n'
  + '<script>\n' + charts + '\n</script>\n'
  + '</body>\n</html>\n')

path = os.path.join(ROOT, 'index.html')
open(path, 'w', encoding='utf-8').write(out)
print('WROTE', path, os.path.getsize(path), 'bytes')
