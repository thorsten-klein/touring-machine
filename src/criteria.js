'use strict';

// Turing Machine — criteria card definitions.
//
// Each card represents what a single Verifier checks. The player sees the card
// (topic + list of possible criteria), and must deduce which option is the one
// actually being checked. Every option carries a `test(b,y,p)` that returns
// true when the proposal (blue, yellow, purple) satisfies that criterion.
//
// Card IDs 1..48 follow the physical rulebook's numbering where the public
// rule text was specific; for cards whose exact mapping isn't in the public
// rules we chose sensible, distinct definitions that match the card category
// described in the rulebook.
//
// `topic` is a short, public phrase shown above the option list.
// `family` is used by the generator to avoid stacking near-duplicate verifiers.

// Color slot names come from GAME_CONFIG.colors. Cards that reference a
// specific color do so by symbolic name (COLOR.BLUE etc.) — index lookup is
// resolved at call-time via colorIdx() so re-ordering colors works for free.
const COLOR = (() => {
    const out = {};
    GAME_CONFIG.colors.forEach(c => { out[c.toUpperCase()] = c; });
    return out;
})();
const COLOR_NAMES = GAME_CONFIG.colors.slice();
function colorIdx(name) { return GAME_CONFIG.colors.indexOf(name); }

function digit(code, color) {
    return code[colorIdx(color)];
}
function countDigit(code, n) {
    let c = 0;
    for (const d of code) if (d === n) c++;
    return c;
}
function countEven(code) { let c=0; for (const d of code) if (d%2===0) c++; return c; }
function colorLabel(c) { return c[0].toUpperCase() + c.slice(1); }

// helpers to build the most common option shapes
function cmp(color, n) {
    return [
        { label: `${colorLabel(color)} < ${n}`, test: c => digit(c,color) <  n },
        { label: `${colorLabel(color)} = ${n}`, test: c => digit(c,color) === n },
        { label: `${colorLabel(color)} > ${n}`, test: c => digit(c,color) >  n },
    ];
}
function cmpTwoColors(a, b) {
    return [
        { label: `${colorLabel(a)} < ${colorLabel(b)}`, test: c => digit(c,a) <  digit(c,b) },
        { label: `${colorLabel(a)} = ${colorLabel(b)}`, test: c => digit(c,a) === digit(c,b) },
        { label: `${colorLabel(a)} > ${colorLabel(b)}`, test: c => digit(c,a) >  digit(c,b) },
    ];
}
function parity(color) {
    return [
        { label: `${colorLabel(color)} is even`, test: c => digit(c,color)%2 === 0 },
        { label: `${colorLabel(color)} is odd`,  test: c => digit(c,color)%2 === 1 },
    ];
}

const CARDS = [

    // --- 1: blue compared to 1 (only =, >) ---
    { id:1, topic:'Blue compared to 1', family:'cmp_blue_1', options:[
        { label:'Blue = 1', test: c => digit(c,COLOR.BLUE) === 1 },
        { label:'Blue > 1', test: c => digit(c,COLOR.BLUE) > 1 },
    ]},

    // --- 2-4: a color vs a constant (less/equal/greater).
    // Family scheme `cmp_<color>_<N>` matches the scaling generator below so
    // duplicates can be skipped automatically when the digit range widens.
    { id:2, topic:'Blue compared to 3',   family:'cmp_blue_3',   options: cmp(COLOR.BLUE,   3) },
    { id:3, topic:'Yellow compared to 3', family:'cmp_yellow_3', options: cmp(COLOR.YELLOW, 3) },
    { id:4, topic:'Yellow compared to 4', family:'cmp_yellow_4', options: cmp(COLOR.YELLOW, 4) },

    // --- 5-7: parity of a single color ---
    { id:5, topic:'Parity of blue',   family:'parB', options: parity(COLOR.BLUE) },
    { id:6, topic:'Parity of yellow', family:'parY', options: parity(COLOR.YELLOW) },
    { id:7, topic:'Parity of purple', family:'parP', options: parity(COLOR.PURPLE) },

    // --- 8-10: count of 1s / 3s / 4s in the code (verifier knows the digit) ---
    { id:8, topic:'How many 1s are in the code', family:'count_1', options:[
        { label:'Zero 1s',  test: c => countDigit(c,1) === 0 },
        { label:'One 1',    test: c => countDigit(c,1) === 1 },
        { label:'Two 1s',   test: c => countDigit(c,1) === 2 },
        { label:'Three 1s', test: c => countDigit(c,1) === 3 },
    ]},
    { id:9, topic:'How many 3s are in the code', family:'count_3', options:[
        { label:'Zero 3s',  test: c => countDigit(c,3) === 0 },
        { label:'One 3',    test: c => countDigit(c,3) === 1 },
        { label:'Two 3s',   test: c => countDigit(c,3) === 2 },
        { label:'Three 3s', test: c => countDigit(c,3) === 3 },
    ]},
    { id:10, topic:'How many 4s are in the code', family:'count_4', options:[
        { label:'Zero 4s',  test: c => countDigit(c,4) === 0 },
        { label:'One 4',    test: c => countDigit(c,4) === 1 },
        { label:'Two 4s',   test: c => countDigit(c,4) === 2 },
        { label:'Three 4s', test: c => countDigit(c,4) === 3 },
    ]},

    // --- 11-13: compare two colors in the proposal ---
    { id:11, topic:'Blue vs Yellow',   family:'cmpBY', options: cmpTwoColors(COLOR.BLUE,   COLOR.YELLOW) },
    { id:12, topic:'Blue vs Purple',   family:'cmpBP', options: cmpTwoColors(COLOR.BLUE,   COLOR.PURPLE) },
    { id:13, topic:'Yellow vs Purple', family:'cmpYP', options: cmpTwoColors(COLOR.YELLOW, COLOR.PURPLE) },

    // --- 14-15: which color is strictly smallest ---
    { id:14, topic:'Which color is strictly the smallest', family:'minColor', options:[
        { label:'Blue is smallest',   test: c => c[0] < c[1] && c[0] < c[2] },
        { label:'Yellow is smallest', test: c => c[1] < c[0] && c[1] < c[2] },
        { label:'Purple is smallest', test: c => c[2] < c[0] && c[2] < c[1] },
    ]},
    { id:15, topic:'Which color is strictly the greatest', family:'maxColor', options:[
        { label:'Blue is greatest',   test: c => c[0] > c[1] && c[0] > c[2] },
        { label:'Yellow is greatest', test: c => c[1] > c[0] && c[1] > c[2] },
        { label:'Purple is greatest', test: c => c[2] > c[0] && c[2] > c[1] },
    ]},

    // --- 16: more even or more odd numbers ---
    { id:16, topic:'More even or more odd numbers', family:'majorityParity', options:[
        { label:'More even numbers', test: c => countEven(c) >= 2 },
        { label:'More odd numbers',  test: c => countEven(c) <= 1 },
    ]},

    // --- 17: exact count of even numbers ---
    { id:17, topic:'How many even numbers are in the code', family:'countEven', options:[
        { label:'Zero even numbers',  test: c => countEven(c) === 0 },
        { label:'One even number',    test: c => countEven(c) === 1 },
        { label:'Two even numbers',   test: c => countEven(c) === 2 },
        { label:'Three even numbers', test: c => countEven(c) === 3 },
    ]},

    // --- 18: parity of the sum ---
    { id:18, topic:'Sum of all three numbers', family:'sumParity', options:[
        { label:'The sum is even', test: c => (c[0]+c[1]+c[2])%2 === 0 },
        { label:'The sum is odd',  test: c => (c[0]+c[1]+c[2])%2 === 1 },
    ]},

    // --- 19: sum of blue + yellow vs 6 ---
    { id:19, topic:'Blue + Yellow compared to 6', family:'sumBY6', options:[
        { label:'Blue + Yellow < 6', test: c => c[0]+c[1] <  6 },
        { label:'Blue + Yellow = 6', test: c => c[0]+c[1] === 6 },
        { label:'Blue + Yellow > 6', test: c => c[0]+c[1] >  6 },
    ]},

    // --- 20: how many repeats (no rep / one pair / three of a kind) ---
    { id:20, topic:'Repetition pattern', family:'repPattern', options:[
        { label:'All three numbers are different',
          test: c => (new Set(c)).size === 3 },
        { label:'Exactly one number appears twice (a pair)',
          test: c => (new Set(c)).size === 2 },
        { label:'All three numbers are the same',
          test: c => (new Set(c)).size === 1 },
    ]},

    // --- 21: is there a pair (or none) ---
    { id:21, topic:'Whether there is a pair of identical numbers', family:'pairOrNot', options:[
        { label:'There is exactly one pair', test: c => (new Set(c)).size === 2 },
        { label:'There is no pair',          test: c => (new Set(c)).size !== 2 },
    ]},

    // --- 22: ascending / descending / no order ---
    { id:22, topic:'Order of the 3 numbers', family:'order', options:[
        { label:'Ascending order  (b < y < p)', test: c => c[0] <  c[1] && c[1] <  c[2] },
        { label:'Descending order (b > y > p)', test: c => c[0] >  c[1] && c[1] >  c[2] },
        { label:'No order',                     test: c => !(c[0]<c[1]&&c[1]<c[2]) && !(c[0]>c[1]&&c[1]>c[2]) },
    ]},

    // --- 23: sum of all three vs 6 ---
    { id:23, topic:'Sum of all three compared to 6', family:'sum6', options:[
        { label:'Sum < 6', test: c => c[0]+c[1]+c[2] <  6 },
        { label:'Sum = 6', test: c => c[0]+c[1]+c[2] === 6 },
        { label:'Sum > 6', test: c => c[0]+c[1]+c[2] >  6 },
    ]},

    // --- 24: consecutive ascending sequence ---
    { id:24, topic:'Consecutive ascending values', family:'ascSeq', options:[
        { label:'No ascending consecutive sequence',
          test: c => !(c[1]-c[0]===1) && !(c[2]-c[1]===1) },
        { label:'A 2-digit ascending consecutive sequence (but not 3)',
          test: c => ((c[1]-c[0]===1) || (c[2]-c[1]===1)) && !(c[1]-c[0]===1 && c[2]-c[1]===1) },
        { label:'A 3-digit ascending consecutive sequence',
          test: c => (c[1]-c[0]===1) && (c[2]-c[1]===1) },
    ]},

    // --- 25: consecutive sequence (direction unknown) ---
    { id:25, topic:'Consecutive values (asc or desc)', family:'anySeq', options:[
        { label:'No consecutive sequence',
          test: c => !(Math.abs(c[1]-c[0])===1) && !(Math.abs(c[2]-c[1])===1) },
        { label:'A 2-digit consecutive sequence (but not 3)',
          test: c => {
              const a = Math.abs(c[1]-c[0])===1;
              const b = Math.abs(c[2]-c[1])===1;
              const three = ((c[1]-c[0]===1)&&(c[2]-c[1]===1)) || ((c[0]-c[1]===1)&&(c[1]-c[2]===1));
              return (a||b) && !three;
          }},
        { label:'A 3-digit consecutive sequence',
          test: c => ((c[1]-c[0]===1)&&(c[2]-c[1]===1)) || ((c[0]-c[1]===1)&&(c[1]-c[2]===1)) },
    ]},

    // --- 26-27: a color is less than 3 (which color?) ---
    { id:26, topic:'A specific color is less than 3', family:'lt3', options:[
        { label:'Blue < 3',   test: c => c[0] < 3 },
        { label:'Yellow < 3', test: c => c[1] < 3 },
        { label:'Purple < 3', test: c => c[2] < 3 },
    ]},
    { id:27, topic:'A specific color is greater than 3', family:'gt3', options:[
        { label:'Blue > 3',   test: c => c[0] > 3 },
        { label:'Yellow > 3', test: c => c[1] > 3 },
        { label:'Purple > 3', test: c => c[2] > 3 },
    ]},

    // --- 28-30: a color equals 1 ---
    { id:28, topic:'A specific color equals 1', family:'eq1', options:[
        { label:'Blue = 1',   test: c => c[0] === 1 },
        { label:'Yellow = 1', test: c => c[1] === 1 },
        { label:'Purple = 1', test: c => c[2] === 1 },
    ]},
    { id:29, topic:'A specific color equals 3', family:'eq3', options:[
        { label:'Blue = 3',   test: c => c[0] === 3 },
        { label:'Yellow = 3', test: c => c[1] === 3 },
        { label:'Purple = 3', test: c => c[2] === 3 },
    ]},
    { id:30, topic:'A specific color equals 4', family:'eq4', options:[
        { label:'Blue = 4',   test: c => c[0] === 4 },
        { label:'Yellow = 4', test: c => c[1] === 4 },
        { label:'Purple = 4', test: c => c[2] === 4 },
    ]},

    // --- 31-32: a color is greater than 1 / less than 4 ---
    { id:31, topic:'A specific color is greater than 1', family:'gt1', options:[
        { label:'Blue > 1',   test: c => c[0] > 1 },
        { label:'Yellow > 1', test: c => c[1] > 1 },
        { label:'Purple > 1', test: c => c[2] > 1 },
    ]},
    { id:32, topic:'A specific color is less than 4', family:'lt4', options:[
        { label:'Blue < 4',   test: c => c[0] < 4 },
        { label:'Yellow < 4', test: c => c[1] < 4 },
        { label:'Purple < 4', test: c => c[2] < 4 },
    ]},

    // --- 33: parity of a specific color (which color?) ---
    { id:33, topic:'A specific color is even', family:'even', options:[
        { label:'Blue is even',   test: c => c[0]%2 === 0 },
        { label:'Yellow is even', test: c => c[1]%2 === 0 },
        { label:'Purple is even', test: c => c[2]%2 === 0 },
    ]},

    // --- 34-35: a color is min / max (≤ / ≥ the others) ---
    { id:34, topic:'A specific color ≤ the others (a smallest one)', family:'leAll', options:[
        { label:'Blue ≤ Yellow and Blue ≤ Purple',   test: c => c[0] <= c[1] && c[0] <= c[2] },
        { label:'Yellow ≤ Blue and Yellow ≤ Purple', test: c => c[1] <= c[0] && c[1] <= c[2] },
        { label:'Purple ≤ Blue and Purple ≤ Yellow', test: c => c[2] <= c[0] && c[2] <= c[1] },
    ]},
    { id:35, topic:'A specific color ≥ the others (a greatest one)', family:'geAll', options:[
        { label:'Blue ≥ Yellow and Blue ≥ Purple',   test: c => c[0] >= c[1] && c[0] >= c[2] },
        { label:'Yellow ≥ Blue and Yellow ≥ Purple', test: c => c[1] >= c[0] && c[1] >= c[2] },
        { label:'Purple ≥ Blue and Purple ≥ Yellow', test: c => c[2] >= c[0] && c[2] >= c[1] },
    ]},

    // --- 36: sum multiple of 3, 4 or 5 ---
    { id:36, topic:'The sum is a multiple of…', family:'sumMul', options:[
        { label:'Sum is a multiple of 3', test: c => (c[0]+c[1]+c[2])%3 === 0 },
        { label:'Sum is a multiple of 4', test: c => (c[0]+c[1]+c[2])%4 === 0 },
        { label:'Sum is a multiple of 5', test: c => (c[0]+c[1]+c[2])%5 === 0 },
    ]},

    // --- 37-38: sum of two specific colors equals 4 ---
    { id:37, topic:'Sum of Blue + Yellow vs 4', family:'sumBY4', options:[
        { label:'Blue + Yellow < 4', test: c => c[0]+c[1] <  4 },
        { label:'Blue + Yellow = 4', test: c => c[0]+c[1] === 4 },
        { label:'Blue + Yellow > 4', test: c => c[0]+c[1] >  4 },
    ]},
    { id:38, topic:'Sum of Blue + Purple vs 4', family:'sumBP4', options:[
        { label:'Blue + Purple < 4', test: c => c[0]+c[2] <  4 },
        { label:'Blue + Purple = 4', test: c => c[0]+c[2] === 4 },
        { label:'Blue + Purple > 4', test: c => c[0]+c[2] >  4 },
    ]},

    // --- 39-41: a color compared to 1 (lt/eq/gt) ---
    { id:39, topic:'Blue vs 1',   family:'cmp_blue_1',   options: cmp(COLOR.BLUE,   1) },
    { id:40, topic:'Yellow vs 1', family:'cmp_yellow_1', options: cmp(COLOR.YELLOW, 1) },
    { id:41, topic:'Purple vs 1', family:'cmp_purple_1', options: cmp(COLOR.PURPLE, 1) },

    // --- 42: a color is strictly greater or strictly less than both others ---
    { id:42, topic:'A specific color is the strict extremum', family:'extrColor', options:[
        { label:'Blue is strictly greater than the others',
          test: c => c[0] > c[1] && c[0] > c[2] },
        { label:'Yellow is strictly greater than the others',
          test: c => c[1] > c[0] && c[1] > c[2] },
        { label:'Purple is strictly greater than the others',
          test: c => c[2] > c[0] && c[2] > c[1] },
    ]},

    // --- 43-44: a color compared to another constant ---
    { id:43, topic:'Purple compared to 3', family:'cmp_purple_3', options: cmp(COLOR.PURPLE, 3) },
    { id:44, topic:'Purple compared to 4', family:'cmp_purple_4', options: cmp(COLOR.PURPLE, 4) },

    // --- 45-47: count of 1s / 3s / 4s differently ---
    { id:45, topic:'How many 5s are in the code', family:'count_5', options:[
        { label:'Zero 5s',  test: c => countDigit(c,5) === 0 },
        { label:'One 5',    test: c => countDigit(c,5) === 1 },
        { label:'Two 5s',   test: c => countDigit(c,5) === 2 },
        { label:'Three 5s', test: c => countDigit(c,5) === 3 },
    ]},
    { id:46, topic:'How many 2s are in the code', family:'count_2', options:[
        { label:'Zero 2s',  test: c => countDigit(c,2) === 0 },
        { label:'One 2',    test: c => countDigit(c,2) === 1 },
        { label:'Two 2s',   test: c => countDigit(c,2) === 2 },
        { label:'Three 2s', test: c => countDigit(c,2) === 3 },
    ]},
    { id:47, topic:'Whether all numbers are below or above 3', family:'allRel3', options:[
        { label:'All three numbers are < 3', test: c => c[0]<3 && c[1]<3 && c[2]<3 },
        { label:'All three numbers are > 3', test: c => c[0]>3 && c[1]>3 && c[2]>3 },
        { label:'Neither (some below, some above, or one equals 3)',
          test: c => !(c[0]<3 && c[1]<3 && c[2]<3) && !(c[0]>3 && c[1]>3 && c[2]>3) },
    ]},

    // --- 48: comparison between two specific colors with constant offset ---
    { id:48, topic:'Compare Yellow + Purple to 6', family:'sumYP6', options:[
        { label:'Yellow + Purple < 6', test: c => c[1]+c[2] <  6 },
        { label:'Yellow + Purple = 6', test: c => c[1]+c[2] === 6 },
        { label:'Yellow + Purple > 6', test: c => c[1]+c[2] >  6 },
    ]},
];

// The unpruned card data — never mutated. `CARDS` (below) is a working copy
// that gets re-derived from this every time the digit range changes, so
// reconfiguration is non-destructive.
const ORIGINAL_CARDS = CARDS.map(c => ({ ...c, options: c.options.slice() }));

// `ALL_CODES` and `CARDS_BY_ID` are bound to `let` because `reconfigureGame()`
// replaces them when the digit range or color set changes.
let ALL_CODES = enumerateCodes();
let CARDS_BY_ID;

// --- admissibility check ---------------------------------------------------
// An option (one possible criterion on a criteria card) is admissible iff:
//   1. At least 2 distinct codes satisfy it. An option satisfied by zero or
//      one code is degenerate — it either can't be the truth, or it pins the
//      whole code down, neither of which is interesting.
//   2. It does NOT, on its own, force any single color to a single value.
//      i.e. for every color slot, the set of values that appear across
//      satisfying codes has size >= 2.
//
// The Turing Machine rulebook avoids these by construction (e.g. "Blue < 2"
// is missing because that's equivalent to "Blue = 1" — a one-criterion
// digit reveal). We enforce the same property here so the puzzle generator
// can never hand the player a too-easy verifier.
function optionPossibleDigitsPerColor(option) {
    return GAME_CONFIG.colors.map((_, i) => {
        const vals = new Set();
        for (const code of ALL_CODES) if (option.test(code)) vals.add(code[i]);
        return vals;
    });
}
function optionSolutionCount(option) {
    let c = 0;
    for (const code of ALL_CODES) if (option.test(code)) c++;
    return c;
}
function optionIsAdmissible(option) {
    if (optionSolutionCount(option) < 2) return false;
    const perColor = optionPossibleDigitsPerColor(option);
    return !perColor.some(set => set.size <= 1);
}

// --- prune cards against the current config --------------------------------
// Rebuilds `CARDS` and `CARDS_BY_ID` from `ORIGINAL_CARDS`, dropping options
// that aren't admissible under the active GAME_CONFIG / ALL_CODES and cards
// left with <2 viable options. Called once at load and again from
// reconfigureGame() whenever the digit range changes.
function rebuildCardsForCurrentConfig() {
    const droppedOptions = [];
    const droppedCards = [];
    const rebuilt = [];
    // Start with the hand-written set...
    const source = ORIGINAL_CARDS.slice();
    // ...then append scaling cards for any (color, N) / count-of-D that the
    // hand-written set doesn't already cover. Generator must come after
    // collecting the existing families so dedup is correct.
    const existingFamilies = new Set(source.map(c => c.family));
    source.push(...generateScalingCards(existingFamilies));

    for (const orig of source) {
        const opts = orig.options.filter(opt => {
            if (optionIsAdmissible(opt)) return true;
            droppedOptions.push(`card ${orig.id} "${opt.label}"`);
            return false;
        });
        if (opts.length < 2) {
            droppedCards.push(`card ${orig.id} (${orig.topic})`);
            continue;
        }
        rebuilt.push({ ...orig, options: opts });
    }
    CARDS.length = 0;
    CARDS.push(...rebuilt);
    CARDS_BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
    /* istanbul ignore next -- diagnostic logging: no realistic GAME_CONFIG produces zero pruning, so the surrounding control flow is fixed */
    if (droppedOptions.length) {
        console.info(`[TM] Cards rebuilt: ${CARDS.length} active. ` +
            `Pruned ${droppedOptions.length} option(s); dropped ${droppedCards.length} card(s).`);
        console.debug('[TM] Pruned options:', droppedOptions);
        if (droppedCards.length) console.debug('[TM] Dropped cards:', droppedCards);
    }
}

// --- scaling cards: range-aware parametric cards --------------------------
// For each (color, N) with N inside the active range we add a "color compared
// to N" card; for each digit D we add a "How many Ds" count card. IDs live
// in the 1000+ space so they never collide with the hand-written 1..48 set.
// Families use the same `cmp_<color>_<N>` / `count_<D>` scheme as the
// hand-written cards, which lets us skip generated cards that would only
// duplicate a hand-written one.
function generateScalingCards(existingFamilies) {
    const out = [];
    const min = GAME_CONFIG.digitMin, max = GAME_CONFIG.digitMax;
    const colors = GAME_CONFIG.colors;
    let id = 1000;
    // "color compared to N" — three-way (<, =, >) form. Useful through most of
    // the range; near the extremes pruning will drop = and one side.
    for (const c of colors) {
        for (let N = min + 1; N <= max - 1; N++) {
            const fam = `cmp_${c}_${N}`;
            if (existingFamilies.has(fam)) continue;
            out.push({
                id: id++,
                topic: `${c[0].toUpperCase() + c.slice(1)} compared to ${N}`,
                family: fam,
                options: cmp(c, N),
            });
        }
    }
    // Binary split: "color < N" vs "color ≥ N". Survives near the range
    // boundaries where the three-way card collapses to a single option
    // (e.g. with digits 1-9 the user expects "Blue < 8" to exist — it
    // exists here as one of the two options on the split card at N=8).
    for (const c of colors) {
        for (let N = min + 1; N <= max; N++) {
            const fam = `split_${c}_${N}`;
            /* istanbul ignore if -- no hand-written card uses the split_ family scheme, so the dedup check is purely defensive */
            if (existingFamilies.has(fam)) continue;
            const cap = c[0].toUpperCase() + c.slice(1);
            out.push({
                id: id++,
                topic: `${cap} below or above ${N}`,
                family: fam,
                options: [
                    { label: `${cap} < ${N}`, test: code => digit(code, c) < N },
                    { label: `${cap} ≥ ${N}`, test: code => digit(code, c) >= N },
                ],
            });
        }
    }
    // "How many Ds in the code" — D ranges over the active digits.
    const slotCount = colors.length;
    for (let D = min; D <= max; D++) {
        const fam = `count_${D}`;
        if (existingFamilies.has(fam)) continue;
        const opts = [];
        for (let k = 0; k <= slotCount; k++) {
            const label = k === 0 ? `Zero ${D}s` : k === 1 ? `One ${D}` : `${k} ${D}s`;
            opts.push({ label, test: c => countDigit(c, D) === k });
        }
        out.push({ id: id++, topic: `How many ${D}s are in the code`, family: fam, options: opts });
    }
    return out;
}

// Re-target the game at a new digit range (and/or color list). Reenumerates
// the code space, re-prunes cards against it. Returns the resulting card
// count so callers can sanity-check that the range still yields enough laws.
function reconfigureGame({ digitMin, digitMax, colors } = {}) {
    if (digitMin !== undefined) GAME_CONFIG.digitMin = digitMin;
    if (digitMax !== undefined) GAME_CONFIG.digitMax = digitMax;
    if (colors)                 GAME_CONFIG.colors   = colors.slice();
    ALL_CODES = enumerateCodes();
    rebuildCardsForCurrentConfig();
    return { cards: CARDS.length, codes: ALL_CODES.length };
}

rebuildCardsForCurrentConfig();
