import { test, expect } from './coverage-fixture.js';

// Drives a full Easy-level game using a mix of UI clicks and direct game
// method calls. Direct calls bypass the per-verifier Ask-enabled gating so we
// can advance the state regardless of which option currently matches.
test('easy game full lifecycle', async ({ page }) => {
    await page.goto('');

    await page.click('#btn-start-game');
    await expect(page.locator('#screen-level')).toBeVisible();
    await page.click('#level-options .level-option:has(strong:text("Easy"))');
    await expect(page.locator('#screen-game')).toBeVisible();

    // Bump every dial to exercise onProposalChange + updateVerifierPreviews
    for (const c of ['blue', 'yellow', 'purple']) {
        await page.click(`.dial.${c} .dial-step:has-text("+")`);
        await page.click(`.dial.${c} .dial-step:has-text("−")`);
        await page.click(`.dial.${c} .dial-step:has-text("−")`); // wrap-around
    }

    // Ask three verifiers directly → triggers cap-reached auto-endRound.
    await page.evaluate(() => {
        window.game.onAsk(0);
        window.game.onAsk(1);
        window.game.onAsk(2);
    });

    // Confirm notes table now has rows (res-ok or res-no cells).
    await expect(page.locator('#notes-table .res-ok, #notes-table .res-no')).toHaveCount(3);

    // Start the next round (pendingNewRound → false branch).
    await page.evaluate(() => window.game.onAsk(0));

    // Click End round — needs ≥1 query in active round
    await page.click('#btn-end-round');

    // Submit code via modal
    await page.click('#btn-submit-code');
    await expect(page.locator('#submit-modal')).toBeVisible();
    await page.click('#submit-modal .dial.blue .dial-step:has-text("+")');
    await page.click('#btn-confirm-submit');
    await expect(page.locator('#screen-end')).toBeVisible();

    // Replay same puzzle
    await page.click('#btn-replay-same');
    await expect(page.locator('#screen-game')).toBeVisible();

    // Open share modal via topbar — exercises wireGlobalUI btn-share branch
    await page.click('#btn-share');
    await expect(page.locator('#share-modal')).toBeVisible();
    await page.click('#btn-share-copy-url');
    await page.click('#btn-share-copy-id');
    await page.click('#btn-share-close');

    // Open rules modal via topbar
    await page.click('#btn-info');
    await expect(page.locator('#rules-modal')).toBeVisible();
    await page.click('#btn-close-rules');

    // Give up: cancel first, then confirm
    await page.click('#btn-give-up');
    await expect(page.locator('#giveup-modal')).toBeVisible();
    await page.click('#btn-cancel-giveup');
    await expect(page.locator('#giveup-modal')).toBeHidden();
    await page.click('#btn-give-up');
    await page.click('#btn-confirm-giveup');
    await expect(page.locator('#screen-end')).toBeVisible();

    // Back to menu via end screen — wires onMenu callback
    await page.click('#btn-end-menu');
    await expect(page.locator('#screen-main')).toBeVisible();
});
