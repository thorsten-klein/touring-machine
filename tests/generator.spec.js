import { test, expect } from './coverage-fixture.js';

// generator.js: puzzle generation + game-id codec. All pure JS.

test('generatePuzzle: preset + custom + opts variants (verifiers / qpr / digit range)', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        if (!generatePuzzle('EASY', 1))                     throw new Error('easy null');
        if (!generatePuzzle('HARD', 2))                     throw new Error('hard null');
        if (!generatePuzzle('CUSTOM', 3, { digitMin: 1, digitMax: 5 })) throw new Error('custom null');
        // opts.verifiers and opts.questionsPerRound override the level defaults.
        if (!generatePuzzle('EASY', 4, { verifiers: 4, questionsPerRound: 5 })) throw new Error('opts null');
        // CUSTOM with no opts.verifiers → falls back to 5 inside the function.
        if (!generatePuzzle('CUSTOM', 5, { digitMin: 1, digitMax: 5 })) throw new Error('custom-default null');
        // signal.aborted exits before any attempt finishes.
        if (generatePuzzle('EASY', 6, { signal: { aborted: true } }) !== null) throw new Error('expected null');
        // Impossible config exhausts the search budget.
        if (generatePuzzle('EASY', 7, { verifiers: 999, maxAttempts: 5 }) !== null) throw new Error('expected null');
    });
});

test('encodeGameId / decodeGameId round-trip for preset and custom (with and without Q suffix)', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const preset = generatePuzzle('EASY', 100);
        const presetId = encodeGameId(preset);
        if (!decodeGameId(presetId)) throw new Error('preset decode failed');
        const cq3 = generatePuzzle('CUSTOM', 101, { digitMin: 1, digitMax: 5, verifiers: 3, questionsPerRound: 3 });
        if (encodeGameId(cq3).includes('Q')) throw new Error('default qpr should NOT emit Q');
        const cq2 = generatePuzzle('CUSTOM', 102, { digitMin: 1, digitMax: 5, verifiers: 3, questionsPerRound: 2 });
        if (!encodeGameId(cq2).includes('Q')) throw new Error('non-default qpr should emit Q');
        if (!decodeGameId(encodeGameId(cq2))) throw new Error('custom decode failed');
    });
});

test('decodeGameId: every error path throws', async ({ page }) => {
    await page.goto('');
    const errs = await page.evaluate(() => {
        const r = [];
        const cases = [
            ['empty', ''],
            ['tooShort', 'E'],
            ['unknownPrefix', 'Zfoo'],
            ['badCustom', 'Cnope'],
            ['rangeOOB', 'C9_2_11.0'],
            ['badQpr', 'C1_5Q0_11.0'],
            ['unknownCard', 'E9999.0'],
            ['badOpt', 'E11.99'],
            ['notUnique', 'E11.0'],
            // Extreme codec error paths
            ['badSegLen', 'E11.0.7'],                   // 3 nums — not 2, not 5
            ['unknownDecoy', 'X11.0.9999.0.0'],         // decoy card id invalid
            ['badDecoyOpt', 'X11.0.12.99.0'],           // decoy option index invalid
            ['badSwapBit', 'X11.0.12.0.2'],             // swap not 0/1
            ['mixedSegs', 'E11.0-12.0.13.0.0'],         // normal mixed with extreme
            ['markerMismatch', 'E11.0.12.0.0'],         // E says normal, segment is extreme
        ];
        for (const [label, id] of cases) {
            try { decodeGameId(id); r.push(label + ':no-throw'); }
            catch (e) { r.push(label + ':' + e.message); }
        }
        return r;
    });
    expect(errs.filter(s => s.endsWith(':no-throw'))).toEqual([]);
});

test('extreme: generate + encode + decode round-trip (preset and custom)', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        // Preset EXTREME — emits X-prefixed id with 5-num segments.
        const presetExt = generatePuzzle('EXTREME', 200);
        if (!presetExt) throw new Error('preset extreme generate null');
        if (!presetExt.config.extreme) throw new Error('preset extreme missing config flag');
        if (!presetExt.cards.every(c => c.altId !== undefined && c.swap !== undefined))
            throw new Error('preset extreme cards missing decoy fields');
        if (!presetExt.cards.every(c => CARDS_BY_ID[c.id].family !== CARDS_BY_ID[c.altId].family))
            throw new Error('extreme decoy shares family with its slot active card');
        const presetId = encodeGameId(presetExt);
        if (!presetId.startsWith('X')) throw new Error('preset extreme id should start with X');
        const back = decodeGameId(presetId);
        if (!back.config.extreme) throw new Error('decoded preset extreme lost config flag');
        if (back.cards.length !== presetExt.cards.length) throw new Error('card count mismatch');
        back.cards.forEach((c, i) => {
            const o = presetExt.cards[i];
            if (c.id !== o.id || c.opt !== o.opt
                || c.altId !== o.altId || c.altOpt !== o.altOpt
                || !!c.swap !== !!o.swap) {
                throw new Error('preset extreme round-trip mismatch at ' + i);
            }
        });

        // Custom EXTREME with non-default qpr — emits Q<qpr>X marker.
        const cExt = generatePuzzle('CUSTOM', 201, {
            digitMin: 1, digitMax: 5, verifiers: 3, questionsPerRound: 2, extreme: true,
        });
        if (!cExt) throw new Error('custom extreme generate null');
        const cId = encodeGameId(cExt);
        if (!cId.includes('Q2X_')) throw new Error('custom extreme id missing QX marker: ' + cId);
        const cBack = decodeGameId(cId);
        if (!cBack.config.extreme) throw new Error('decoded custom extreme lost config flag');
        if (cBack.config.questionsPerRound !== 2) throw new Error('qpr round-trip broken');

        // Custom EXTREME with default qpr — uses X (no Q).
        const cExt2 = generatePuzzle('CUSTOM', 202, {
            digitMin: 1, digitMax: 5, verifiers: 3, questionsPerRound: 3, extreme: true,
        });
        const cId2 = encodeGameId(cExt2);
        if (cId2.includes('Q')) throw new Error('default qpr should not emit Q for extreme');
        if (!cId2.includes('X_')) throw new Error('extreme marker missing on default-qpr custom');
        if (!decodeGameId(cId2).config.extreme) throw new Error('round-trip broken (no-Q variant)');
    });
});

test('extreme: attachDecoys returns false when no different-family decoy exists', async ({ page }) => {
    await page.goto('');
    const got = await page.evaluate(() => {
        // Direct attachDecoys call against a synthetic puzzle whose active
        // card sits in a family with no other cards (i.e., when the candidate
        // pool collapses to empty). We pick a real card id but restrict the
        // global CARDS pool to only that card so its family becomes singleton.
        const origCards = CARDS.slice();
        const onlyCard = origCards[0];
        CARDS.length = 0; CARDS.push(onlyCard);
        let r;
        try {
            r = attachDecoys({ cards: [{ id: onlyCard.id, opt: 0 }] }, () => 0);
        } finally {
            CARDS.length = 0; origCards.forEach(c => CARDS.push(c));
        }
        return r;
    });
    expect(got).toBe(false);
});

test('hardplus opts with too few verifiers fails the ≥3 colorParam gate', async ({ page }) => {
    await page.goto('');
    const r = await page.evaluate(() => {
        // 2 verifiers + hardplus → head pins at most 2 colorParam cards →
        // the ≥3 gate never passes → generation exhausts budget → null.
        return generatePuzzle('EASY', 999, { hardplus: true, verifiers: 2, maxAttempts: 200 });
    });
    expect(r).toBeNull();
});

test('hardplus + extreme opts.* override LEVELS-derived flags', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        // opts.hardplus explicitly true on EASY (which has no hardplus flag)
        // turns on the colorParam-bias card ordering. Puzzle still generates;
        // its config.hardplus rides the explicit opts override.
        const p = generatePuzzle('EASY', 222, { hardplus: true });
        if (!p) throw new Error('opts.hardplus generate null');
        if (!p.config.hardplus) throw new Error('opts.hardplus did not set config flag');
        // opts.extreme explicitly false on EXTREME suppresses decoy attachment.
        const p2 = generatePuzzle('EXTREME', 333, { extreme: false });
        if (!p2) throw new Error('opts.extreme=false generate null');
        if (p2.cards.some(c => c.altId !== undefined))
            throw new Error('opts.extreme=false still attached decoys');
    });
});

test('hardplus: puzzle generates, biases toward colorParam, codec round-trips', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('HARDPLUS', 500);
        if (!p) throw new Error('hardplus generate null');
        if (!p.config.hardplus) throw new Error('hardplus config flag missing');
        // Hard+ uses the full pool but biases towards colorParam cards by
        // shuffling them to the front. We assert AT LEAST one colorParam
        // card is present — the exact mix varies seed-to-seed.
        const cpCount = p.cards.filter(c => CARDS_BY_ID[c.id].colorParam).length;
        if (cpCount < 3) throw new Error('hardplus puzzle has fewer than 3 colorParam cards: ' + cpCount);
        const id = encodeGameId(p);
        if (!id.startsWith('P')) throw new Error('hardplus id should start with P');
        const back = decodeGameId(id);
        if (back.level !== 'HARDPLUS') throw new Error('decode preserves level');
        if (!back.config.hardplus) throw new Error('decoded config.hardplus is false');
    });
});

test('extreme: generatePuzzle retries when attachDecoys fails, then returns null', async ({ page }) => {
    await page.goto('');
    const result = await page.evaluate(() => {
        // Stub attachDecoys to always fail — every otherwise-valid generation
        // attempt then hits the `if (!ok) continue;` branch and the loop
        // exhausts its maxAttempts budget, returning null. Exercises line
        // 223 specifically (the continue after attachDecoys returns false).
        const orig = attachDecoys;
        // eslint-disable-next-line no-global-assign
        attachDecoys = () => false;
        let r;
        try {
            r = generatePuzzle('EXTREME', 400, { maxAttempts: 100 });
        } finally {
            // eslint-disable-next-line no-global-assign
            attachDecoys = orig;
        }
        return r;
    });
    expect(result).toBeNull();
});
