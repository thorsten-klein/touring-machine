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

test('encodeGameId / decodeGameId round-trip for preset and custom (with and without Q / N suffix)', async ({ page }) => {
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
        // Custom with extra colors → ID must include N<count> and round-trip.
        const c4 = generatePuzzle('CUSTOM', 103, { digitMin: 1, digitMax: 5, colorCount: 4, verifiers: 3, questionsPerRound: 3 });
        const c4id = encodeGameId(c4);
        if (!c4id.includes('N4')) throw new Error('non-default color count should emit N');
        if (!decodeGameId(c4id)) throw new Error('custom 4-color decode failed');
        // Restore default config so later tests aren't affected.
        reconfigureGame({ digitMin: 1, digitMax: 5, colors: ALL_COLORS.slice(0, 3) });
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
            ['badColors', 'C1_5N2_11.0'],
            ['badQpr', 'C1_5Q0_11.0'],
            ['unknownCard', 'E9999.0'],
            ['badOpt', 'E11.99'],
            ['notUnique', 'E11.0'],
        ];
        for (const [label, id] of cases) {
            try { decodeGameId(id); r.push(label + ':no-throw'); }
            catch (e) { r.push(label + ':' + e.message); }
        }
        return r;
    });
    expect(errs.filter(s => s.endsWith(':no-throw'))).toEqual([]);
});
