import { test, expect } from './coverage-fixture.js';

// Custom level modal + corner-case branches in generator + criteria.
test('custom level modal: edit cfg, hit limits, start a custom puzzle', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    await expect(page.locator('#custom-level-modal')).toBeVisible();

    // Wait for first runCheck pass to complete (status becomes "Looks good!")
    await expect(page.locator('#custom-status.ok')).toBeVisible({ timeout: 15000 });

    // Push digitMax to its max (=9) — also exercises range clamp branch.
    for (let i = 0; i < 12; i++) {
        await page.click('button[data-cfg="digitMax"][data-delta="1"]');
    }
    await expect(page.locator('#cfg-digit-max')).toHaveText('9');

    // Push digitMin past its max (=3) — exercises digitMin >= digitMax adjustment via key==='digitMin'
    for (let i = 0; i < 6; i++) {
        await page.click('button[data-cfg="digitMin"][data-delta="1"]');
    }
    await expect(page.locator('#cfg-digit-min')).toHaveText('3');

    // Push digitMax down — exercises digitMin >= digitMax adjustment via key==='digitMax'
    for (let i = 0; i < 12; i++) {
        await page.click('button[data-cfg="digitMax"][data-delta="-1"]');
    }
    // digitMin clamp pushed it to digitMax-1 = 3, digitMax = 4 after the adjustment.
    // Bump back up to a roomier range so generation actually succeeds quickly.
    for (let i = 0; i < 4; i++) {
        await page.click('button[data-cfg="digitMax"][data-delta="1"]');
    }
    for (let i = 0; i < 4; i++) {
        await page.click('button[data-cfg="digitMin"][data-delta="-1"]');
    }
    await expect(page.locator('#cfg-digit-min')).toHaveText('0');

    // Bump questionsPerRound to !==3 → exercises the Q-suffix branch in encodeGameId.
    await page.click('button[data-cfg="questionsPerRound"][data-delta="1"]');
    // Push qpr down to min (=1) and then below to hit the clamp.
    for (let i = 0; i < 8; i++) {
        await page.click('button[data-cfg="questionsPerRound"][data-delta="-1"]');
    }
    await expect(page.locator('#cfg-qpr')).toHaveText('1');
    // Reset qpr to a comfortable value.
    for (let i = 0; i < 2; i++) {
        await page.click('button[data-cfg="questionsPerRound"][data-delta="1"]');
    }

    // Trim verifiers down a bit (avoid clamp churn — leave a generous count).
    await page.click('button[data-cfg="verifiers"][data-delta="-1"]');
    await page.click('button[data-cfg="verifiers"][data-delta="-1"]');

    // Wait again for runCheck to settle
    await expect(page.locator('#custom-status.ok')).toBeVisible({ timeout: 30000 });

    // Start the custom puzzle — exercises beginWithPuzzle with config + questionsPerRound branch
    await page.click('#btn-start-custom');
    await expect(page.locator('#screen-game')).toBeVisible();
});

test('custom level: spam +/- on verifiers to hit verifier max clamp', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    // Bump verifiers to 99 (the max) — exercises clamp on the high side.
    for (let i = 0; i < 100; i++) {
        await page.click('button[data-cfg="verifiers"][data-delta="1"]');
    }
    await expect(page.locator('#cfg-verifiers')).toHaveText('99');
    // Bump back down so we don't sit on an impossible config when we cancel.
    for (let i = 0; i < 95; i++) {
        await page.click('button[data-cfg="verifiers"][data-delta="-1"]');
    }
    await page.click('#btn-cancel-custom');
});

test('custom modal: open and cancel (checkToken++ branch)', async ({ page }) => {
    await page.goto('');
    await page.click('#btn-start-game');
    await page.click('#level-options .level-option:has(strong:text("Custom"))');
    await page.click('#btn-cancel-custom');
    await expect(page.locator('#custom-level-modal')).toBeHidden();
});

test('custom level: encode/decode CUSTOM game id with Q suffix and without', async ({ page }) => {
    await page.goto('');
    // Generate two custom puzzles, encode + round-trip decode them. Covers
    // encodeGameId(CUSTOM, Q!=3), encodeGameId(CUSTOM, Q===3), decodeGameId 'C'
    // path with and without Q.
    const ok = await page.evaluate(() => {
        const a = generatePuzzle('CUSTOM', 1, { digitMin: 1, digitMax: 5, verifiers: 3, questionsPerRound: 2 });
        const b = generatePuzzle('CUSTOM', 1, { digitMin: 1, digitMax: 5, verifiers: 3, questionsPerRound: 3 });
        if (!a || !b) return false;
        const ida = encodeGameId(a);
        const idb = encodeGameId(b);
        const da = decodeGameId(ida);
        const db = decodeGameId(idb);
        return da && db && ida.startsWith('C') && idb.startsWith('C') && ida.includes('Q') && !idb.includes('Q');
    });
    expect(ok).toBeTruthy();
});

test('decodeGameId / generatePuzzle error and edge branches', async ({ page }) => {
    await page.goto('');
    // Run a series of negative cases inside the page (covers every throw in decodeGameId)
    const result = await page.evaluate(() => {
        const errs = [];
        const tryIt = (label, fn) => {
            try { fn(); errs.push(label + ':no-throw'); }
            catch (e) { errs.push(label + ':' + e.message); }
        };
        tryIt('empty',       () => decodeGameId(''));
        tryIt('tooShort',    () => decodeGameId('E'));
        tryIt('unknownPfx',  () => decodeGameId('Zfoo'));
        tryIt('badCustom',   () => decodeGameId('Cnope'));
        tryIt('outOfBounds', () => decodeGameId('C9_2_11.0'));
        tryIt('badQpr',      () => decodeGameId('C1_5Q0_11.0'));
        tryIt('unknownCard', () => decodeGameId('E9999.0'));
        tryIt('badOpt',      () => decodeGameId('E11.99'));
        tryIt('badSolution', () => decodeGameId('E11.0'));
        // Exercise pick() (dead-ish helper) and digitCount() for coverage.
        const picked = (function () {
            // call into module-scoped helpers via Function constructor
            return (new Function('return [pick(()=>0.5,[1,2,3,4]), digitCount()]'))();
        })();
        errs.push('pick:' + picked[0] + ',count:' + picked[1]);
        // generatePuzzle with abort signal aborted immediately
        const sigPuzzle = generatePuzzle('EASY', 1, { signal: { aborted: true }, maxAttempts: 5 });
        errs.push('aborted:' + (sigPuzzle === null));
        // generatePuzzle with impossible config → null after exhausting budget
        const impossible = generatePuzzle('EASY', 1, { verifiers: 999, maxAttempts: 5 });
        errs.push('impossible:' + (impossible === null));
        // generatePuzzle with explicit digitMin/digitMax to hit reconfigure branch
        const reconf = generatePuzzle('EASY', 99, { digitMin: 1, digitMax: 5 });
        errs.push('reconf:' + !!reconf);
        // reconfigureGame with colors arg
        const cfg = reconfigureGame({ colors: ['blue', 'yellow', 'purple'] });
        errs.push('colors:' + cfg.cards);
        // reconfigureGame() with no args
        reconfigureGame();
        // saveActive failure path: stub localStorage.setItem to throw
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new Error('quota'); };
        saveActive({ serialize: () => ({}) });
        Storage.prototype.setItem = orig;
        // loadActive parse failure: stash garbage
        localStorage.setItem('tm.active', '{not json');
        const bad = loadActive();
        errs.push('badParse:' + (bad === null));
        // loadActive with valid JSON but wrong version
        localStorage.setItem('tm.active', JSON.stringify({ v: 999 }));
        const wrongV = loadActive();
        errs.push('wrongV:' + (wrongV === null));
        // clearActive failure path
        const origR = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function () { throw new Error('nope'); };
        clearActive();
        Storage.prototype.removeItem = origR;
        // GameState.deserialize null + bad-v
        errs.push('desNull:'  + (GameState.deserialize(null) === null));
        errs.push('desBadV:'  + (GameState.deserialize({ v: 99 }) === null));
        // history.replaceState catch branch — invoke via main on a fresh nav.
        // (covered separately by another test)
        return errs;
    });
    // Just make sure no entry says ':no-throw' — every negative case must throw.
    expect(result.filter(s => s.endsWith(':no-throw'))).toEqual([]);
});

test('reconfigure to a wider range so generateScalingCards count_D path fires', async ({ page }) => {
    await page.goto('');
    const cardCount = await page.evaluate(() => {
        // 1..9 means count_6/7/8/9 are new families → scaling cards generated.
        const cfg = reconfigureGame({ digitMin: 1, digitMax: 9 });
        // reset to default afterwards
        const cards = cfg.cards;
        reconfigureGame({ digitMin: 1, digitMax: 5 });
        return cards;
    });
    expect(cardCount).toBeGreaterThan(0);
});
