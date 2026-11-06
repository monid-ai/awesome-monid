import { fetchJson, sleep, log } from './util.mjs';

const API = 'https://api.github.com';

// Thin GitHub REST client. Code search is capped at 10 requests/min, so every search call waits
// SEARCH_GAP_MS before it fires; everything else rides the 5,000/h core budget.
export class GitHub {
  constructor(token, { searchGapMs = 7000 } = {}) {
    if (!token) throw new Error('GITHUB_TOKEN is required');
    this.token = token;
    this.searchGapMs = searchGapMs;
    this.lastSearchAt = 0;
  }

  headers(extra = {}) {
    return {
      authorization: `Bearer ${this.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'awesome-monid-autopr',
      ...extra,
    };
  }

  async req(path, opts = {}) {
    const url = path.startsWith('http') ? path : API + path;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetchJson(url, { ...opts, headers: this.headers(opts.headers) });
      const remaining = Number(r.headers.get('x-ratelimit-remaining'));
      if ((r.status === 403 || r.status === 429) && (remaining === 0 || /rate limit/i.test(r.text))) {
        const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
        const retryAfter = Number(r.headers.get('retry-after')) * 1000;
        const wait = Math.min(Math.max(retryAfter || reset - Date.now() || 0, 5000) + 1000, 90000);
        log(`github rate limited on ${path}, waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      return r;
    }
    throw new Error(`github: rate limit on ${path} did not clear`);
  }

  // Code search with text fragments around each match. Returns one row per file hit.
  async codeSearch(q, { maxPages = 3 } = {}) {
    const items = [];
    for (let page = 1; page <= maxPages; page++) {
      const gap = this.searchGapMs - (Date.now() - this.lastSearchAt);
      if (gap > 0) await sleep(gap);
      this.lastSearchAt = Date.now();
      const r = await this.req(`/search/code?q=${encodeURIComponent(q)}&per_page=100&page=${page}`, {
        headers: { accept: 'application/vnd.github.text-match+json' },
      });
      if (!r.ok) throw new Error(`code search ${r.status} for ${q}: ${r.text.slice(0, 200)}`);
      for (const it of r.data.items || []) {
        items.push({
          repo: it.repository.full_name,
          path: it.path,
          html_url: it.html_url,
          fragments: (it.text_matches || []).map((m) => m.fragment).filter(Boolean),
        });
      }
      if ((r.data.items || []).length < 100) break;
    }
    return items;
  }

  async repo(full) {
    const r = await this.req(`/repos/${full}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`repo ${full}: ${r.status}`);
    const d = r.data;
    return {
      full_name: d.full_name,
      owner: d.owner?.login,
      owner_type: d.owner?.type,
      name: d.name,
      description: d.description || '',
      homepage: d.homepage || '',
      html_url: d.html_url,
      fork: !!d.fork,
      archived: !!d.archived,
      private: !!d.private,
      stars: d.stargazers_count || 0,
      language: d.language || '',
      topics: d.topics || [],
      license: d.license?.spdx_id || '',
      created_at: (d.created_at || '').slice(0, 10),
      pushed_at: (d.pushed_at || '').slice(0, 10),
      default_branch: d.default_branch || 'main',
    };
  }

  async readme(full) {
    const r = await this.req(`/repos/${full}/readme`, { headers: { accept: 'application/vnd.github.raw+json' } });
    if (r.status === 404) return '';
    if (!r.ok) return '';
    return r.text || '';
  }

  async fileRaw(full, path) {
    const r = await this.req(`/repos/${full}/contents/${encodeURI(path)}`, { headers: { accept: 'application/vnd.github.raw+json' } });
    return r.ok ? r.text : '';
  }

  async openPulls(repoFull) {
    const r = await this.req(`/repos/${repoFull}/pulls?state=open&per_page=50`);
    if (!r.ok) throw new Error(`list pulls: ${r.status}`);
    return r.data;
  }

  async createPull(repoFull, { title, head, base, body }) {
    const r = await this.req(`/repos/${repoFull}/pulls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, head, base, body, maintainer_can_modify: true }),
    });
    if (!r.ok) throw new Error(`create pull: ${r.status} ${r.text.slice(0, 300)}`);
    return r.data;
  }

  async updatePull(repoFull, number, { title, body }) {
    const r = await this.req(`/repos/${repoFull}/pulls/${number}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    if (!r.ok) throw new Error(`update pull: ${r.status} ${r.text.slice(0, 300)}`);
    return r.data;
  }

  async addLabels(repoFull, number, labels) {
    const r = await this.req(`/repos/${repoFull}/issues/${number}/labels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ labels }),
    });
    return r.ok;
  }

  async comment(repoFull, number, body) {
    const r = await this.req(`/repos/${repoFull}/issues/${number}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    return r.ok;
  }

  // HEAD-ish check that a hosted URL answers. Follows redirects; anything < 400 counts.
  static async urlAlive(url) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 awesome-monid-autopr' } });
      clearTimeout(t);
      return res.status < 400;
    } catch {
      return false;
    }
  }
}
