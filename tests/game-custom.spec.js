import { test, expect } from './coverage-fixture.js';

// Custom-level modal: stepper bounds, digitMin/digitMax adjustment, search
// states, start/cancel, edge cases inside the chunked search.

test('custom modal: edit cfg, hit all stepper bounds, start a puzzle', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    await expect(page.locator('#custom-status.ok')).toBeVisible({ timeout: 15000 });

    // digitMax → 9 then back; digitMin clamp at 3.
    for (let i = 0; i < 12; i++) await page.click('button[data-cfg="digitMax"][data-delta="1"]');
    await expect(page.locator('#cfg-digit-max')).toHaveText('9');
    for (let i = 0; i < 6;  i++) await page.click('button[data-cfg="digitMin"][data-delta="1"]');
    await expect(page.locator('#cfg-digit-min')).toHaveText('3');
    // Push digitMax down — triggers digitMax = digitMin + 1 adjustment (key='digitMax' branch).
    for (let i = 0; i < 12; i++) await page.click('button[data-cfg="digitMax"][data-delta="-1"]');
    // Restore a roomy range and pick non-default qpr (covers Q-suffix later).
    for (let i = 0; i < 4;  i++) await page.click('button[data-cfg="digitMax"][data-delta="1"]');
    for (let i = 0; i < 4;  i++) await page.click('button[data-cfg="digitMin"][data-delta="-1"]');
    await page.click('button[data-cfg="questionsPerRound"][data-delta="1"]');
    // qpr clamp at min (1).
    for (let i = 0; i < 8;  i++) await page.click('button[data-cfg="questionsPerRound"][data-delta="-1"]');
    await expect(page.locator('#cfg-qpr')).toHaveText('1');
    for (let i = 0; i < 2;  i++) await page.click('button[data-cfg="questionsPerRound"][data-delta="1"]');

    await page.click('button[data-cfg="verifiers"][data-delta="-1"]');
    await page.click('button[data-cfg="verifiers"][data-delta="-1"]');
    await expect(page.locator('#custom-status.ok')).toBeVisible({ timeout: 30000 });
    await page.click('#btn-start-custom');
    await expect(page.locator('#screen-game')).toBeVisible();
});

test('custom modal: triggers digitMin >= digitMax adjustment via digitMin (key="digitMin" branch)', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    // Drive digitMax DOWN to its min first, so digitMin can collide with it.
    for (let i = 0; i < 12; i++) await page.click('button[data-cfg="digitMax"][data-delta="-1"]');
    await expect(page.locator('#cfg-digit-max')).toHaveText('3');
    for (let i = 0; i < 6;  i++) await page.click('button[data-cfg="digitMin"][data-delta="1"]');
    await expect(page.locator('#cfg-digit-min')).toHaveText('2'); // clamped to digitMax-1
    await page.click('#btn-cancel-custom');
});

test('custom modal: verifier max clamp (push to 99)', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    for (let i = 0; i < 100; i++) await page.click('button[data-cfg="verifiers"][data-delta="1"]');
    await expect(page.locator('#cfg-verifiers')).toHaveText('99');
    for (let i = 0; i < 96;  i++) await page.click('button[data-cfg="verifiers"][data-delta="-1"]');
    await page.click('#btn-cancel-custom');
});

test('custom modal: open and cancel (checkToken++ + spinner hide)', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    await page.click('#btn-cancel-custom');
    await expect(page.locator('#custom-level-modal')).toBeHidden();
});

test('custom modal: minRounds === expectedRounds branch via qpr=99', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    for (let i = 0; i < 100; i++) await page.click('button[data-cfg="questionsPerRound"][data-delta="1"]');
    await expect(page.locator('#cfg-qpr')).toHaveText('99');
    await expect(page.locator('#stat-rounds')).toContainText(/round/);
    await page.click('#btn-cancel-custom');
});

test('custom modal: cancellation branches via overridden setTimeout delay', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('');
    await page.addInitScript(() => {
        // Once the page is up, slow down setTimeout so a fresh tryChunk schedule
        // hasn't fired yet by the time we click another stepper → the first
        // `if (myToken !== checkToken)` branch trips on the late tick.
        document.addEventListener('DOMContentLoaded', () => {
            const orig = window.setTimeout;
            window.setTimeout = (fn, ms) => orig(fn, Math.max(ms || 0, 200));
        }, { capture: true });
    });
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    for (let i = 0; i < 5; i++) await page.click('button[data-cfg="verifiers"][data-delta="1"]');
    for (let i = 0; i < 5; i++) await page.click('button[data-cfg="verifiers"][data-delta="-1"]');
    await page.waitForTimeout(800);   // let the delayed chunk fire and see the stale token
    await page.click('#btn-cancel-custom');
});

test('custom modal: Abort button cancels in-flight search without closing modal', async ({ page }) => {
    test.setTimeout(20000);
    await page.goto('');
    // Force every chunk to come back null so the search loop keeps going —
    // gives the test a stable in-flight state to abort.
    await page.evaluate(() => {
        window.__origGP = generatePuzzle;
        // eslint-disable-next-line no-global-assign
        generatePuzzle = () => null;
    });
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    // Abort button should appear while a search is running.
    await expect(page.locator('#btn-custom-abort')).toBeVisible();
    await page.click('#btn-custom-abort');
    // Status flips to the aborted message; the modal stays open and the
    // Abort button hides until the next search.
    await expect(page.locator('#custom-status.bad')).toContainText('aborted');
    await expect(page.locator('#btn-custom-abort')).toBeHidden();
    await expect(page.locator('#custom-level-modal')).toBeVisible();
    await page.evaluate(() => { generatePuzzle = window.__origGP; });
    await page.click('#btn-cancel-custom');
});

test('custom modal: Start when generatePuzzle returns null → toast fallback', async ({ page }) => {
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
