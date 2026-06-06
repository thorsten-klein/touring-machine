import { test, expect } from './coverage-fixture.js';
import { startEasyGame } from './_helpers.js';

// Resume-from-storage flows + state ↔ DOM persistence integration.

test('start game, reload, click Resume → state restored', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 800);
    await page.evaluate(() => window.game.onAsk(0));
    // Reload — main.js without ?game-id= but storage exists → Resume visible.
    await page.goto('');
    await expect(page.locator('#btn-resume-game')).toBeVisible();
    await page.click('#btn-resume-game');
    await expect(page.locator('#screen-game')).toBeVisible();
});

test('resumeFromStorage returns false when no active state', async ({ page }) => {
    await page.goto('');
    const ok = await page.evaluate(() => window.game.resumeFromStorage());
    expect(ok).toBeFalsy();
});

test('resumeFromStorage with saved puzzle missing config + missing qpr', async ({ page }) => {
    await page.goto('');
    const r1 = await page.evaluate(() => {
        // Save: puzzle missing config entirely → resumeFromStorage's
        // `if (s.puzzle && s.puzzle.config)` takes its else branch.
        const p = generatePuzzle('EASY', 801);
        delete p.config;
        saveActive(new GameState(p));
        return window.game.resumeFromStorage();
    });
    expect(r1).toBe(true);
    await expect(page.locator('#screen-game')).toBeVisible();

    const r2 = await page.evaluate(() => {
        // Save: puzzle WITH config but no questionsPerRound (covers the
        // L34 qpr-falsy branch inside resumeFromStorage).
        const p = generatePuzzle('CUSTOM', 802, { digitMin: 1, digitMax: 5, verifiers: 3, questionsPerRound: 3 });
        delete p.config.questionsPerRound;
        saveActive(new GameState(p));
        return window.game.resumeFromStorage();
    });
    expect(r2).toBe(true);
});

test('beginWithPuzzle: puzzle with NO config (covers L46 if[1] branch)', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 804);
        delete p.config;
        window.game.startWithPuzzle(p);
    });
    await expect(page.locator('#screen-game')).toBeVisible();
});

test('refreshMainMenu hasActive=true branch (Resume button shows)', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        saveActive(new GameState(generatePuzzle('EASY', 803)));
        window.game.refreshMainMenu();
    });
    await expect(page.locator('#btn-resume-game')).toBeVisible();
});
