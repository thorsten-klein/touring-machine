import { test, expect } from './coverage-fixture.js';

// Mock navigator.share + clipboard to exercise webShare, webShareSupported,
// and copyText success/failure branches.

test('web share + copy success / failure', async ({ page }) => {
    // Install navigator.share + a failing clipboard BEFORE any page script runs.
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: async (opts) => {
                if (opts && opts.text && opts.text.includes('TRIGGER_ABORT')) {
                    const e = new Error('cancelled'); e.name = 'AbortError'; throw e;
                }
                if (opts && opts.text && opts.text.includes('TRIGGER_FAIL')) {
                    throw new Error('boom');
                }
                return true;
            },
        });
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (text) => {
                    if (text === 'COPY_FAIL') throw new Error('no');
                    return true;
                },
            },
        });
    });
    await page.goto('');

    // Drive a tiny game so the share modal can open
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 11);
        window.game.startWithPuzzle(p);
    });
    await expect(page.locator('#screen-game')).toBeVisible();

    // Open share modal → Web Share buttons are now visible (mocked support)
    await page.click('#btn-share');
    await expect(page.locator('#btn-share-share-url')).toBeVisible();
    await page.click('#btn-share-share-url'); // success path
    await page.click('#btn-share-share-id');  // success path

    // Exercise webShare AbortError + generic-error branches by calling directly
    await page.evaluate(async () => {
        await webShare({ title: 't', text: 'TRIGGER_ABORT', url: 'u' });           // AbortError, no toast
        await webShare({ title: 't', text: 'TRIGGER_FAIL',  url: 'u' }, { toast: () => {} }); // generic error, with ui
        await webShare({ title: 't', text: 'TRIGGER_FAIL',  url: 'u' });           // generic error, no ui
        await webShare({ title: 't', text: 'ok' });                                // success, no url
        // webShareSupported true branch already exercised; flip it false:
        const orig = navigator.share;
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        await webShare({ title: 't', text: 'no-support', url: 'u' });              // early return
        Object.defineProperty(navigator, 'share', { configurable: true, value: orig });
        // copyText failure path
        await copyText('COPY_FAIL', { toast: () => {} });
        // copyText with no ui (success + fail)
        await copyText('COPY_FAIL');
        await copyText('hello');
        // labelToColoredNodes when GAME_CONFIG.colors is empty
        const saved = GAME_CONFIG.colors.slice();
        GAME_CONFIG.colors = [];
        labelToColoredNodes('anything');
        GAME_CONFIG.colors = saved;
        // autosize no-op
        autosize();
    });
    await page.click('#btn-share-close');

    // End screen: also test the end-screen share buttons (webShare supported branch)
    await page.evaluate(() => {
        window.game.state.finished = true;
        window.game.state.outcome = 'won';
        window.game.state.guessedCode = window.game.state.puzzle.solution.slice();
        window.game.showEndScreen({ won: true, gaveUp: false });
    });
    await expect(page.locator('#screen-end')).toBeVisible();
    await page.click('#btn-end-copy-url');
    await page.click('#btn-end-copy-id');
    await page.click('#btn-end-share-url');
    await page.click('#btn-end-share-id');
});

test('web share unsupported branch (no navigator.share)', async ({ page }) => {
    // Force navigator.share undefined so webShareSupported() returns false.
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    });
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 22);
        window.game.startWithPuzzle(p);
    });
    await page.click('#btn-share');
    await expect(page.locator('#btn-share-share-url')).toBeHidden();
    await page.click('#btn-share-close');
    // Same on end screen
    await page.evaluate(() => {
        window.game.state.submitGuess(window.game.state.puzzle.solution.slice());
        window.game.showEndScreen({ won: true, gaveUp: false });
    });
    await expect(page.locator('#btn-end-share-url')).toBeHidden();
});

test('btn-share with no active game is a no-op', async ({ page }) => {
    await page.goto('');
    // From main menu, btn-share is hidden, but its handler can still be invoked.
    await page.evaluate(() => document.getElementById('btn-share').click());
});
