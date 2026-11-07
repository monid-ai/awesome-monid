#!/usr/bin/env node
// Generates the entry list in README.md from data/*.yaml.
// Usage:
//   node scripts/build.mjs          rewrite README.md
//   node scripts/build.mjs --check  fail if README.md is out of date (CI)
//
// Zero dependencies on purpose: a contributor can run this with a bare Node.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const BEGIN = '<!-- BEGIN GENERATED -->';
const END = '<!-- END GENERATED -->';

/* ------------------------------------------------------------------ *
 * Minimal YAML reader for the one shape we use: a list of flat maps.  *
 * Supports: "- key: value", "  key: value", [a, b], "quoted \uXXXX",  *
 * true/false, and whole-line # comments. Anything fancier is a bug    *
 * in the data file, not a missing feature here.                       *
 * ------------------------------------------------------------------ */
function parseList(text, file) {
  const out = [];
  let cur = null;
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) return;

    const at = (msg) => `${file}:${i + 1}: ${msg}`;
    let body = line;

    if (/^- /.test(line)) {
      cur = {};
      out.push(cur);
      body = line.slice(2);
    } else if (/^\s+\S/.test(line)) {
      if (!cur) throw new Error(at('key outside of any list item'));
      body = line.trim();
    } else {
      throw new Error(at(`cannot parse: ${line}`));
    }

    const m = body.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) throw new Error(at(`expected "key: value", got: ${body}`));
    const [, key, rawValue] = m;
    if (key in cur) throw new Error(at(`duplicate key "${key}"`));
    cur[key] = parseScalar(rawValue, at);
  });

  return out;
}

function parseScalar(v, at) {
  const s = v.trim();
  if (s === '') return '';
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw new Error(at('unterminated inline list'));
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((x) => parseScalar(x, at));
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('"') && s.endsWith('"') && s.length > 1) return unescape(s.slice(1, -1));
  if (s.startsWith("'") && s.endsWith("'") && s.length > 1) return s.slice(1, -1);
  return s;
}

function unescape(s) {
  return s
    .replace(/\\U([0-9A-Fa-f]{8})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/* ------------------------------------------------------------------ *
 * Legend                                                              *
 * ------------------------------------------------------------------ */
// Metadata is set in backticks rather than emoji, the way awesome-selfhosted
// does it. An emoji row needs a legend to decode; `hosted` `Python` does not.
// `oss` is deliberately absent: the Source Code link already says it.
const KIND = {
  hosted: 'hosted',
  oss: null,
  skill: 'skill',
  writeup: 'write-up',
};

const LANG = {
  py: 'Python',
  ts: 'TypeScript',
  go: 'Go',
  rust: 'Rust',
  other: null,
};

// How we know this project uses Monid. Recorded per entry so a curated list
// stays auditable: anyone can re-check the claim without asking us.
const EVIDENCE = {
  'api-url': 'api.monid.ai found in the source',
  'api-key': 'MONID_API_KEY found in the source',
  'cli-package': '@monid-ai/cli installed by the project',
  'cli-command': 'a monid CLI command is part of the documented workflow',
  'rest-v1': 'a REST v1 path is called directly',
  'readme-link': 'only a link to monid.ai, not yet confirmed in code',
  'author-stated': 'the author states it, not visible in public source',
};

/* ------------------------------------------------------------------ *
 * Validation                                                          *
 * ------------------------------------------------------------------ */
function hostOf(u) {
  try { return new URL(u).host.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

// data/blocklist.yaml: competing registries and the like. Match on repo or url host.
function blockedBy(blocklist, p) {
  const repo = String(p.repo || '').toLowerCase();
  const host = hostOf(p.url);
  return blocklist.find((b) =>
    (b.repo && repo && String(b.repo).toLowerCase() === repo) ||
    (b.url && host && hostOf(b.url) === host)) || null;
}

function validate(projects, categories, blocklist = []) {
  const errors = [];
  const ids = new Set();
  const catIds = new Set(categories.map((c) => c.id));
  const required = [
    'id', 'name', 'url', 'author', 'category', 'kind',
    'description', 'added', 'evidence',
  ];
  // Outside developers, with a short allowlist of our own work that the
  // maintainer decided belongs here anyway.
  const OURS = /^(monid-ai|Jasper0122|shengkun-ye)\//i;
  const ALLOWED = new Set(['jasper0122/agent-seo-kit']);

  for (const p of projects) {
    const where = p.id || p.name || '(unnamed entry)';
    const bad = (msg) => errors.push(`${where}: ${msg}`);

    for (const f of required) {
      if (p[f] === undefined || p[f] === '' || (Array.isArray(p[f]) && !p[f].length)) {
        bad(`missing required field "${f}"`);
      }
    }
    if (p.id) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id)) bad('id must be kebab-case');
      if (ids.has(p.id)) bad('duplicate id');
      ids.add(p.id);
    }
    if (p.category && !catIds.has(p.category)) bad(`unknown category "${p.category}"`);
    if (p.source) bad('the "source" field is gone, this list has no team section');
    const blocked = blockedBy(blocklist, p);
    if (blocked) bad(`on data/blocklist.yaml (${blocked.reason || 'blocked'}), it does not go on the list`);
    if (p.repo && OURS.test(p.repo) && !ALLOWED.has(p.repo.toLowerCase())) {
      bad('this is one of our own repos, it does not go on the list');
    }
    if (p.evidence && !EVIDENCE[p.evidence]) {
      bad(`evidence must be one of ${Object.keys(EVIDENCE).join(', ')}`);
    }
    // `in`, not a truthiness check: a value of null is a valid kind that simply
    // prints nothing.
    for (const k of asArray(p.kind)) if (!(k in KIND)) bad(`unknown kind "${k}"`);
    for (const l of asArray(p.lang)) if (!(l in LANG)) bad(`unknown lang "${l}"`);
    if (p.url && !/^https?:\/\/\S+$/.test(p.url)) bad('url must be an absolute http(s) URL');
    if (p.repo && !/^[\w.-]+\/[\w.-]+$/.test(p.repo)) bad('repo must be "owner/name"');
    if (p.added && !/^\d{4}-\d{2}-\d{2}$/.test(p.added)) bad('added must be YYYY-MM-DD');
    // Maintainer-only: the handful of live apps monid.ai/built-with opens with.
    if (p.featured !== undefined && typeof p.featured !== 'boolean') bad('featured must be true or false');
    if (p.featured && !asArray(p.kind).includes('hosted')) bad('only a hosted app can be featured');

    const d = p.description;
    if (typeof d === 'string' && d) {
      if (!/^[A-Z0-9]/.test(d)) bad('description must start with a capital letter');
      if (!d.endsWith('.')) bad('description must end with a period');
      if (d.length > 160) bad(`description is ${d.length} chars, max 160`);
      if (/\p{Extended_Pictographic}/u.test(d)) bad('description must not contain emoji');
      if (/—|–/.test(d)) bad('description must not contain an em dash or en dash');
      // A sentence break is a period followed by whitespace and a capital.
      // Counting bare periods would trip over Next.js, v1.2 and e.g.
      if (/\.\s+[A-Z]/.test(d)) bad('description must be a single sentence');
    }
  }
  return errors;
}

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/* ------------------------------------------------------------------ *
 * Rendering                                                           *
 * ------------------------------------------------------------------ */
// Mirrors github-slugger, which is what GitHub uses to build heading anchors:
// lowercase, trim, drop everything that is not a word char / space / hyphen
// (emoji and "&" go here), then spaces to hyphens. Note the trim happens
// BEFORE the emoji is removed, so an emoji prefix leaves a leading hyphen.
function slug(heading) {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');
}

function renderEntry(p) {
  const repoUrl = p.repo ? `https://github.com/${p.repo}` : '';
  // Name, then the sentence, then the metadata. A reader scanning for what a
  // thing does should not have to step over a row of icons to reach the verb.
  const bits = [
    `- [${p.name}](${p.url}) - ${p.description}`,
  ];

  // Second link, worded, so the source is reachable when the name points at a
  // live product. Skipped when the name already is the repo.
  if (repoUrl && p.url.replace(/\/$/, '') !== repoUrl) bits.push(`([Source Code](${repoUrl}))`);

  // No stars badge on purpose. The inclusion rules say stars do not matter, so
  // printing 36 of them would argue the opposite, and each one is a remote
  // image request on a page that already has enough to load.
  const tags = [
    ...asArray(p.kind).map((k) => KIND[k]),
    ...asArray(p.lang).map((l) => LANG[l]),
    p.cost,
    p.event,
  ].filter(Boolean);
  if (tags.length) bits.push(tags.map((t) => `\`${t}\``).join(' '));

  return bits.join(' ');
}

const BLUE = '0016D7';

// Shields renders these, so the counts stay true without anyone maintaining them.
function renderStats(projects) {
  const withCost = projects.filter((p) => p.cost).length;
  const cats = new Set(projects.map((p) => p.category)).size;
  const badge = (label, value) =>
    `![${label}](https://img.shields.io/badge/${encodeURIComponent(label)}-${value}-${BLUE}?style=flat-square)`;
  return [
    '<div align="center">',
    '',
    [
      badge('projects', projects.length),
      badge('categories', cats),
      badge('with a real price tag', withCost),
      '[![Awesome](https://awesome.re/badge-flat2.svg)](https://awesome.re)',
    ].join(' '),
    '',
    '</div>',
    '',
  ].join('\n');
}

// An HTML table, not a markdown one: markdown needs a header row, and a header
// above a set of category chips is a row of nothing. Links must be <a> here,
// since GitHub does not parse markdown inside an HTML block.
function renderNav(projects, categories) {
  const used = categories.filter((c) => projects.some((p) => p.category === c.id));
  const cells = used.map((c) => {
    const n = projects.filter((p) => p.category === c.id).length;
    const href = `#${slug(`${c.emoji} ${c.title}`)}`;
    return `<td><a href="${href}">${c.emoji} ${escapeHtml(c.title)}</a> <sub>${n}</sub></td>`;
  });

  const rows = [];
  for (let i = 0; i < cells.length; i += 3) rows.push(`  <tr>${cells.slice(i, i + 3).join('')}</tr>`);
  return ['<div align="center">', '', '<table>', ...rows, '</table>', '', '</div>', ''].join('\n');
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderCategorised(projects, categories, { empty }) {
  const lines = [];
  const used = categories.filter((c) => projects.some((p) => p.category === c.id));

  if (!used.length) return [empty, ''].join('\n');

  for (const c of used) {
    const rows = projects
      .filter((p) => p.category === c.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`### ${c.emoji} ${c.title}`, '', `<sub>${escapeHtml(c.blurb)}</sub>`, '');
    lines.push(...rows.map(renderEntry), '');
    lines.push('<sup>[back to top](#readme)</sup>', '');
  }
  return lines.join('\n');
}

function build() {
  // --demo renders the real data plus data/projects.demo.yaml into README.demo.md,
  // so you can see a populated list without inventing entries in the real file.
  const demo = process.argv.includes('--demo');
  const target = demo ? join(ROOT, 'README.demo.md') : README;

  const categories = parseList(
    readFileSync(join(ROOT, 'data/categories.yaml'), 'utf8'),
    'data/categories.yaml',
  );
  const projects = parseList(
    readFileSync(join(ROOT, 'data/projects.yaml'), 'utf8'),
    'data/projects.yaml',
  );
  if (demo) {
    projects.push(
      ...parseList(
        readFileSync(join(ROOT, 'data/projects.demo.yaml'), 'utf8'),
        'data/projects.demo.yaml',
      ),
    );
  }

  const blocklistPath = join(ROOT, 'data/blocklist.yaml');
  const blocklist = existsSync(blocklistPath) ? parseList(readFileSync(blocklistPath, 'utf8'), 'data/blocklist.yaml') : [];
  const errors = validate(projects, categories, blocklist);
  if (errors.length) {
    console.error('Validation failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }

  const body = [
    renderStats(projects),
    renderNav(projects, categories),
    renderCategorised(projects, categories, {
      empty:
        'Nothing here yet. If you shipped something on Monid, ' +
        '[submit it](CONTRIBUTING.md#how-to-submit) ' +
        'and be the first entry on this list.',
    }),
  ].join('\n');

  // README.md is always the template: the demo run only redirects the output.
  const readme = readFileSync(README, 'utf8');
  const start = readme.indexOf(BEGIN);
  const stop = readme.indexOf(END);
  if (start === -1 || stop === -1) {
    console.error(`README.md is missing the ${BEGIN} / ${END} markers.`);
    process.exit(1);
  }
  const next =
    readme.slice(0, start + BEGIN.length) +
    '\n\n' + body + '\n' +
    readme.slice(stop);

  if (process.argv.includes('--check')) {
    if (next !== readme) {
      console.error('README.md is out of date. Run `npm run build` and commit the result.');
      process.exit(1);
    }
    console.log(`README.md is up to date (${projects.length} entries).`);
    return;
  }

  const used = new Set(projects.map((p) => p.category)).size;
  writeFileSync(target, next, 'utf8');
  if (!demo) writeShowcase(projects, categories);
  console.log(
    `Wrote ${demo ? 'README.demo.md' : 'README.md'}: ${projects.length} entries ` +
    `across ${used} of ${categories.length} categories.`,
  );
}

/* ------------------------------------------------------------------ *
 * Showcase export                                                     *
 * ------------------------------------------------------------------ */
// data/built-with.json is what monid.ai/built-with reads, from this repo's
// showcase-data branch (the showcase workflow rebuilds it there after every
// merge; the copy on main is only the seed). Same entries as the README,
// joined with the GitHub numbers in data/github.json (written by
// scripts/github-meta.mjs, refreshed every three days). Deterministic for a given pair of inputs,
// so a contributor's local build and CI agree byte for byte.
function writeShowcase(projects, categories) {
  const metaPath = join(ROOT, 'data/github.json');
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
  const checked = Object.values(meta).map((m) => m.checked).filter(Boolean).sort().pop() || '';
  const visitsPath = join(ROOT, 'data/visits.json');
  const visits = existsSync(visitsPath) ? JSON.parse(readFileSync(visitsPath, 'utf8')) : null;

  const rows = projects.map((p) => {
    const gh = p.repo ? meta[p.repo] : null;
    const hosted = asArray(p.kind).includes('hosted') && !/github\.com/.test(p.url);
    return {
      id: p.id,
      name: p.name,
      url: p.url,
      repo: p.repo || '',
      author: p.author,
      owner: p.repo ? p.repo.split('/')[0] : '',
      avatar: (gh && gh.avatar) || '',
      category: p.category,
      kind: asArray(p.kind),
      lang: (gh && gh.lang) || LANG[asArray(p.lang)[0]] || '',
      cost: p.cost || '',
      monid: asArray(p.monid),
      description: p.description,
      stars: gh && !gh.missing ? gh.stars : null,
      forks: gh && !gh.missing ? gh.forks ?? null : null,
      commits30d: gh && !gh.missing ? gh.commits30d ?? null : null,
      visits7d: visits ? visits.visits[p.id] ?? 0 : null,
      starsPrev: gh && gh.prev ? gh.prev.stars : null,
      starsPrevAt: gh && gh.prev ? gh.prev.checked : '',
      pushed: gh ? gh.pushed : '',
      hosted,
      featured: p.featured === true,
      added: p.added,
      verified: p.verified === true,
    };
  });

  const out = {
    source: 'https://github.com/monid-ai/awesome-monid',
    githubChecked: checked,
    visitsChecked: visits ? visits.checked : '',
    categories: categories.map((c) => ({ id: c.id, title: c.title, blurb: c.blurb })),
    projects: rows,
  };
  writeFileSync(join(ROOT, 'data/built-with.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`Wrote data/built-with.json: ${rows.length} entries, GitHub numbers as of ${checked || 'never'}.`);
}

build();
