#!/usr/bin/env node
// Turns a submission issue into a new entry in data/projects.yaml.
//
// Reads the issue body from $ISSUE_BODY (that is how GitHub issue forms arrive:
// "### Label" followed by a blank line and the value, "_No response_" when empty,
// and "- [X] option" lines for checkboxes).
//
// Writes nothing and exits 1 with a readable message when the submission is bad,
// so the workflow can paste that message back as a comment.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data/projects.yaml');

const CATEGORIES = readFileSync(join(ROOT, 'data/categories.yaml'), 'utf8')
  .split(/\r?\n/)
  .map((l) => l.match(/^- id:\s*(\S+)/))
  .filter(Boolean)
  .map((m) => m[1]);

const KINDS = ['hosted', 'oss', 'skill', 'writeup'];
const LANGS = ['py', 'ts', 'go', 'rust', 'other'];

function fields(body) {
  const out = {};
  const parts = body.split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const label = part.slice(0, nl === -1 ? undefined : nl).trim();
    const value = nl === -1 ? '' : part.slice(nl + 1).trim();
    out[label.toLowerCase()] = value === '_No response_' ? '' : value;
  }
  return out;
}

const checked = (v) =>
  (v || '')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*-\s*\[[xX]\]\s*(.+?)\s*$/))
    .filter(Boolean)
    .map((m) => m[1]);

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

const body = process.env.ISSUE_BODY;
if (!body) die('ISSUE_BODY is empty.');

const f = fields(body);
const name = f['project name'];
const url = f['link'];
const repo = f['github repo'];
const author = f['author'];
const category = (f['category'] || '').trim();
const kind = checked(f['kind']);
const lang = checked(f['language']);
const description = (f['description'] || '').replace(/\s+/g, ' ').trim();
const monid = (f['monid endpoints used'] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const cost = (f['cost per run'] || '').trim();

const problems = [];
if (!name) problems.push('Project name is missing.');
if (!/^https?:\/\/\S+$/.test(url || '')) problems.push('Link must be an absolute http(s) URL.');
if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) problems.push('GitHub repo must look like `owner/name`.');
if (!author) problems.push('Author is missing.');
if (!CATEGORIES.includes(category)) problems.push(`Category must be one of: ${CATEGORIES.join(', ')}.`);
if (!kind.length) problems.push('Pick at least one Kind.');
if (kind.some((k) => !KINDS.includes(k))) problems.push('Unknown Kind value.');
if (lang.some((l) => !LANGS.includes(l))) problems.push('Unknown Language value.');
if (!description) problems.push('Description is missing.');
if (description && !/^[A-Z0-9]/.test(description)) problems.push('Description must start with a capital letter.');
if (description && !description.endsWith('.')) problems.push('Description must end with a period.');
if (description.length > 160) problems.push(`Description is ${description.length} characters, max is 160.`);
if (/\p{Extended_Pictographic}/u.test(description)) problems.push('Description must not contain emoji.');
if (/—|–/.test(description)) problems.push('Description must not contain an em dash or en dash.');
if (/\.\s+[A-Z]/.test(description)) problems.push('Description must be a single sentence.');
if (!monid.length) problems.push('List at least one Monid endpoint.');
if (cost && !/^\$[\d.,]+\s*\/\s*\w+$/.test(cost)) problems.push('Cost should look like `$0.15/lead`.');

// Our own repos are rejected at the door, apart from a short allowlist the
// maintainer keeps in scripts/build.mjs.
const ALLOWED = new Set(['jasper0122/agent-seo-kit']);
if (/^(monid-ai|Jasper0122|shengkun-ye)\//i.test(repo || '') && !ALLOWED.has((repo || '').toLowerCase())) {
  problems.push('This list mostly carries work by developers outside the Monid team.');
}

const existing = readFileSync(DATA, 'utf8');
const id = (name || '')
  .toLowerCase()
  .replace(/[^\w\s-]/g, '')
  .trim()
  .replace(/\s+/g, '-');
if (id && new RegExp(`^- id:\\s*${id}\\s*$`, 'm').test(existing)) {
  problems.push(`\`${id}\` is already on the list.`);
}
if (url && existing.includes(`url: ${url}`)) problems.push('That link is already on the list.');

if (problems.length) {
  die('This submission needs a fix before it can be added:\n\n' + problems.map((p) => `- ${p}`).join('\n'));
}

const inline = (a) => `[${a.join(', ')}]`;
const entry = [
  '',
  `- id: ${id}`,
  `  name: ${name}`,
  `  url: ${url}`,
  `  repo: ${repo || '""'}`,
  `  author: ${author}`,
  `  category: ${category}`,
  `  kind: ${inline(kind)}`,
  `  lang: ${lang.length ? inline(lang) : '[]'}`,
  `  cost: ${cost ? `"${cost}"` : '""'}`,
  `  monid: ${inline(monid)}`,
  // A submitter's own word is the weakest grade. A maintainer upgrades this
  // during review once the usage is visible in the source.
  '  evidence: author-stated',
  `  description: ${description}`,
  `  added: ${new Date().toISOString().slice(0, 10)}`,
  '  verified: false',
  '',
].join('\n');

writeFileSync(DATA, existing.replace(/\s*$/, '\n') + entry, 'utf8');
console.log(`Added ${id} to data/projects.yaml.`);
