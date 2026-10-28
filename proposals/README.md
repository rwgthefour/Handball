# Site proposals

Three landing-page directions for usafateamhandball.com, each a self-contained
HTML page (portraits, crest and team photo embedded, Google Fonts loaded from
the network). Open `index.html` or go straight to one:

| | File | Direction | Reference style |
|---|---|---|---|
| A | `a-mission-control.html` | **Mission Control** — near-black ground, hairline grid, monospace labels, light display type, bracketed figures, telemetry band | Palantir landing page |
| B | `b-editorial.html` | **Editorial** — white ground, oversized grotesk wordmark + serif italic, numbered chapters, marquee, case-study game cards, editorial roster list | DesignRush "best website designs" |
| C | `c-game-day.html` | **Game Day** — navy and gold, condensed display type with outlined numerals, diagonal cuts, results ticker, floating scoreboard, leaders carousel, keeper's shot map | Dribbble "sports website" |

What is real: the roster, positions, class years, hometowns and majors come
from `data/team.json`; the record (0–2), scores, halftime lines, player and
keeper numbers and the shot-map dots come from the two workbooks in `games/`.
The "Next up" fixture in C is a placeholder — the site has no schedule data.

These pages are proposals, not part of the build: `src/build.py` does not
touch them and they are not linked from `index.html`. Once a direction is
chosen, its markup and CSS move into `src/part_head.html` and the generated
sections (stream, recap, cards, season tables) are restyled to match.

Each page carries a small fixed switcher in the bottom-right corner to jump
between A, B, C and this index.
