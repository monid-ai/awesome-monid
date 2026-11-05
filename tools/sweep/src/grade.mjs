// Grades one candidate repo against the CONTRIBUTING rules and drafts its entry.
// Claude through the official SDK when ANTHROPIC_API_KEY is set; OpenAI chat completions as the
// alternative when only OPENAI_API_KEY is set. Either way the output is one JSON object.
import { truncate } from './util.mjs';
import { KINDS, LANGS } from './listdata.mjs';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['include', 'reason', 'name', 'url', 'author', 'category', 'kind', 'lang', 'monid', 'description', 'cost'],
  properties: {
    include: { type: 'boolean' },
    reason: { type: 'string', description: 'One or two sentences a maintainer reads to decide. Name the rule that decided it.' },
    name: { type: 'string', description: 'Display name, no marketing suffix.' },
    url: { type: 'string', description: 'What a reader opens first: the live app if there is a working hosted URL, else the GitHub repo URL.' },
    author: { type: 'string', description: '@githubhandle of the person or org that built it.' },
    category: { type: 'string', description: 'One id from the category list.' },
    kind: { type: 'array', items: { type: 'string', enum: KINDS } },
    lang: { type: 'array', items: { type: 'string', enum: LANGS } },
    monid: { type: 'array', items: { type: 'string' }, description: 'Monid endpoints or capability areas the project calls, e.g. search, enrichment, social, scrape, tikhub.' },
    description: { type: 'string', description: 'One sentence, starts with a capital, ends with a period, 160 chars max, no emoji, no dashes, no marketing.' },
    cost: { type: 'string', description: 'Real Monid spend per run if the README states it, e.g. "$0.15/lead". Otherwise "".' },
  },
};

function buildPrompt(c, categories) {
  const cats = categories.map((x) => `- ${x.id}: ${x.title}. ${x.blurb}`).join('\n');
  const files = c.files.slice(0, 6).map((f) => `### ${f.path}\n${f.fragments.map((x) => truncate(x, 600)).join('\n---\n')}`).join('\n\n');
  return `You are the maintainer of awesome-monid, a curated list of real services, agents and tools that OUTSIDE developers built on Monid (api.monid.ai, the pay-per-call data tool catalog for AI agents). You are reviewing one GitHub repository found by code search and deciding whether it belongs on the list, and if so, drafting its entry.

## Inclusion rules (all must hold)
1. Built outside the Monid team. Anything by the monid-ai org, Jasper0122 or shengkun-ye is out. Official Monid plugin or skill mirrors copied verbatim are out.
2. It calls Monid. The code search already found a Monid marker in the files below; confirm from the fragments that the project actually uses it (a real call, config, or documented command), not just a mention in a comparison, a catalog of providers, or a dependency list that is never used.
3. It is a thing someone can use: a shipped service, an installable skill, plugin or MCP server, a fork-and-run template, or a write-up that teaches something specific. OUT: personal dotfiles, config dumps, homework, empty scaffolds, a demo that wraps one endpoint and adds nothing, generic "agent skills" collections where Monid is one of 200 unrelated files unless the collection is itself a usable product, repos with a live API key committed in source (say so in the reason).
4. Hackathon entries are in regardless of polish. No star floor, no minimum age.

## Entry fields
- name: display name, no marketing suffix
- url: the live app if the homepage is a real working product URL, otherwise the repo URL
- author: @handle of the builder
- category: exactly one id from this list
${cats}
- kind: one or more of hosted (a running service), oss (open source), skill (installable skill/plugin/MCP), writeup
- lang: one or more of py, ts, go, rust, other; [] if none applies
- monid: endpoints or capability areas it calls, from the code fragments and README
- description: ONE sentence, starts with a capital, ends with a period, 160 characters max. No emoji, no em dash, no en dash, no marketing adjectives. Say what it does for the reader. Good: "Turns a company domain into a funding-signal brief with sources attached." Bad: "The ultimate AI-powered research platform."
- cost: only if the README states real Monid spend per run, else ""

If include is false, still fill the other fields with your best guess so a human can override.

## Repository
full_name: ${c.meta.full_name}
owner: ${c.meta.owner} (${c.meta.owner_type})
description: ${c.meta.description || '(none)'}
homepage: ${c.meta.homepage || '(none)'}${c.homepageAlive === false ? ' (did not answer when fetched)' : ''}
language: ${c.meta.language || '(none)'}; topics: ${c.meta.topics.join(', ') || '(none)'}
stars: ${c.meta.stars}; created: ${c.meta.created_at}; last push: ${c.meta.pushed_at}; license: ${c.meta.license || '(none)'}
evidence from code search: ${c.evidence} (matched ${c.files.length} file(s))

## Matched code fragments
${files || '(no fragments returned)'}

## README (truncated)
${truncate(c.readme, 9000) || '(no README)'}

Return only the JSON object.`;
}

async function viaAnthropic(prompt, env) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 180000 });
  const model = env.LLM_MODEL || 'claude-opus-5-5';
  const res = await client.beta.messages.create({
    model,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') throw new Error(`model refused: ${res.stop_details?.category || 'unknown'}`);
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, model, usage: res.usage };
}

async function viaOpenAI(prompt, env) {
  const model = env.LLM_MODEL || 'gpt-5.5';
  const body = /^(gpt-5|o\d)/.test(model)
    ? { model, messages: [{ role: 'user', content: prompt }], max_completion_tokens: 4000, reasoning_effort: 'medium', response_format: { type: 'json_schema', json_schema: { name: 'entry', schema: SCHEMA, strict: true } } }
    : { model, messages: [{ role: 'user', content: prompt }], max_tokens: 1500, response_format: { type: 'json_object' } };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 180000);
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(`openai ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
    return { text: d.choices?.[0]?.message?.content || '', model, usage: d.usage };
  } finally {
    clearTimeout(t);
  }
}

export function llmAvailable(env = process.env) {
  return !!(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY);
}

export async function grade(candidate, categories, env = process.env) {
  const prompt = buildPrompt(candidate, categories);
  const out = env.ANTHROPIC_API_KEY ? await viaAnthropic(prompt, env) : await viaOpenAI(prompt, env);
  let json;
  try {
    json = JSON.parse(out.text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new Error(`model did not return JSON: ${out.text.slice(0, 200)}`);
  }
  return { ...json, _model: out.model, _usage: out.usage };
}
