// Everything persistent lives under DATA_DIR (the /data volume in the cloud, ./data locally):
//   state.json        every repo ever graded, with verdict + date (+ PR number) so a rejection is
//                     not re-graded every week and an accepted repo is never proposed twice
//   runs/<ts>.json    one summary per run
//   runs/index.json   run ids seen (cron idempotency) + last run pointer
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(join(dir, 'runs'), { recursive: true });
    this.stateFile = join(dir, 'state.json');
    this.indexFile = join(dir, 'runs', 'index.json');
    this.state = this.readJson(this.stateFile, { repos: {} });
    this.index = this.readJson(this.indexFile, { cronRunIds: [], last: null });
  }

  readJson(file, fallback) {
    try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback; } catch { return fallback; }
  }

  writeJson(file, obj) {
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(obj, null, 2));
    renameSync(tmp, file);
  }

  repo(full) { return this.state.repos[full.toLowerCase()]; }

  setRepo(full, rec) {
    this.state.repos[full.toLowerCase()] = { ...(this.repo(full) || {}), ...rec, at: new Date().toISOString() };
    this.writeJson(this.stateFile, this.state);
  }

  seenCronRun(id) { return !!id && this.index.cronRunIds.includes(id); }

  markCronRun(id) {
    if (!id) return;
    this.index.cronRunIds = [...this.index.cronRunIds.slice(-200), id];
    this.writeJson(this.indexFile, this.index);
  }

  saveRun(summary) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    this.writeJson(join(this.dir, 'runs', `${ts}.json`), summary);
    this.index.last = ts;
    this.writeJson(this.indexFile, this.index);
    return ts;
  }

  runs(limit = 20) {
    return readdirSync(join(this.dir, 'runs'))
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => ({ id: f.replace(/\.json$/, ''), ...this.readJson(join(this.dir, 'runs', f), {}) }));
  }
}
