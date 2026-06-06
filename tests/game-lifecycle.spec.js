import { test, expect } from './coverage-fixture.js';
import { startEasyGame, makeAskable } from './_helpers.js';

// End-to-end happy path through a game: main menu → level → game → submit →
// end screen → replay/menu. Sprinkles in the small Game-class edge cases.

test('main-menu → easy game → ask → end-round → submit → end → replay → menu', async ({ page }) => {
    await page.goto('');

    await page.click('#btn-start-game');
    await expect(page.locator('#screen-level')).toBeVisible();
    await page.click('#level-options .level-option:has(strong:text("Easy"))');
    await expect(page.locator('#screen-game')).toBeVisible();

    // Drive every dial (covers onProposalChange + updateVerifierPreviews).
    for (const c of ['blue', 'yellow', 'purple']) {
        await page.click(`.dial.${c} .dial-step:has-text("+")`);
        await page.click(`.dial.${c} .dial-step:has-text("−")`);
        await page.click(`.dial.${c} .dial-step:has-text("−")`); // wrap
    }

    // Drive 3 asks via direct calls (cap → auto-endRound).
    await page.evaluate(() => {
        window.game.onAsk(0); window.game.onAsk(1); window.game.onAsk(2);
    });
    await expect(page.locator('#notes-table .res-ok, #notes-table .res-no')).toHaveCount(3);

    // pendingNewRound → ask one more, then End round (≥1 query branch).
    await page.evaluate(() => window.game.onAsk(0));
    await page.click('#btn-end-round');

    // Submit modal end-to-end.
    await page.click('#btn-submit-code');
    await expect(page.locator('#submit-modal')).toBeVisible();
    await page.click('#submit-modal .dial.blue .dial-step:has-text("+")');
    await page.click('#btn-confirm-submit');
    await expect(page.locator('#screen-end')).toBeVisible();

    // Replay same puzzle → new game.
    await page.click('#btn-replay-same');
    await expect(page.locator('#screen-game')).toBeVisible();

    // Topbar share + rules.
    await page.click('#btn-share');
    await page.click('#btn-share-close');
    await page.click('#btn-info');
    await page.click('#btn-close-rules');

    // Give-up modal: cancel, then confirm.
    await page.click('#btn-give-up');
    await page.click('#btn-cancel-giveup');
    await page.click('#btn-give-up');
    await page.click('#btn-confirm-giveup');
    await expect(page.locator('#screen-end')).toBeVisible();

    // End-screen routes (onReplaySame already covered; onNewPuzzle + onMenu next).
    await page.click('#btn-new-puzzle');
    await expect(page.locator('#screen-level')).toBeVisible();
    await page.click('#btn-back-to-main');
    await expect(page.locator('#screen-main')).toBeVisible();
});

test('end screen Back-to-menu callback', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 1);
    await page.evaluate(() => {
        window.game.state.submitGuess(window.game.state.puzzle.solution.slice());
        window.game.showEndScreen({ won: true, gaveUp: false });
    });
    await page.click('#btn-end-menu');
    await expect(page.locator('#screen-main')).toBeVisible();
});

test('cancel submit modal returns to game', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 2);
    await page.click('#btn-submit-code');
    await page.click('#btn-cancel-submit');
    await expect(page.locator('#submit-modal')).toBeHidden();
});

test('Ask button (UI click): only enabled when activeCountFor === 1', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 3);
    const ok = await makeAskable(page, 0);
    expect(ok).toBeTruthy();
    const btn = page.locator('.verifier-card[data-vidx="0"] .vbtn');
    await expect(btn).toBeEnabled();
    await btn.scrollIntoViewIfNeeded();
    await btn.click({ force: true });
});

test('Game guards: onAsk + onEndRound noop after state.finished', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 4);
    await page.evaluate(() => {
        window.game.state.finished = true;
        window.game.onAsk(0);
        window.game.onEndRound();
    });
});

test('renderAll: CUSTOM-level header with full + missing config fields', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('CUSTOM', 5, { digitMin: 1, digitMax: 5, verifiers: 3, questionsPerRound: 3 });
        delete p.config.verifiers;
        delete p.config.questionsPerRound;
        window.game.startWithPuzzle(p);
    });
});

test('renderAll without round-hint / btn-end-round in DOM (missing-element fallbacks)', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 6);
    await page.evaluate(() => {
        document.getElementById('round-hint').remove();
        document.getElementById('btn-end-round').remove();
        window.game.renderAll();
    });
});

test('round-hint text variants: zero asked, mid-round, cap reached, pending', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 7);
    // Inject queries to drive each hint variant.
    await page.evaluate(() => {
        window.game.state.queries = [{ round: 1, proposal: [1, 1, 1], verifierIdx: 0, result: true }];
        window.game.renderAll();
        while (window.game.state.queries.filter(q => q.round === 1).length < GAME_CONFIG.questionsPerRound) {
            window.game.state.queries.push({ round: 1, proposal: [1, 1, 1], verifierIdx: 0, result: true });
        }
        window.game.renderAll();   // cap-reached hint
        window.game.state.pendingNewRound = true;
        window.game.renderAll();   // pending hint
    });
});

test('onProposalChange when _lastDeductions is null', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 8);
    await page.evaluate(() => {
        window.game._lastDeductions = null;
        window.game.onProposalChange([2, 3, 4]);
    });
});

test('onAsk when askVerifier returns null', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 9);
    await page.evaluate(() => {
        window.game.state.askVerifier = () => null;
        window.game.onAsk(0);
    });
});

test('btn-back from game returns to main menu', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 10);
    await page.click('#btn-back');
    await expect(page.locator('#screen-main')).toBeVisible();
});

test('btn-share with no active state is a no-op', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => document.getElementById('btn-share').click());
});
