#!/usr/bin/env node
// Refreshes data/github.json: stars, last push and language for every repo in
// data/projects.yaml, read from the GitHub API.
//
//   GITHUB_TOKEN=... node scripts/github-meta.mjs   (what the showcase workflow runs)
//   node scripts/github-meta.mjs                     (falls back to `gh api`, logged in)
//
// The file is what monid.ai/built-with ranks its leaderboard on, so it keeps
// ONE previous reading per repo: when a repo's last reading is six or more
// days old it rolls into `prev` before the new one is written. "Rising" on
// the showcase is stars minus prev.stars over that window. Nothing else is
// kept, a curated list is not a metrics store.
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

async function read(repo) {
  if (token) {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'awesome-monid', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    return res.json();
  }
  try {
    return JSON.parse(execFileSync('gh', ['api', `repos/${repo}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
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
    pushed: (r.pushed_at || '').slice(0, 10),
    lang: r.language || '',
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
