#!/usr/bin/env node
// Local run. `--dry-run` grades and prints the PR body but pushes nothing.
import { Store } from '../src/store.mjs';
import { runSweep } from '../src/pipeline.mjs';

const dryRun = process.argv.includes('--dry-run');
const store = new Store(process.env.DATA_DIR || './data');
const s = await runSweep({ store, dryRun });
console.log(JSON.stringify({ ...s, pr: s.pr && { ...s.pr, body: undefined } }, null, 2));
if (s.pr?.body) console.log('\n----- PR body -----\n' + s.pr.body);
