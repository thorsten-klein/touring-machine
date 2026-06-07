'use strict';

// Puzzle generator and game-id codec.
//
// A puzzle = an ordered list of verifiers (A..F), each pinned to one
// (cardId, optionIdx) pair. The "true criterion" for verifier A is
// cards[0].options[opt0], etc.
//
// Valid puzzle invariants:
//   1. Exactly one code in 1..5^3 satisfies all chosen criteria.
//   2. No criterion is redundant: removing any single verifier leaves
//      strictly more than one solution. (matches the rulebook hint that
//      "no verifier is superfluous")
//   3. No two verifiers share the same card family — keeps puzzles varied.

// Verifier label by index. Backed by a function so we never run out of
// letters — CLASSIC's stepper goes up to 7, EXTREME adds a 6th
// red-herring slot, CUSTOM ranges up to 99, and the old fixed array
// silently rendered `undefined` (empty .vletter) past the cap. After 'Z'
// we wrap to 'AA', 'AB', … in the spreadsheet style.
function verifierLetter(idx) {
    if (idx < 26) return String.fromCharCode(65 + idx);
    const high = Math.floor(idx / 26) - 1;
    const low  = idx % 26;
    return String.fromCharCode(65 + high) + String.fromCharCode(65 + low);
}

// Returns the verifier cards the level-info modal lists for the given level.
//   • Hard: only the colorParam "mystery" cards — the combos are described
//     in the subtitle so the list stays manageable.
//   • Everything else: the full Classic source pool (non-hardplusOnly).
function availableCardsForLevel(level) {
    if (level === 'HARD' || (LEVELS[level] && LEVELS[level].hardplus)) {
        return CARDS.filter(c => c.colorParam);
    }
    return CARDS.filter(c => !c.hardplusOnly);
}

// Count of Classic source cards (non-hardplusOnly, non-colorParam) used as
// the building blocks for Hard's OR-combo verifier slots.
function classicSourceCount() {
    return CARDS.filter(c => !c.hardplusOnly && !c.colorParam).length;
}

// Returns the [paneA, paneB] (or [paneA]) view of a verifier card. paneA is
// always at display index 0 and paneB at index 1; the `swap` flag on extreme
// cards reverses which of (id,opt) vs (altId,altOpt) appears in pane 0.
// Each returned entry carries .active === true for the pane that the verifier
// actually tests; for non-extreme cards there is exactly one entry, which is
// trivially active. Callers should treat the returned panes as the visible
// arrangement (left/top → right/bottom) — the truth bit lives on .active.
function paneListOf(card) {
    if (card.altId === undefined) {
        return [{ id: card.id, opt: card.opt, active: true }];
    }
    const real = { id: card.id,    opt: card.opt,    active: true  };
    const fake = { id: card.altId, opt: card.altOpt, active: false };
    return card.swap ? [fake, real] : [real, fake];
}

function isExtremeCard(card) {
    return card && card.altId !== undefined;
}

// --- random helpers (seeded, deterministic so a seed reproduces a puzzle) ---
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/* istanbul ignore next -- pick is an unused utility kept for parity with shuffle */
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// --- core puzzle helpers ---
// Red-herring slots (Extreme only) carry `redHerring: true`; their active
// criterion does NOT constrain the solution — they're decoys at the slot
// level, not just the pane level. Solution-counting filters them out.
function solutionsFor(puzzle) {
    const tests = puzzle.cards
        .filter(c => !c.redHerring)
        .map(({id, opt}) => CARDS_BY_ID[id].options[opt].test);
    return ALL_CODES.filter(code => tests.every(t => t(code)));
}

// Count matching codes but stop as soon as `cap+1` are found — most callers
// only need to know "exactly 1" or "≤ 1", so enumerating the full code
// space when the second match has already shown up is pure waste.
function solutionCountUpTo(puzzle, cap) {
    const tests = puzzle.cards
        .filter(c => !c.redHerring)
        .map(({id, opt}) => CARDS_BY_ID[id].options[opt].test);
    let c = 0;
    for (const code of ALL_CODES) {
        if (tests.every(t => t(code))) {
            c++;
            if (c > cap) return c;
        }
    }
    return c;
}

// First two whitespace-separated tokens of an option label — used to detect
// near-duplicate cards across a puzzle (e.g. both a "Blue compared to 3"
// and a "Blue below or above 5" card would share the prefix "Blue <"). Two
// verifiers with the same prefix on any of their options end up reading like
// the same kind of question, which is confusing for the player.
function optionPrefix(label) {
    return label.split(/\s+/).slice(0, 2).join(' ');
}

// Memoised set of option prefixes for a card. Cached on the card object
// itself; reconfigureGame swaps in a fresh CARDS array so the cache never
// outlives the config it was built for.
function cardPrefixes(card) {
    if (!card._prefixes) {
        card._prefixes = new Set(card.options.map(o => optionPrefix(o.label)));
    }
    return card._prefixes;
}

// True iff the chosen criteria together rule out at least one option on
// some other (non-redHerring) card BEFORE the player asks anything —
// i.e. that option has zero codes that satisfy both the criteria set and
// the option itself. Example: criterion "A specific color > 3" with
// active option "Blue > 3" combined with card "Whether all numbers are
// below or above 3" — the latter's "All < 3" option becomes impossible
// the moment the player learns the former, so it's free deduction the
// puzzle never intended. We reject such puzzles in generation.
function hasImpliedDeadOption(puzzle) {
    const real = puzzle.cards.filter(c => !c.redHerring);
    const allTests = real.map(({id, opt}) => CARDS_BY_ID[id].options[opt].test);
    // For each card C, check every NON-chosen option against the OTHER
    // cards' criteria (excluding C's own — otherwise non-chosen options
    // trivially conflict with C's chosen one). If no code satisfies the
    // option AND all other criteria, the player can deduce ✗ on that
    // option from the puzzle's setup alone — a leaked deduction we don't
    // want.
    for (let cIdx = 0; cIdx < real.length; cIdx++) {
        const c = real[cIdx];
        const def = CARDS_BY_ID[c.id];
        const otherTests = allTests.filter((_, i) => i !== cIdx);
        for (let oi = 0; oi < def.options.length; oi++) {
            if (oi === c.opt) continue;
            const ot = def.options[oi].test;
            let any = false;
            for (const code of ALL_CODES) {
                if (ot(code) && otherTests.every(t => t(code))) { any = true; break; }
            }
            if (!any) return true;
        }
    }
    return false;
}

function isValidPuzzle(puzzle) {
    const sols = solutionsFor(puzzle);
    if (sols.length !== 1) return false;
    const solution = sols[0];

    // Every verifier must be essential: drop it → >1 solution must remain.
    // We only care whether the count exceeds 1; solutionCountUpTo bails as
    // soon as the second hit shows up. Red-herring cards don't constrain
    // the solution at all so dropping one is a no-op — skip them.
    for (let i = 0; i < puzzle.cards.length; i++) {
        if (puzzle.cards[i].redHerring) continue;
        const dropped = { cards: puzzle.cards.filter((_, j) => j !== i) };
        if (solutionCountUpTo(dropped, 1) === 1) return false;
    }

    // For each card, the solution must activate EXACTLY ONE option. Cards
    // whose options aren't mutually exclusive on the solution (e.g. "sum is
    // a multiple of 3" and "…of 4" both true when sum=12) would let the
    // player query with the solution itself and not know which option fits.
    //
    // EXCEPTIONS:
    //   • multiOption cards (Hard OR-combo cards) are designed so most
    //     proposals match multiple options. The puzzle is still uniquely
    //     solvable on the solution code; the player just can't
    //     reverse-engineer which specific option was the criterion.
    //   • redHerring slots aren't constraints — their criterion is chosen
    //     to NOT match the solution, so this check would always fail.
    for (const card of puzzle.cards) {
        if (card.redHerring) continue;
        const def = CARDS_BY_ID[card.id];
        if (def.multiOption) continue;
        let pass = 0;
        for (const opt of def.options) if (opt.test(solution)) pass++;
        if (pass !== 1) return false;
    }

    // Only check for "implied dead" options on non-hardplus puzzles:
    // Hard's combo verifiers don't auto-deduce per option anyway, so
    // the leak isn't visible to the player there, and enforcing the
    // rule blows past the generation budget given Hard's narrow pool.
    if (!puzzle.config.hardplus && hasImpliedDeadOption(puzzle)) return false;
    // Prefix-uniqueness is enforced at card-selection time in generatePuzzle
    // (so we don't even build puzzles that would fail it), so no need to
    // re-check it here.

    return true;
}

// --- difficulty levels ---
// Each level just declares how many verifiers to pin. Honors
// GAME_CONFIG.maxVerifiers so widening the game later (more cards, more
// colors) needs only a config tweak. The CUSTOM level carries no fixed
// verifier count — it's filled in per-puzzle.
const LEVELS = {
    // Classic carries no fixed verifier count: the player picks the count
    // via a stepper on the level-select screen, which gets passed through
    // generatePuzzle's opts.verifiers.
    CLASSIC: { id:'CLASSIC', label:'Classic', verifiers:5,
               description:'The standard rule pool — pick how many verifiers you want above' },
    HARD:    { id:'HARD',    label:'Hard',    verifiers:Math.min(5, GAME_CONFIG.maxVerifiers), hardplus:true,
               description:'Same as Classic, but using OR-combo cards' },
    EXTREME: { id:'EXTREME', label:'Extreme', verifiers:Math.min(5, GAME_CONFIG.maxVerifiers), extreme:true,
               description:'5 real verifiers (each shows TWO cards, only one is real) PLUS a 6th red-herring verifier' },
    CUSTOM:  { id:'CUSTOM',  label:'Custom level', verifiers:0,
               description:'Pick your own digit range and verifier count' },
    // "Create game for my number" — the player picks a code AND a level
    // (Classic/Hard/Extreme), the generator produces a puzzle whose
    // unique solution equals the chosen code. Meant for sharing the
    // game id with friends so they can play YOUR puzzle.
    MYCODE:  { id:'MYCODE',  label:'Create game for my number', verifiers:0, noInfo:true,
               description:'Pick a code and a level — share the resulting puzzle with friends' },
    // Legacy entries kept so old game IDs and existing tests keep working.
    // _legacy:true is the filter main.js uses to hide them on level select.
    EASY:     { id:'EASY',     label:'Classic', verifiers:4, _legacy:true },
    MEDIUM:   { id:'MEDIUM',   label:'Classic', verifiers:5, _legacy:true },
    HARDPLUS: { id:'HARDPLUS', label:'Hard',    verifiers:Math.min(5, GAME_CONFIG.maxVerifiers), hardplus:true, _legacy:true },
};

// --- generate a puzzle for a given level, optionally from a seed -----------
// opts: { verifiers, digitMin, digitMax, maxAttempts, signal }
//   - verifiers/digitMin/digitMax override the LEVELS default and GAME_CONFIG
//     (applied via reconfigureGame BEFORE attempting generation, so the
//     pruning is correct for the requested range).
//   - maxAttempts caps the search budget (default 4000).
//   - signal: { aborted } poll-checked between attempts, lets the caller
//     interrupt a long-running search.
// Returns the puzzle on success, or null if the budget is exhausted / aborted.
function generatePuzzle(level, seed, opts = {}) {
    if (opts.digitMin !== undefined || opts.digitMax !== undefined) {
        reconfigureGame({ digitMin: opts.digitMin, digitMax: opts.digitMax });
    }
    const verifiers = opts.verifiers !== undefined ? opts.verifiers
                    : (level === 'CUSTOM' ? 5 : LEVELS[level].verifiers);
    const questionsPerRound = opts.questionsPerRound !== undefined
        ? opts.questionsPerRound
        : (level === 'CUSTOM' ? 3 : GAME_CONFIG.questionsPerRound);
    // Extreme: every verifier slot also gets a decoy card. Active card alone
    // determines puzzle validity; decoy is just a distractor for the player.
    const extreme = opts.extreme !== undefined
        ? !!opts.extreme
        : !!(LEVELS[level] && LEVELS[level].extreme);
    // Hard+: restrict the card pool to colorParam cards — every verifier's
    // rule is "which color satisfies <predicate>?". Same deduction mechanics
    // as a normal puzzle, but the homogeneous card style raises the bar.
    const hardplus = opts.hardplus !== undefined
        ? !!opts.hardplus
        : !!(LEVELS[level] && LEVELS[level].hardplus);
    // Default budget bumped to account for the stricter `isValidPuzzle`
    // constraints (solution must activate exactly one option per card AND no
    // two cards may share an option prefix). HARD (6 verifiers) needs a few
    // thousand attempts on average; this leaves comfortable headroom.
    const maxAttempts = opts.maxAttempts || 100000;
    const baseSeed = (seed === undefined) ? Math.floor(Math.random() * 0xFFFFFFFF) : seed;
    let attempt = 0;
    // Card pool — Hard+ uses the FULL pool (including the easier levels'
    // cards) and requires every puzzle to contain at least one colorParam
    // verifier (otherwise it's indistinguishable from HARD). The
    // colorParam-requirement gate is applied AFTER selection: an attempt
    // that picked zero colorParam cards is rejected and the loop tries
    // again with a fresh seed. This works because the colorParam family is
    // a comfortable share of the pool, so random shuffles hit it often.
    while (attempt < maxAttempts) {
        if (opts.signal && opts.signal.aborted) return null;
        const rng = mulberry32((baseSeed + attempt * 2654435761) >>> 0);
        attempt++;
        let shuffled;
        if (hardplus) {
            // Hard: pool consists of every "mystery" verifier. That's the
            // synthesised OR-combos (you don't know which of the 2 source
            // rules was answered) PLUS the colorParam cards (you don't
            // know which color is the criterion). Both have the property
            // that a YES/NO verdict alone doesn't pin a single option, so
            // they fit Hard's "the verdict tells you less" theme. Each
            // combo's family is `combo_<srcA>_<srcB>` so family-uniqueness
            // already prevents the same source pair appearing twice; sources
            // CAN appear in multiple combos at different slots, which is
            // intentional — that's the bluff.
            shuffled = shuffle(rng, CARDS.filter(c => c.hardplusOnly || c.colorParam));
        } else {
            // Non-Hard pools exclude the combo cards (their multiOption
            // semantics don't fit the standard 1-● Ask rule).
            shuffled = shuffle(rng, CARDS.filter(c => !c.hardplusOnly));
        }
        const chosen = [];
        const usedFamilies = new Set();
        // Tracks option-prefixes of cards already picked in this attempt so
        // we can skip any incoming card that would collide BEFORE handing
        // the puzzle to isValidPuzzle. Early-rejecting here is the big win:
        // most random combinations would fail the prefix-uniqueness check,
        // and dropping them now skips the 125-code enumeration entirely.
        //
        // Hard+ INTENTIONALLY violates the prefix-uniqueness rule: the whole
        // appeal of that level is that every verifier asks the same SHAPE of
        // question (Color < N, Color = N, …) and the player must isolate the
        // active color. Enforcing distinct prefixes here would also make 6
        // verifiers from the colorParam pool nearly impossible to source.
        const usedPrefixes = new Set();
        // ALSO track each chosen card's full option labels — no two cards
        // in the same puzzle may list an identical option text. Catches
        // overlaps that prefix-uniqueness misses (e.g. card 2 "Blue < 3"
        // option matches card 26 "Blue < 3" option exactly) AND applies
        // uniformly to Hard's combo pool where prefix-uniqueness is off.
        const usedOptionLabels = new Set();
        for (const card of shuffled) {
            if (chosen.length === verifiers) break;
            /* istanbul ignore if -- with the default pruned card pool, no two surviving cards share a family, so this dedup is defensive against future config changes */
            if (usedFamilies.has(card.family)) continue;
            const prefs = cardPrefixes(card);
            if (!hardplus) {
                let clash = false;
                for (const p of prefs) {
                    if (usedPrefixes.has(p)) { clash = true; break; }
                }
                if (clash) continue;
            }
            if (card.options.some(o => usedOptionLabels.has(o.label))) continue;
            // opts.fixedSolution constrains the option choice: only options
            // the target code satisfies are eligible — guarantees that the
            // target IS a solution. (isValidPuzzle then verifies it's the
            // UNIQUE solution; if not, the attempt continues.)
            let opt;
            if (opts.fixedSolution) {
                const validOpts = [];
                for (let i = 0; i < card.options.length; i++) {
                    if (card.options[i].test(opts.fixedSolution)) validOpts.push(i);
                }
                if (!validOpts.length) continue;
                opt = validOpts[Math.floor(rng() * validOpts.length)];
            } else {
                opt = Math.floor(rng() * card.options.length);
            }
            chosen.push({ id: card.id, opt });
            usedFamilies.add(card.family);
            for (const p of prefs) usedPrefixes.add(p);
            for (const o of card.options) usedOptionLabels.add(o.label);
        }
        if (chosen.length < verifiers) continue;
        const puzzle = {
            level,
            seed: baseSeed,
            cards: chosen,
            config: {
                digitMin: GAME_CONFIG.digitMin,
                digitMax: GAME_CONFIG.digitMax,
                verifiers,
                questionsPerRound,
                extreme,
                hardplus,
            },
        };
        if (!isValidPuzzle(puzzle)) continue;
        // Active cards form a valid puzzle — now attach decoys for extreme.
        // Decoy at slot i must be a different family than the slot's ACTIVE
        // card (so the pair reads as two genuinely different rules) but is
        // otherwise unconstrained — decoys may share families across slots
        // and may collide with prefixes of other slots' actives; both are
        // intentional and add to the bluff.
        if (extreme) {
            // Every Extreme slot pairs the Classic active with an
            // OR-combo decoy — pairing two Classic cards in one slot
            // makes the Ask-rule grey-out unnecessarily strict (e.g. on
            // [1,1,1] two natural Classic options match in different
            // panes). Combo decoys carry multiOption, which relaxes the
            // 1-● gate to "always askable" — the player gets to ask any
            // proposal and reason about the YES/NO answer.
            const ok = attachDecoys(puzzle, rng, { minCombo: puzzle.cards.length });
            /* istanbul ignore if -- triggered only when the pool has no different-family decoy for some slot; tested directly via the attachDecoys-stubbed test */
            if (!ok) continue;
        }
        puzzle.solution = solutionsFor(puzzle)[0];
        if (extreme) {
            // Append a single red-herring slot. The herring's active
            // criterion is deliberately chosen to NOT match the solution,
            // so the player can tell it apart by asking the solution (the
            // herring is the verifier that says NO when everything else
            // says YES). Failure to find a non-family-conflicting herring
            // rejects the attempt — generation retries with a new seed.
            const ok = attachRedHerring(puzzle, rng);
            /* istanbul ignore if -- the Classic pool has tens of cards across many families; failing to find a herring takes a pathological config */
            if (!ok) continue;
        }
        return puzzle;
    }
    return null;
}

// Append a single red-herring slot to an Extreme puzzle. The herring is
// styled like a normal Extreme slot (two cards, one swap bit) so the
// player can't tell it apart visually — but its active criterion is
// chosen to NOT match the actual solution. That makes the herring the
// one verifier that says NO on a query of the true solution.
//
// Returns true on success; false if the pool can't supply a family-distinct
// herring whose active criterion misses the solution (the caller will
// retry with a fresh seed).
function attachRedHerring(puzzle, rng) {
    const solution = puzzle.solution;
    const usedFamilies = new Set(puzzle.cards.map(c => CARDS_BY_ID[c.id].family));
    const usedLabels   = usedOptionLabelsIn(puzzle);
    // Active card pool: non-hardplusOnly, family not yet used, with at
    // least one option that does NOT match the solution AND no option-label
    // overlap with any card already in the puzzle.
    const activeCands = CARDS.filter(c =>
        !c.hardplusOnly && !usedFamilies.has(c.family) &&
        c.options.some(o => !o.test(solution)) &&
        !c.options.some(o => usedLabels.has(o.label)));
    if (!activeCands.length) return false;
    const shuffledActives = shuffle(rng, activeCands);
    for (const card of shuffledActives) {
        const okOpts = card.options
            .map((opt, oi) => ({ oi, opt }))
            .filter(({ opt }) => !opt.test(solution));
        /* istanbul ignore if -- activeCands already filtered to cards with ≥1 such option */
        if (!okOpts.length) continue;
        const pick = okOpts[Math.floor(rng() * okOpts.length)];
        // Decoy for the herring's pair: an OR-combo (matches every other
        // Extreme slot, which use combo decoys uniformly) so the herring
        // doesn't end up as the only Classic-Classic pair in the puzzle.
        const heldLabels = new Set([...usedLabels, ...card.options.map(o => o.label)]);
        const decoyCands = CARDS.filter(c =>
            c.hardplusOnly &&
            c.family !== card.family &&
            c.id !== card.id &&
            !c.options.some(o => heldLabels.has(o.label)));
        /* istanbul ignore if -- with a Classic pool of 30+ families, a label-distinct decoy from a different family always exists */
        if (!decoyCands.length) continue;
        const decoy = decoyCands[Math.floor(rng() * decoyCands.length)];
        const decoyOpt = Math.floor(rng() * decoy.options.length);
        puzzle.cards.push({
            id:    card.id,
            opt:   pick.oi,
            altId: decoy.id,
            altOpt: decoyOpt,
            swap:  rng() < 0.5,
            redHerring: true,
        });
        return true;
    }
    return false;
}

// Collects every option label currently in use across the puzzle's active
// AND decoy cards. Generators use this to reject candidates whose options
// would duplicate an existing one — "Blue < 3" must appear at most once.
function usedOptionLabelsIn(puzzle) {
    const out = new Set();
    for (const c of puzzle.cards) {
        for (const o of CARDS_BY_ID[c.id].options) out.add(o.label);
        if (c.altId !== undefined) {
            for (const o of CARDS_BY_ID[c.altId].options) out.add(o.label);
        }
    }
    return out;
}

// For each verifier slot, pick a decoy card with a different family than the
// slot's active card AND no option-label overlap with any other card already
// in the puzzle. Returns true on success; false if the pool is too small to
// provide such a decoy for every slot (in which case the caller will retry
// with a different seed). Mutates puzzle.cards in place.
// Attaches a decoy pane to every slot in `puzzle.cards`. opts.minCombo
// forces the first N slots (in a random order) to draw their decoy from
// the OR-combo (hardplusOnly) pool — used by Extreme to guarantee at
// least 3 multiOption decoys per puzzle. Remaining slots draw from the
// Classic source pool. Returns false when the pool can't satisfy the
// constraints (caller retries with a fresh seed).
function attachDecoys(puzzle, rng, opts = {}) {
    const used     = usedOptionLabelsIn(puzzle);
    const minCombo = opts.minCombo || 0;
    // Shuffle slot indices so the combo decoys land on random slots.
    const order = shuffle(rng, puzzle.cards.map((_, i) => i));
    for (let k = 0; k < order.length; k++) {
        const slot = puzzle.cards[order[k]];
        const activeDef = CARDS_BY_ID[slot.id];
        const wantCombo = k < minCombo;
        const candidates = CARDS.filter(c => {
            if (wantCombo ? !c.hardplusOnly : c.hardplusOnly) return false;
            return c.family !== activeDef.family && c.id !== slot.id &&
                   !c.options.some(o => used.has(o.label));
        });
        if (!candidates.length) return false;
        const pick = candidates[Math.floor(rng() * candidates.length)];
        const optIdx = Math.floor(rng() * pick.options.length);
        slot.altId  = pick.id;
        slot.altOpt = optIdx;
        slot.swap   = rng() < 0.5;
        for (const o of pick.options) used.add(o.label);
    }
    return true;
}

// --- game id codec ----------------------------------------------------------
// Preset format: <levelChar><cardId>.<opt>-<cardId>.<opt>-...
//   Example: "M11.0-23.2-4.1-9.3-21.0"
// Custom format: "C<digitMin>_<digitMax>[Q<qpr>][X]_<cardList>"
//   Example: "C1_7_5.1-12.2-23.0-31.2-17.1" → digits 1..7, 5 verifiers.
// Extreme mode adds a decoy per verifier: each segment becomes
//   <id>.<opt>.<altId>.<altOpt>.<swap>   (swap ∈ {0,1})
// Preset extreme uses level char X. Custom extreme appends the X marker after
// the optional Q suffix (e.g. "C1_5X_…" or "C1_5Q4X_…").
// Self-describing and short enough for a URL.
// Encoder is canonical: each current level has ONE letter. Legacy LEVELS
// entries still encode (so tests using generatePuzzle('EASY', …) work)
// but they collapse onto the modern letter — an EASY puzzle encodes as L
// and decodes back as CLASSIC. The cards and solution are identical;
// only the label differs.
const LEVEL_CHAR = {
    CLASSIC:'L', HARD:'H', EXTREME:'X',
    EASY:'L', MEDIUM:'L', HARDPLUS:'H',
};
const CHAR_LEVEL = {
    L:'CLASSIC',  X:'EXTREME',  H:'HARD',
    // Legacy aliases:
    E:'CLASSIC',  // old Easy   (4 verifiers)
    M:'CLASSIC',  // old Medium (5 verifiers)
    P:'HARD',     // old Hard+  (5 verifiers, hardplus pool)
};

function encodeGameId(puzzle) {
    const body = puzzle.cards.map(card => {
        if (isExtremeCard(card)) {
            // 6 ints per extreme segment: id.opt.altId.altOpt.swap.herring.
            const h = card.redHerring ? 1 : 0;
            return `${card.id}.${card.opt}.${card.altId}.${card.altOpt}.${card.swap ? 1 : 0}.${h}`;
        }
        return `${card.id}.${card.opt}`;
    }).join('-');
    if (puzzle.level === 'CUSTOM') {
        const { digitMin, digitMax, questionsPerRound, extreme } = puzzle.config;
        // Only emit the Q suffix when it differs from the default (3); keeps
        // older shared IDs short and forward-compatible.
        const q = (questionsPerRound && questionsPerRound !== 3) ? `Q${questionsPerRound}` : '';
        const x = extreme ? 'X' : '';
        return `C${digitMin}_${digitMax}${q}${x}_${body}`;
    }
    return `${LEVEL_CHAR[puzzle.level]}${body}`;
}

function decodeGameId(id) {
    if (!id || id.length < 2) throw new Error('Empty game id');
    const ch = id[0].toUpperCase();

    let level, body, customConfig = null;
    let extreme = false;
    if (ch === 'C') {
        // Custom: read the digit range (and optional questions-per-round, and
        // optional extreme marker X) from the ID, reconfigure the runtime
        // BEFORE looking up cards (pruned card sets differ by range).
        const rest = id.slice(1);
        // Accept "min_max[Qqpr][X]_cards" — Q and X both optional, in that order.
        const m = rest.match(/^(\d+)_(\d+)(?:Q(\d+))?(X)?_(.+)$/);
        if (!m) throw new Error('Malformed custom game id');
        const digitMin = parseInt(m[1]);
        const digitMax = parseInt(m[2]);
        const qpr      = m[3] ? parseInt(m[3]) : 3;
        extreme        = !!m[4];
        if (!(digitMin >= 0 && digitMax > digitMin && digitMax <= 9)) {
            throw new Error('Custom digit range out of bounds');
        }
        if (!(qpr >= 1)) throw new Error('Custom questions/round out of bounds');
        customConfig = { digitMin, digitMax, questionsPerRound: qpr, extreme };
        reconfigureGame({ digitMin, digitMax });
        level = 'CUSTOM';
        body = m[5];
    } else if (ch in CHAR_LEVEL) {
        level = CHAR_LEVEL[ch];
        body  = id.slice(1);
        extreme = !!(LEVELS[level] && LEVELS[level].extreme);
        // Preset levels assume the default config; if the runtime was last
        // reconfigured for a custom puzzle, restore it now.
        reconfigureGame({ digitMin: 1, digitMax: 5 });
    } else {
        throw new Error('Unknown level prefix');
    }

    const cards = body.split('-').map(part => {
        const nums = part.split('.').map(Number);
        if (nums.length !== 2 && nums.length !== 5 && nums.length !== 6) {
            throw new Error('Malformed verifier segment: ' + part);
        }
        const [cid, oi] = nums;
        if (!CARDS_BY_ID[cid]) throw new Error('Unknown card id: ' + cid);
        const opt = oi | 0;
        if (opt < 0 || opt >= CARDS_BY_ID[cid].options.length) {
            throw new Error('Invalid option index on card ' + cid);
        }
        const out = { id: cid, opt };
        if (nums.length >= 5) {
            const [, , aid, aoi, swap] = nums;
            if (!CARDS_BY_ID[aid]) throw new Error('Unknown decoy card id: ' + aid);
            const aopt = aoi | 0;
            if (aopt < 0 || aopt >= CARDS_BY_ID[aid].options.length) {
                throw new Error('Invalid decoy option index on card ' + aid);
            }
            if (swap !== 0 && swap !== 1) {
                throw new Error('Decoy swap bit must be 0 or 1');
            }
            out.altId = aid;
            out.altOpt = aopt;
            out.swap = swap === 1;
            if (nums.length === 6) {
                const h = nums[5];
                if (h !== 0 && h !== 1) {
                    throw new Error('Red-herring bit must be 0 or 1');
                }
                if (h === 1) out.redHerring = true;
            }
        }
        return out;
    });
    /* istanbul ignore if -- defensive: body.split('-') always yields ≥1 element so this trips only on truly malformed parsing earlier */
    if (cards.length < 1) {
        throw new Error('Game must have at least one verifier');
    }
    // Segments must be uniform (all extreme or none), and that must agree
    // with the top-level marker. Mixed encodings are nonsense; mismatches
    // mean the id was edited by hand into an inconsistent state.
    const allExtremeSeg  = cards.every(c => c.altId !== undefined);
    const noneExtremeSeg = cards.every(c => c.altId === undefined);
    if (!allExtremeSeg && !noneExtremeSeg) {
        throw new Error('Mixed normal and extreme verifier segments');
    }
    if (extreme !== allExtremeSeg) {
        throw new Error('Extreme marker disagrees with verifier segments');
    }
    const hardplus = !!(LEVELS[level] && LEVELS[level].hardplus);
    const puzzle = {
        level, seed: null, cards,
        config: customConfig
            ? {
                digitMin: customConfig.digitMin,
                digitMax: customConfig.digitMax,
                verifiers: cards.length,
                questionsPerRound: customConfig.questionsPerRound,
                extreme: customConfig.extreme,
                hardplus: false,
              }
            : {
                digitMin: GAME_CONFIG.digitMin,
                digitMax: GAME_CONFIG.digitMax,
                verifiers: cards.length,
                questionsPerRound: GAME_CONFIG.questionsPerRound,
                extreme,
                hardplus,
              },
    };
    const sols = solutionsFor(puzzle);
    if (sols.length !== 1) {
        throw new Error('Game id does not yield a unique solution');
    }
    puzzle.solution = sols[0];
    return puzzle;
}
