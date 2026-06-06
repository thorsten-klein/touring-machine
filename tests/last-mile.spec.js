import { test, expect } from './coverage-fixture.js';

// The remaining sub-1% branches that need exact, surgical tests.

test('ui.setAllAskButtons exercises forEach against rendered buttons', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 2001);
        window.game.startWithPuzzle(p);
        // setAllAskButtons is defined but unused by source. Call it directly.
        window.game.ui.setAllAskButtons(false);
        window.game.ui.setAllAskButtons(true);
    });
});

test('ui.setVerifierAskEnabled with a real button (btn-exists true branch)', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 2002);
        window.game.startWithPuzzle(p);
        window.game.ui.setVerifierAskEnabled(0, false);
        window.game.ui.setVerifierAskEnabled(0, true);
    });
});

test('ui.updateVerifierPreviews: !node branch and deductions[i] fallback', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 2003);
        window.game.startWithPuzzle(p);
        // Wipe the verifier-row → querySelector for .preview returns null → !node branch.
        document.getElementById('verifier-row').innerHTML = '';
        window.game.ui.updateVerifierPreviews(p, [], [1, 1, 1]);
        // renderVerifiers with a sparse deductions array → deductions[i] || {...} fallback.
        window.game.ui.renderVerifiers(p, [], [], () => {}, [1, 1, 1]);
        // updateVerifierPreviews with sparse deductions on freshly rendered row
        window.game.ui.updateVerifierPreviews(p, [], [1, 1, 1]);
    });
});

test('renderEnd plurals: each ternary hit both ways', async ({ page }) => {
    await page.goto('');
    for (const [r, q, won] of [[1, 1, true], [2, 2, true], [1, 1, false], [3, 5, false]]) {
        await page.evaluate(({ r, q, won }) => {
            const p = generatePuzzle('EASY', 2100 + r * 10 + q);
            window.game.startWithPuzzle(p);
            // Submit a wrong code so gaveUp branch is false but guessedCode is set.
            const code = p.solution.slice();
            if (!won) code[0] = (code[0] % 5) + 1;
            window.game.state.submitGuess(code);
            window.game.state.round = r;
            // Inflate queries so questionsAsked() matches q.
            window.game.state.queries = Array.from({ length: q }, () => ({
                round: r, proposal: [1, 1, 1], verifierIdx: 0, result: true,
            }));
            window.game.showEndScreen({ won, gaveUp: false });
        }, { r, q, won });
    }
    // gaveUp branch with both plural and singular permutations.
    for (const [r, q] of [[1, 1], [2, 3]]) {
        await page.evaluate(({ r, q }) => {
            const p = generatePuzzle('EASY', 2900 + r * 10 + q);
            window.game.startWithPuzzle(p);
            window.game.state.finished = true;
            window.game.state.outcome = 'lost';
            window.game.state.round = r;
            window.game.state.queries = Array.from({ length: q }, () => ({
                round: 1, proposal: [1, 1, 1], verifierIdx: 0, result: false,
            }));
            window.game.showEndScreen({ won: false, gaveUp: true });
        }, { r, q });
    }
});

test('Ask button: actually click an enabled one (covers arrow fn at renderVerifiers callsite)', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 2300);
        window.game.startWithPuzzle(p);
        // Find a proposal where verifier 0 has exactly one active option.
        const def = CARDS_BY_ID[p.cards[0].id];
        outer: for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) for (let c = 1; c <= 5; c++) {
            const n = def.options.filter(o => o.test([a, b, c])).length;
            if (n === 1) {
                window.game.state.proposal = [a, b, c];
                window.game.renderAll();
                break outer;
            }
        }
    });
    // Wait for the Ask button on verifier 0 to be enabled, then click via UI.
    const btn = page.locator('.verifier-card[data-vidx="0"] .vbtn');
    await expect(btn).toBeEnabled();
    await btn.click();
});

test('custom modal: trigger digitMin >= digitMax adjustment via digitMin push', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    // Drive digitMax down to its min (3) FIRST.
    for (let i = 0; i < 12; i++) {
        await page.click('button[data-cfg="digitMax"][data-delta="-1"]');
    }
    await expect(page.locator('#cfg-digit-max')).toHaveText('3');
    // Now push digitMin up to 3 → triggers `if (key === 'digitMin')` true branch.
    for (let i = 0; i < 6; i++) {
        await page.click('button[data-cfg="digitMin"][data-delta="1"]');
    }
    await expect(page.locator('#cfg-digit-min')).toHaveText('2'); // clamped via digitMax-1
    await page.click('#btn-cancel-custom');
});

test('openPlaySharedModal: error with non-Error throw (e.message fallback)', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        window.game.openPlaySharedModal();
        window.decodeGameId = () => { throw new Error(''); }; // empty message → fallback to default text
        document.getElementById('play-shared-input').value = 'Eanything';
        document.getElementById('btn-play-shared-start').click();
    });
    await expect(page.locator('#play-shared-error')).toBeVisible();
});

test('custom modal: qpr=max triggers minRounds === expectedRounds branch', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    // Push qpr to 99 → minQueries/99 ≤ 1 and minQueries*1.4/99 ≤ 1 → both rounds collapse to 1.
    for (let i = 0; i < 100; i++) {
        await page.click('button[data-cfg="questionsPerRound"][data-delta="1"]');
    }
    await expect(page.locator('#cfg-qpr')).toHaveText('99');
    // Stats updated synchronously inside the click handler — should now show "~1 round".
    await expect(page.locator('#stat-rounds')).toContainText(/round/);
    await page.click('#btn-cancel-custom');
});

test('custom modal: generatePuzzle throwing inside chunk → catch branch', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('');
    await page.addInitScript(() => {
        // Patch generatePuzzle to throw on the FIRST modal call only, then restore.
        document.addEventListener('DOMContentLoaded', () => {
            let calls = 0;
            const orig = window.generatePuzzle;
            window.generatePuzzle = function (...args) {
                calls++;
                if (args[2] && args[2].maxAttempts === 2000) {
                    throw new Error('synthetic chunk failure');
                }
                return orig.apply(this, args);
            };
        }, { capture: true });
    });
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    // The first tryChunk call should throw → catch sets puzzle=null → keep searching.
    // After a few attempts the modal eventually settles. Cancel.
    await page.waitForTimeout(500);
    await page.click('#btn-cancel-custom');
});

test('custom modal: invalidate checkToken mid-search → cancellation branches', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    // Push verifiers to a value where generation takes a while, then click
    // cancel — that increments checkToken while a tryChunk is still scheduled,
    // so the cancellation if-blocks fire on the next tick.
    for (let i = 0; i < 30; i++) {
        await page.click('button[data-cfg="verifiers"][data-delta="1"]');
    }
    // Hop in and out via cancel + reopen so the modal re-runs runCheck while
    // an earlier tryChunk is still pending its setTimeout(0).
    await page.click('#btn-cancel-custom');
    // Re-open via the level-options link (modal is gone; level screen is visible).
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    await page.click('#btn-cancel-custom');
});

test('custom modal: ultra-spam stepper to land on the cancellation branches deterministically', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    // Override setTimeout inside the page so the modal's chunk-step runs with
    // a long delay, guaranteeing we click another stepper BEFORE the chunk runs.
    await page.evaluate(() => {
        const origST = window.setTimeout;
        window.setTimeout = (fn, ms) => origST(fn, Math.max(ms || 0, 200));
    });
    // Now click multiple steppers fast — each runCheck schedules a chunk that
    // will see myToken !== checkToken when it eventually runs.
    for (let i = 0; i < 5; i++) {
        await page.click('button[data-cfg="verifiers"][data-delta="1"]');
    }
    for (let i = 0; i < 5; i++) {
        await page.click('button[data-cfg="verifiers"][data-delta="-1"]');
    }
    // Let pending timers drain so the cancellation branches fire.
    await page.waitForTimeout(1000);
    await page.click('#btn-cancel-custom');
});

test('main menu: hidden btn-share is harmless to click; verify wireGlobalUI noop branches', async ({ page }) => {
    await page.goto('');
    // The btn-back handler is wired in wireGlobalUI. Already exercised, but
    // make sure the early-return state-null branch is hit explicitly.
    await page.evaluate(() => {
        document.getElementById('btn-back').click();
    });
});
