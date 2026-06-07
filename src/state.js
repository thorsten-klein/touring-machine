'use strict';

// Game state object + localStorage persistence.
//
// Two saved blobs in localStorage:
//   tm.active   → the currently-running game (resumable)
//   tm.recent   → a small list of recent puzzles (for "Resume" UX)

const STORAGE_KEY = 'tm.active';
const SETTINGS_KEY = 'tm.settings';
// Default user-toggleable settings. The settings modal in the topbar lets
// the player override these; they persist across games (separate from
// the active-puzzle blob).
const DEFAULT_SETTINGS = {
    autoDeduce: true,        // show ✓/✗/⊘ on verifier options
    showPreviewArrow: true,  // live ← arrow next to options the current proposal satisfies
};
function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (e) { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(settings) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    catch (e) { /* ignore quota errors */ }
}
// Cycle order for the hand-set user-markers on each verifier option.
// '' sentinel means "no marker shown"; the cycle wraps back to it.
const USER_MARKER_CYCLE = ['', 'check', 'cross', 'question'];

class GameState {
    constructor(puzzle) {
        this.puzzle    = puzzle;             // { level, cards, solution }
        this.proposal  = GAME_CONFIG.colors.map(() => GAME_CONFIG.digitMin); // one dial per color
        // Manual "digit map" overlays. All per-color sets of digit values:
        //   disabledDigits  — crossed off (definitely not this digit)
        //   candidateDigits — circled (a likely candidate)
        // Cells can be both at once (e.g. "I crossed it out but want to
        // remember it was once a candidate"). Hand-curated — NOT derived
        // from queries.
        this.disabledDigits  = GAME_CONFIG.colors.map(() => new Set());
        this.candidateDigits = GAME_CONFIG.colors.map(() => new Set());
        // Hand-set "scratch pad" markers on each verifier option. Cycle:
        // empty → 'check' → 'cross' → 'question' → empty. Keyed by
        // "vi:pi:oi" so the same map covers normal + extreme (where pi
        // disambiguates panes). Purely cosmetic — never feeds deduction
        // or Ask gating, just helps the player track their thinking.
        this.userMarkers = {};
        this.round     = 1;
        // Set by endRound() — the round counter only actually advances on the
        // next askVerifier(), so the player has a moment between rounds to
        // change their proposal before "starting" the new round.
        this.pendingNewRound = false;
        // queries: list of { round, proposal, verifierIdx, result }
        this.queries   = [];
        // queriesThisRound is recomputed from queries (max 3 per round).
        this.finished  = false;
        this.outcome   = null;               // 'won' | 'lost' | null
        this.guessedCode = null;             // [b,y,p] | null
        this.startedAt = Date.now();
    }

    queriesInRound(round) {
        return this.queries.filter(q => q.round === round).length;
    }

    canQueryThisRound() {
        if (this.finished) return false;
        // While a new round is pending, the next ask will create round N+1
        // with zero queries — so a new ask is always allowed.
        if (this.pendingNewRound) return true;
        return this.queriesInRound(this.round) < GAME_CONFIG.questionsPerRound;
    }

    // True when the dials should be frozen: at least one query has landed in
    // the current round AND the round hasn't been ended yet.
    isRoundLocked() {
        return !this.finished && !this.pendingNewRound &&
               this.queriesInRound(this.round) > 0;
    }

    canEndRound() {
        return !this.finished && !this.pendingNewRound &&
               this.queriesInRound(this.round) > 0;
    }

    // Returns the verifier's answer: true / false. Advancing the round number
    // is lazy — only done here so display + dial-lock stay consistent with
    // "next round starts when you click Ask".
    askVerifier(verifierIdx) {
        if (!this.canQueryThisRound()) return null;
        if (this.pendingNewRound) {
            this.round++;
            this.pendingNewRound = false;
        }
        const card  = this.puzzle.cards[verifierIdx];
        const opt   = CARDS_BY_ID[card.id].options[card.opt];
        const ok    = !!opt.test(this.proposal.slice());
        this.queries.push({
            round: this.round,
            proposal: this.proposal.slice(),
            verifierIdx,
            result: ok,
        });
        return ok;
    }

    endRound() {
        if (!this.canEndRound()) return;
        this.pendingNewRound = true;
    }

    submitGuess(code) {
        this.guessedCode = code.slice();
        const sol = this.puzzle.solution;
        const ok  = code[0] === sol[0] && code[1] === sol[1] && code[2] === sol[2];
        this.outcome  = ok ? 'won' : 'lost';
        this.finished = true;
        return ok;
    }

    questionsAsked() { return this.queries.length; }
    roundsPlayed()   { return this.finished ? this.round : Math.max(0, this.round - 1); }

    toggleDisabledDigit(colorIdx, digit) {
        const set = this.disabledDigits[colorIdx];
        if (set.has(digit)) set.delete(digit); else set.add(digit);
    }
    toggleCandidateDigit(colorIdx, digit) {
        const set = this.candidateDigits[colorIdx];
        if (set.has(digit)) set.delete(digit); else set.add(digit);
    }
    // Cycles the hand-set marker on a verifier option: empty → ✓ → ✗ → ?
    // → empty. Returns the new state so the caller can re-render that
    // single cell without a full renderAll.
    cycleUserMarker(vi, pi, oi) {
        const key = `${vi}:${pi}:${oi}`;
        const cur = this.userMarkers[key] || '';
        const next = USER_MARKER_CYCLE[(USER_MARKER_CYCLE.indexOf(cur) + 1) % USER_MARKER_CYCLE.length];
        if (next === '') delete this.userMarkers[key];
        else             this.userMarkers[key] = next;
        return next;
    }
    getUserMarker(vi, pi, oi) {
        return this.userMarkers[`${vi}:${pi}:${oi}`] || '';
    }

    serialize() {
        return {
            v: 1,
            puzzle: this.puzzle,
            proposal: this.proposal,
            round: this.round,
            queries: this.queries,
            finished: this.finished,
            outcome: this.outcome,
            guessedCode: this.guessedCode,
            startedAt: this.startedAt,
            // Hand-curated digit-map state — not derivable, must persist.
            disabledDigits:  this.disabledDigits.map(s => Array.from(s)),
            candidateDigits: this.candidateDigits.map(s => Array.from(s)),
            userMarkers:     { ...this.userMarkers },
            pendingNewRound: this.pendingNewRound,
        };
        // Verifier-option deductions ARE derived from `queries`, so they
        // are intentionally NOT persisted.
    }

    static deserialize(raw) {
        if (!raw || raw.v !== 1) return null;
        const s = new GameState(raw.puzzle);
        s.proposal    = raw.proposal;
        s.round       = raw.round;
        s.queries     = raw.queries || [];
        s.finished    = !!raw.finished;
        s.outcome     = raw.outcome;
        s.guessedCode = raw.guessedCode;
        s.startedAt   = raw.startedAt || Date.now();
        s.disabledDigits  = (raw.disabledDigits  || GAME_CONFIG.colors.map(() => []))
            .map(a => new Set(a));
        s.candidateDigits = (raw.candidateDigits || GAME_CONFIG.colors.map(() => []))
            .map(a => new Set(a));
        s.userMarkers     = raw.userMarkers ? { ...raw.userMarkers } : {};
        s.pendingNewRound = !!raw.pendingNewRound;
        return s;
    }
}

function saveActive(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.serialize())); }
    catch (e) { /* ignore quota errors */ }
}
function loadActive() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return GameState.deserialize(JSON.parse(raw));
    } catch (e) { return null; }
}
function clearActive() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
}
