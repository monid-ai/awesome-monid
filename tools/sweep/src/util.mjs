export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const today = () => new Date().toISOString().slice(0, 10);

export function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// fetch with a timeout and a parsed body. Never throws on HTTP status; callers decide.
export async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 30000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctl.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { ok: res.ok, status: res.status, headers: res.headers, text, data };
  } finally {
    clearTimeout(t);
  }
}

export const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) + `\n…[truncated, ${s.length - n} more chars]` : s || '');

// kebab-case id from a display name, the way the list's ids look
export function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'project';
}

// Strip a secret from any string that might reach a log or a PR body.
export function redact(s, secrets) {
  let out = String(s);
  for (const v of secrets) if (v) out = out.split(v).join('***');
  return out;
}
