import { test, expect } from './coverage-fixture.js';
import { startEasyGame } from './_helpers.js';

// Share modal (topbar), Play-shared modal, deep-link via ?game-id=, and the
// end-screen share buttons. Also covers extractGameIdFromInput branches.

test('share modal: copy buttons + web share buttons (mocked)', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: async () => true });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => true } });
    });
    await page.goto('');
    await startEasyGame(page, 600);
    await page.click('#btn-share');
    await expect(page.locator('#share-modal')).toBeVisible();
    await page.click('#btn-share-copy-url');
    await page.click('#btn-share-copy-id');
    await expect(page.locator('#btn-share-share-url')).toBeVisible();
    await page.click('#btn-share-share-url');
    await page.click('#btn-share-share-id');
    await page.click('#btn-share-close');
});

test('end-screen share buttons (web-share supported + clipboard)', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: async () => true });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => true } });
    });
    await page.goto('');
    await startEasyGame(page, 601);
    await page.evaluate(() => {
        window.game.state.submitGuess(window.game.state.puzzle.solution.slice());
        window.game.showEndScreen({ won: true, gaveUp: false });
    });
    await page.click('#btn-end-copy-url');
    await page.click('#btn-end-copy-id');
    await page.click('#btn-end-share-url');
    await page.click('#btn-end-share-id');
});

test('web-share unsupported: buttons hidden in share-modal and end-screen', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    });
    await page.goto('');
    await startEasyGame(page, 602);
    await page.click('#btn-share');
    await expect(page.locator('#btn-share-share-url')).toBeHidden();
    await page.click('#btn-share-close');
    await page.evaluate(() => {
        window.game.state.submitGuess(window.game.state.puzzle.solution.slice());
        window.game.showEndScreen({ won: true, gaveUp: false });
    });
    await expect(page.locator('#btn-end-share-url')).toBeHidden();
});

test('deep-link ?game-id= / ?game= / ?id= load shared puzzle', async ({ page }) => {
    await page.goto('');
    const id = await page.evaluate(() => encodeGameId(generatePuzzle('EASY', 700)));
    for (const k of ['game-id', 'game', 'id']) {
        await page.goto(`?${k}=` + encodeURIComponent(id));
        await expect(page.locator('#screen-game')).toBeVisible();
    }
});

test('deep-link with malformed id triggers toast and stays on main', async ({ page }) => {
    await page.goto('?game-id=Zbogus');
    await expect(page.locator('#screen-main')).toBeVisible();
    await expect(page.locator('#toast')).toBeVisible();
});

test('Play-shared modal: URL input, plain id, invalid, URL-with-no-id, malformed URL', async ({ page }) => {
    await page.goto('');
    const id = await page.evaluate(() => encodeGameId(generatePuzzle('EASY', 701)));

    await page.click('#btn-play-friends');
    await page.fill('#play-shared-input', 'http://example.com/x?game-id=' + encodeURIComponent(id));
    await page.click('#btn-play-shared-start');
    await expect(page.locator('#screen-game')).toBeVisible();
    await page.click('#btn-back');

    await page.click('#btn-play-friends');
    await page.fill('#play-shared-input', id);
    await page.click('#btn-play-shared-start');
    await expect(page.locator('#screen-game')).toBeVisible();
    await page.click('#btn-back');

    for (const bad of ['not-a-puzzle', 'http://example.com/no-id', 'https://[bad-url']) {
        await page.click('#btn-play-friends');
        await page.fill('#play-shared-input', bad);
        await page.click('#btn-play-shared-start');
        await expect(page.locator('#play-shared-error')).toBeVisible();
        await page.click('#btn-play-shared-cancel');
    }
});

test('extractGameIdFromInput: null / empty branches', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        if (extractGameIdFromInput(null) !== null) throw new Error();
        if (extractGameIdFromInput('')   !== null) throw new Error();
    });
});

test('history.replaceState failure is caught silently', async ({ page }) => {
    await page.addInitScript(() => { history.replaceState = () => { throw new Error('blocked'); }; });
    await page.goto('');
    const id = await page.evaluate(() => encodeGameId(generatePuzzle('EASY', 702)));
    await page.goto('?game-id=' + encodeURIComponent(id));
    await expect(page.locator('#screen-game')).toBeVisible();
});

test('main.js gameIdParam: non-Error throw hits `e.message || e` fallback', async ({ page }) => {
    await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
            window.decodeGameId = function () { throw 'plain string'; }; // eslint-disable-line no-throw-literal
        }, { capture: true });
    });
    await page.goto('?game-id=anything');
    await expect(page.locator('#toast')).toBeVisible();
});
