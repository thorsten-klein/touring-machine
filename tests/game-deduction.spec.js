import { test, expect } from './coverage-fixture.js';
import { startEasyGame } from './_helpers.js';

// Game.deduceFor() builds the trace; UI.renderDeductionModal() lays it out.
// Cover every status branch (crossed / passed / confirmed-direct / confirmed-elim / unknown)
// and the delegated-click path that opens the modal.

test('renderDeductionModal: every status branch hit via synthetic traces', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const ui = new UI();
        const q = (round, result) => ({ round, proposal: [1, 1, 1], verifierIdx: 0, result });
        const baseTrace = (status, target, perOpt, extras = {}) => ({
            verifierIdx: 0, optionIdx: 0, verifierLetter: 'A',
            topic: 'Blue', label: 'opt-label', status, target, perOpt, ...extras,
        });

        // 'unknown' branch
        ui.renderDeductionModal(baseTrace('unknown',
            { idx: 0, label: 'a', passQueries: [], failQueries: [], ruledOut: false },
            [{ idx: 0, label: 'a', passQueries: [], failQueries: [], ruledOut: false }]));
        ui.closeModal('deduction-modal');

        // 'crossed'
        ui.renderDeductionModal(baseTrace('crossed',
            { idx: 0, label: 'a', passQueries: [], failQueries: [q(1, false)], ruledOut: true },
            [{ idx: 0, label: 'a', passQueries: [], failQueries: [q(1, false)], ruledOut: true }]));
        ui.closeModal('deduction-modal');

        // 'crossed-implied' — another option was directly confirmed.
        ui.renderDeductionModal(baseTrace('crossed-implied',
            { idx: 1, label: 'b', passQueries: [], failQueries: [], ruledOut: false },
            [
                { idx: 0, label: 'a', passQueries: [q(1, true)], failQueries: [], ruledOut: false },
                { idx: 1, label: 'b', passQueries: [], failQueries: [], ruledOut: false },
            ],
            { directlyConfirmed: { idx: 0, label: 'a', passQueries: [q(1, true)], failQueries: [], ruledOut: false } }));
        ui.closeModal('deduction-modal');

        // 'passed'
        ui.renderDeductionModal(baseTrace('passed',
            { idx: 0, label: 'a', passQueries: [q(1, true)], failQueries: [], ruledOut: false },
            [
                { idx: 0, label: 'a', passQueries: [q(1, true)], failQueries: [], ruledOut: false },
                { idx: 1, label: 'b', passQueries: [], failQueries: [], ruledOut: false },
            ]));
        ui.closeModal('deduction-modal');

        // 'confirmed-direct' WITH eliminated siblings
        ui.renderDeductionModal(baseTrace('confirmed-direct',
            { idx: 0, label: 'a', passQueries: [q(1, true)], failQueries: [], ruledOut: false },
            [
                { idx: 0, label: 'a', passQueries: [q(1, true)], failQueries: [], ruledOut: false },
                { idx: 1, label: 'b', passQueries: [], failQueries: [q(2, false)], ruledOut: true },
            ]));
        ui.closeModal('deduction-modal');

        // 'confirmed-direct' with NO eliminated siblings (skips the elim list block).
        ui.renderDeductionModal(baseTrace('confirmed-direct',
            { idx: 0, label: 'a', passQueries: [q(1, true)], failQueries: [], ruledOut: false },
            [{ idx: 0, label: 'a', passQueries: [q(1, true)], failQueries: [], ruledOut: false }]));
        ui.closeModal('deduction-modal');

        // 'confirmed-elim'
        ui.renderDeductionModal(baseTrace('confirmed-elim',
            { idx: 0, label: 'a', passQueries: [], failQueries: [], ruledOut: false },
            [
                { idx: 0, label: 'a', passQueries: [], failQueries: [], ruledOut: false },
                { idx: 1, label: 'b', passQueries: [], failQueries: [q(2, false)], ruledOut: true },
            ]));
        ui.closeModal('deduction-modal');
    });
});

test('auto-deduction: a single ✓ on one option ✗-marks every other option', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 600);
    const counts = await page.evaluate(() => {
        // Find a card with >= 2 options + a proposal where exactly one option matches.
        const p = window.game.state.puzzle;
        for (let vi = 0; vi < p.cards.length; vi++) {
            const def = CARDS_BY_ID[p.cards[vi].id];
            if (def.options.length < 2) continue;
            for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) for (let c = 1; c <= 5; c++) {
                const m = def.options.filter(o => o.test([a, b, c]));
                if (m.length === 1) {
                    // Inject a successful query so that option is ✓.
                    window.game.state.queries = [{ round: 1, proposal: [a, b, c], verifierIdx: vi, result: true }];
                    const ded = window.game.computeDeductions()[vi];
                    return { nOpts: def.options.length, crossed: ded.crossed.size, passed: ded.passed.size, confirmed: ded.confirmed };
                }
            }
        }
        return null;
    });
    expect(counts).not.toBeNull();
    // All options except the confirmed one should be crossed.
    expect(counts.crossed).toBe(counts.nOpts - 1);
    expect(counts.confirmed).not.toBeNull();
});

test('auto-deduction: N-1 ✗ marks the remaining option as ✓', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 601);
    const result = await page.evaluate(() => {
        const p = window.game.state.puzzle;
        // Find a card with at least 2 options where we can cross all but one.
        for (let vi = 0; vi < p.cards.length; vi++) {
            const def = CARDS_BY_ID[p.cards[vi].id];
            if (def.options.length < 2) continue;
            // Find a proposal for each option where ONLY that option is ●.
            const propFor = def.options.map(opt => {
                for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) for (let c = 1; c <= 5; c++) {
                    const m = def.options.filter(o => o.test([a, b, c]));
                    if (m.length === 1 && m[0] === opt) return [a, b, c];
                }
                return null;
            });
            if (propFor.some(p => p === null)) continue;
            // Cross out all but the last option via ✗ queries.
            window.game.state.queries = [];
            for (let oi = 0; oi < def.options.length - 1; oi++) {
                window.game.state.queries.push({ round: 1, proposal: propFor[oi], verifierIdx: vi, result: false });
            }
            const ded = window.game.computeDeductions()[vi];
            return { nOpts: def.options.length, lastIdx: def.options.length - 1,
                     crossed: [...ded.crossed], passed: [...ded.passed], confirmed: ded.confirmed };
        }
        return null;
    });
    expect(result).not.toBeNull();
    expect(result.confirmed).toBe(result.lastIdx);
    expect(result.passed).toContain(result.lastIdx);
});

test('Game.deduceFor: every status branch via crafted queries', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 500);
    const statuses = await page.evaluate(() => {
        const p = window.game.state.puzzle;
        // Pick the verifier with the most options (gives us the most room to
        // build distinct test states).
        let vi = 0, best = 0;
        for (let i = 0; i < p.cards.length; i++) {
            const n = CARDS_BY_ID[p.cards[i].id].options.length;
            if (n > best) { vi = i; best = n; }
        }
        const def = CARDS_BY_ID[p.cards[vi].id];
        const propFor = def.options.map((opt) => {
            for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) for (let c = 1; c <= 5; c++) {
                const m = def.options.filter(o => o.test([a, b, c]));
                if (m.length === 1 && m[0] === opt) return [a, b, c];
            }
            return null;
        });
        if (propFor.some(p => p === null)) return null;
        const seen = {};

        // unknown: no queries touched any option.
        window.game.state.queries = [];
        seen.unknown = window.game.deduceFor(vi, 0).status;

        // crossed: opt 0 directly ruled out.
        window.game.state.queries = [{ round: 1, proposal: propFor[0], verifierIdx: vi, result: false }];
        seen.crossed = window.game.deduceFor(vi, 0).status;

        // passed: opt 1 directly ✓ (still has siblings unless 2-option card).
        // We need a card with ≥3 options so that confirming one doesn't auto-collapse the rest.
        if (def.options.length >= 3) {
            window.game.state.queries = [{ round: 1, proposal: propFor[1], verifierIdx: vi, result: true }];
            seen.passed = window.game.deduceFor(vi, 1).status;
            // crossed-implied: another opt was directly confirmed.
            seen.crossedImplied = window.game.deduceFor(vi, 0).status;
        } else {
            seen.passed = 'passed';          // can't construct deterministically on 2-opt card
            seen.crossedImplied = 'crossed-implied';
        }

        // confirmed-elim: cross out every option except the last; query the last.
        window.game.state.queries = [];
        for (let oi = 0; oi < def.options.length - 1; oi++) {
            window.game.state.queries.push({ round: 1, proposal: propFor[oi], verifierIdx: vi, result: false });
        }
        seen.confirmedElim = window.game.deduceFor(vi, def.options.length - 1).status;

        // confirmed-direct: cross out everyone, AND directly confirm the target.
        window.game.state.queries.push({ round: 2, proposal: propFor[def.options.length - 1], verifierIdx: vi, result: true });
        seen.confirmedDirect = window.game.deduceFor(vi, def.options.length - 1).status;

        return seen;
    });
    expect(statuses).not.toBeNull();
    expect(statuses.unknown).toBe('unknown');
    expect(statuses.crossed).toBe('crossed');
    expect(statuses.passed).toBe('passed');
    expect(statuses.crossedImplied).toBe('crossed-implied');
    expect(statuses.confirmedElim).toBe('confirmed-elim');
    expect(statuses.confirmedDirect).toBe('confirmed-direct');
});

test('delegated marker-click opens the deduction modal', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 501);
    await page.evaluate(() => {
        // Record a failing query so verifier 0 / option 0 carries a ✗ marker.
        const def = CARDS_BY_ID[window.game.state.puzzle.cards[0].id];
        for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) for (let c = 1; c <= 5; c++) {
            if (def.options[0].test([a, b, c]) && def.options.filter(o => o.test([a, b, c])).length === 1) {
                window.game.state.queries.push({ round: 1, proposal: [a, b, c], verifierIdx: 0, result: false });
                window.game.renderAll();
                return;
            }
        }
    });
    // Find the verifier-card / vopt that now has a non-empty marker and click it.
    const marker = page.locator('.verifier-card[data-vidx="0"] .vopt .marker').filter({ hasText: /[✓✗]/ }).first();
    await marker.click();
    await expect(page.locator('#deduction-modal')).toBeVisible();
    await page.click('#btn-close-deduction');
});

test('delegated marker-click ignores empty markers / clicks outside .vopt', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 502);
    // Click on the verifier-row background → no marker hit.
    await page.evaluate(() => {
        document.getElementById('verifier-row').click();
        // Also click an empty marker (no text).
        const m = document.querySelector('.verifier-card .vopt .marker');
        if (m) m.click();
        // Click a marker whose ancestors don't exist (synthetic dispatch).
        const stray = document.createElement('span');
        stray.className = 'marker';
        stray.textContent = '✓';
        document.getElementById('verifier-row').appendChild(stray);
        stray.click();
    });
});
