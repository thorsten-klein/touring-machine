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

test('reconfigureGame: 4-color (even N) hits card-16 tie branch + parity-scaling for new color', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const r = reconfigureGame({ colors: ALL_COLORS.slice(0, 4) });
        if (r.cards <= 0) throw new Error('4-color reconfigure produced no cards');
        if (r.codes !== Math.pow(5, 4)) throw new Error('expected 5^4 codes for 4-color/1-5');
        // Card 16 must expose the "equal evens and odds" option that only
        // exists for even N (covers the N % 2 === 0 branch in buildOriginalCards).
        const c16 = CARDS_BY_ID[16];
        if (!c16) throw new Error('card 16 missing under 4 colors');
        if (!c16.options.some(o => /Equal/i.test(o.label))) {
            throw new Error('card 16 missing the "equal" option for even N');
        }
        // Parity scaling card for green must exist (par_green family) since
        // the hand-written set only covers parB / parY / parP.
        if (!CARDS.some(c => c.family === 'par_green')) {
            throw new Error('expected parity scaling card for green');
        }
        // Restore defaults so other tests see the canonical state.
        reconfigureGame({ digitMin: 1, digitMax: 5, colors: ALL_COLORS.slice(0, 3) });
    });
});
