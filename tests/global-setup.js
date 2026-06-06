// Runs once before the suite: instruments src/ with nyc into .nyc_inst/src
// and mirrors index.html + css/ next to it so tests can load
// .nyc_inst/index.html (which pulls the instrumented scripts via the same
// `./src/x.js` relative refs).
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INST = path.join(ROOT, '.nyc_inst');

export default async function globalSetup() {
    if (fs.existsSync(INST)) fs.rmSync(INST, { recursive: true, force: true });
    fs.mkdirSync(INST, { recursive: true });

    // Instrument src/ → .nyc_inst/src
    execSync(`npx nyc instrument src ${path.join(INST, 'src')}`, {
        cwd: ROOT,
        stdio: ['ignore', 'ignore', 'inherit'],
    });

    // Mirror index.html + css/ (relative refs stay valid because we put
    // src/ next to them in INST).
    fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(INST, 'index.html'));
    fs.mkdirSync(path.join(INST, 'css'), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'css'))) {
        fs.copyFileSync(path.join(ROOT, 'css', f), path.join(INST, 'css', f));
    }
}
