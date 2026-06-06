import { test, expect } from './coverage-fixture.js';

// Cover: ?game-id= URL path, the Play-shared modal (URL form + plain id form +
// invalid input), state resume from storage, decodeGameId paths.

test('shared puzzle: ?game-id= URL', async ({ page }) => {
    // Hand-craft a valid game id by walking ALL_CODES + CARDS in-page to find
    // a small puzzle. Easier: use a known valid preset by generating in-page.
    const gameId = await page.evaluate(async () => {
        // need to load the scripts first; this navigates by hand
        return null;
    });
    // simpler: load home first, generate a puzzle, then navigate
    await page.goto('');
    const id = await page.evaluate(() => {
        reconfigureGame({ digitMin: 1, digitMax: 5 });
        const p = generatePuzzle('EASY', 42);
        return encodeGameId(p);
    });

    await page.goto('?game-id=' + encodeURIComponent(id));
    await expect(page.locator('#screen-game')).toBeVisible();
});

test('shared puzzle: bad ?game-id= triggers toast', async ({ page }) => {
    await page.goto('?game-id=Zbogus');
    await expect(page.locator('#screen-main')).toBeVisible();
    await expect(page.locator('#toast')).toBeVisible();
});

test('alternate URL param names: ?game= and ?id=', async ({ page }) => {
    await page.goto('');
    const id = await page.evaluate(() => encodeGameId(generatePuzzle('EASY', 7)));
    await page.goto('?game=' + encodeURIComponent(id));
    await expect(page.locator('#screen-game')).toBeVisible();
    await page.goto('?id=' + encodeURIComponent(id));
    await expect(page.locator('#screen-game')).toBeVisible();
});

test('play-shared modal: paste URL form, plain id, and invalid', async ({ page }) => {
    await page.goto('');
    const id = await page.evaluate(() => encodeGameId(generatePuzzle('EASY', 3)));

    // 1) Paste a URL containing game-id
    await page.click('#btn-play-friends');
    await expect(page.locator('#play-shared-modal')).toBeVisible();
    const url = 'http://example.com/x?game-id=' + encodeURIComponent(id);
    await page.fill('#play-shared-input', url);
    await page.click('#btn-play-shared-start');
    await expect(page.locator('#screen-game')).toBeVisible();

    // back to menu
    await page.click('#btn-back');
    await expect(page.locator('#screen-main')).toBeVisible();

    // 2) Plain id
    await page.click('#btn-play-friends');
    await page.fill('#play-shared-input', id);
    await page.click('#btn-play-shared-start');
    await expect(page.locator('#screen-game')).toBeVisible();

    // back
    await page.click('#btn-back');

    // 3) Invalid -> error message
    await page.click('#btn-play-friends');
    await page.fill('#play-shared-input', 'not-a-puzzle');
    await page.click('#btn-play-shared-start');
    await expect(page.locator('#play-shared-error')).toBeVisible();
    await page.click('#btn-play-shared-cancel');

    // 4) URL but no game-id query → falls through to plain-id regex → no match
    await page.click('#btn-play-friends');
    await page.fill('#play-shared-input', 'http://example.com/no-id');
    await page.click('#btn-play-shared-start');
    await expect(page.locator('#play-shared-error')).toBeVisible();
    await page.click('#btn-play-shared-cancel');

    // 5) extractGameIdFromInput: invalid URL string that throws inside try
    await page.click('#btn-play-friends');
    await page.fill('#play-shared-input', 'https://[bad-url');
    await page.click('#btn-play-shared-start');
    await expect(page.locator('#play-shared-error')).toBeVisible();
    await page.click('#btn-play-shared-cancel');
});

test('resume from storage: start a game, reload, click Resume', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Easy"))');
    await expect(page.locator('#screen-game')).toBeVisible();
    // Asks one verifier so the state has a recorded query (round 1 has queries).
    await page.evaluate(() => window.game.onAsk(0));
    // toggle a digit-map cell to flip toggleDisabledDigit branch (add then remove)
    const cells = page.locator('#digitmap-table .dm-cell');
    await cells.first().click();
    await cells.first().click();

    // Reload — main.js without ?game-id= but state exists → "Resume" appears
    await page.goto('');
    await expect(page.locator('#btn-resume-game')).toBeVisible();
    await page.click('#btn-resume-game');
    await expect(page.locator('#screen-game')).toBeVisible();
});

test('resume from storage: no saved state, click Resume returns false (no-op)', async ({ page }) => {
    await page.goto('');
    // simulate calling resumeFromStorage with empty storage
    const ok = await page.evaluate(() => window.game.resumeFromStorage());
    expect(ok).toBeFalsy();
});
