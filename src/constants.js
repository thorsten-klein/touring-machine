'use strict';

// Single source of truth for the puzzle's structural parameters.
// To extend the game (e.g. wider digit range, new colors, more verifiers),
// change a value here and the rest of the code recomputes automatically:
//
//  • GAME_CONFIG.digitMin / digitMax — the range of each digit on the dials.
//                 ALL_CODES is regenerated; UI dials cycle through this range.
//  • GAME_CONFIG.colors             — list of color "slot" names (currently 3).
//                 Card option `test` functions index slots by position; new
//                 colors require defining new cards that reference them.
//  • GAME_CONFIG.maxVerifiers       — hard cap on how many verifiers a single
//                 puzzle can have. Per-difficulty counts live in generator.js.
//  • GAME_CONFIG.questionsPerRound  — max queries a player may ask per round.
//
// `enumerateCodes()` returns every possible code under the current config;
// criteria.js exposes it as `ALL_CODES` for convenience.

// Master list of supported color slots, in the order they're activated when a
// puzzle is configured with more than 3 colors. Custom levels can choose to
// use anywhere from 3 to ALL_COLORS.length of these.
const ALL_COLORS = ['blue', 'yellow', 'purple', 'green', 'orange', 'grey', 'red'];

const GAME_CONFIG = {
    digitMin: 1,
    digitMax: 5,
    colors: ALL_COLORS.slice(0, 3),
    maxVerifiers: 6,
    questionsPerRound: 3,
};

function digitRange() {
    const out = [];
    for (let v = GAME_CONFIG.digitMin; v <= GAME_CONFIG.digitMax; v++) out.push(v);
    return out;
}

function digitCount() {
    return GAME_CONFIG.digitMax - GAME_CONFIG.digitMin + 1;
}

function enumerateCodes() {
    const range = digitRange();
    const out = [];
    // Cartesian product over GAME_CONFIG.colors.length slots.
    const rec = (idx, acc) => {
        if (idx === GAME_CONFIG.colors.length) { out.push(acc.slice()); return; }
        for (const v of range) { acc.push(v); rec(idx + 1, acc); acc.pop(); }
    };
    rec(0, []);
    return out;
}
