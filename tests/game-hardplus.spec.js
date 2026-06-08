import { test, expect } from './coverage-fixture.js';

// HARD+ level: cards are restricted to the colorParam family (every option is
// the same predicate applied to a different color). Standard deduction
// mechanics — the only difference is the homogeneous card pool.

test('level select offers Hard and starts a 5-verifier "mystery" game', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    await expect(page.locator('#level-options .level-option:has(strong:text("Hard"))'))
        .toBeVisible();
    await page.click('#level-options .level-option:has(strong:text("Hard"))');
    await expect(page.locator('#screen-game')).toBeVisible();
    const stats = await page.evaluate(() => {
        const p = window.game.state.puzzle;
        return {
            level: p.level,
            verifierCount: p.cards.length,
            // Every Hard verifier must be a mystery verifier — either a
            // synthesised combo (hardplusOnly) or a colorParam card.
            allMystery: p.cards.every(c => {
                const def = CARDS_BY_ID[c.id];
                return def.hardplusOnly || def.colorParam;
            }),
        };
    });
    expect(stats.level).toBe('HARD');
    expect(stats.verifierCount).toBe(5);
    expect(stats.allMystery).toBe(true);
});

test('level-info modal: Hard subtitle explains mystery mechanic; Classic source pool listed in both', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Hard")) .level-info-icon');
    await expect(page.locator('#level-info-modal')).toBeVisible();
    await expect(page.locator('#level-info-title')).toContainText('Hard');
    // Hard's subtitle calls out the mystery mechanic.
    await expect(page.locator('#level-info-subtitle')).toContainText('MYSTERY');
    // colorParam cards show the styled "color" placeholder inline in
    // their topic (the old .lvtag-color chip was dropped in favor of this).
    await expect(page.locator('.color-placeholder').first()).toBeVisible();
    // Numbered list — the first card head carries "1.".
    await expect(page.locator('.lvcard-num').first()).toHaveText('1.');
    await page.click('#btn-close-level-info');
    await expect(page.locator('#level-info-modal')).toBeHidden();

    // Classic — same source pool, different subtitle.
    await page.click('#level-options .level-option:has(strong:text("Classic")) .level-info-icon');
    await expect(page.locator('#level-info-modal')).toBeVisible();
    await expect(page.locator('#level-info-title')).toContainText('Classic');
    await expect(page.locator('#level-info-subtitle')).toContainText('rules');
    await page.click('#btn-close-level-info');
});

test('level-info modal: Custom level shows the digit-range hint and does not start a game on icon click', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom")) .level-info-icon');
    await expect(page.locator('#level-info-modal')).toBeVisible();
    await expect(page.locator('#level-info-subtitle')).toContainText('digit range');
    // Game screen must NOT have opened (the magnifier click was intercepted).
    await expect(page.locator('#screen-game')).toBeHidden();
    await page.click('#btn-close-level-info');
});

test('hard header label reads "Hard"', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('HARD', 1234);
        window.game.startWithPuzzle(p);
    });
    await expect(page.locator('#info-level')).toHaveText('Hard');
});
