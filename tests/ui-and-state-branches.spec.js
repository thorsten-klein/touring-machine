import { test, expect } from './coverage-fixture.js';

// Targets specific branches not covered by lifecycle test:
//   - UI: showScreen('end'), setVerifierAskEnabled missing btn,
//     updateProposalDials, el() factory uncovered attribute branches.
//   - State: canEndRound 0 queries, askVerifier when capped, endRound noop,
//     submitGuess wrong, toggleDisabledDigit add+remove, pendingNewRound,
//     deserialize edge cases (queries missing, startedAt missing, finished).
//   - main.js: history.replaceState catch.

test('UI: el() factory branches, setVerifierAskEnabled missing, updateProposalDials', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const ui = new UI();
        ui.showScreen('end');
        ui.showScreen('main');
        ui.setVerifierAskEnabled(999, false);                // btn missing branch
        ui.updateProposalDials('#proposal-dials', [3, 3, 3]); // no-op (empty container)
        // Exercise el() helper's `html` and null-child branches via direct call.
        el('div', { html: '<b>x</b>' });
        el('div', { 'data-x': false, 'data-y': null, 'data-z': undefined });
        el('div', { boolish: true }, null, undefined);
        // labelToColoredNodes with empty colors and with matches.
        const saved = GAME_CONFIG.colors.slice();
        GAME_CONFIG.colors = [];
        labelToColoredNodes('plain');
        GAME_CONFIG.colors = saved;
        labelToColoredNodes('blue greater than yellow');
        // autosize no-op
        autosize();
    });
});

test('state machine branches', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 5);
        const s = new GameState(p);
        // canEndRound with 0 queries → false
        if (s.canEndRound()) throw new Error('expected false');
        s.endRound();                       // no-op (canEndRound false)
        // roundsPlayed when not finished
        s.roundsPlayed();
        const ok1 = s.askVerifier(0);
        if (ok1 === null) throw new Error('null');
        if (!s.canEndRound()) throw new Error('expected true');
        s.askVerifier(0);
        s.askVerifier(0);
        // 4th ask in same round (no auto-end here) → null
        if (s.askVerifier(0) !== null) throw new Error('expected null');
        // endRound sets pendingNewRound
        s.endRound();
        if (!s.canQueryThisRound()) throw new Error('expected can-query while pending');
        // pendingNewRound branch advances round on next ask
        s.askVerifier(1);
        // submitGuess wrong code
        const wrong = s.puzzle.solution.slice();
        wrong[0] = (wrong[0] % 5) + 1;
        if (s.submitGuess(wrong)) throw new Error('expected wrong');
        // canQueryThisRound after finished
        if (s.canQueryThisRound()) throw new Error('expected false after finish');
        // toggleDisabledDigit add then remove
        s.toggleDisabledDigit(0, 3);
        s.toggleDisabledDigit(0, 3);
        if (s.disabledDigits[0].has(3)) throw new Error('expected removed');
        s.roundsPlayed(); // finished branch
        // serialize → deserialize round-trip
        const raw = s.serialize();
        const back = GameState.deserialize(raw);
        if (!back) throw new Error('null deserialize');
        // deserialize with disabledDigits + queries + startedAt missing (legacy)
        delete raw.disabledDigits;
        delete raw.queries;
        delete raw.startedAt;
        delete raw.finished;
        if (!GameState.deserialize(raw)) throw new Error('null legacy');
    });
});

test('end screen lose path with guessedCode set', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 99);
        window.game.startWithPuzzle(p);
        const wrong = p.solution.slice();
        wrong[0] = (wrong[0] % 5) + 1;
        window.game.state.submitGuess(wrong);
        window.game.showEndScreen({ won: false, gaveUp: false });
    });
    await expect(page.locator('#end-title.lose')).toBeVisible();
});

test('history.replaceState throws → caught silently', async ({ page }) => {
    await page.addInitScript(() => {
        history.replaceState = function () { throw new Error('blocked'); };
    });
    await page.goto('');
    const id = await page.evaluate(() => encodeGameId(generatePuzzle('EASY', 33)));
    await page.goto('?game-id=' + encodeURIComponent(id));
    await expect(page.locator('#screen-game')).toBeVisible();
});

test('give-up modal: cancel keeps game alive', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 44);
        window.game.startWithPuzzle(p);
    });
    await page.click('#btn-give-up');
    await expect(page.locator('#giveup-modal')).toBeVisible();
    await page.click('#btn-cancel-giveup');
    await expect(page.locator('#screen-game')).toBeVisible();
});

test('refreshMainMenu hasActive=true branch is exercised', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 55);
        const s = new GameState(p);
        saveActive(s);
        window.game.refreshMainMenu();
    });
    await expect(page.locator('#btn-resume-game')).toBeVisible();
});

test('resumeFromStorage path with a saved puzzle that has no config', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 66);
        delete p.config;
        const s = new GameState(p);
        saveActive(s);
    });
    await page.goto('');
    await page.click('#btn-resume-game');
    await expect(page.locator('#screen-game')).toBeVisible();
});

test('main menu → back-to-main from level select via onBack callback', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#btn-back-to-main');
    await expect(page.locator('#screen-main')).toBeVisible();
});

test('topbar back button from game returns to menu', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 77);
        window.game.startWithPuzzle(p);
    });
    await expect(page.locator('#screen-game')).toBeVisible();
    await page.click('#btn-back');
    await expect(page.locator('#screen-main')).toBeVisible();
});
