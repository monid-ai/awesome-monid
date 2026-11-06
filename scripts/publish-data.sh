#!/usr/bin/env bash
# Commits the given files, as they are in the working tree, onto the
# showcase-data branch and pushes it. main is protected (every change goes
# through a reviewed pull request), so the files the bots rewrite every few
# days live on this one unprotected branch instead, and the Built with Monid
# page reads data/built-with.json from there.
#
#   scripts/publish-data.sh "<commit message>" data/github.json data/built-with.json
#
# Starts from the branch's current tree, so each caller only touches its own
# files. Creates the branch on the first run. Prints "nothing changed" and
# exits 0 when the files are identical to what is already there.
set -euo pipefail
msg=$1; shift
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git fetch -q origin showcase-data:refs/remotes/origin/showcase-data 2>/dev/null || true
parent=$(git rev-parse -q --verify refs/remotes/origin/showcase-data || true)
GIT_INDEX_FILE=$(mktemp); export GIT_INDEX_FILE
if [ -n "$parent" ]; then git read-tree "$parent"; else git read-tree --empty; fi
for f in "$@"; do
  if [ -f "$f" ]; then git update-index --add "$f"; else echo "skip $f (not in the working tree)"; fi
done
tree=$(git write-tree)
rm -f "$GIT_INDEX_FILE"; unset GIT_INDEX_FILE
if [ -n "$parent" ] && [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
  echo "showcase-data: nothing changed"; exit 0
fi
commit=$(git commit-tree "$tree" ${parent:+-p "$parent"} -m "$msg")
git push -q origin "$commit:refs/heads/showcase-data"
echo "showcase-data: pushed ${commit:0:7}"
