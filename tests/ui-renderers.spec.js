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
        [2, 5, true,  'guess'],   // won, plural
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
