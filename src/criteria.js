'use strict';

// Turing Machine — criteria card definitions.
//
// Each card represents what a single Verifier checks. The player sees the card
// (topic + list of possible criteria), and must deduce which option is the one
// actually being checked. Every option carries a `test(code)` that returns
// true when the proposal satisfies that criterion.
//
// Card IDs 1..48 follow the physical rulebook's numbering where the public
// rule text was specific; for cards whose exact mapping isn't in the public
// rules we chose sensible, distinct definitions that match the card category
// described in the rulebook.
//
// `topic` is a short, public phrase shown above the option list.
// `family` is used by the generator to avoid stacking near-duplicate verifiers.
//
// Custom levels can change the number of color slots (3..7). Cards that
// reference specific colors (e.g. cards 1-7, 11-13, 19, 26-32, 37-38) stay as
// hand-written entries — they only apply when those colors are present. Cards
// whose logic depends on the slot count (smallest/greatest, sum of all,
// repetition patterns, count-of-D, consecutive sequences, etc.) are
// regenerated from buildOriginalCards() every time GAME_CONFIG.colors changes,
// so their option lists and tests always cover every active slot.

// Color slot names come from GAME_CONFIG.colors. Cards that reference a
// specific color do so by symbolic name (COLOR.BLUE etc.) — index lookup is
// resolved at call-time via colorIdx() so re-ordering colors works for free.
const COLOR = (() => {
    const out = {};
    // Keys derived from the master ALL_COLORS list so card definitions can
    // reference any supported color, even when GAME_CONFIG.colors doesn't
    // currently include it (admissibility pruning will drop those cards).
    ALL_COLORS.forEach(c => { out[c.toUpperCase()] = c; });
    return out;
})();
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
function sumAll(code)    { let s=0; for (const d of code) s += d; return s; }
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

// CARDS is rebuilt every time GAME_CONFIG.colors / digitMin / digitMax change.
// Kept as a `const` reference (callers hold pointers to it) — we mutate its
// contents in-place during rebuild.
const CARDS = [];

// `ALL_CODES` and `CARDS_BY_ID` are bound to `let` because `reconfigureGame()`
// replaces them when the digit range or color set changes.
let ALL_CODES = enumerateCodes();
let CARDS_BY_ID;

// --- card-set builder ------------------------------------------------------
// Returns the unpruned, range-aware hand-written cards for the current
// GAME_CONFIG.colors. Cards whose logic is universal (sum, count, smallest,
// etc.) are generated from generic loops so they stay correct for any slot
// count. Cards that name specific colors are emitted as-is — they get pruned
// later if their colors aren't active.
function buildOriginalCards() {
    const colors = GAME_CONFIG.colors;
    const N      = colors.length;

    // One option per active color slot, built from a (color, idx) → test fn.
    // Used by min/max/extremum-style cards so they always cover every slot.
    const perColorOpts = (suffix, predicateForIdx) =>
        colors.map((col, i) => ({
            label: `${colorLabel(col)} ${suffix}`,
            test: predicateForIdx(i),
        }));

    // Count-shaped option list: 0..N inclusive. Label switches between
    // "Zero", "One", "k" forms to read naturally.
    const countOpts = (singular, plural, predicateForK) => {
        const opts = [];
        for (let k = 0; k <= N; k++) {
            const label = k === 0 ? `Zero ${plural}`
                        : k === 1 ? `One ${singular}`
                        :           `${k} ${plural}`;
            opts.push({ label, test: predicateForK(k) });
        }
        return opts;
    };

    return [

        // --- 1: blue compared to 1 (only =, >) ---
        { id:1, topic:'Blue compared to 1', family:'cmp_blue_1', options:[
            { label:'Blue = 1', test: c => digit(c,COLOR.BLUE) === 1 },
            { label:'Blue > 1', test: c => digit(c,COLOR.BLUE) > 1 },
        ]},

        // --- 2-4: a color vs a constant (less/equal/greater). ---
        { id:2, topic:'Blue compared to 3',   family:'cmp_blue_3',   options: cmp(COLOR.BLUE,   3) },
        { id:3, topic:'Yellow compared to 3', family:'cmp_yellow_3', options: cmp(COLOR.YELLOW, 3) },
        { id:4, topic:'Yellow compared to 4', family:'cmp_yellow_4', options: cmp(COLOR.YELLOW, 4) },

        // --- 5-7: parity of a single color ---
        { id:5, topic:'Parity of blue',   family:'parB', options: parity(COLOR.BLUE) },
        { id:6, topic:'Parity of yellow', family:'parY', options: parity(COLOR.YELLOW) },
        { id:7, topic:'Parity of purple', family:'parP', options: parity(COLOR.PURPLE) },

        // --- 8-10: count of 1s / 3s / 4s in the code (one option per possible count) ---
        { id:8,  topic:'How many 1s are in the code', family:'count_1',
          options: countOpts('1','1s', k => c => countDigit(c,1) === k) },
        { id:9,  topic:'How many 3s are in the code', family:'count_3',
          options: countOpts('3','3s', k => c => countDigit(c,3) === k) },
        { id:10, topic:'How many 4s are in the code', family:'count_4',
          options: countOpts('4','4s', k => c => countDigit(c,4) === k) },

        // --- 11-13: compare two colors in the proposal ---
        { id:11, topic:'Blue vs Yellow',   family:'cmpBY', options: cmpTwoColors(COLOR.BLUE,   COLOR.YELLOW) },
        { id:12, topic:'Blue vs Purple',   family:'cmpBP', options: cmpTwoColors(COLOR.BLUE,   COLOR.PURPLE) },
        { id:13, topic:'Yellow vs Purple', family:'cmpYP', options: cmpTwoColors(COLOR.YELLOW, COLOR.PURPLE) },

        // --- 14-15: which color is strictly smallest / greatest --------------
        // One option per active slot — covers any color count.
        { id:14, topic:'Which color is strictly the smallest', family:'minColor',
          options: perColorOpts('is smallest',
              idx => c => colors.every((_, i) => i === idx || c[idx] < c[i])) },
        { id:15, topic:'Which color is strictly the greatest', family:'maxColor',
          options: perColorOpts('is greatest',
              idx => c => colors.every((_, i) => i === idx || c[idx] > c[i])) },

        // --- 16: more even or more odd numbers --------------------------------
        // For an odd slot count there's always a strict majority — two options
        // suffice. For an even slot count we add a "tied" option so the card
        // remains a total partition of the code space.
        (() => {
            const opts = [
                { label: 'More even numbers',
                  test: c => countEven(c) * 2 > N },
                { label: 'More odd numbers',
                  test: c => countEven(c) * 2 < N },
            ];
            if (N % 2 === 0) {
                opts.push({ label: 'Equal number of evens and odds',
                            test: c => countEven(c) * 2 === N });
            }
            return { id:16, topic:'More even or more odd numbers',
                     family:'majorityParity', options: opts };
        })(),

        // --- 17: exact count of even numbers (one option per possible count) ---
        { id:17, topic:'How many even numbers are in the code', family:'countEven',
          options: countOpts('even number','even numbers',
              k => c => countEven(c) === k) },

        // --- 18: parity of the sum ---
        { id:18, topic:`Sum of all ${N} numbers`, family:'sumParity', options:[
            { label:'The sum is even', test: c => sumAll(c) % 2 === 0 },
            { label:'The sum is odd',  test: c => sumAll(c) % 2 === 1 },
        ]},

        // --- 19: sum of blue + yellow vs 6 ---
        { id:19, topic:'Blue + Yellow compared to 6', family:'sumBY6', options:[
            { label:'Blue + Yellow < 6',
              test: c => digit(c,COLOR.BLUE) + digit(c,COLOR.YELLOW) <  6 },
            { label:'Blue + Yellow = 6',
              test: c => digit(c,COLOR.BLUE) + digit(c,COLOR.YELLOW) === 6 },
            { label:'Blue + Yellow > 6',
              test: c => digit(c,COLOR.BLUE) + digit(c,COLOR.YELLOW) >  6 },
        ]},

        // --- 20: repetition pattern ------------------------------------------
        // Generic options that scale with slot count.
        { id:20, topic:'Repetition pattern', family:'repPattern', options:[
            { label: `All ${N} numbers are different`,
              test: c => (new Set(c)).size === N },
            { label: 'Exactly one number appears twice (a pair, rest unique)',
              test: c => {
                  const cnt = {};
                  for (const d of c) cnt[d] = (cnt[d] || 0) + 1;
                  const vals = Object.values(cnt);
                  return vals.filter(v => v === 2).length === 1
                      && vals.filter(v => v >= 3).length === 0;
              }},
            { label: `All ${N} numbers are the same`,
              test: c => (new Set(c)).size === 1 },
        ]},

        // --- 21: is there a pair (or none) -----------------------------------
        // "Exactly one pair" stays meaningful for any N; "no pair" means no
        // value appears more than once OR the entire code is the same value.
        { id:21, topic:'Whether there is a pair of identical numbers', family:'pairOrNot', options:[
            { label:'There is exactly one pair', test: c => {
                const cnt = {};
                for (const d of c) cnt[d] = (cnt[d] || 0) + 1;
                const vals = Object.values(cnt);
                return vals.filter(v => v === 2).length === 1
                    && vals.filter(v => v >= 3).length === 0;
            }},
            { label:'There is no pair (all different, or all the same)',
              test: c => {
                  const cnt = {};
                  for (const d of c) cnt[d] = (cnt[d] || 0) + 1;
                  const vals = Object.values(cnt);
                  return !(vals.filter(v => v === 2).length === 1
                        && vals.filter(v => v >= 3).length === 0);
              }},
        ]},

        // --- 22: ascending / descending / no order ---------------------------
        // Compares EVERY adjacent pair across the full code.
        { id:22, topic:`Order of the ${N} numbers`, family:'order', options:[
            { label: `Ascending order (every digit < the next)`,
              test: c => { for (let i=1;i<N;i++) if (!(c[i-1] <  c[i])) return false; return true; } },
            { label: `Descending order (every digit > the next)`,
              test: c => { for (let i=1;i<N;i++) if (!(c[i-1] >  c[i])) return false; return true; } },
            { label: 'No order',
              test: c => {
                  let asc = true, desc = true;
                  for (let i=1;i<N;i++) { if (!(c[i-1]<c[i])) asc = false; if (!(c[i-1]>c[i])) desc = false; }
                  return !asc && !desc;
              }},
        ]},

        // --- 23: sum of all numbers vs the average code-sum ------------------
        // Threshold is the midpoint of possible sums, so half the codes fall
        // on each side and the card stays interesting at any (N, digit range).
        (() => {
            const mid = Math.round(N * (GAME_CONFIG.digitMin + GAME_CONFIG.digitMax) / 2);
            return { id:23, topic:`Sum of all ${N} compared to ${mid}`, family:'sumMid', options:[
                { label:`Sum < ${mid}`, test: c => sumAll(c) <  mid },
                { label:`Sum = ${mid}`, test: c => sumAll(c) === mid },
                { label:`Sum > ${mid}`, test: c => sumAll(c) >  mid },
            ]};
        })(),

        // --- 24: consecutive ascending sequence -------------------------------
        // 0-step: no adjacent (+1) jumps anywhere in the code.
        // 2-step: at least one +1 jump but no two in a row.
        // 3-step: at least one run of 3 consecutive ascending values.
        { id:24, topic:'Consecutive ascending values', family:'ascSeq', options:[
            { label: 'No ascending consecutive sequence',
              test: c => { for (let i=1;i<N;i++) if (c[i]-c[i-1]===1) return false; return true; } },
            { label: 'A 2-digit ascending consecutive sequence (but not 3)',
              test: c => {
                  let hasTwo = false, hasThree = false;
                  for (let i=1;i<N;i++) {
                      if (c[i]-c[i-1] === 1) {
                          hasTwo = true;
                          if (i >= 2 && c[i-1]-c[i-2] === 1) hasThree = true;
                      }
                  }
                  return hasTwo && !hasThree;
              }},
            { label: 'A 3-digit ascending consecutive sequence',
              test: c => { for (let i=2;i<N;i++) if (c[i]-c[i-1]===1 && c[i-1]-c[i-2]===1) return true; return false; } },
        ]},

        // --- 25: consecutive sequence (direction unknown) --------------------
        { id:25, topic:'Consecutive values (asc or desc)', family:'anySeq', options:[
            { label: 'No consecutive sequence',
              test: c => { for (let i=1;i<N;i++) if (Math.abs(c[i]-c[i-1])===1) return false; return true; } },
            { label: 'A 2-digit consecutive sequence (but not 3)',
              test: c => {
                  let hasTwo = false, hasThree = false;
                  for (let i=1;i<N;i++) {
                      if (Math.abs(c[i]-c[i-1]) === 1) hasTwo = true;
                  }
                  for (let i=2;i<N;i++) {
                      if ((c[i]-c[i-1]===1 && c[i-1]-c[i-2]===1) ||
                          (c[i-1]-c[i]===1 && c[i-2]-c[i-1]===1)) hasThree = true;
                  }
                  return hasTwo && !hasThree;
              }},
            { label: 'A 3-digit consecutive sequence',
              test: c => {
                  for (let i=2;i<N;i++) {
                      if ((c[i]-c[i-1]===1 && c[i-1]-c[i-2]===1) ||
                          (c[i-1]-c[i]===1 && c[i-2]-c[i-1]===1)) return true;
                  }
                  return false;
              }},
        ]},

        // --- 26-27: a color is less / greater than 3 -------------------------
        // One option per active slot — generic over color count.
        { id:26, topic:'A specific color is less than 3', family:'lt3',
          options: perColorOpts('< 3', idx => c => c[idx] < 3) },
        { id:27, topic:'A specific color is greater than 3', family:'gt3',
          options: perColorOpts('> 3', idx => c => c[idx] > 3) },

        // --- 28-30: a color equals K -----------------------------------------
        { id:28, topic:'A specific color equals 1', family:'eq1',
          options: perColorOpts('= 1', idx => c => c[idx] === 1) },
        { id:29, topic:'A specific color equals 3', family:'eq3',
          options: perColorOpts('= 3', idx => c => c[idx] === 3) },
        { id:30, topic:'A specific color equals 4', family:'eq4',
          options: perColorOpts('= 4', idx => c => c[idx] === 4) },

        // --- 31-32: a color is greater than 1 / less than 4 ------------------
        { id:31, topic:'A specific color is greater than 1', family:'gt1',
          options: perColorOpts('> 1', idx => c => c[idx] > 1) },
        { id:32, topic:'A specific color is less than 4', family:'lt4',
          options: perColorOpts('< 4', idx => c => c[idx] < 4) },

        // --- 33: a specific color is even ------------------------------------
        { id:33, topic:'A specific color is even', family:'even',
          options: perColorOpts('is even', idx => c => c[idx] % 2 === 0) },

        // --- 34-35: a color is ≤ / ≥ every other slot ------------------------
        { id:34, topic:'A specific color ≤ every other (a smallest one)', family:'leAll',
          options: perColorOpts('≤ every other',
              idx => c => colors.every((_, i) => i === idx || c[idx] <= c[i])) },
        { id:35, topic:'A specific color ≥ every other (a greatest one)', family:'geAll',
          options: perColorOpts('≥ every other',
              idx => c => colors.every((_, i) => i === idx || c[idx] >= c[i])) },

        // --- 36: sum multiple of 3, 4 or 5 ---
        { id:36, topic:'The sum is a multiple of…', family:'sumMul', options:[
            { label:'Sum is a multiple of 3', test: c => sumAll(c) % 3 === 0 },
            { label:'Sum is a multiple of 4', test: c => sumAll(c) % 4 === 0 },
            { label:'Sum is a multiple of 5', test: c => sumAll(c) % 5 === 0 },
        ]},

        // --- 37-38: sum of two specific colors compared to 4 -----------------
        { id:37, topic:'Sum of Blue + Yellow vs 4', family:'sumBY4', options:[
            { label:'Blue + Yellow < 4',
              test: c => digit(c,COLOR.BLUE) + digit(c,COLOR.YELLOW) <  4 },
            { label:'Blue + Yellow = 4',
              test: c => digit(c,COLOR.BLUE) + digit(c,COLOR.YELLOW) === 4 },
            { label:'Blue + Yellow > 4',
              test: c => digit(c,COLOR.BLUE) + digit(c,COLOR.YELLOW) >  4 },
        ]},
        { id:38, topic:'Sum of Blue + Purple vs 4', family:'sumBP4', options:[
            { label:'Blue + Purple < 4',
              test: c => digit(c,COLOR.BLUE) + digit(c,COLOR.PURPLE) <  4 },
            { label:'Blue + Purple = 4',
              test: c => digit(c,COLOR.BLUE) + digit(c,COLOR.PURPLE) === 4 },
            { label:'Blue + Purple > 4',
              test: c => digit(c,COLOR.BLUE) + digit(c,COLOR.PURPLE) >  4 },
        ]},

        // --- 39-41: a color compared to 1 ---
        { id:39, topic:'Blue vs 1',   family:'cmp_blue_1',   options: cmp(COLOR.BLUE,   1) },
        { id:40, topic:'Yellow vs 1', family:'cmp_yellow_1', options: cmp(COLOR.YELLOW, 1) },
        { id:41, topic:'Purple vs 1', family:'cmp_purple_1', options: cmp(COLOR.PURPLE, 1) },

        // --- 42: a color is strictly greater than every other slot -----------
        { id:42, topic:'A specific color is the strict maximum', family:'extrColor',
          options: perColorOpts('is strictly greater than the others',
              idx => c => colors.every((_, i) => i === idx || c[idx] > c[i])) },

        // --- 43-44: a color compared to another constant ---
        { id:43, topic:'Purple compared to 3', family:'cmp_purple_3', options: cmp(COLOR.PURPLE, 3) },
        { id:44, topic:'Purple compared to 4', family:'cmp_purple_4', options: cmp(COLOR.PURPLE, 4) },

        // --- 45-46: count of 5s / 2s in the code -----------------------------
        { id:45, topic:'How many 5s are in the code', family:'count_5',
          options: countOpts('5','5s', k => c => countDigit(c,5) === k) },
        { id:46, topic:'How many 2s are in the code', family:'count_2',
          options: countOpts('2','2s', k => c => countDigit(c,2) === k) },

        // --- 47: all numbers below / above 3 ---------------------------------
        { id:47, topic:'Whether all numbers are below or above 3', family:'allRel3', options:[
            { label: `All ${N} numbers are < 3`,
              test: c => { for (const d of c) if (d >= 3) return false; return true; } },
            { label: `All ${N} numbers are > 3`,
              test: c => { for (const d of c) if (d <= 3) return false; return true; } },
            { label: 'Neither (some below, some above, or one equals 3)',
              test: c => {
                  let allLo = true, allHi = true;
                  for (const d of c) { if (d >= 3) allLo = false; if (d <= 3) allHi = false; }
                  return !allLo && !allHi;
              }},
        ]},

        // --- 48: yellow + purple compared to 6 ---
        { id:48, topic:'Compare Yellow + Purple to 6', family:'sumYP6', options:[
            { label:'Yellow + Purple < 6',
              test: c => digit(c,COLOR.YELLOW) + digit(c,COLOR.PURPLE) <  6 },
            { label:'Yellow + Purple = 6',
              test: c => digit(c,COLOR.YELLOW) + digit(c,COLOR.PURPLE) === 6 },
            { label:'Yellow + Purple > 6',
              test: c => digit(c,COLOR.YELLOW) + digit(c,COLOR.PURPLE) >  6 },
        ]},
    ];
}

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
// Rebuilds `CARDS` and `CARDS_BY_ID` from a fresh buildOriginalCards()
// snapshot (which itself reflects the current GAME_CONFIG.colors), dropping
// options that aren't admissible under the active GAME_CONFIG / ALL_CODES
// and cards left with <2 viable options. Called once at load and again from
// reconfigureGame() whenever any of digitMin/digitMax/colors changes.
function rebuildCardsForCurrentConfig() {
    const droppedOptions = [];
    const droppedCards = [];
    const rebuilt = [];
    // Start with the hand-written set (built fresh against current colors)...
    const source = buildOriginalCards();
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
// to N" card; for each digit D we add a "How many Ds" count card; for each
// color we add a parity card. IDs live in the 1000+ space so they never
// collide with the hand-written 1..48 set. Families use the same
// `cmp_<color>_<N>` / `count_<D>` / `par<X>` scheme as the hand-written
// cards, which lets us skip generated cards that would only duplicate one.
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
                topic: `${colorLabel(c)} compared to ${N}`,
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
            const cap = colorLabel(c);
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
    // Parity card per color — hand-written set covers blue/yellow/purple
    // (families parB / parY / parP); generate for any remaining active
    // colors so the new slots have parity laws available too.
    for (const c of colors) {
        const fam = `par_${c}`;
        const legacyFam = `par${c[0].toUpperCase()}`;
        if (existingFamilies.has(fam) || existingFamilies.has(legacyFam)) continue;
        out.push({
            id: id++,
            topic: `Parity of ${c}`,
            family: fam,
            options: parity(c),
        });
    }
    // "How many Ds in the code" — D ranges over the active digits. The
    // option count is N+1 (0..N occurrences across N slots).
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
