import { test, expect } from './coverage-fixture.js';
import { makeAskable } from './_helpers.js';

// Extreme mode: each verifier shows TWO criteria cards, only one is real.
// Tests cover preset+custom entry, dual-pane rendering, ask gating across
// panes, the direct + global deduction rules, and end-screen decoy reveal.

async function startExtremePreset(page, seed = 17) {
    await page.goto('');
    await page.evaluate((s) => {
        const p = generatePuzzle('EXTREME', s);
        window.game.startWithPuzzle(p);
    }, seed);
    await expect(page.locator('#screen-game')).toBeVisible();
}

test('extreme preset: renders two panes per verifier with the X-tag in head', async ({ page }) => {
    await startExtremePreset(page);
    const slotCount = await page.locator('.verifier-card.extreme').count();
    expect(slotCount).toBeGreaterThan(0);
    // Every slot has exactly two panes.
    const ok = await page.evaluate(() => {
        const slots = document.querySelectorAll('.verifier-card.extreme');
        return Array.from(slots).every(s => s.querySelectorAll('.vcard-pane').length === 2);
    });
    expect(ok).toBe(true);
    await expect(page.locator('.verifier-card.extreme .extreme-tag').first()).toBeVisible();
});

test('extreme custom modal: toggling extreme on starts an extreme puzzle', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    await expect(page.locator('#custom-status.ok')).toBeVisible({ timeout: 15000 });
    // Toggle extreme on, then ensure stats note "2 cards/verifier".
    await page.click('button[data-cfg="extreme"][data-delta="1"]');
    await expect(page.locator('#cfg-extreme')).toHaveText('on');
    await expect(page.locator('#stat-cards')).toContainText('extreme: 2 cards/verifier');
    // Toggle past the 0/1 bound (no-op clamp).
    await page.click('button[data-cfg="extreme"][data-delta="1"]');
    await expect(page.locator('#cfg-extreme')).toHaveText('on');
    await expect(page.locator('#custom-status.ok')).toBeVisible({ timeout: 30000 });
    await page.click('#btn-start-custom');
    await expect(page.locator('#screen-game')).toBeVisible();
    const hasExtreme = await page.evaluate(() =>
        document.querySelectorAll('.verifier-card.extreme').length > 0);
    expect(hasExtreme).toBe(true);
});

test('extreme ASK with ✓: pins active pane, kills the other, marks the option', async ({ page }) => {
    await startExtremePreset(page, 23);
    // Find a verifier where the active option lies on a proposal we can craft
    // such that it's the only ● across both panes. Then ASK — the verifier
    // must answer ✓ (active criterion matches by construction).
    const result = await page.evaluate(() => {
        const p = window.game.state.puzzle;
        for (let vi = 0; vi < p.cards.length; vi++) {
            const panes = paneListOf(p.cards[vi]);
            const allOpts = panes.flatMap(pane =>
                CARDS_BY_ID[pane.id].options.map(opt => ({pane, opt})));
            // Look for a proposal where exactly one option across both panes
            // matches AND that option's pane is the ACTIVE pane (so verifier
            // returns ✓).
            for (let a = 1; a <= 5; a++)
            for (let b = 1; b <= 5; b++)
            for (let c = 1; c <= 5; c++) {
                const matching = allOpts.filter(x => x.opt.test([a, b, c]));
                if (matching.length !== 1) continue;
                if (!matching[0].pane.active) continue;
                // Active criterion test must match the proposal for ✓ (= the
                // matching option must be the active card's criterion).
                const activeCard = panes.find(x => x.active);
                const activeCriterion = CARDS_BY_ID[activeCard.id].options[activeCard.opt];
                if (!activeCriterion.test([a, b, c])) continue;
                if (matching[0].opt !== activeCriterion) continue;
                return { vi, proposal: [a, b, c] };
            }
        }
        return null;
    });
    if (!result) test.skip(); // unlikely
    await page.evaluate(({ vi, proposal }) => {
        window.game.state.proposal = proposal.slice();
        window.game.renderAll();
        // Click the verifier's Ask button programmatically.
        document.querySelector(`.verifier-card[data-vidx="${vi}"] .vbtn`).click();
    }, result);
    // The asked verifier should now have one pane marked dead (pane-dead class)
    // and the active pane should carry a ✓ marker.
    const post = await page.evaluate((vi) => {
        const ded = window.game.computeDeductions()[vi];
        return {
            deadCount: ded.panes.filter(p => p.dead).length,
            confirmedPane: ded.confirmedPane,
            hasConfirmed: ded.panes.some(p => p.confirmed !== null),
        };
    }, result.vi);
    expect(post.deadCount).toBe(1);
    expect(post.confirmedPane).not.toBeNull();
    expect(post.hasConfirmed).toBe(true);
    // DOM should reflect the dead pane.
    const deadVisible = await page.locator(
        `.verifier-card[data-vidx="${result.vi}"] .vcard-pane.pane-dead`).count();
    expect(deadVisible).toBe(1);
});

test('extreme ASK with ✗: crosses the asked option but does NOT mark the pane dead', async ({ page }) => {
    await startExtremePreset(page, 31);
    // Find a verifier + proposal where the ● is on a NON-active option AND
    // on the non-active pane → verifier returns ✗.
    const result = await page.evaluate(() => {
        const p = window.game.state.puzzle;
        for (let vi = 0; vi < p.cards.length; vi++) {
            const panes = paneListOf(p.cards[vi]);
            const allOpts = panes.flatMap((pane, pi) =>
                CARDS_BY_ID[pane.id].options.map((opt, oi) => ({pi, oi, pane, opt})));
            const activeCard = panes.find(x => x.active);
            const activeCriterion = CARDS_BY_ID[activeCard.id].options[activeCard.opt];
            for (let a = 1; a <= 5; a++)
            for (let b = 1; b <= 5; b++)
            for (let c = 1; c <= 5; c++) {
                const matching = allOpts.filter(x => x.opt.test([a, b, c]));
                if (matching.length !== 1) continue;
                // Verifier answer = activeCriterion(proposal). Want ✗.
                if (activeCriterion.test([a, b, c])) continue;
                // Each option on the active card that's NOT the active
                // criterion: if exactly one such option is the ●, verifier
                // returns ✗ and only that option is crossed.
                return { vi, proposal: [a, b, c], hit: matching[0] };
            }
        }
        return null;
    });
    if (!result) test.skip();
    await page.evaluate(({ vi, proposal }) => {
        window.game.state.proposal = proposal.slice();
        window.game.renderAll();
        document.querySelector(`.verifier-card[data-vidx="${vi}"] .vbtn`).click();
    }, result);
    const post = await page.evaluate((vi) => {
        const ded = window.game.computeDeductions()[vi];
        return {
            deadCount: ded.panes.filter(p => p.dead).length,
            crossedTotal: ded.panes.reduce((s, p) => s + p.crossed.size, 0),
            confirmedPane: ded.confirmedPane,
        };
    }, result.vi);
    // No pane killed yet, exactly one option crossed.
    expect(post.deadCount).toBe(0);
    expect(post.crossedTotal).toBe(1);
    expect(post.confirmedPane).toBeNull();
});

test('extreme global rule: 2N-1 options eliminated → last one auto-confirmed', async ({ page }) => {
    // Hand-rolled minimal puzzle whose two panes are cards 14 ("smallest
    // color") + 15 ("greatest color") — both partial-coverage cards (return
    // 0 ● on ties) so every option across both panes can be isolated by some
    // 1-● proposal. Active = card 14 opt 0 ("Blue is smallest").
    //
    // Crossing the 5 non-active options (3 of card 15, 2 of card 14) with
    // direct ✗ queries leaves exactly the active option alive across both
    // panes → the EXTREME global rule fires and auto-confirms it.
    await page.goto('');
    const result = await page.evaluate(() => {
        const puzzle = {
            level: 'CUSTOM',
            cards: [{ id: 14, opt: 0, altId: 15, altOpt: 0, swap: false }],
            config: { digitMin: 1, digitMax: 5, verifiers: 1, questionsPerRound: 3, extreme: true },
            solution: [1, 5, 3],
        };
        window.game.startWithPuzzle(puzzle);
        // Construct ✗ queries that isolate each non-active option.
        // Pane A = card 14, Pane B = card 15.
        const queries = [
            // Cross "Yellow smallest" (pane A opt 1): [3,1,3] isolates it.
            { round: 1, proposal: [3, 1, 3], verifierIdx: 0, result: false },
            // Cross "Purple smallest" (pane A opt 2): [3,3,1] isolates it.
            { round: 1, proposal: [3, 3, 1], verifierIdx: 0, result: false },
            // Cross "Blue greatest" (pane B opt 0): [3,1,1] isolates it.
            { round: 1, proposal: [3, 1, 1], verifierIdx: 0, result: false },
            // Cross "Yellow greatest" (pane B opt 1): [1,3,1] isolates it.
            { round: 1, proposal: [1, 3, 1], verifierIdx: 0, result: false },
            // Cross "Purple greatest" (pane B opt 2): [1,1,3] isolates it.
            { round: 1, proposal: [1, 1, 3], verifierIdx: 0, result: false },
        ];
        window.game.state.queries = queries;
        const ded = window.game.computeDeductions()[0];
        return {
            confirmedPane: ded.confirmedPane,
            confirmedOpt:  ded.panes[ded.confirmedPane]?.confirmed,
            paneADead:     ded.panes[0].dead,
            paneBDead:     ded.panes[1].dead,
            paneAPassed:   [...ded.panes[0].passed],
        };
    });
    // Pane B is dead (all 3 options crossed). Pane A has 2 crossed + 1 left.
    // The global rule fires: the lone surviving option (pane A opt 0,
    // "Blue is smallest") is auto-confirmed.
    expect(result.paneBDead).toBe(true);
    expect(result.paneADead).toBe(false);
    expect(result.confirmedPane).toBe(0);
    expect(result.confirmedOpt).toBe(0);
    expect(result.paneAPassed).toContain(0);
});

test('extreme pane dies when all its options crossed by direct queries', async ({ page }) => {
    let result = null;
    for (const seed of [53, 67, 79, 89, 103, 127, 149, 167, 181, 199]) {
        await startExtremePreset(page, seed);
        result = await page.evaluate(() => {
            const p = window.game.state.puzzle;
            for (let vi = 0; vi < p.cards.length; vi++) {
                const panes = paneListOf(p.cards[vi]);
                const activeIdx = panes.findIndex(x => x.active);
                const deadIdx   = 1 - activeIdx;
                const activeCard = panes[activeIdx];
                const activeOpt  = CARDS_BY_ID[activeCard.id].options[activeCard.opt];
                const deadDef = CARDS_BY_ID[panes[deadIdx].id];
                const allOpts = panes.flatMap(pane => CARDS_BY_ID[pane.id].options);
                const queries = [];
                let ok = true;
                for (const opt of deadDef.options) {
                    let prop = null;
                    for (let a = 1; a <= 5 && !prop; a++)
                    for (let b = 1; b <= 5 && !prop; b++)
                    for (let c = 1; c <= 5 && !prop; c++) {
                        const m = allOpts.filter(o => o.test([a, b, c]));
                        if (m.length === 1 && m[0] === opt) prop = [a, b, c];
                    }
                    if (!prop) { ok = false; break; }
                    queries.push({ round: 1, proposal: prop, verifierIdx: vi, result: false });
                }
                if (!ok) continue;
                window.game.state.queries = queries;
                const ded = window.game.computeDeductions()[vi];
                return {
                    found: true,
                    deadCount: ded.panes.filter(p => p.dead).length,
                    inactiveIsDead: ded.panes[deadIdx].dead,
                    activeIsDead:   ded.panes[activeIdx].dead,
                };
            }
            return { found: false };
        });
        if (result.found) break;
    }
    expect(result.found).toBe(true);
    expect(result.deadCount).toBe(1);
    expect(result.inactiveIsDead).toBe(true);
    expect(result.activeIsDead).toBe(false);
});

test('extreme end screen lists both active criterion and decoy', async ({ page }) => {
    await startExtremePreset(page, 67);
    // Force a win by submitting the actual solution.
    await page.evaluate(() => {
        const sol = window.game.state.puzzle.solution;
        window.game.finishWithGuess(sol.slice());
    });
    await expect(page.locator('#screen-end')).toBeVisible();
    const decoyCount = await page.locator('#end-criteria-list .end-decoy').count();
    expect(decoyCount).toBeGreaterThan(0);
    const decoyTags = await page.locator('#end-criteria-list .decoy-tag').count();
    expect(decoyTags).toBe(decoyCount);
});

test('extreme ask gating counts across both panes', async ({ page }) => {
    await startExtremePreset(page, 71);
    // Find a proposal where ≥2 options match across both panes for verifier 0
    // → Ask should be disabled.
    const has = await page.evaluate(() => {
        const p = window.game.state.puzzle;
        const panes = paneListOf(p.cards[0]);
        const allOpts = panes.flatMap(pane => CARDS_BY_ID[pane.id].options);
        for (let a = 1; a <= 5; a++)
        for (let b = 1; b <= 5; b++)
        for (let c = 1; c <= 5; c++) {
            const n = allOpts.filter(o => o.test([a, b, c])).length;
            if (n >= 2) {
                window.game.state.proposal = [a, b, c];
                window.game.renderAll();
                return true;
            }
        }
        return false;
    });
    if (!has) test.skip();
    const disabled = await page.locator('.verifier-card[data-vidx="0"] .vbtn').isDisabled();
    expect(disabled).toBe(true);
    // Now make it askable (1 ●).
    const ok = await makeAskable(page, 0);
    if (ok) {
        await expect(page.locator('.verifier-card[data-vidx="0"] .vbtn')).toBeEnabled();
    }
});

test('extreme deduction modal: pane-dead status branch + pane-tag in subtitle', async ({ page }) => {
    // Use a ✓-via-active path: a single ✓ result both pins the active pane
    // AND marks the other pane dead by direct fact. Then deduceFor on an
    // option of the now-dead pane yields the 'pane-dead' branch.
    let opened = false;
    for (const seed of [11, 23, 47, 89, 131, 167, 191, 211, 233, 257]) {
        await startExtremePreset(page, seed);
        opened = await page.evaluate(() => {
            const p = window.game.state.puzzle;
            for (let vi = 0; vi < p.cards.length; vi++) {
                const panes = paneListOf(p.cards[vi]);
                const activeIdx = panes.findIndex(x => x.active);
                const deadIdx   = 1 - activeIdx;
                const activeCard = panes[activeIdx];
                const activeOpt  = CARDS_BY_ID[activeCard.id].options[activeCard.opt];
                const allOpts = panes.flatMap(pane => CARDS_BY_ID[pane.id].options);
                // Find a proposal where activeOpt is the only ● across both
                // panes — that gives a ✓ result which kills the other pane.
                let prop = null;
                for (let a = 1; a <= 5 && !prop; a++)
                for (let b = 1; b <= 5 && !prop; b++)
                for (let c = 1; c <= 5 && !prop; c++) {
                    if (!activeOpt.test([a, b, c])) continue;
                    const m = allOpts.filter(o => o.test([a, b, c]));
                    if (m.length === 1 && m[0] === activeOpt) prop = [a, b, c];
                }
                if (!prop) continue;
                window.game.state.queries = [
                    { round: 1, proposal: prop, verifierIdx: vi, result: true },
                ];
                window.game.renderAll();
                const trace = window.game.deduceFor(vi, deadIdx, 0);
                if (trace.status !== 'pane-dead') continue;
                window.game.ui.renderDeductionModal(trace);
                return true;
            }
            return false;
        });
        if (opened) break;
    }
    expect(opened).toBe(true);
    await expect(page.locator('#deduction-modal')).toBeVisible();
    await expect(page.locator('#deduction-modal .pane-tag')).toBeVisible();
    await expect(page.locator('#ded-status.is-no')).toContainText('eliminated');
    await page.click('#btn-close-deduction');
});

test('extreme save+resume round-trips decoy fields', async ({ page }) => {
    await startExtremePreset(page, 97);
    const before = await page.evaluate(() => {
        const card = window.game.state.puzzle.cards[0];
        return { id: card.id, opt: card.opt, altId: card.altId, altOpt: card.altOpt, swap: !!card.swap };
    });
    // Reload the page — the active session is persisted via saveActive on
    // game start, so Resume picks it up with full extreme fields.
    await page.reload();
    await expect(page.locator('#btn-resume-game')).toBeVisible();
    await page.click('#btn-resume-game');
    await expect(page.locator('#screen-game')).toBeVisible();
    const after = await page.evaluate(() => {
        const card = window.game.state.puzzle.cards[0];
        return { id: card.id, opt: card.opt, altId: card.altId, altOpt: card.altOpt, swap: !!card.swap };
    });
    expect(after).toEqual(before);
    // And the verifier still renders as extreme with two panes.
    const panes = await page.locator('.verifier-card[data-vidx="0"] .vcard-pane').count();
    expect(panes).toBe(2);
});

test('extreme deduceFor paneIdx=0 renders card A tag in modal', async ({ page }) => {
    // Cover the "card A" branch of the pane-tag ternary by directly invoking
    // deduceFor with paneIdx=0 and rendering the resulting trace.
    await startExtremePreset(page, 13);
    await page.evaluate(() => {
        const trace = window.game.deduceFor(0, 0, 0);
        window.game.ui.renderDeductionModal(trace);
    });
    await expect(page.locator('#deduction-modal .pane-tag')).toHaveText('card A');
    await page.click('#btn-close-deduction');
});

test('extreme deduceFor: query on this pane only → otherPaneCounts returns null', async ({ page }) => {
    // The otherPaneCounts helper inside deduceFor returns `null` for any
    // query whose ● is on the current pane (i.e. no option on the OTHER
    // pane matches the proposal). Hard to trigger via normal play, but we
    // can synthesize: pick a verifier, find a proposal matching only an
    // option of pane 0, record a query, then call deduceFor(vi, 0, oi).
    await startExtremePreset(page, 19);
    const ok = await page.evaluate(() => {
        const p = window.game.state.puzzle;
        for (let vi = 0; vi < p.cards.length; vi++) {
            const panes = paneListOf(p.cards[vi]);
            const defA = CARDS_BY_ID[panes[0].id];
            const defB = CARDS_BY_ID[panes[1].id];
            for (let a = 1; a <= 5; a++)
            for (let b = 1; b <= 5; b++)
            for (let c = 1; c <= 5; c++) {
                const mA = defA.options.filter(o => o.test([a, b, c])).length;
                const mB = defB.options.filter(o => o.test([a, b, c])).length;
                if (mA === 1 && mB === 0) {
                    window.game.state.queries.push({
                        round: 1, proposal: [a, b, c], verifierIdx: vi, result: false,
                    });
                    const trace = window.game.deduceFor(vi, 0, 0);
                    return trace.otherPaneQueries.length === 0;
                }
            }
        }
        return null;
    });
    if (ok === null) test.skip();
    expect(ok).toBe(true);
});

test('extreme level select: EXTREME option is offered and starts a 2-pane game', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    await expect(page.locator('#level-options .level-option:has(strong:text("Extreme"))'))
        .toBeVisible();
    await page.click('#level-options .level-option:has(strong:text("Extreme"))');
    await expect(page.locator('#screen-game')).toBeVisible();
    const panes = await page.locator('.verifier-card.extreme .vcard-pane').count();
    expect(panes).toBeGreaterThan(0);
});
