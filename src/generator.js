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

// Single-letter verifier labels. Extended to 'Z' so custom levels with a high
// verifier count still get distinct labels; the visible card row only uses as
// many letters as the puzzle has verifiers.
const VERIFIER_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];

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
function solutionsFor(puzzle) {
    const tests = puzzle.cards.map(({id, opt}) => CARDS_BY_ID[id].options[opt].test);
    return ALL_CODES.filter(code => tests.every(t => t(code)));
}

function isValidPuzzle(puzzle) {
    const sols = solutionsFor(puzzle);
    if (sols.length !== 1) return false;
    // Every verifier must be essential: drop it → >1 solution must remain.
    for (let i = 0; i < puzzle.cards.length; i++) {
        const dropped = { cards: puzzle.cards.filter((_, j) => j !== i) };
        if (solutionsFor(dropped).length === 1) return false;
    }
    return true;
}

// --- difficulty levels ---
// Each level just declares how many verifiers to pin. Honors
// GAME_CONFIG.maxVerifiers so widening the game later (more cards, more
// colors) needs only a config tweak. The CUSTOM level carries no fixed
// verifier count — it's filled in per-puzzle.
const LEVELS = {
    EASY:    { id:'EASY',    label:'Easy',    verifiers:Math.min(4, GAME_CONFIG.maxVerifiers), description:'4 verifiers · perfect for a first game' },
    MEDIUM:  { id:'MEDIUM',  label:'Medium',  verifiers:Math.min(5, GAME_CONFIG.maxVerifiers), description:'5 verifiers · the standard challenge' },
    HARD:    { id:'HARD',    label:'Hard',    verifiers:Math.min(6, GAME_CONFIG.maxVerifiers), description:'6 verifiers · for experienced sleuths' },
    CUSTOM:  { id:'CUSTOM',  label:'Custom level', verifiers:0,             description:'Pick your own digit range and verifier count' },
};

// --- generate a puzzle for a given level, optionally from a seed -----------
// opts: { verifiers, digitMin, digitMax, colorCount, maxAttempts, signal }
//   - verifiers/digitMin/digitMax/colorCount override the LEVELS default and
//     GAME_CONFIG (applied via reconfigureGame BEFORE attempting generation,
//     so the pruning is correct for the requested range and slot count).
//   - colorCount (3..ALL_COLORS.length) picks how many color slots the code
//     has. Defaults to the current GAME_CONFIG.colors length.
//   - maxAttempts caps the search budget (default 4000).
//   - signal: { aborted } poll-checked between attempts, lets the caller
//     interrupt a long-running search.
// Returns the puzzle on success, or null if the budget is exhausted / aborted.
function generatePuzzle(level, seed, opts = {}) {
    if (opts.digitMin !== undefined || opts.digitMax !== undefined || opts.colorCount !== undefined) {
        const reconf = {
            digitMin: opts.digitMin,
            digitMax: opts.digitMax,
        };
        if (opts.colorCount !== undefined) {
            reconf.colors = ALL_COLORS.slice(0, opts.colorCount);
        }
        reconfigureGame(reconf);
    }
    const verifiers = opts.verifiers !== undefined ? opts.verifiers
                    : (level === 'CUSTOM' ? 5 : LEVELS[level].verifiers);
    const questionsPerRound = opts.questionsPerRound !== undefined
        ? opts.questionsPerRound
        : (level === 'CUSTOM' ? 3 : GAME_CONFIG.questionsPerRound);
    const maxAttempts = opts.maxAttempts || 4000;
    const baseSeed = (seed === undefined) ? Math.floor(Math.random() * 0xFFFFFFFF) : seed;
    let attempt = 0;
    while (attempt < maxAttempts) {
        if (opts.signal && opts.signal.aborted) return null;
        const rng = mulberry32((baseSeed + attempt * 2654435761) >>> 0);
        attempt++;
        const shuffled = shuffle(rng, CARDS);
        const chosen = [];
        const usedFamilies = new Set();
        for (const card of shuffled) {
            if (chosen.length === verifiers) break;
            /* istanbul ignore if -- with the default pruned card pool, no two surviving cards share a family, so this dedup is defensive against future config changes */
            if (usedFamilies.has(card.family)) continue;
            const opt = Math.floor(rng() * card.options.length);
            chosen.push({ id: card.id, opt });
            usedFamilies.add(card.family);
        }
        if (chosen.length < verifiers) continue;
        const puzzle = {
            level,
            seed: baseSeed,
            cards: chosen,
            config: {
                digitMin: GAME_CONFIG.digitMin,
                digitMax: GAME_CONFIG.digitMax,
                colors: GAME_CONFIG.colors.slice(),
                verifiers,
                questionsPerRound,
            },
        };
        if (isValidPuzzle(puzzle)) {
            puzzle.solution = solutionsFor(puzzle)[0];
            return puzzle;
        }
    }
    return null;
}

// --- game id codec ----------------------------------------------------------
// Preset format: <levelChar><cardId>.<opt>-<cardId>.<opt>-...
//   Example: "M11.0-23.2-4.1-9.3-21.0"
// Custom format: "C<digitMin>_<digitMax>[N<colorCount>][Q<qpr>]_<cardList>"
//   Example: "C1_7_5.1-12.2-23.0-31.2-17.1" → digits 1..7, 3 colors (default).
//   Example: "C1_5N5_..." → digits 1..5 with 5 color slots.
// Self-describing and short enough for a URL. N/Q suffixes are only emitted
// when they differ from the default so legacy IDs stay compact and parseable.
const LEVEL_CHAR = { EASY:'E', MEDIUM:'M', HARD:'H' };
const CHAR_LEVEL = { E:'EASY',  M:'MEDIUM',  H:'HARD'  };

function encodeGameId(puzzle) {
    const body = puzzle.cards.map(({id, opt}) => `${id}.${opt}`).join('-');
    if (puzzle.level === 'CUSTOM') {
        const { digitMin, digitMax, questionsPerRound, colors } = puzzle.config;
        const colorCount = (colors && colors.length) || 3;
        // Only emit the N/Q suffixes when they differ from the defaults (3
        // colors / 3 questions-per-round); keeps older shared IDs short and
        // forward-compatible.
        const n = colorCount !== 3 ? `N${colorCount}` : '';
        const q = (questionsPerRound && questionsPerRound !== 3) ? `Q${questionsPerRound}` : '';
        return `C${digitMin}_${digitMax}${n}${q}_${body}`;
    }
    return `${LEVEL_CHAR[puzzle.level]}${body}`;
}

function decodeGameId(id) {
    if (!id || id.length < 2) throw new Error('Empty game id');
    const ch = id[0].toUpperCase();

    let level, body, customConfig = null;
    if (ch === 'C') {
        // Custom: read the digit range (and optional color-count /
        // questions-per-round) from the ID, reconfigure the runtime BEFORE
        // looking up cards (pruned card sets differ by range and colors).
        const rest = id.slice(1);
        // Order: digitMin _ digitMax [N<colors>] [Q<qpr>] _ cards
        // Legacy forms ("min_max_cards", "min_maxQqpr_cards") still parse —
        // both N and Q are independently optional.
        const m = rest.match(/^(\d+)_(\d+)(?:N(\d+))?(?:Q(\d+))?_(.+)$/);
        if (!m) throw new Error('Malformed custom game id');
        const digitMin   = parseInt(m[1]);
        const digitMax   = parseInt(m[2]);
        const colorCount = m[3] ? parseInt(m[3]) : 3;
        const qpr        = m[4] ? parseInt(m[4]) : 3;
        if (!(digitMin >= 0 && digitMax > digitMin && digitMax <= 9)) {
            throw new Error('Custom digit range out of bounds');
        }
        if (!(colorCount >= 3 && colorCount <= ALL_COLORS.length)) {
            throw new Error('Custom color count out of bounds');
        }
        if (!(qpr >= 1)) throw new Error('Custom questions/round out of bounds');
        const colorList = ALL_COLORS.slice(0, colorCount);
        customConfig = {
            digitMin, digitMax,
            colors: colorList,
            questionsPerRound: qpr,
        };
        reconfigureGame({ digitMin, digitMax, colors: colorList });
        level = 'CUSTOM';
        body = m[5];
    } else if (ch in CHAR_LEVEL) {
        level = CHAR_LEVEL[ch];
        body  = id.slice(1);
        // Preset levels assume the default config; if the runtime was last
        // reconfigured for a custom puzzle, restore it now.
        reconfigureGame({ digitMin: 1, digitMax: 5, colors: ALL_COLORS.slice(0, 3) });
    } else {
        throw new Error('Unknown level prefix');
    }

    const cards = body.split('-').map(part => {
        const [cid, oi] = part.split('.').map(Number);
        if (!CARDS_BY_ID[cid]) throw new Error('Unknown card id: ' + cid);
        const opt = oi | 0;
        if (opt < 0 || opt >= CARDS_BY_ID[cid].options.length) {
            throw new Error('Invalid option index on card ' + cid);
        }
        return { id: cid, opt };
    });
    /* istanbul ignore if -- defensive: body.split('-') always yields ≥1 element so this trips only on truly malformed parsing earlier */
    if (cards.length < 1) {
        throw new Error('Game must have at least one verifier');
    }
    const puzzle = {
        level, seed: null, cards,
        config: customConfig
            ? {
                digitMin: customConfig.digitMin,
                digitMax: customConfig.digitMax,
                colors: customConfig.colors.slice(),
                verifiers: cards.length,
                questionsPerRound: customConfig.questionsPerRound,
              }
            : {
                digitMin: GAME_CONFIG.digitMin,
                digitMax: GAME_CONFIG.digitMax,
                colors: GAME_CONFIG.colors.slice(),
                verifiers: cards.length,
                questionsPerRound: GAME_CONFIG.questionsPerRound,
              },
    };
    const sols = solutionsFor(puzzle);
    if (sols.length !== 1) {
        throw new Error('Game id does not yield a unique solution');
    }
    puzzle.solution = sols[0];
    return puzzle;
}
