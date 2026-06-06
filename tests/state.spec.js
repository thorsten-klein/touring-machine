import { test, expect } from './coverage-fixture.js';

// GameState class + localStorage persistence helpers.

test('GameState lifecycle: ask cap, end-round, pending → next-round, submit', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const p = generatePuzzle('EASY', 200);
        const s = new GameState(p);
        // canEndRound is false with 0 queries.
        if (s.canEndRound()) throw new Error('expected false');
        s.endRound();                                        // no-op (canEndRound false)
        s.roundsPlayed();                                    // not-finished branch
        if (s.askVerifier(0) === null) throw new Error('first ask returned null');
        if (!s.canEndRound()) throw new Error('canEndRound should be true now');
        // Fill the round to the cap, then attempt one more → null.
        s.askVerifier(0); s.askVerifier(0);
        if (s.askVerifier(0) !== null) throw new Error('expected null at cap');
        s.endRound();
        if (!s.canQueryThisRound()) throw new Error('pendingNewRound should allow next ask');
        s.askVerifier(1);                                    // bumps round counter
        const wrong = s.puzzle.solution.slice(); wrong[0] = (wrong[0] % 5) + 1;
        if (s.submitGuess(wrong)) throw new Error('expected wrong');
        if (s.canQueryThisRound()) throw new Error('finished → no more asks');
        s.roundsPlayed();                                    // finished branch
    });
});

test('toggleDisabledDigit / toggleCandidateDigit add+remove', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const s = new GameState(generatePuzzle('EASY', 201));
        s.toggleDisabledDigit(0, 3); s.toggleDisabledDigit(0, 3);
        if (s.disabledDigits[0].has(3)) throw new Error('disabled toggle failed');
        s.toggleCandidateDigit(1, 4); s.toggleCandidateDigit(1, 4);
        if (s.candidateDigits[1].has(4)) throw new Error('candidate toggle failed');
    });
});

test('serialize / deserialize: round-trip + legacy missing-fields fallbacks', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const s = new GameState(generatePuzzle('EASY', 202));
        s.askVerifier(0);
        const raw = s.serialize();
        if (!GameState.deserialize(raw)) throw new Error('round-trip null');
        // Each fallback in deserialize (queries, startedAt, finished,
        // disabledDigits, candidateDigits) is exercised by dropping the field.
        delete raw.queries; delete raw.startedAt; delete raw.finished;
        delete raw.disabledDigits; delete raw.candidateDigits;
        if (!GameState.deserialize(raw)) throw new Error('legacy null');
        // Wrong version + null input.
        if (GameState.deserialize(null) !== null)        throw new Error('null in');
        if (GameState.deserialize({ v: 99 }) !== null)   throw new Error('bad v');
    });
});

test('localStorage persistence helpers handle quota / parse / removal failures silently', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        // saveActive: setItem throws → swallowed.
        const origSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new Error('quota'); };
        saveActive({ serialize: () => ({}) });
        Storage.prototype.setItem = origSet;
        // loadActive: garbage JSON → null.
        localStorage.setItem('tm.active', '{not json');
        if (loadActive() !== null) throw new Error('expected null for bad JSON');
        // loadActive: wrong version → null.
        localStorage.setItem('tm.active', JSON.stringify({ v: 99 }));
        if (loadActive() !== null) throw new Error('expected null for wrong v');
        // clearActive: removeItem throws → swallowed.
        const origRm = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function () { throw new Error('nope'); };
        clearActive();
        Storage.prototype.removeItem = origRm;
        clearActive(); // success branch
    });
});
