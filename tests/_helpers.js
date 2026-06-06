// Small reusable helpers shared by the spec files. Keeping these out of the
// fixture file so the fixture stays focused on coverage plumbing.

export const PRESET_PRESET_SEED = 42;

// Drive the page into a running Easy game with a deterministic seed. Returns
// nothing — caller asserts on screen state.
export async function startEasyGame(page, seed = PRESET_PRESET_SEED) {
    await page.evaluate((s) => {
        const p = generatePuzzle('EASY', s);
        window.game.startWithPuzzle(p);
    }, seed);
}

// Drive into a running custom game with the given config.
export async function startCustomGame(page, cfg, seed = 7) {
    await page.evaluate(({ cfg, seed }) => {
        const p = generatePuzzle('CUSTOM', seed, cfg);
        window.game.startWithPuzzle(p);
    }, { cfg, seed });
}

// Find a proposal that makes verifier `vi` "askable" (exactly one option
// active for the current proposal). Sets state.proposal and re-renders.
// Returns true on success, false if no such proposal exists for this verifier.
export async function makeAskable(page, vi = 0) {
    return page.evaluate((vi) => {
        const p = window.game.state.puzzle;
        const def = CARDS_BY_ID[p.cards[vi].id];
        for (let a = GAME_CONFIG.digitMin; a <= GAME_CONFIG.digitMax; a++)
        for (let b = GAME_CONFIG.digitMin; b <= GAME_CONFIG.digitMax; b++)
        for (let c = GAME_CONFIG.digitMin; c <= GAME_CONFIG.digitMax; c++) {
            const n = def.options.filter(o => o.test([a, b, c])).length;
            if (n === 1) {
                window.game.state.proposal = [a, b, c];
                window.game.renderAll();
                return true;
            }
        }
        return false;
    }, vi);
}
