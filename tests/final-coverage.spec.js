import { test, expect } from './coverage-fixture.js';

// Final targeted tests for any branches not naturally hit elsewhere.

test('digit map click cells fires onToggle callback in game.js', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 101);
        window.game.startWithPuzzle(p);
    });
    await expect(page.locator('#screen-game')).toBeVisible();
    const cell = page.locator('#digitmap-table tbody .dm-cell').first();
    await cell.click();
    await expect(cell).toHaveClass(/off/);
    await cell.click();
});

test('end screen Back-to-menu fires onMenu callback', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 202);
        window.game.startWithPuzzle(p);
        window.game.state.submitGuess(p.solution.slice());
        window.game.showEndScreen({ won: true, gaveUp: false });
    });
    await expect(page.locator('#screen-end')).toBeVisible();
    await page.click('#btn-end-menu');
    await expect(page.locator('#screen-main')).toBeVisible();
});

test('end screen New puzzle button', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 303);
        window.game.startWithPuzzle(p);
        window.game.state.submitGuess(p.solution.slice());
        window.game.showEndScreen({ won: true, gaveUp: false });
    });
    await page.click('#btn-new-puzzle');
    await expect(page.locator('#screen-level')).toBeVisible();
});

test('custom modal Start with no puzzle → toast', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    await expect(page.locator('#custom-status.ok')).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => {
        window.__origGP = generatePuzzle;
        // eslint-disable-next-line no-global-assign
        generatePuzzle = () => null;
    });
    await page.click('#btn-start-custom');
    await expect(page.locator('#toast')).toBeVisible();
    await page.evaluate(() => { generatePuzzle = window.__origGP; });
});

test('toast hide timers fire (1800 + 250 ms)', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => new UI().toast('hi'));
    await page.waitForFunction(() => document.getElementById('toast').hidden, null, { timeout: 4000 });
});

test('main.js gameIdParam toast handles non-Error throw', async ({ page }) => {
    // Register a capture-phase DOMContentLoaded listener that runs BEFORE
    // main.js's listener and patches decodeGameId to throw a primitive — so
    // the `e.message || e` fallback in main.js gets exercised.
    await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
            window.decodeGameId = function () { throw 'plain string error'; }; // eslint-disable-line no-throw-literal
        }, { capture: true });
    });
    await page.goto('?game-id=anything');
    await expect(page.locator('#toast')).toBeVisible();
});

test('onAsk early-return when state is finished, onEndRound early-return', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 404);
        window.game.startWithPuzzle(p);
        window.game.state.finished = true;
        window.game.onAsk(0);
        window.game.onEndRound();
    });
});

test('submit-code cancel button closes modal', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 505);
        window.game.startWithPuzzle(p);
    });
    await page.click('#btn-submit-code');
    await expect(page.locator('#submit-modal')).toBeVisible();
    await page.click('#btn-cancel-submit');
    await expect(page.locator('#submit-modal')).toBeHidden();
});
