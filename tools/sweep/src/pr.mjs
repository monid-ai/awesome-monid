// Git side: clone awesome-monid, append the new entries to data/projects.yaml, regenerate README.md
// with the repo's own build script, push a bot branch, open (or refresh) the pull request.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitBlocks, renderEntry } from './listdata.mjs';
import { redact, log } from './util.mjs';

export const LIST_REPO = 'monid-ai/awesome-monid';
const BRANCH_PREFIX = 'autopr/';
const BOT_NAME = 'awesome-monid autopr';

export function cloneList({ token }) {
  const dir = mkdtempSync(join(tmpdir(), 'awesome-monid-'));
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    } catch (e) {
      throw new Error(redact(`git ${args[0]} failed: ${e.stderr || e.message}`, [token]));
    }
  };
  // Public clone with no token in the URL; the token only ever goes on the push URL.
  execFileSync('git', ['clone', '--quiet', '--no-single-branch', '--depth', '50', `https://github.com/${LIST_REPO}.git`, dir], { stdio: 'ignore' });
  git('config', 'user.name', BOT_NAME);
  git('config', 'user.email', process.env.GIT_AUTHOR_EMAIL || 'autopr@monid.ai');
  if (token) git('remote', 'set-url', '--push', 'origin', `https://x-access-token:${token}@github.com/${LIST_REPO}.git`);
  return { dir, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function readMainData(dir) {
  const projectsText = readFileSync(join(dir, 'data/projects.yaml'), 'utf8');
  const categoriesText = readFileSync(join(dir, 'data/categories.yaml'), 'utf8');
  return { projectsText, categoriesText };
}

// Entries present on an open bot branch but not on main: the ones a maintainer has not merged yet.
function pendingBlocks(git, branch, mainText) {
  let branchText;
  try { branchText = git('show', `origin/${branch}:data/projects.yaml`); } catch { return []; }
  const mainIds = new Set(splitBlocks(mainText).keys());
  return [...splitBlocks(branchText)].filter(([id]) => !mainIds.has(id)).map(([, block]) => block);
}

export function buildCheck(dir) {
  execFileSync('node', ['scripts/build.mjs'], { cwd: dir, stdio: 'pipe' });
  execFileSync('node', ['scripts/build.mjs', '--check'], { cwd: dir, stdio: 'pipe' });
}

// Writes entries, rebuilds, commits, pushes. Returns { branch, pendingCount, pushed }.
export function commitEntries({ clone, entries, existingBranch, date }) {
  const { dir, git } = clone;
  const branch = existingBranch || `${BRANCH_PREFIX}${date}`;
  const mainText = readFileSync(join(dir, 'data/projects.yaml'), 'utf8');
  const pending = existingBranch ? pendingBlocks(git, existingBranch, mainText) : [];

  git('checkout', '-q', '-B', branch, 'origin/main');
  const blocks = [...pending, ...entries.map(renderEntry)];
  const next = mainText.replace(/\s+$/, '') + '\n\n' + blocks.join('\n\n') + '\n';
  writeFileSync(join(dir, 'data/projects.yaml'), next);
  buildCheck(dir);

  git('add', 'data/projects.yaml', 'README.md');
  const msg = [
    `Add ${entries.length} project${entries.length === 1 ? '' : 's'} from the ${date} sweep`,
    '',
    ...entries.map((e) => `- ${e.name} (${e.repo || e.url})`),
    '',
    'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>',
  ].join('\n');
  git('commit', '-q', '-m', msg);
  git('push', '-q', '--force', 'origin', `${branch}:${branch}`);
  log(`pushed ${branch} (${entries.length} new, ${pending.length} carried over)`);
  return { branch, pendingCount: pending.length };
}

export function prBody({ date, accepted, rejected, skipped, queries, carried }) {
  const row = (e) => {
    const ev = e._files.slice(0, 2).map((f) => `[${f.path.split('/').pop()}](${f.html_url})`).join(', ');
    return `| [${e.name}](${e.url}) | ${e.repo ? `[${e.repo}](https://github.com/${e.repo})` : 'closed source'} | \`${e.evidence}\` ${ev} | \`${e.category}\` | ${e._reason} |`;
  };
  const lines = [
    '## What',
    '',
    `- ${accepted.length} new entr${accepted.length === 1 ? 'y' : 'ies'} from the automated sweep on ${date}: GitHub code search on ${queries.map((q) => `\`${q}\``).join(', ')}, every hit not already listed read past the README and graded against the CONTRIBUTING rules by a model, then checked against the build script's validation.`,
    `- Every entry is \`verified: false\`. A maintainer still opens the link and confirms the Monid call before merge, same as a human submission.`,
    `- \`README.md\` regenerated with \`npm run build\`; \`--check\` passes.`,
    ...(carried ? [`- ${carried} entr${carried === 1 ? 'y' : 'ies'} from the previous sweep carried over on this branch, still unmerged.`] : []),
    '',
    '| Project | Repo | Evidence | Category | Why it is in |',
    '|---|---|---|---|---|',
    ...accepted.map(row),
    '',
  ];
  if (rejected.length) {
    lines.push('## Left out on purpose', '', ...rejected.map((r) => `- \`${r.repo}\`: ${r.reason}`), '');
  }
  if (skipped.length) {
    lines.push('<details><summary>Skipped before grading</summary>', '', ...skipped.map((s) => `- \`${s.repo}\`: ${s.reason}`), '', '</details>', '');
  }
  lines.push('🤖 Generated with [Claude Code](https://claude.com/claude-code)');
  return lines.join('\n');
}

export async function openOrUpdatePull(gh, { branch, title, body, existing }) {
  if (existing) {
    await gh.updatePull(LIST_REPO, existing.number, { title, body });
    await gh.comment(LIST_REPO, existing.number, `Refreshed with this week's sweep. Branch rebuilt on top of main, earlier unmerged entries kept.`);
    return existing;
  }
  const pr = await gh.createPull(LIST_REPO, { title, head: branch, base: 'main', body });
  await gh.addLabels(LIST_REPO, pr.number, ['submission']);
  return pr;
}

export async function findOpenBotPull(gh) {
  const pulls = await gh.openPulls(LIST_REPO);
  return pulls.find((p) => p.head?.ref?.startsWith(BRANCH_PREFIX)) || null;
}
