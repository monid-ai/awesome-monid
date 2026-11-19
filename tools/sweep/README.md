# sweep

Every three days `.github/workflows/sweep.yml` runs `node bin/run.mjs` here. It searches GitHub
code for the four Monid markers (`api.monid.ai`, `MONID_API_KEY`, `@monid-ai/cli`, `monid run`),
drops what is already listed, ours, a fork, archived, or graded in the last 60 days, reads the
README and matched fragments of the rest, and asks a model to grade each one against the four
CONTRIBUTING rules and draft its entry. Entries that pass the build script's own validation go
on one branch, `autopr/<date>`, with the README regenerated, as one pull request labelled
`submission`. **Nothing merges on its own**: every entry is `verified: false` until a maintainer
opens the link. An unmerged sweep PR is rebuilt on top of main next time, earlier entries kept.

State (every repo graded, with verdict and date) lives in `data/sweep-state.json` so a rejection
is not re-graded for 60 days and an accepted repo is never proposed twice. The workflow commits
that file back to main when it changes.

Secrets the workflow needs: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (the grader). `GITHUB_TOKEN`
is the workflow's own. `MAX_CANDIDATES` (default 25) caps how many repos are graded per run; the
backlog is picked up on the next one, most recently pushed first.

Local dry run, nothing pushed:

```sh
cd tools/sweep && npm ci
GITHUB_TOKEN=$(gh auth token) ANTHROPIC_API_KEY=... DATA_DIR=../../data/sweep node bin/run.mjs --dry-run
```
