import { test, expect } from './coverage-fixture.js';

// HARD+ level: cards are restricted to the colorParam family (every option is
// the same predicate applied to a different color). Standard deduction
// mechanics — the only difference is the homogeneous card pool.

test('level select offers Hard+ and starts a 6-verifier game with all colorParam cards', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    await expect(page.locator('#level-options .level-option:has(strong:text("Hard+"))'))
        .toBeVisible();
    await page.click('#level-options .level-option:has(strong:text("Hard+"))');
    await expect(page.locator('#screen-game')).toBeVisible();
    const stats = await page.evaluate(() => {
        const p = window.game.state.puzzle;
        return {
            level: p.level,
            verifierCount: p.cards.length,
            colorParamCount: p.cards.filter(c => CARDS_BY_ID[c.id].colorParam).length,
        };
    });
    expect(stats.level).toBe('HARDPLUS');
    expect(stats.verifierCount).toBe(5);
    // Hard+ uses the full pool, with at least 3 colorParam verifiers.
    expect(stats.colorParamCount).toBeGreaterThanOrEqual(3);
});

test('hardplus header label reads "Hard+"', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('HARDPLUS', 1234);
        window.game.startWithPuzzle(p);
    });
    await expect(page.locator('#info-level')).toHaveText('Hard+');
});
