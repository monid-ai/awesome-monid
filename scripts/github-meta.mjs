#!/usr/bin/env node
// Refreshes data/github.json: stars, last push and language for every repo in
// data/projects.yaml, read from the GitHub API.
//
//   GITHUB_TOKEN=... node scripts/github-meta.mjs   (what the showcase workflow runs)
//   node scripts/github-meta.mjs                     (falls back to `gh api`, logged in)
//
// The file is what monid.ai/built-with ranks its leaderboard on:
//   stars        the vote ("Most starred")
//   commits30d   commits on the default branch in the last 30 days (read but not
//                ranked on: a "Most active" tab was tried and dropped, commits
//                say nothing about use)
//   prev.stars   ONE previous reading per repo, rolled when the last reading is
//                six or more days old; "Rising" is stars minus prev.stars
// Nothing else is kept, a curated list is not a metrics store. Visits from
// the showcase page itself live in data/visits.json (see visits()).
//
// Zero dependencies on purpose, same as build.mjs.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/github.json');
const ROLL_DAYS = 6;

const repos = [...new Set(
  readFileSync(join(ROOT, 'data/projects.yaml'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s+repo:\s*"?([\w.-]+\/[\w.-]+)"?\s*$/))
    .filter(Boolean)
    .map((m) => m[1]),
)];

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

async function api(path) {
  if (token) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'awesome-monid', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    return res.json();
  }
  try {
    return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

const read = (repo) => api(`/repos/${repo}`);

// Commits in the last 30 days, capped at 100 (one page): past that the
// number stops meaning anything on a leaderboard of mostly small repos.
async function commits30d(repo) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const list = await api(`/repos/${repo}/commits?since=${since}&per_page=100`);
  return Array.isArray(list) ? list.length : null;
}

const prior = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const today = new Date().toISOString().slice(0, 10);
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const next = {};
let missing = 0;

for (const repo of repos) {
  const r = await read(repo);
  const old = prior[repo];
  if (!r) {
    // A 404 today should not erase last week's numbers; keep what we had and
    // say so. The link checker is what decides whether the entry comes down.
    if (old) next[repo] = { ...old, missing: true };
    missing++;
    continue;
  }
  const entry = {
    stars: r.stargazers_count,
    forks: r.forks_count,
    commits30d: await commits30d(repo),
    pushed: (r.pushed_at || '').slice(0, 10),
    lang: r.language || '',
    // The owner's avatar as a direct avatars.githubusercontent.com URL: it
    // answers with CORS *, so the showcase can draw it on a canvas. The
    // github.com/<login>.png shortcut redirects first and cannot be used.
    avatar: (r.owner && r.owner.avatar_url) || '',
    checked: today,
  };
  if (old && old.checked && !old.missing && days(old.checked, today) >= ROLL_DAYS) {
    entry.prev = { stars: old.stars, checked: old.checked };
  } else if (old && old.prev) {
    entry.prev = old.prev;
  }
  next[repo] = entry;
}

writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n');
console.log(`data/github.json: ${Object.keys(next).length} repos read, ${missing} not found.`);

// ── Visits from the showcase page ────────────────────────────────────
// monid.ai/built-with fires a PostHog event `built_with_project_click`
// (property `project_id`) whenever a reader opens a project from the page.
// With POSTHOG_API_KEY (+ POSTHOG_PROJECT_ID) set, the last seven days of
// those clicks are written to data/visits.json; without the key the file
// is left alone and the showcase hides its "Most visited" tab.
async function visits() {
  const key = process.env.POSTHOG_API_KEY;
  const project = process.env.POSTHOG_PROJECT_ID;
  if (!key || !project) return;
  const host = process.env.POSTHOG_HOST || 'https://us.posthog.com';
  const query =
    "SELECT properties.project_id AS id, count() AS n FROM events " +
    "WHERE event = 'built_with_project_click' AND timestamp > now() - INTERVAL 7 DAY " +
    "GROUP BY id ORDER BY n DESC LIMIT 500";
  const res = await fetch(`${host}/api/projects/${project}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!res.ok) {
    console.error(`visits: PostHog answered ${res.status}, data/visits.json left as is.`);
    return;
  }
  const data = await res.json();
  const out = { checked: today, days: 7, visits: {} };
  for (const [id, n] of data.results || []) if (id) out.visits[id] = n;
  writeFileSync(join(ROOT, 'data/visits.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`data/visits.json: ${Object.keys(out.visits).length} projects visited in the last 7 days.`);
}
await visits();
