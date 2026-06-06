import { test as base } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NYC_OUT = path.join(ROOT, '.nyc_output');

if (!fs.existsSync(NYC_OUT)) fs.mkdirSync(NYC_OUT, { recursive: true });

function writeCoverage(istanbul) {
    const id = crypto.randomBytes(8).toString('hex');
    fs.writeFileSync(path.join(NYC_OUT, `coverage-${id}.json`), JSON.stringify(istanbul));
}

// The instrumented sources live under .nyc_inst/src; their coverage objects
// carry that path (e.g. ".../​.nyc_inst/src/game.js"). Rewrite to the real src
// paths so the report matches the .nycrc include pattern ("src/**/*.js").
function rewritePaths(cov) {
    const out = {};
    const INST_PREFIX = path.join(ROOT, '.nyc_inst', 'src') + path.sep;
    const SRC_PREFIX  = path.join(ROOT, 'src') + path.sep;
    for (const [k, v] of Object.entries(cov)) {
        let newKey = k;
        if (k.startsWith(INST_PREFIX)) newKey = SRC_PREFIX + k.slice(INST_PREFIX.length);
        const rec = { ...v, path: newKey };
        out[newKey] = rec;
    }
    return out;
}

export const test = base.extend({
    page: async ({ page }, use) => {
        await use(page);
        let cov;
        try { cov = await page.evaluate(() => window.__coverage__ || null); }
        catch (e) { return; }
        if (!cov || !Object.keys(cov).length) return;
        writeCoverage(rewritePaths(cov));
    },
});

export const expect = test.expect;
