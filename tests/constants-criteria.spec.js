import { test, expect } from './coverage-fixture.js';

// Constants module + the card definitions / pruning / scaling logic in
// criteria.js. All pure: no UI flow required.

test('digitRange / digitCount / enumerateCodes return matching shapes', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const r = digitRange();
        if (r.length !== digitCount()) throw new Error('range/count mismatch');
        const all = enumerateCodes();
        if (all.length !== Math.pow(digitCount(), GAME_CONFIG.colors.length)) {
            throw new Error('enumerateCodes size mismatch');
        }
    });
});

test('reconfigureGame: digitMin/digitMax/colors all apply, with and without each arg', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const a = reconfigureGame({ digitMin: 1, digitMax: 5 });
        if (a.cards <= 0 || a.codes !== 125) throw new Error('default config bad');
        // colors arg exercises the .slice() branch.
        const b = reconfigureGame({ colors: ['blue', 'yellow', 'purple'] });
        if (b.cards <= 0) throw new Error('colors arg failed');
        // No-arg call is a no-op rebuild.
        reconfigureGame();
        // Wider digit range so generateScalingCards produces fresh count_D cards.
        const c = reconfigureGame({ digitMin: 1, digitMax: 9 });
        if (c.cards <= a.cards) throw new Error('expected more cards in wider range');
        // Restore defaults so other tests see the canonical state.
        reconfigureGame({ digitMin: 1, digitMax: 5 });
    });
});
