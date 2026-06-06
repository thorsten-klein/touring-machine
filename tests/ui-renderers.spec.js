import { test, expect } from './coverage-fixture.js';
import { startEasyGame } from './_helpers.js';

// Direct calls into UI class methods. Bypassing the Game wiring lets us hit
// branches that don't surface naturally during a play-through.

test('renderProposalDials locked + unlocked', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const ui = new UI();
        ui.renderProposalDials('#proposal-dials', [1, 2, 3], () => {}, { locked: true });
        ui.renderProposalDials('#proposal-dials', [1, 2, 3], () => {});
        // _equalizeVerifierCardWidths early-return when no cards exist yet.
        ui._equalizeVerifierCardWidths();
    });
});

test('updateProposalDials operates on freshly rendered dials', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page);
    await page.evaluate(() => new UI().updateProposalDials('#proposal-dials', [3, 3, 3]));
});

test('renderVerifiers + updateVerifierPreviews: sparse deductions, missing nodes', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page);
    await page.evaluate(() => {
        const p = window.game.state.puzzle;
        // Empty deductions array → the `deductions[i] || {...}` fallback inside
        // renderVerifiers + updateVerifierPreviews is exercised.
        window.game.ui.renderVerifiers(p, [], [], () => {}, [1, 1, 1]);
        window.game.ui.updateVerifierPreviews(p, [], [1, 1, 1]);
        // Wipe the verifier row → updateVerifierPreviews' !node branch fires.
        document.getElementById('verifier-row').innerHTML = '';
        window.game.ui.updateVerifierPreviews(p, [], [1, 1, 1]);
    });
});

test('setVerifierAskEnabled + setAllAskButtons cover present-and-missing button paths', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page);
    await page.evaluate(() => {
        window.game.ui.setVerifierAskEnabled(0, false);
        window.game.ui.setVerifierAskEnabled(0, true);
        window.game.ui.setVerifierAskEnabled(999, false);   // btn-missing branch
        window.game.ui.setAllAskButtons(false);
        window.game.ui.setAllAskButtons(true);
    });
});

test('renderNotesTable: empty queries (empty-row), and ambiguous-proposal (activeLabel null)', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        // Find a (puzzle, vi, proposal) where the verifier's options have ≠1
        // matches for the proposal — the activeLabel === null branch fires.
        let p, vi, badProp;
        outer: for (let s = 0; s < 80; s++) {
            const pp = generatePuzzle('HARD', s);
            if (!pp) continue;
            for (let i = 0; i < pp.cards.length; i++) {
                const def = CARDS_BY_ID[pp.cards[i].id];
                for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) for (let c = 1; c <= 5; c++) {
                    const n = def.options.filter(o => o.test([a, b, c])).length;
                    if (n !== 1) { p = pp; vi = i; badProp = [a, b, c]; break outer; }
                }
            }
        }
        if (!p) throw new Error('no ambiguous case');
        window.game.startWithPuzzle(p);
        window.game.state.queries = [];
        window.game.renderAll();                                    // empty-row branch
        window.game.state.queries = [{ round: 1, proposal: badProp, verifierIdx: vi, result: true }];
        window.game.renderAll();                                    // activeLabel null
    });
});

test('renderDigitMap: pre-disabled + pre-candidate cells, touch events, right-click', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page);
    // Pre-set some disabled + candidate digits BEFORE re-rendering so the
    // off/candidate class branches fire at render time.
    await page.evaluate(() => {
        window.game.state.disabledDigits[0].add(2);
        window.game.state.candidateDigits[1].add(3);
        window.game.renderAll();
    });
    const cell = page.locator('#digitmap-table tbody .dm-cell').first();
    await cell.click();
    // Right-click triggers the candidate toggle (contextmenu handler).
    await cell.click({ button: 'right' });
    // Touch long-press WITHOUT navigator.vibrate (covers the falsy branch).
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
        const c = document.querySelector('#digitmap-table tbody .dm-cell');
        c.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
        const c = document.querySelector('#digitmap-table tbody .dm-cell');
        c.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
    });
    // Touch long-press WITH navigator.vibrate stubbed (truthy branch).
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => true });
        const c = document.querySelector('#digitmap-table tbody .dm-cell');
        c.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
        const c = document.querySelector('#digitmap-table tbody .dm-cell');
        c.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
    });
    // Touchmove cancel branch: another touchstart, then touchmove before timer fires.
    await page.evaluate(() => {
        const c = document.querySelector('#digitmap-table tbody .dm-cell');
        c.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
        c.dispatchEvent(new TouchEvent('touchmove',  { bubbles: true }));
        c.dispatchEvent(new TouchEvent('touchend',   { bubbles: true, cancelable: true }));
    });

    // Suppress-click branch (ui.js): after a long-press timer fires and sets
    // suppressClick=true, the next click handler must short-circuit instead
    // of toggling the cross-out again. We dispatch touchstart → wait past
    // 500 ms → touchend → click, and verify the disabled-state didn't flip
    // back from the candidate toggle.
    await page.evaluate(() => {
        // Reset the cell's overlays so the assertion below is unambiguous.
        const s = window.game.state;
        s.disabledDigits[0].clear();
        s.candidateDigits[0].clear();
        window.game.renderAll();
    });
    await page.evaluate(() => {
        const c = document.querySelector('#digitmap-table tbody .dm-cell');
        c.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
    });
    await page.waitForTimeout(700);
    const cellHasCandidate = await page.evaluate(() => {
        const c = document.querySelector('#digitmap-table tbody .dm-cell');
        c.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
        c.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return c.classList.contains('candidate') && !c.classList.contains('off');
    });
    if (!cellHasCandidate) throw new Error('suppressClick branch failed: click after long-press toggled off');
});

test('renderDigitMap: onToggleOff/onCandidate callbacks survive a wiped table', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page);
    await page.evaluate(() => {
        let onOff, onCand;
        const orig = window.game.ui.renderDigitMap.bind(window.game.ui);
        window.game.ui.renderDigitMap = (dis, cand, a, b) => { onOff = a; onCand = b; orig(dis, cand, a, b); };
        window.game.renderAll();
        document.getElementById('digitmap-table').innerHTML = '';
        onOff(0, 99);   // querySelector finds no cell → inner `if (cell)` falsy branch
        onCand(0, 99);
    });
});

test('renderEnd: win/lose plurals (1 vs many rounds/questions, won + gaveUp + wrong-guess)', async ({ page }) => {
    await page.goto('');
    for (const [r, q, won, mode] of [
        [1, 1, true,  'guess'],   // won, singular
        [2, 5, true,  'guess'],   // won, plural — also drives all 5 ranking tiers
        [10, 50, true, 'guess'],  // won, plenty of queries → low-tier ranking
        [1, 1, false, 'guess'],   // wrong guess, singular
        [3, 4, false, 'guess'],   // wrong guess, plural
        [1, 1, false, 'gaveUp'],  // gave up, singular
        [2, 3, false, 'gaveUp'],  // gave up, plural
    ]) {
        await page.evaluate(({ r, q, won, mode }) => {
            const p = generatePuzzle('EASY', 3000 + r * 10 + q + (won ? 0 : 100));
            window.game.startWithPuzzle(p);
            window.game.state.round = r;
            window.game.state.queries = Array.from({ length: q }, () => ({
                round: 1, proposal: [1, 1, 1], verifierIdx: 0, result: true,
            }));
            if (mode === 'guess') {
                const code = p.solution.slice();
                if (!won) code[0] = (code[0] % 5) + 1;
                window.game.state.submitGuess(code);
            } else {
                window.game.state.finished = true;
                window.game.state.outcome = 'lost';
            }
            window.game.showEndScreen({ won, gaveUp: mode === 'gaveUp' });
        }, { r, q, won, mode });
    }
});

// Lucky Gambler tier: wins with questions < verifiers. Covers the
// classifyWin Lucky branch + renderEnd's special-tier rendering path
// (Special badge, skipped score breakdown, ★ ladder rung).
test('renderEnd: winning with fewer questions than verifiers → Lucky Gambler', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        // EASY puzzles have 4 verifiers; we ask only 1 question then guess
        // the correct code. classifyWin should pick the Lucky Gambler tier.
        const p = generatePuzzle('EASY', 8000);
        window.game.startWithPuzzle(p);
        window.game.state.round = 1;
        window.game.state.queries = [{ round: 1, proposal: [1, 1, 1], verifierIdx: 0, result: true }];
        window.game.state.submitGuess(p.solution.slice());
        window.game.showEndScreen({ won: true, gaveUp: false });
    });
    await expect(page.locator('#end-rank-badge')).toHaveText('Special');
    await expect(page.locator('#end-rank-title')).toHaveText('Lucky Gambler');
    // The score-combined block should still render, but no Efficiency/Pacing lines.
    const scoreLines = await page.locator('#end-rank-score > div').count();
    if (scoreLines !== 1) throw new Error(`expected 1 score line for Lucky, got ${scoreLines}`);
});

// Drives the equal-min/max + singular-unit branches of the expected-average
// formatter (minRounds === expRounds, expRounds === 1). A CUSTOM puzzle with
// qpr=99 makes both round counts collapse to 1 regardless of bit content.
test('renderEnd: expected-average collapses to "1 round" when min === max === 1', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('CUSTOM', 7000, {
            digitMin: 1, digitMax: 5, verifiers: 3, questionsPerRound: 99,
        });
        window.game.startWithPuzzle(p);
        window.game.state.round = 1;
        window.game.state.queries = Array.from({ length: 3 }, () => ({
            round: 1, proposal: [1, 1, 1], verifierIdx: 0, result: true,
        }));
        window.game.state.submitGuess(p.solution.slice());
        window.game.showEndScreen({ won: true, gaveUp: false });
    });
    const text = await page.locator('#end-expected-vals').textContent();
    if (!/^1 round /.test(text)) {
        throw new Error(`expected text to start with "1 round ", got: ${text}`);
    }
});

// Cover ui.js's `puzzle.config && puzzle.config.questionsPerRound || GAME_CONFIG.questionsPerRound`
// fallback in renderEnd. Both halves of the short-circuit are exercised:
//   (a) puzzle with no .config           → first ternand undefined → falls through
//   (b) puzzle with .config but no qpr   → second ternand undefined → falls through
test('renderEnd: ranking falls back to GAME_CONFIG.questionsPerRound when puzzle.config lacks it', async ({ page }) => {
    await page.goto('');
    for (const which of ['no-config', 'no-qpr']) {
        await page.evaluate((which) => {
            const p = generatePuzzle('EASY', 5000);
            window.game.startWithPuzzle(p);
            window.game.state.round = 3;
            window.game.state.queries = Array.from({ length: 7 }, () => ({
                round: 1, proposal: [1, 1, 1], verifierIdx: 0, result: true,
            }));
            const code = p.solution.slice();
            window.game.state.submitGuess(code);
            // Mutate the puzzle for the end-screen render path, AFTER state
            // is set up — submitGuess doesn't read .config.
            if (which === 'no-config') delete window.game.state.puzzle.config;
            else delete window.game.state.puzzle.config.questionsPerRound;
            window.game.showEndScreen({ won: true, gaveUp: false });
        }, which);
    }
});
