#!/usr/bin/env bash
# Copies the latest bot-written files from the showcase-data branch into the
# working tree, so a run starts from the previous reading (Rising is stars
# gained since the last one) instead of the stale copy on main.
#
#   scripts/pull-data.sh data/github.json data/visits.json
set -euo pipefail
if ! git fetch -q origin showcase-data:refs/remotes/origin/showcase-data 2>/dev/null; then
  echo "no showcase-data branch yet, starting from the copies on main"; exit 0
fi
for f in "$@"; do
  if git cat-file -e "origin/showcase-data:$f" 2>/dev/null; then
    mkdir -p "$(dirname "$f")"; git show "origin/showcase-data:$f" > "$f"; echo "pulled $f"
  fi
done
