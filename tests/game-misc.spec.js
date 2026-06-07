import { test, expect } from './coverage-fixture.js';
import { startEasyGame } from './_helpers.js';

// Coverage for misc additions: verifierLetter wrap-around, redHerring
// codec branches, settings load/save, user-marker cycle, classic stepper
// bumps, expected-effort + settings + level-info modals, click-handler
// branches, and the "color" highlight in topic rendering.

test('verifierLetter wraps to AA/AB/… past index 25', async ({ page }) => {
    await page.goto('');
    const out = await page.evaluate(() => ({
        i0:  verifierLetter(0),
        i25: verifierLetter(25),
        i26: verifierLetter(26),
        i27: verifierLetter(27),
        i52: verifierLetter(52),
    }));
    expect(out.i0).toBe('A');
    expect(out.i25).toBe('Z');
    expect(out.i26).toBe('AA');
    expect(out.i27).toBe('AB');
    expect(out.i52).toBe('BA');
});

test('codec: extreme red-herring bit round-trip + bad bit throws', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        // Generate an Extreme puzzle so we have a real herring slot to round-trip.
        const p = generatePuzzle('EXTREME', 1234);
        if (!p) throw new Error('extreme generate null');
        if (!p.cards.some(c => c.redHerring)) throw new Error('no herring slot');
        const id   = encodeGameId(p);
        const back = decodeGameId(id);
        const orig = p.cards.find(c => c.redHerring);
        const cpy  = back.cards.find(c => c.redHerring);
        if (!cpy || cpy.id !== orig.id || cpy.opt !== orig.opt
            || cpy.altId !== orig.altId || cpy.altOpt !== orig.altOpt
            || !!cpy.swap !== !!orig.swap) {
            throw new Error('herring fields did not round-trip');
        }
        // Bad herring bit (must be 0 or 1) throws.
        let threw = false;
        try { decodeGameId('X11.0.12.0.0.2'); }
        catch (e) {
            threw = /herring/i.test(e.message);
        }
        if (!threw) throw new Error('bad herring bit should throw');
    });
});

test('attachRedHerring returns false when pool has no different-family card', async ({ page }) => {
    await page.goto('');
    const ok = await page.evaluate(() => {
        // Synthetic puzzle with a known card; prune CARDS to just that one
        // family so attachRedHerring can't find a different-family decoy.
        const orig = CARDS.slice();
        const fam  = CARDS_BY_ID[26].family;
        CARDS.length = 0;
        orig.filter(c => c.family === fam).forEach(c => CARDS.push(c));
        let result;
        try {
            result = attachRedHerring(
                { cards: [{ id: 26, opt: 0 }], solution: [1, 1, 1] },
                () => 0);
        } finally {
            CARDS.length = 0;
            orig.forEach(c => CARDS.push(c));
        }
        return result;
    });
    expect(ok).toBe(false);
});

test('settings: load default, save+reload, malformed JSON falls back', async ({ page }) => {
    await page.goto('');
    const result = await page.evaluate(() => {
        // 1. No stored settings → defaults.
        localStorage.removeItem('tm.settings');
        const def = loadSettings();
        // 2. Save + reload returns same values.
        saveSettings({ autoDeduce: false, showPreviewArrow: false });
        const back = loadSettings();
        // 3. Malformed JSON → defaults again (catch branch).
        localStorage.setItem('tm.settings', '{not json');
        const recovered = loadSettings();
        // 4. saveSettings tolerates a localStorage quota throw silently.
        const realSet = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new Error('quota'); };
        try { saveSettings({ autoDeduce: true }); } finally {
            Storage.prototype.setItem = realSet;
        }
        return { def, back, recovered };
    });
    expect(result.def.autoDeduce).toBe(true);
    expect(result.def.showPreviewArrow).toBe(true);
    expect(result.back.autoDeduce).toBe(false);
    expect(result.back.showPreviewArrow).toBe(false);
    expect(result.recovered.autoDeduce).toBe(true);
});

test('userMarkers: cycle empty→check→cross→question→empty + getUserMarker', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 1);
    const out = await page.evaluate(() => {
        const s = window.game.state;
        const k = '0:0:0';
        const seq = [];
        seq.push(s.getUserMarker(0, 0, 0));   // initial
        seq.push(s.cycleUserMarker(0, 0, 0)); // → check
        seq.push(s.cycleUserMarker(0, 0, 0)); // → cross
        seq.push(s.cycleUserMarker(0, 0, 0)); // → question
        seq.push(s.cycleUserMarker(0, 0, 0)); // → empty (deletes key)
        const present = k in s.userMarkers;
        return { seq, present };
    });
    expect(out.seq).toEqual(['', 'check', 'cross', 'question', '']);
    expect(out.present).toBe(false);
});

test('UI: wireClassicStepper +/- buttons within bounds', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    // Push above max (clamps at 7) then below min (clamps at 3).
    for (let i = 0; i < 8; i++) await page.click('#btn-cv-inc');
    await expect(page.locator('#cv-count')).toHaveText('7');
    for (let i = 0; i < 10; i++) await page.click('#btn-cv-dec');
    await expect(page.locator('#cv-count')).toHaveText('3');
});

test('UI: updateUserMarker no-op when node missing + glyph swap', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 2);
    await page.evaluate(() => {
        const ui = window.game.ui;
        // Real node exists → glyph updates.
        ui.updateUserMarker(0, 0, 0, 'check');
        const node = document.querySelector(
            '.verifier-card[data-vidx="0"] .vopt[data-cidx="0"][data-oi="0"] .user-marker');
        if (node.textContent !== '✓') throw new Error('expected ✓');
        // Out-of-range → no-op (function returns early; no throw).
        ui.updateUserMarker(99, 0, 0, 'cross');
    });
});

test('Game: click on .user-marker cycles state and saves', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 3);
    const um = page.locator('.verifier-card[data-vidx="0"] .vopt[data-oi="0"] .user-marker').first();
    await um.click();
    await expect(um).toHaveText('✓');
    await um.click();
    await expect(um).toHaveText('✗');
    await um.click();
    await expect(um).toHaveText('?');
});

test('Game: empty-marker click opens modal when verifier has queries (false-1pin path)', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 4);
    // Inject a FALSE+1-● query that, under the current rule, marks the matched
    // option as crossed (✗) — clicking that marker reaches the deduceFor path.
    const ok = await page.evaluate(() => {
        const p = window.game.state.puzzle;
        const vi = 0;
        const def = CARDS_BY_ID[p.cards[vi].id];
        // Find any proposal isolating exactly one option that ISN'T the criterion.
        const activeOpt = def.options[p.cards[vi].opt];
        for (let a = 1; a <= 5; a++)
        for (let b = 1; b <= 5; b++)
        for (let c = 1; c <= 5; c++) {
            const m = def.options.filter(o => o.test([a, b, c]));
            if (m.length === 1 && m[0] !== activeOpt && !activeOpt.test([a, b, c])) {
                window.game.state.queries.push({ round: 1, proposal: [a, b, c], verifierIdx: vi, result: false });
                window.game.renderAll();
                return true;
            }
        }
        return false;
    });
    if (!ok) test.skip();
    // The marker should now carry ✗ — click it to open the modal.
    const marker = page.locator('.verifier-card[data-vidx="0"] .vopt .marker').filter({ hasText: /[✗]/ }).first();
    await marker.click();
    await expect(page.locator('#deduction-modal')).toBeVisible();
    await page.click('#btn-close-deduction');
});

test('Game: openExpectedModal renders min/typical questions+rounds', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 5);
    await page.click('#info-level');
    await expect(page.locator('#expected-modal')).toBeVisible();
    await expect(page.locator('#expected-min-q')).not.toHaveText('—');
    await expect(page.locator('#expected-exp-r')).toContainText('round');
    await page.click('#btn-close-expected');
});

test('Game: openSettingsModal toggles persist via localStorage and re-render', async ({ page }) => {
    await page.goto('');
    await startEasyGame(page, 6);
    await page.click('#btn-settings');
    await expect(page.locator('#settings-modal')).toBeVisible();
    // Toggle each via direct .checked manipulation + change event.
    await page.evaluate(() => {
        const a = document.getElementById('set-auto-deduce');
        a.checked = false; a.dispatchEvent(new Event('change'));
        const b = document.getElementById('set-preview-arrow');
        b.checked = false; b.dispatchEvent(new Event('change'));
    });
    const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('tm.settings')));
    expect(stored.autoDeduce).toBe(false);
    expect(stored.showPreviewArrow).toBe(false);
    await page.click('#btn-close-settings');
});

test('Game: subtitleForLevel covers each level branch via openLevelInfo', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    for (const [labelText, expected] of [
        ['Classic', 'rules'],
        ['Hard',    'MYSTERY'],
        ['Extreme', 'red herring'],
        ['Custom',  'digit range'],
    ]) {
        await page.click(`#level-options .level-option:has(strong:text("${labelText}")) .level-info-icon`);
        await expect(page.locator('#level-info-subtitle')).toContainText(expected);
        await page.click('#btn-close-level-info');
    }
});

test('UI: "color" word in colorParam topic renders as .color-placeholder', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Hard")) .level-info-icon');
    await expect(page.locator('.color-placeholder').first()).toBeVisible();
    await expect(page.locator('.color-placeholder').first()).toHaveText(/color/i);
    await page.click('#btn-close-level-info');
});

test('Game: 1-● + FALSE on non-multiOption card crosses the matched option', async ({ page }) => {
    // Hand-rolled puzzle with card 37 (Sum of Blue + Yellow vs 4). Proposal
    // [1,1,1] → sum=2 → only "B+Y < 4" matches; FALSE answer should cross it.
    await page.goto('');
    await page.evaluate(() => {
        const puzzle = {
            level: 'CLASSIC',
            cards: [{ id: 37, opt: 1 }], // criterion = "B+Y = 4" so 2 != 4 → FALSE for [1,1,1]
            config: { digitMin: 1, digitMax: 5, verifiers: 1, questionsPerRound: 3 },
            solution: [2, 2, 1],
        };
        window.game.startWithPuzzle(puzzle);
        window.game.state.proposal = [1, 1, 1];
        window.game.state.queries = [
            { round: 1, proposal: [1, 1, 1], verifierIdx: 0, result: false },
        ];
        window.game.renderAll();
    });
    const ded = await page.evaluate(() => {
        const d = window.game.computeDeductions()[0];
        return { crossed: [...d.panes[0].crossed], passed: [...d.panes[0].passed] };
    });
    // Option 0 is "B+Y < 4" → should be crossed by the FALSE+1-● rule.
    expect(ded.crossed).toContain(0);
});
