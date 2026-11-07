import { GitHub } from './github.mjs';
import { grade, llmAvailable } from './grade.mjs';
import { parseList, validateEntry, tidyDescription, blockedBy, OURS, ALLOWED_OURS } from './listdata.mjs';
import { cloneList, readMainData, commitEntries, prBody, openOrUpdatePull, mergePull, findOpenBotPull } from './pr.mjs';
import { log, slug, today } from './util.mjs';

// Search query -> evidence tag, in the order the list prefers when several match.
export const QUERIES = [
  ['"api.monid.ai"', 'api-url'],
  ['MONID_API_KEY', 'api-key'],
  ['"@monid-ai/cli"', 'cli-package'],
  ['"monid run"', 'cli-command'],
];

const REGRADE_AFTER_DAYS = 60;
const NOISE = /(^|\/)(\.?dotfiles|dotfiles\.|nvim-config|zsh-config|my-config|config-files)$/i;

export async function runSweep({ store, env = process.env, dryRun = false, maxCandidates = Number(env.MAX_CANDIDATES || 25) }) {
  const startedAt = new Date().toISOString();
  const date = today();
  const gh = new GitHub(env.GITHUB_TOKEN);
  const autoMerge = /^(1|true|yes)$/i.test(String(env.AUTO_MERGE || ''));
  const summary = { startedAt, date, dryRun, hits: 0, candidates: 0, accepted: [], rejected: [], skipped: [], errors: [], pr: null };

  if (!llmAvailable(env)) {
    summary.errors.push('no ANTHROPIC_API_KEY or OPENAI_API_KEY set, nothing can be graded');
    return finish(store, summary);
  }

  // 1. The list as it is on main right now.
  const clone = cloneList({ token: dryRun ? '' : env.GITHUB_TOKEN });
  try {
    const { projectsText, categoriesText, blocklistText } = readMainData(clone.dir);
    const blocklist = blocklistText ? parseList(blocklistText) : [];
    const listed = parseList(projectsText);
    const categories = parseList(categoriesText);
    const categoryIds = new Set(categories.map((c) => c.id));
    const listedRepos = new Set(listed.map((p) => String(p.repo || '').toLowerCase()).filter(Boolean));
    const listedUrls = new Set(listed.map((p) => String(p.url || '').toLowerCase().replace(/\/$/, '')));
    const ids = new Set(listed.map((p) => p.id));

    // An open bot PR means last week's entries are still waiting; this week's go on the same branch.
    const existing = dryRun ? null : await findOpenBotPull(gh);
    if (existing) {
      for (const p of parseList(clone.git('show', `origin/${existing.head.ref}:data/projects.yaml`))) {
        if (p.repo) listedRepos.add(String(p.repo).toLowerCase());
        ids.add(p.id);
      }
    }

    // 2. Code search, four queries, hits folded per repo.
    const hits = new Map();
    for (const [q, evidence] of QUERIES) {
      let items = [];
      try { items = await gh.codeSearch(q); } catch (e) { summary.errors.push(`search ${q}: ${e.message}`); continue; }
      for (const it of items) {
        const key = it.repo.toLowerCase();
        const h = hits.get(key) || { repo: it.repo, evidence: null, files: [] };
        if (!h.evidence) h.evidence = evidence; // QUERIES order is the precedence
        if (!h.files.some((f) => f.path === it.path)) h.files.push(it);
        hits.set(key, h);
      }
    }
    summary.hits = hits.size;
    log(`code search: ${hits.size} repos`);

    // 3. Cheap filters before any API or model call.
    const fresh = [];
    for (const h of hits.values()) {
      const key = h.repo.toLowerCase();
      if (listedRepos.has(key)) continue;
      if (OURS.test(h.repo) && !ALLOWED_OURS.has(key)) { continue; }
      if (NOISE.test(h.repo)) { summary.skipped.push({ repo: h.repo, reason: 'config or dotfiles repo' }); continue; }
      const blocked = blockedBy(blocklist, { repo: h.repo });
      if (blocked) {
        store.setRepo(h.repo, { verdict: 'blocked', reason: blocked.reason || 'on data/blocklist.yaml' });
        summary.skipped.push({ repo: h.repo, reason: `on data/blocklist.yaml: ${blocked.reason || 'blocked'}` });
        continue;
      }
      const prev = store.repo(h.repo);
      if (prev) {
        const ageDays = (Date.now() - new Date(prev.at).getTime()) / 86400000;
        if (prev.verdict === 'accepted') continue;
        if (ageDays < REGRADE_AFTER_DAYS) continue;
      }
      fresh.push(h);
    }
    summary.candidates = fresh.length;
    log(`${fresh.length} repos not listed and not recently graded`);

    // 4. Metadata, then pick the batch: most recently pushed first.
    const withMeta = [];
    for (const h of fresh) {
      let meta;
      try { meta = await gh.repo(h.repo); } catch (e) { summary.errors.push(`${h.repo}: ${e.message}`); continue; }
      if (!meta) { store.setRepo(h.repo, { verdict: 'skipped', reason: 'repo gone' }); continue; }
      if (meta.fork) { store.setRepo(h.repo, { verdict: 'skipped', reason: 'fork' }); summary.skipped.push({ repo: h.repo, reason: 'fork' }); continue; }
      if (meta.archived) { store.setRepo(h.repo, { verdict: 'skipped', reason: 'archived' }); summary.skipped.push({ repo: h.repo, reason: 'archived' }); continue; }
      if (listedUrls.has(meta.html_url.toLowerCase())) continue;
      withMeta.push({ ...h, meta });
    }
    withMeta.sort((a, b) => (b.meta.pushed_at > a.meta.pushed_at ? 1 : -1));
    const batch = withMeta.slice(0, maxCandidates);
    if (withMeta.length > batch.length) log(`grading ${batch.length} of ${withMeta.length}, the rest next week`);

    // 5. Read past the README and grade.
    const accepted = [];
    for (const c of batch) {
      try {
        c.readme = await gh.readme(c.repo);
        c.homepageAlive = c.meta.homepage && /^https?:\/\//.test(c.meta.homepage) ? await GitHub.urlAlive(c.meta.homepage) : null;
        const g = await grade(c, categories, env);
        const entry = toEntry(c, g, date, ids);
        const problems = validateEntry(entry, categoryIds, ids, blocklist);
        if (!g.include) {
          store.setRepo(c.repo, { verdict: 'rejected', reason: g.reason, model: g._model });
          summary.rejected.push({ repo: c.repo, reason: g.reason });
          log(`reject ${c.repo}: ${g.reason}`);
        } else if (problems.length) {
          store.setRepo(c.repo, { verdict: 'rejected', reason: `entry failed validation: ${problems.join('; ')}`, model: g._model, draft: entry });
          summary.rejected.push({ repo: c.repo, reason: `model accepted it but the drafted entry failed validation (${problems.join('; ')}); review by hand` });
          log(`invalid ${c.repo}: ${problems.join('; ')}`);
        } else {
          ids.add(entry.id);
          accepted.push(entry);
          log(`accept ${c.repo} -> ${entry.id}`);
        }
      } catch (e) {
        summary.errors.push(`${c.repo}: ${e.message}`);
        log(`error ${c.repo}: ${e.message}`);
      }
    }
    summary.accepted = accepted.map(({ _files, _reason, ...e }) => ({ ...e, reason: _reason, files: _files.map((f) => f.html_url) }));

    // 6. Branch, build, PR.
    if (!accepted.length) {
      log('nothing accepted this week, no PR');
      return finish(store, summary);
    }
    if (dryRun) {
      summary.pr = { dryRun: true, body: prBody({ date, accepted, rejected: summary.rejected, skipped: summary.skipped, queries: QUERIES.map((q) => q[0]), carried: 0 }) };
      return finish(store, summary);
    }
    const { branch, pendingCount } = commitEntries({ clone, entries: accepted, existingBranch: existing?.head?.ref, date });
    const total = accepted.length + pendingCount;
    const title = `Add ${total} project${total === 1 ? '' : 's'} from the ${date} automated sweep`;
    const body = prBody({ date, accepted, rejected: summary.rejected, skipped: summary.skipped, queries: QUERIES.map((q) => q[0]), carried: pendingCount, autoMerge });
    const pr = await openOrUpdatePull(gh, { branch, title, body, existing });
    summary.pr = { number: pr.number, url: pr.html_url, branch, refreshed: !!existing, merged: false };
    for (const e of accepted) store.setRepo(e.repo || e.url, { verdict: 'accepted', id: e.id, pr: pr.number });
    log(`PR ${pr.html_url}`);
    if (autoMerge) {
      // A refused merge is not fatal: the PR stays open for a human, same as before.
      try {
        summary.pr.mergeSha = await mergePull(gh, pr, { title });
        summary.pr.merged = true;
        log(`merged #${pr.number} as ${summary.pr.mergeSha}`);
      } catch (e) {
        summary.errors.push(`auto-merge of #${pr.number} failed, left open: ${e.message}`);
        log(`auto-merge failed: ${e.message}`);
      }
    }
    return finish(store, summary);
  } finally {
    clone.cleanup();
  }
}

function toEntry(c, g, date, ids) {
  const name = String(g.name || c.meta.name).trim();
  let id = slug(name);
  if (ids.has(id)) id = slug(`${c.meta.owner}-${name}`);
  const hosted = (g.kind || []).includes('hosted');
  const homepageOk = c.homepageAlive === true;
  const url = hosted && homepageOk && /^https?:\/\//.test(String(g.url || '')) && !/github\.com/.test(g.url)
    ? g.url
    : c.meta.html_url;
  const kind = [...new Set([...(g.kind || []), 'oss'])].filter((k) => k !== 'hosted' || homepageOk);
  const author = String(g.author || `@${c.meta.owner}`).replace(/^@?/, '@').replace(/[^\w@.-]/g, '');
  return {
    id,
    name,
    url,
    repo: c.meta.full_name,
    author,
    category: g.category,
    kind,
    lang: g.lang || [],
    cost: g.cost || '',
    monid: (g.monid || []).map((m) => String(m).toLowerCase().replace(/[^a-z0-9/_-]/g, '')).filter(Boolean).slice(0, 6),
    evidence: c.evidence,
    description: tidyDescription(g.description),
    created: c.meta.created_at,
    added: date,
    _reason: String(g.reason || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim(),
    _files: c.files,
  };
}

function finish(store, summary) {
  summary.finishedAt = new Date().toISOString();
  summary.id = store.saveRun(summary);
  return summary;
}
