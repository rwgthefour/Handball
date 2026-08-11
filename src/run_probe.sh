#!/bin/bash
# One-command verification: stages a hosted copy of the site (with a test
# team.json), serves it on 127.0.0.1:8123, runs the full probe, tears down.
# Exit 0 = every assertion green.
set -u
cd "$(dirname "$0")"
STAGE="${TMPDIR:-/tmp}/afahb_hosted_stage"
kill $(lsof -ti :8123) 2>/dev/null
node probe_handball.js --prep-hosted "$STAGE" || exit 1
python3 -m http.server 8123 --bind 127.0.0.1 --directory "$STAGE" >/dev/null 2>&1 &
SRV=$!
sleep 1
node probe_handball.js
RC=$?
kill $SRV 2>/dev/null
exit $RC
