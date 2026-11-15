#!/usr/bin/env node
// Tells a Slack channel which projects are new on the Built with Monid page.
//
//   node scripts/notify-slack.mjs --prev /tmp/built-with.prev.json [--next data/built-with.json] [--dry]
//
// "New" means an id in --next that is not in --prev, where --prev is the
// data/built-with.json the showcase-data branch held before this run and
// --next is the one just built. The showcase workflow runs this after every
// publish, so the message goes out once per merged entry and never on the
// three-day metadata refreshes (same ids, nothing to say). NOTIFY_IDS
// (comma-separated ids) announces those entries again, for a test post.
//
// Posts through a Slack incoming webhook in SLACK_WEBHOOK_URL. Without one it
// prints the payload and exits 0, so a fork or a local build never fails on
// it. --dry does the same with a webhook set.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const dry = args.includes('--dry');
const prevPath = opt('--prev', '');
const nextPath = opt('--next', 'data/built-with.json');
const PAGE = 'https://monid.ai/built-with/';

function load(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

const next = load(nextPath);
const prev = prevPath ? load(prevPath, { projects: [] }) : { projects: [] };
const before = new Set((prev.projects || []).map((p) => p.id));
const forced = new Set((process.env.NOTIFY_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
const fresh = next.projects.filter((p) => forced.has(p.id) || (!forced.size && !before.has(p.id)));

if (!fresh.length) {
  console.log(`notify-slack: no new projects (${next.projects.length} before and after), nothing to post.`);
  process.exit(0);
}

const titles = Object.fromEntries((next.categories || []).map((c) => [c.id, c.title]));
const stars = (n) => (typeof n === 'number' ? `★ ${n.toLocaleString('en-US')}` : '');
const line = (p) => {
  const bits = [titles[p.category] || p.category, stars(p.stars), p.lang].filter(Boolean).join(' · ');
  const by = p.author ? ` by ${p.author}` : '';
  return `• <${p.url}|*${p.name}*>${by}\n    ${bits}\n    ${p.description}`;
};

// Slack caps a section's text at 3000 characters, so the list goes out in
// chunks of eight entries.
const sections = [];
for (let i = 0; i < fresh.length; i += 8) {
  sections.push({ type: 'section', text: { type: 'mrkdwn', text: fresh.slice(i, i + 8).map(line).join('\n') } });
}

const n = fresh.length;
const headline = `${n} new project${n === 1 ? '' : 's'} on Built with Monid`;
const source = process.env.COMMIT_URL
  ? ` · <${process.env.COMMIT_URL}|${(process.env.COMMIT_MSG || 'the merge').split('\n')[0].slice(0, 80)}>`
  : '';
const payload = {
  text: `${headline}: ${fresh.map((p) => p.name).join(', ')}`,
  blocks: [
    { type: 'header', text: { type: 'plain_text', text: headline } },
    ...sections,
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Now ${next.projects.length} projects · <${PAGE}|monid.ai/built-with>${source}` }],
    },
  ],
};

const hook = process.env.SLACK_WEBHOOK_URL;
if (!hook || dry) {
  console.log(`notify-slack: ${hook ? 'dry run' : 'no SLACK_WEBHOOK_URL'}, payload:\n${JSON.stringify(payload, null, 2)}`);
  process.exit(0);
}
const res = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
const body = await res.text();
if (!res.ok) {
  console.error(`notify-slack: Slack answered ${res.status}: ${body}`);
  process.exit(1);
}
console.log(`notify-slack: posted ${n} new project${n === 1 ? '' : 's'} (${fresh.map((p) => p.id).join(', ')}).`);
