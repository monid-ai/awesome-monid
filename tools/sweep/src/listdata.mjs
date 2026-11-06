// Reads and writes data/projects.yaml in the exact flat shape scripts/build.mjs in awesome-monid
// understands, and re-implements its validation so a bad entry is caught here, not in CI.
import { readFileSync } from 'node:fs';

export const KINDS = ['hosted', 'oss', 'skill', 'writeup'];
export const LANGS = ['py', 'ts', 'go', 'rust', 'other'];
export const EVIDENCE = ['api-url', 'api-key', 'cli-package', 'cli-command', 'rest-v1', 'readme-link', 'author-stated'];
export const OURS = /^(monid-ai|Jasper0122|shengkun-ye)\//i;
export const ALLOWED_OURS = new Set(['jasper0122/agent-seo-kit']);

// Same minimal reader as build.mjs: list of flat maps, "- key: value" / "  key: value".
export function parseList(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    let body = line;
    if (/^- /.test(line)) { cur = {}; out.push(cur); body = line.slice(2); }
    else if (/^\s+\S/.test(line)) { if (!cur) throw new Error('key outside of any list item'); body = line.trim(); }
    else throw new Error(`cannot parse: ${line}`);
    const m = body.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) throw new Error(`expected key: value, got ${body}`);
    cur[m[1]] = parseScalar(m[2]);
  }
  return out;
}

function parseScalar(v) {
  const s = v.trim();
  if (s === '') return '';
  if (s.startsWith('[')) {
    const inner = s.slice(1, -1).trim();
    return inner ? inner.split(',').map((x) => parseScalar(x)) : [];
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('"') && s.endsWith('"') && s.length > 1) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (s.startsWith("'") && s.endsWith("'") && s.length > 1) return s.slice(1, -1);
  return s;
}

// Split the raw file into entry blocks keyed by id, so pending entries on an existing bot branch
// can be carried over verbatim onto a fresh copy of main.
export function splitBlocks(text) {
  const blocks = new Map();
  const lines = text.split(/\r?\n/);
  let cur = null, id = null;
  const flush = () => { if (cur && id) blocks.set(id, cur.join('\n').replace(/\n+$/, '')); };
  for (const line of lines) {
    if (/^- /.test(line)) { flush(); cur = [line]; id = (line.match(/^- id:\s*(.+)$/) || [])[1]?.trim() || null; }
    else if (cur) cur.push(line);
  }
  flush();
  return blocks;
}

const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const needsQuote = (s) => /[:#"'\[\]{}]|^\s|\s$/.test(s) || s === '' || /^(true|false)$/.test(s);
const scalar = (s) => (needsQuote(String(s)) ? q(s) : String(s));
const list = (a) => `[${(a || []).map((x) => String(x).replace(/[,\[\]]/g, ' ').trim()).filter(Boolean).join(', ')}]`;

// Emit one entry in the CONTRIBUTING template order.
export function renderEntry(p) {
  return [
    `- id: ${p.id}`,
    `  name: ${scalar(p.name)}`,
    `  url: ${p.url}`,
    `  repo: ${p.repo ? p.repo : '""'}`,
    `  author: ${q(p.author)}`,
    `  category: ${p.category}`,
    `  kind: ${list(p.kind)}`,
    `  lang: ${list(p.lang)}`,
    `  cost: ${q(p.cost || '')}`,
    `  monid: ${list(p.monid)}`,
    `  evidence: ${p.evidence}`,
    `  description: ${q(p.description)}`,
    ...(p.created ? [`  created: ${p.created}`] : []),
    `  added: ${p.added}`,
    `  verified: false`,
  ].join('\n');
}

// Mirrors validate() in build.mjs. Returns [] when the entry would pass CI.
export function validateEntry(p, categoryIds, existingIds) {
  const bad = [];
  for (const f of ['id', 'name', 'url', 'author', 'category', 'kind', 'description', 'added', 'evidence']) {
    if (p[f] === undefined || p[f] === '' || (Array.isArray(p[f]) && !p[f].length)) bad.push(`missing ${f}`);
  }
  if (p.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id)) bad.push('id not kebab-case');
  if (p.id && existingIds.has(p.id)) bad.push('duplicate id');
  if (p.category && !categoryIds.has(p.category)) bad.push(`unknown category ${p.category}`);
  if (p.repo && OURS.test(p.repo) && !ALLOWED_OURS.has(p.repo.toLowerCase())) bad.push('our own repo');
  if (p.evidence && !EVIDENCE.includes(p.evidence)) bad.push('bad evidence');
  for (const k of p.kind || []) if (!KINDS.includes(k)) bad.push(`unknown kind ${k}`);
  for (const l of p.lang || []) if (!LANGS.includes(l)) bad.push(`unknown lang ${l}`);
  if (p.url && !/^https?:\/\/\S+$/.test(p.url)) bad.push('url not absolute');
  if (p.repo && !/^[\w.-]+\/[\w.-]+$/.test(p.repo)) bad.push('repo not owner/name');
  if (p.added && !/^\d{4}-\d{2}-\d{2}$/.test(p.added)) bad.push('added not a date');
  const d = p.description;
  if (typeof d === 'string' && d) {
    if (!/^[A-Z0-9]/.test(d)) bad.push('description must start with a capital');
    if (!d.endsWith('.')) bad.push('description must end with a period');
    if (d.length > 160) bad.push(`description ${d.length} chars`);
    if (/\p{Extended_Pictographic}/u.test(d)) bad.push('description has emoji');
    if (/—|–/.test(d)) bad.push('description has a dash');
    if (/\.\s+[A-Z]/.test(d)) bad.push('description is more than one sentence');
  }
  return bad;
}

// Tidy the obvious slips a model makes before validation runs: trailing whitespace, missing period,
// lowercase first letter, dashes, double spaces. Anything else is the model's problem.
export function tidyDescription(d) {
  let s = String(d || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*[—–]\s*/g, ', ');
  if (s && !/^[A-Z0-9]/.test(s)) s = s[0].toUpperCase() + s.slice(1);
  s = s.replace(/[.!?]+$/, '') + '.';
  return s;
}

export function loadCategories(file) {
  return parseList(readFileSync(file, 'utf8'));
}
