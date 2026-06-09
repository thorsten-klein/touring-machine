import { test, expect } from './coverage-fixture.js';

// Training mode: criteria are revealed up-front (no asking). Covers the
// branches that the standard-flow specs don't reach:
//   • main.js: TRAINING in the level-select onChoose
//   • generator.js: LEVELS[level].training fallback in generatePuzzle
//   • game.js: computeDeductions synthesized-deduction branch,
//              renderAll skip-notes/skip-proposal/skip-end-round/etc.,
//              showEndScreen rank/expected hide branch,
//              subtitleForLevel TRAINING case
//   • ui.js: renderVerifiers training=true → no Ask button per card

test('training: start from level select reveals criteria, hides ask UI, submit wins', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('');

    // Open the level-info modal for Training first — covers
    // subtitleForLevel('TRAINING') and openLevelInfo for a non-CUSTOM level.
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Training")) .level-info-icon');
    await expect(page.locator('#level-info-modal')).toBeVisible();
    await expect(page.locator('#level-info-subtitle')).toContainText('revealed up-front');
    await page.click('#btn-close-level-info');

    // Start a training game via the level button — exercises the
    // main.js TRAINING branch + generator's LEVELS-fallback training flag.
    await page.click('#level-options .level-option:has(strong:text("Training"))');
    await expect(page.locator('#screen-game')).toBeVisible();

    // The question-asking UI must be hidden in training mode — but the
    // proposal dials stay visible above the Submit / Give-up buttons.
    await expect(page.locator('#proposal-section')).toBeVisible();
    await expect(page.locator('#proposal-dials .dial')).toHaveCount(3);
    await expect(page.locator('#round-hint')).toContainText('Submit code');
    await expect(page.locator('#notes-section')).toBeHidden();
    await expect(page.locator('#btn-end-round')).toBeHidden();
    await expect(page.locator('#info-round')).toBeHidden();
    await expect(page.locator('#info-questions')).toBeHidden();

    // Every verifier card must render WITHOUT an Ask button, and every
    // card's active option must be marked ✓ (the synthesized deduction).
    const cards = page.locator('.verifier-card');
    await expect(cards).toHaveCount(5);
    await expect(page.locator('.verifier-card .vbtn')).toHaveCount(0);
    await expect(page.locator('.verifier-card .vopt.confirmed')).toHaveCount(5);

    // Submit the puzzle's known solution to win in training — covers the
    // showEndScreen training branch (hides rank/expected, rewrites stats).
    await page.evaluate(() => window.game.finishWithGuess(window.game.state.puzzle.solution));
    await expect(page.locator('#screen-end')).toBeVisible();
    await expect(page.locator('#end-ranking')).toBeHidden();
    await expect(page.locator('#end-expected')).toBeHidden();
    await expect(page.locator('#end-stats')).toContainText('training mode');
});

test('training: explicit opts.training=true via generatePuzzle round-trips encode/decode', async ({ page }) => {
    await page.goto('');
    const out = await page.evaluate(() => {
        // Pass training via opts (covers the `opts.training !== undefined`
        // arm in generatePuzzle that the level-fallback path doesn't).
        const puzzle = generatePuzzle('CLASSIC', 12345, { verifiers: 4, training: true });
        const id = encodeGameId(puzzle);
        const decoded = decodeGameId(id);
        return {
            level: puzzle.level,
            training: puzzle.config.training,
            id,
            decodedLevel: decoded.level,
            decodedTraining: decoded.config.training,
        };
    });
    // Encoded as CLASSIC (the level the caller passed) — opts.training is
    // a config flag, not a level switch, so it doesn't change the letter.
    expect(out.level).toBe('CLASSIC');
    expect(out.training).toBe(true);
    expect(out.id.startsWith('L')).toBe(true);
    expect(out.decodedLevel).toBe('CLASSIC');
    // Decoded level is CLASSIC → its config.training falls back to false.
    expect(out.decodedTraining).toBe(false);
});

test('training: give-up flow uses the lost stats text', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('TRAINING', 99, { verifiers: 4 });
        window.game.startWithPuzzle(p);
        // Submitting a deliberately wrong code drives showEndScreen(won=false)
        // for a training puzzle — covers the lost arm of the won ternary.
        const sol = p.solution.slice();
        sol[0] = (sol[0] % GAME_CONFIG.digitMax) + 1;
        window.game.finishWithGuess(sol);
    });
    await expect(page.locator('#screen-end')).toBeVisible();
    await expect(page.locator('#end-stats')).toContainText('Training round ended.');
});

test('training: T-prefixed game id decodes back to TRAINING with training:true', async ({ page }) => {
    await page.goto('');
    // Build a training puzzle, encode → 'T...', decode → TRAINING.
    const out = await page.evaluate(() => {
        const p = generatePuzzle('TRAINING', 7, { verifiers: 4 });
        const id = encodeGameId(p);
        const d  = decodeGameId(id);
        return { id, level: d.level, training: d.config.training };
    });
    expect(out.id.startsWith('T')).toBe(true);
    expect(out.level).toBe('TRAINING');
    expect(out.training).toBe(true);

    // extractGameIdFromInput must accept the T-prefixed plain id (covers
    // the regex update in game.js).
    const accepted = await page.evaluate((id) => {
        // No URL shape — feed the plain id directly so we hit the regex arm.
        try {
            window.game.startSharedFromInput(id);
            return window.game.state.puzzle.level;
        } catch (e) { return 'ERR:' + e.message; }
    }, out.id);
    expect(accepted).toBe('TRAINING');
});
