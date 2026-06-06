'use strict';

// Glue layer between UI events and GameState. Holds the running game,
// tracks player-side deductions on each verifier, and renders updates.

class Game {
    constructor(ui) {
        this.ui = ui;
        this.state = null;
        this.wireGlobalUI();
    }

    // ---------- session lifecycle ----------
    startNew(level, seed) {
        // Preset levels assume the default range + questions/round. Extreme
        // mode is a per-puzzle flag set by generatePuzzle from LEVELS[level].
        reconfigureGame({ digitMin: 1, digitMax: 5 });
        GAME_CONFIG.questionsPerRound = 3;
        const puzzle = generatePuzzle(level, seed);
        this.beginWithPuzzle(puzzle);
    }
    startWithPuzzle(puzzle) {
        this.beginWithPuzzle(puzzle);
    }
    resumeFromStorage() {
        const s = loadActive();
        if (!s) return false;
        // Apply the saved puzzle's config first, so dial range / pruning /
        // per-round caps all match what the player started with.
        if (s.puzzle && s.puzzle.config) {
            reconfigureGame({
                digitMin: s.puzzle.config.digitMin,
                digitMax: s.puzzle.config.digitMax,
            });
            if (s.puzzle.config.questionsPerRound) {
                GAME_CONFIG.questionsPerRound = s.puzzle.config.questionsPerRound;
            }
        }
        this.state = s;
        this.openGameScreen();
        return true;
    }

    beginWithPuzzle(puzzle) {
        // Apply the puzzle's config (custom puzzles carry their own range
        // and per-round question cap; presets always use the defaults).
        if (puzzle.config) {
            reconfigureGame({
                digitMin: puzzle.config.digitMin,
                digitMax: puzzle.config.digitMax,
            });
            if (puzzle.config.questionsPerRound) {
                GAME_CONFIG.questionsPerRound = puzzle.config.questionsPerRound;
            }
        }
        this.state = new GameState(puzzle);
        saveActive(this.state);
        this.openGameScreen();
    }

    // Markers persist across rounds — once a query has hit an option (i.e.
    // the option was the ● at ask time) the verdict stays visible forever.
    // An option is crossed (✗) the first time any query rules it out; an
    // option is confirmed (✓) when it's the verifier's criterion — either
    // directly confirmed by a ✓ query OR the sole survivor after all others
    // have been ruled out.
    //
    // Auto-deduction (normal mode): each card has exactly one true criterion:
    //   • if an option was confirmed ✓, every other option on the card must
    //     be ✗ (the criterion is uniquely that option);
    //   • if N-1 options are ✗, the lone remaining option must be ✓.
    //
    // Extreme mode adds a second pane per verifier — only one of the two
    // panes is actually being tested. A query's result tells us about the
    // active pane only, so per-query the ● option lives on exactly one pane.
    // The "passed" rule (✓ confirms that pane is active AND the option is
    // the criterion) and the "all options crossed → pane is dead" rule give
    // us the pane-level signal; the "N-1 crossed → last is criterion" rule
    // only fires after the other pane is confirmed dead. The returned shape
    // has a `panes` array (length 1 for normal, 2 for extreme).
    computeDeductions() {
        return this.state.puzzle.cards.map((card, vi) => {
            const panes = paneListOf(card);  // [paneA] or [paneA, paneB]
            const qs    = this.state.queries.filter(q => q.verifierIdx === vi);
            const paneDed = panes.map(pane => {
                const def = CARDS_BY_ID[pane.id];
                return {
                    id: pane.id, opt: pane.opt,
                    optionsLen: def.options.length,
                    crossed: new Set(),
                    passed:  new Set(),
                    dead:    false,
                };
            });
            const isExtreme = panes.length > 1;

            // Walk queries: locate the ● option (when there's exactly one
            // across all panes/options) and record its verdict against its
            // pane. For Hard+ colorParam cards the Ask gate allows queries
            // with 0 or many ●s — in those cases the verdict can't be
            // pinned to any single option, so we skip per-option marking
            // and just leave the query as a recorded entry on the verifier.
            for (const q of qs) {
                let hit = null;
                let hitCount = 0;
                for (let pi = 0; pi < panes.length; pi++) {
                    const def = CARDS_BY_ID[panes[pi].id];
                    def.options.forEach((opt, oi) => {
                        if (opt.test(q.proposal)) { hit = { pi, oi }; hitCount++; }
                    });
                }
                if (hitCount !== 1) continue;
                if (q.result) {
                    paneDed[hit.pi].passed.add(hit.oi);
                    // ✓ definitively pins the active pane → other pane is dead.
                    for (let pi = 0; pi < paneDed.length; pi++) {
                        if (pi !== hit.pi) paneDed[pi].dead = true;
                    }
                } else {
                    paneDed[hit.pi].crossed.add(hit.oi);
                }
            }

            // Propagation differs by mode.
            //
            //   Normal (1 pane): existing logic — passed implies every other
            //   option on the card is crossed (sound: each card has exactly
            //   one criterion); N-1 crossed implies the lone unmarked option
            //   is the criterion. Both propagate to fixed point.
            //
            //   Extreme (2 panes): the player is asked to reason explicitly
            //   about which card is active, so we DO NOT auto-cross sibling
            //   options when one is ✓-passed, and we DO NOT auto-pass the
            //   "last unmarked" option of a single pane. The only auto rules
            //   are: any ✓ pins the other pane as dead (direct), a pane
            //   whose every option is crossed is dead (sound), and — the
            //   single global rule — if exactly ONE option remains across
            //   all 2N options on the verifier (not crossed, not on a dead
            //   pane), that option is the criterion.
            let changed = true;
            while (changed) {
                changed = false;
                // ✓ on any pane ⇒ all other panes are dead.
                paneDed.forEach((p, pi) => {
                    if (p.passed.size === 0) return;
                    paneDed.forEach((q, qi) => {
                        /* istanbul ignore next -- q.dead already true ⇒ skip; only fires on a 2nd ✓ pass after the first iteration killed the other pane */
                        if (qi !== pi && !q.dead) { q.dead = true; changed = true; }
                    });
                });
                if (!isExtreme) {
                    // Normal-mode per-pane propagation (single pane is always
                    // the active one, so per-card logic applies unconditionally).
                    paneDed.forEach(p => {
                        /* istanbul ignore if -- in normal mode the lone pane is always alive; this guard is defensive against pane-death from all-options-crossed within the same propagation loop */
                        if (p.dead) return;
                        for (const truth of p.passed) {
                            for (let oi = 0; oi < p.optionsLen; oi++) {
                                if (oi !== truth && !p.crossed.has(oi)) {
                                    p.crossed.add(oi);
                                    changed = true;
                                }
                            }
                        }
                        if (p.crossed.size === p.optionsLen - 1) {
                            for (let oi = 0; oi < p.optionsLen; oi++) {
                                if (!p.crossed.has(oi) && !p.passed.has(oi)) {
                                    p.passed.add(oi);
                                    changed = true;
                                }
                            }
                        }
                    });
                }
                // Pane death by all-options-crossed — sound in both modes
                // (if every potential criterion of the pane is ruled out,
                // the pane can't be the active one).
                paneDed.forEach(p => {
                    if (p.dead) return;
                    if (p.crossed.size === p.optionsLen) {
                        p.dead = true;
                        changed = true;
                    }
                });
                // EXTREME-only global rule: if exactly one option remains
                // alive across all 2N options, that's the criterion.
                if (isExtreme) {
                    const alive = [];   // [{pi, oi}]
                    paneDed.forEach((p, pi) => {
                        if (p.dead) return;
                        for (let oi = 0; oi < p.optionsLen; oi++) {
                            if (!p.crossed.has(oi)) alive.push({ pi, oi });
                        }
                    });
                    if (alive.length === 1) {
                        const { pi, oi } = alive[0];
                        if (!paneDed[pi].passed.has(oi)) {
                            paneDed[pi].passed.add(oi);
                            changed = true;
                        }
                    }
                }
            }

            // Per-pane status + per-pane confirmed option. Confirmed is
            // exactly `passed[0]` once passed has a single entry. Both the
            // normal-mode "N-1 crossed → last passed" rule and the extreme
            // "1 of 2N alive → mark passed" rule write into `passed` before
            // this block runs, so any "criterion identified" state always
            // shows up as passed.size === 1.
            paneDed.forEach((p, pi) => {
                if (p.dead) {
                    p.paneStatus = 'dead';
                    p.confirmed = null;
                } else {
                    const otherAllDead = paneDed.every((q, qi) => qi === pi || q.dead);
                    p.paneStatus = isExtreme ? (otherAllDead ? 'active' : 'unknown') : 'active';
                    p.confirmed = p.passed.size === 1 ? [...p.passed][0] : null;
                }
            });

            // Aggregate the verifier-level confirmedPane (the active pane, if
            // we've pinned it). Useful for the renderer and tests.
            const alive = paneDed.filter(p => !p.dead);
            const confirmedPane = alive.length === 1
                ? paneDed.indexOf(alive[0])
                : null;

            // Backwards-compat fields: existing callers (renderers, the
            // end-screen criteria list, tests) used to read crossed/passed/
            // confirmed at the verifier level. In normal mode these collapse
            // to the single pane; in extreme they collapse to the active
            // pane if known, else expose empty sets.
            const primary = confirmedPane !== null ? paneDed[confirmedPane] : paneDed[0];
            return {
                panes: paneDed,
                confirmedPane,
                isExtreme,
                // Mirrors of primary for legacy reads (only meaningful in
                // normal mode or once the active pane is identified).
                crossed:  primary.crossed,
                passed:   primary.passed,
                confirmed: confirmedPane !== null ? primary.confirmed : null,
            };
        });
    }

    // Build the reasoning trace for one (verifier, pane, option) marker.
    // Returns everything the deduction-trace modal needs: which past queries
    // directly pinned the option, and — if the marker came from elimination —
    // the queries that knocked out every other option on the card. In extreme
    // mode the `paneIdx` argument selects which of the two displayed cards
    // we're tracing; normal mode passes paneIdx=0.
    deduceFor(verifierIdx, paneIdx, optionIdx) {
        // Backwards-compatible signature: in the original 2-arg form the
        // pane index defaults to 0 and the second arg is treated as the
        // option index.
        if (optionIdx === undefined) {
            optionIdx = paneIdx;
            paneIdx   = 0;
        }
        const card  = this.state.puzzle.cards[verifierIdx];
        const panes = paneListOf(card);
        const pane  = panes[paneIdx];
        const def   = CARDS_BY_ID[pane.id];
        const qs    = this.state.queries.filter(q => q.verifierIdx === verifierIdx);
        // For per-option evidence: a query "touches" this pane's option only
        // when the ● at ask time was that option on THIS pane. The ● might
        // have been on the other pane — in which case the verdict reflects
        // a different option and tells us nothing direct about this option
        // (though it may have helped pin the active pane; that's a separate
        // chain handled in the modal renderer via `paneStatus`).
        const otherPaneCounts = paneIdx => qs.map(q => {
            for (let pi = 0; pi < panes.length; pi++) {
                if (pi === paneIdx) continue;
                const odef = CARDS_BY_ID[panes[pi].id];
                if (odef.options.some(o => o.test(q.proposal))) return q;
            }
            return null;
        }).filter(Boolean);
        const perOpt = def.options.map((opt, oi) => {
            const matching = qs.filter(q => {
                // ● on this pane AND it's this option.
                if (!opt.test(q.proposal)) return false;
                // Make sure no option on the OTHER pane also matches (then
                // the ● isn't unique to this option — but the Ask rule
                // guarantees uniqueness so this is a tautology in practice).
                return true;
            });
            return {
                idx:        oi,
                label:      opt.label,
                passQueries: matching.filter(q => q.result),
                failQueries: matching.filter(q => !q.result),
                ruledOut:   matching.some(q => !q.result),
            };
        });
        const target = perOpt[optionIdx];
        // Any directly-confirmed (✓) option on this pane uniquely fixes the
        // criterion AND pins this pane as active.
        const directlyConfirmed = perOpt.find(p =>
            p.passQueries.length && !p.ruledOut);
        const impliedCross = directlyConfirmed && directlyConfirmed.idx !== optionIdx;
        const possibleOpts = perOpt.filter(p => !p.ruledOut && !(impliedCross && p.idx !== directlyConfirmed.idx));
        const confirmed = possibleOpts.length === 1 && possibleOpts[0].idx === optionIdx;

        // In extreme mode, fetch the full pane deduction so we know if this
        // pane is dead / unknown — used by the modal to explain markers like
        // "this option is greyed out because its pane was ruled out."
        const allDed = this.computeDeductions();
        const verDed = allDed[verifierIdx];
        const paneStatus = verDed.panes[paneIdx].paneStatus;
        const isExtreme  = verDed.isExtreme;

        // Status now folds in pane-level info. In extreme mode an option
        // is also implicitly ruled out when ITS PANE is dead — exposed as
        // a new 'pane-dead' status so the modal can explain "pane was
        // eliminated" distinct from "this specific option was crossed."
        let status;
        if (target.ruledOut)                              status = 'crossed';
        else if (impliedCross)                            status = 'crossed-implied';
        else if (confirmed && target.passQueries.length)  status = 'confirmed-direct';
        else if (confirmed)                               status = 'confirmed-elim';
        else if (target.passQueries.length)               status = 'passed';
        else if (paneStatus === 'dead')                   status = 'pane-dead';
        else                                              status = 'unknown';

        return {
            verifierIdx,
            paneIdx,
            optionIdx,
            verifierLetter: VERIFIER_LETTERS[verifierIdx],
            topic: def.topic,
            label: target.label,
            status,
            target,
            perOpt,
            directlyConfirmed,
            paneStatus,
            isExtreme,
            otherPaneQueries: isExtreme ? otherPaneCounts(paneIdx) : [],
        };
    }

    // Count "active" options for a verifier — those whose live preview is ●
    // for the current proposal. In extreme mode this spans BOTH panes (the
    // answer the verifier gives ultimately tells us which option, on which
    // pane, was queried; the Ask rule "exactly one ●" must hold over the
    // full slot, not per pane). Used to grey out Ask when > 1 (ambiguous).
    //
    // EXCEPTION: cards flagged colorParam (Hard+ "which color does X?"
    // shape) and multiOption (Hard+ OR-combo cards) both allow Ask with
    // any ● count — including 0 or many. Multi/zero-● queries don't
    // auto-mark any option (computeDeductions only marks the unambiguous
    // 1-● case) but the YES/NO verdict still helps the player narrow the
    // criterion mentally. We return 1 to mean "always askable" for those,
    // so refreshAskButtons leaves the button enabled.
    activeCountFor(vi) {
        const card = this.state.puzzle.cards[vi];
        const panes = paneListOf(card);
        if (panes.some(p => {
            const def = CARDS_BY_ID[p.id];
            return def.colorParam || def.multiOption;
        })) return 1;
        let n = 0;
        for (const pane of panes) {
            const def = CARDS_BY_ID[pane.id];
            for (const opt of def.options) {
                if (opt.test(this.state.proposal)) n++;
            }
        }
        return n;
    }

    // ---------- screen renderers ----------
    openGameScreen() {
        this.ui.showScreen('game');
        this.renderAll();
        this.wireGameControls();
    }

    renderAll() {
        const s = this.state;
        const gameId = encodeGameId(s.puzzle);
        let levelLabel = LEVELS[s.puzzle.level].label;
        if (s.puzzle.level === 'CUSTOM' && s.puzzle.config) {
            const c = s.puzzle.config;
            const v = c.verifiers || s.puzzle.cards.length;
            const q = c.questionsPerRound || GAME_CONFIG.questionsPerRound;
            levelLabel = `Custom (${c.digitMin}–${c.digitMax}, ${v} verifiers, ${q}/round)`;
        }
        this.ui.setHeader({
            levelLabel,
            round:      s.round,
            questions:  s.questionsAsked(),
            gameId,
        });
        this.ui.renderProposalDials('#proposal-dials', s.proposal, (p) => this.onProposalChange(p),
            { locked: s.isRoundLocked() });
        const deductions = this.computeDeductions();
        this.ui.renderVerifiers(s.puzzle, deductions, s.queries, (i) => this.onAsk(i), s.proposal);
        // Cache deductions so onProposalChange can do a cheap in-place update
        // of the live preview markers without recomputing everything.
        this._lastDeductions = deductions;
        this.refreshAskButtons();
        this.ui.renderNotesTable(s.puzzle, s.queries);
        // End-round button reflects the round state machine:
        //   - active round, ≥1 query asked  → enabled, "End round →"
        //   - between rounds (pending)      → disabled, "Round ended"
        //   - active round, 0 queries asked → disabled, "End round →" (nothing to end yet)
        const endBtn = document.getElementById('btn-end-round');
        if (endBtn) {
            endBtn.disabled = !s.canEndRound();
            endBtn.textContent = s.pendingNewRound
                ? "Round ended"
                : 'End round →';
        }
        // Round hint reflects the lazy-advance state.
        const hint = document.getElementById('round-hint');
        if (hint) {
            if (s.pendingNewRound) {
                hint.textContent = `Round ${s.round} completed. Submit your code, or adjust your number and click Ask to continue with round ${s.round + 1}.`;
            } else if (s.queriesInRound(s.round) > 0) {
                const left = GAME_CONFIG.questionsPerRound - s.queriesInRound(s.round);
                hint.textContent = left > 0
                    ? `Round ${s.round} — ${left} question${left===1?'':'s'} left this round. Note: You cannot change the number during a round.`
                    : `Round ${s.round} — no more questions this round. Click "End round" when ready.`;
            } else {
                hint.textContent = `Set any number, then click any verifier's 'Ask' to start round ${s.round}.`;
            }
        }
        this.ui.renderDigitMap(
            s.disabledDigits, s.candidateDigits,
            // click → toggle crossed-out state
            (ci, d) => {
                s.toggleDisabledDigit(ci, d);
                saveActive(s);
                const cell = document.querySelector(`#digitmap-table .dm-cell[data-ci="${ci}"][data-d="${d}"]`);
                if (cell) cell.classList.toggle('off', s.disabledDigits[ci].has(d));
            },
            // right-click / long-press → toggle candidate circle
            (ci, d) => {
                s.toggleCandidateDigit(ci, d);
                saveActive(s);
                const cell = document.querySelector(`#digitmap-table .dm-cell[data-ci="${ci}"][data-d="${d}"]`);
                if (cell) cell.classList.toggle('candidate', s.candidateDigits[ci].has(d));
            },
        );
    }

    onProposalChange(newProp) {
        this.state.proposal = newProp.slice();
        // Re-render notes (current row shows live number) and refresh the
        // live preview markers on every verifier option.
        this.ui.renderNotesTable(this.state.puzzle, this.state.queries, this.state.round, this.state.proposal);
        if (this._lastDeductions) {
            this.ui.updateVerifierPreviews(this.state.puzzle, this._lastDeductions, this.state.proposal);
        }
        // Ask eligibility depends on per-verifier ● count, which moves with
        // the number — recompute.
        this.refreshAskButtons();
        saveActive(this.state);
    }

    refreshAskButtons() {
        const globallyCan = this.state.canQueryThisRound();
        // Per-verifier rule: Ask is greyed out when more than one option's
        // preview is ● (the answer would be ambiguous). 0 ● is also disabled —
        // the answer would be FAIL with certainty, yielding no information.
        this.state.puzzle.cards.forEach((_, vi) => {
            const active = this.activeCountFor(vi);
            this.ui.setVerifierAskEnabled(vi, globallyCan && active === 1);
        });
    }

    // ---------- core interactions ----------
    onAsk(verifierIdx) {
        if (!this.state.canQueryThisRound()) return;
        const ok = this.state.askVerifier(verifierIdx);
        if (ok === null) return;
        const letter = VERIFIER_LETTERS[verifierIdx];
        // Auto-end the round once the per-round cap is hit, so the player
        // doesn't have to click End round when there's nothing more they can do.
        const askedThisRound = this.state.queriesInRound(this.state.round);
        const capReached = askedThisRound >= GAME_CONFIG.questionsPerRound;
        if (capReached) this.state.endRound();
        const suffix = capReached ? ' — round complete.' : '';
        this.ui.toast(`Verifier ${letter} → ${ok ? '✓' : '✗'}${suffix}`);
        saveActive(this.state);
        this.renderAll();
    }

    onEndRound() {
        if (!this.state.canEndRound()) return;
        this.state.endRound();
        saveActive(this.state);
        this.renderAll();
    }

    onSubmitCode() {
        const dialState = this.state.proposal.slice();
        // Open modal with its own dials pre-filled with current proposal
        const modal = $('#submit-modal');
        const tmpProp = dialState.slice();
        this.ui.renderProposalDials('#submit-dials', tmpProp, () => {});
        this.ui.openModal('submit-modal');
        $('#btn-cancel-submit').onclick = () => this.ui.closeModal('submit-modal');
        $('#btn-confirm-submit').onclick = () => {
            // Read dial values from DOM
            const vals = $$('#submit-dials .dial-value').map(n => parseInt(n.textContent));
            this.ui.closeModal('submit-modal');
            this.finishWithGuess(vals);
        };
    }

    finishWithGuess(code) {
        const ok = this.state.submitGuess(code);
        saveActive(this.state);
        this.showEndScreen({ won: ok, gaveUp: false });
    }

    onGiveUp() {
        this.ui.openModal('giveup-modal');
        document.getElementById('btn-cancel-giveup').onclick = () =>
            this.ui.closeModal('giveup-modal');
        document.getElementById('btn-confirm-giveup').onclick = () => {
            this.ui.closeModal('giveup-modal');
            this.state.finished = true;
            this.state.outcome  = 'lost';
            saveActive(this.state);
            this.showEndScreen({ won: false, gaveUp: true });
        };
    }

    showEndScreen({ won }) {
        this.ui.showScreen('end');
        const gameId   = encodeGameId(this.state.puzzle);
        const shareUrl = buildShareUrl(gameId);
        this.ui.renderEnd({
            won,
            puzzle: this.state.puzzle,
            queriesAsked: this.state.questionsAsked(),
            roundsPlayed: this.state.roundsPlayed(),
            guessedCode: this.state.guessedCode,
            gameId,
            shareUrl,
            onReplaySame: () => {
                // Replay the same puzzle but a fresh session.
                const puz = { ...this.state.puzzle };
                clearActive();
                this.beginWithPuzzle(puz);
            },
            onNewPuzzle: () => {
                clearActive();
                this.ui.showScreen('level');
            },
            onMenu: () => {
                clearActive();
                this.ui.showScreen('main');
                this.refreshMainMenu();
            },
        });
        clearActive(); // game is over → don't prompt to resume
    }

    refreshMainMenu() {
        this.ui.renderMainMenu({
            hasActive: !!loadActive(),
            onResume: () => this.resumeFromStorage(),
            onStart:  () => this.ui.showScreen('level'),
            onPlayShared: () => this.openPlaySharedModal(),
        });
    }

    // ---------- custom level flow ----------
    openCustomLevelModal() {
        const cfg = { digitMin: 1, digitMax: 5, verifiers: 5, questionsPerRound: 3, extreme: 0 };
        // Verifiers and questions/round have no theoretical max; the high
        // caps here are practical limits so the stepper has a stop.
        // `Infinity` in `verifiers.max` would let the player run away.
        // Extreme is a 0/1 toggle exposed through the same +/- stepper UI.
        const limits = {
            digitMin:          { min: 0,  max: 3  },
            digitMax:          { min: 3,  max: 9  },
            verifiers:         { min: 1,  max: 99 },
            questionsPerRound: { min: 1,  max: 99 },
            extreme:           { min: 0,  max: 1  },
        };
        const valNodes = {
            digitMin:          document.getElementById('cfg-digit-min'),
            digitMax:          document.getElementById('cfg-digit-max'),
            verifiers:         document.getElementById('cfg-verifiers'),
            questionsPerRound: document.getElementById('cfg-qpr'),
            extreme:           document.getElementById('cfg-extreme'),
        };
        const startBtn = document.getElementById('btn-start-custom');
        const statusEl = document.getElementById('custom-status');

        let checkToken = 0;          // increments each time we kick off a check
        let pendingTimer = null;

        const renderVals = () => {
            valNodes.digitMin.textContent          = String(cfg.digitMin);
            valNodes.digitMax.textContent          = String(cfg.digitMax);
            valNodes.verifiers.textContent         = String(cfg.verifiers);
            valNodes.questionsPerRound.textContent = String(cfg.questionsPerRound);
            valNodes.extreme.textContent           = cfg.extreme ? 'on' : 'off';
        };

        const setStatus = (text, kind) => {
            statusEl.textContent = text;
            /* istanbul ignore next -- setStatus is always called with a kind in source */
            statusEl.className = 'custom-status' + (kind ? ' ' + kind : '');
        };

        const statsBox = document.getElementById('custom-stats');
        const spinner  = document.getElementById('custom-spinner');

        // Probe the config in a non-blocking way. Runs the generator in
        // chunks of CHUNK attempts, yielding to the event loop between
        // chunks so the spinner keeps animating and the user can still
        // edit values. Search is unbounded — it keeps going until a puzzle
        // is found OR the user changes/cancels the config (invalidating
        // checkToken). The current attempt count is shown live.
        const CHUNK = 2000;
        const runCheck = () => {
            checkToken++;
            const myToken = checkToken;
            startBtn.disabled = true;
            spinner.hidden = false;
            setStatus('Searching for a valid law-set…', 'pending');
            clearTimeout(pendingTimer);
            // Show the config-derived stats immediately — search space and
            // laws available don't depend on a sample puzzle. Puzzle-specific
            // rows are left as "—" until generation succeeds.
            renderConfigStats(cfg);

            let attempted = 0;
            const tryChunk = () => {
                /* istanbul ignore if -- cancellation is a defensive race-guard; the cancel + reopen flow already covers it elsewhere */
                if (myToken !== checkToken) { spinner.hidden = true; return; }
                let puzzle = null;
                /* istanbul ignore next -- the catch handles programmer-error throws that no user-reachable config produces */
                try {
                    puzzle = generatePuzzle('CUSTOM', undefined, {
                        digitMin: cfg.digitMin,
                        digitMax: cfg.digitMax,
                        verifiers: cfg.verifiers,
                        questionsPerRound: cfg.questionsPerRound,
                        extreme: !!cfg.extreme,
                        maxAttempts: CHUNK,
                    });
                } catch (e) { puzzle = null; }
                /* istanbul ignore if -- generatePuzzle is synchronous, so checkToken can't change between the call and this check */
                if (myToken !== checkToken) { spinner.hidden = true; return; }

                if (puzzle) {
                    spinner.hidden = true;
                    startBtn.disabled = false;
                    setStatus('Looks good! Click Start to play.', 'ok');
                    // Stats already shown from renderConfigStats(); nothing
                    // puzzle-specific to refresh.
                    return;
                }

                attempted += CHUNK;
                // Keep searching with a fresh seed — generator re-seeds
                // internally, so we just yield to the event loop and retry.
                setStatus(`Searching for a valid law-set… (${attempted.toLocaleString()} combinations tried)`, 'pending');
                pendingTimer = setTimeout(tryChunk, 0);
            };

            pendingTimer = setTimeout(tryChunk, 30);
        };

        // All stats are derived purely from the config + the active card
        // pool — no specific puzzle required. Shown the moment the modal
        // opens, before any search starts. Reconfigures the runtime so
        // CARDS reflects the requested range, then estimates the puzzle-
        // level stats from the average options-per-card.
        const renderConfigStats = (cfg) => {
            try { reconfigureGame({ digitMin: cfg.digitMin, digitMax: cfg.digitMax }); }
            catch (e) { /* leave previous CARDS */ }
            const span = cfg.digitMax - cfg.digitMin + 1;
            const codeSpace = Math.pow(span, GAME_CONFIG.colors.length);
            // Average options per card across the pruned pool. The generator
            // picks one card per family; treating options-per-card as i.i.d.
            // is a fine first-order approximation of the typical puzzle. In
            // extreme mode each verifier exposes TWO cards (active + decoy),
            // doubling the option space the player has to deduce across.
            const totalOpts = CARDS.reduce((s, c) => s + c.options.length, 0);
            const avgOpts   = totalOpts / CARDS.length;
            const optsPerVerifier = cfg.extreme ? avgOpts * 2 : avgOpts;
            const v         = cfg.verifiers;
            const combos    = Math.pow(optsPerVerifier, v);
            const bits      = v * Math.log2(optsPerVerifier);
            const minQueries = Math.ceil(bits);
            /* istanbul ignore next -- cfg.questionsPerRound is always present in the modal flow */
            const qpr       = cfg.questionsPerRound || 3;
            const minRounds = Math.max(1, Math.ceil(minQueries / qpr));
            // Players rarely play perfectly — waste maybe ~40% of queries.
            const expectedRounds = Math.max(minRounds, Math.ceil(minQueries * 1.4 / qpr));

            document.getElementById('stat-codespace').textContent =
                `${codeSpace.toLocaleString()} possible codes`;
            document.getElementById('stat-cards').textContent =
                `${CARDS.length} distinct rules (avg ${avgOpts.toFixed(1)} options/card${cfg.extreme ? ' · extreme: 2 cards/verifier' : ''})`;
            document.getElementById('stat-combos').textContent =
                `~${Math.round(combos).toLocaleString()} (≈ ${optsPerVerifier.toFixed(1)}^${v})`;
            document.getElementById('stat-bits').textContent =
                `${bits.toFixed(1)} bits → ≥${minQueries} questions`;
            document.getElementById('stat-rounds').textContent =
                minRounds === expectedRounds
                    ? `~${minRounds} round${minRounds===1?'':'s'}`
                    : `${minRounds}–${expectedRounds} rounds`;
            statsBox.hidden = false;
        };

        // Wire the +/- buttons inside the modal.
        document.querySelectorAll('#custom-level-modal [data-cfg]').forEach(btn => {
            btn.onclick = () => {
                const key   = btn.getAttribute('data-cfg');
                const delta = parseInt(btn.getAttribute('data-delta'));
                const next  = cfg[key] + delta;
                const lim   = limits[key];
                if (next < lim.min || next > lim.max) return;
                cfg[key] = next;
                // Keep digitMin < digitMax.
                if (cfg.digitMin >= cfg.digitMax) {
                    if (key === 'digitMin') cfg.digitMin = cfg.digitMax - 1;
                    else                    cfg.digitMax = cfg.digitMin + 1;
                }
                renderVals();
                runCheck();
            };
        });

        renderVals();
        runCheck();
        this.ui.openModal('custom-level-modal');

        document.getElementById('btn-cancel-custom').onclick = () => {
            checkToken++; // invalidate any pending check
            document.getElementById('custom-spinner').hidden = true;
            this.ui.closeModal('custom-level-modal');
        };
        document.getElementById('btn-start-custom').onclick = () => {
            this.ui.closeModal('custom-level-modal');
            const puzzle = generatePuzzle('CUSTOM', undefined, {
                digitMin: cfg.digitMin,
                digitMax: cfg.digitMax,
                verifiers: cfg.verifiers,
                questionsPerRound: cfg.questionsPerRound,
                extreme: !!cfg.extreme,
            });
            if (!puzzle) {
                this.ui.toast('Could not build a puzzle for that configuration.');
                return;
            }
            clearActive();
            this.beginWithPuzzle(puzzle);
        };
    }

    // ---------- shared puzzle flow ----------
    startSharedFromInput(input) {
        const id = extractGameIdFromInput(input);
        if (!id) throw new Error('Could not find a game ID in your input.');
        const puzzle = decodeGameId(id);
        clearActive();
        this.beginWithPuzzle(puzzle);
    }

    openPlaySharedModal() {
        const errEl = $('#play-shared-error');
        const input = $('#play-shared-input');
        errEl.hidden = true;
        input.value = '';
        this.ui.openModal('play-shared-modal');
        $('#btn-play-shared-cancel').onclick = () => this.ui.closeModal('play-shared-modal');
        $('#btn-play-shared-start').onclick  = () => {
            try {
                this.startSharedFromInput(input.value.trim());
                this.ui.closeModal('play-shared-modal');
            } catch (e) {
                /* istanbul ignore next -- decodeGameId always throws Errors with non-empty messages, so the fallback is purely defensive */
                errEl.textContent = e.message || 'Could not load this puzzle.';
                errEl.hidden = false;
            }
        };
    }

    // ---------- one-time wiring ----------
    wireGlobalUI() {
        const goBack = () => {
            this.ui.showScreen('main');
            this.refreshMainMenu();
        };
        $('#btn-back').onclick = goBack;
        this.ui.setOnBackToMain(goBack);
        $('#btn-info').onclick = () => this.ui.openModal('rules-modal');
        $('#btn-close-rules').onclick = () => this.ui.closeModal('rules-modal');

        $('#btn-share').onclick = () => {
            if (!this.state) return;
            const gameId = encodeGameId(this.state.puzzle);
            const url = buildShareUrl(gameId);
            $('#share-url').value = url;
            $('#share-game-id').value = gameId;
            this.ui.openModal('share-modal');
            $('#btn-share-close').onclick = () => this.ui.closeModal('share-modal');
            $('#btn-share-copy-url').onclick = () => copyText(url, this.ui);
            $('#btn-share-copy-id').onclick  = () => copyText(gameId, this.ui);
            // Web Share API — visible only when supported.
            const shareUrlBtn = $('#btn-share-share-url');
            const shareIdBtn  = $('#btn-share-share-id');
            const supported = webShareSupported();
            shareUrlBtn.hidden = !supported;
            shareIdBtn.hidden  = !supported;
            if (supported) {
                shareUrlBtn.onclick = () => webShare({ title: 'Turing Machine puzzle', text: 'Try this puzzle:', url }, this.ui);
                shareIdBtn.onclick  = () => webShare({ title: 'Turing Machine puzzle', text: `Game ID: ${gameId}` }, this.ui);
            }
        };

    }

    wireGameControls() {
        $('#btn-end-round').onclick  = () => this.onEndRound();
        $('#btn-submit-code').onclick = () => this.onSubmitCode();
        $('#btn-give-up').onclick = () => this.onGiveUp();

        // Delegated click: tapping a verifier-card .marker opens the trace
        // modal explaining how that ✓/✗ came to be. Empty markers are
        // intentionally inert (nothing to explain yet). In extreme mode the
        // .vopt carries data-cidx for the pane index (0 or 1); normal mode
        // omits it and defaults to pane 0.
        $('#verifier-row').addEventListener('click', (ev) => {
            const marker = ev.target.closest('.marker');
            if (!marker) return;
            const vopt = marker.closest('.vopt');
            const card = marker.closest('.verifier-card');
            if (!vopt || !card) return;
            if (!marker.textContent.trim()) return;
            const vi = parseInt(card.getAttribute('data-vidx'));
            const oi = parseInt(vopt.getAttribute('data-oi'));
            /* istanbul ignore next -- data-cidx is always set by renderVerifiers (even normal mode uses 0); the || '0' is purely defensive against future renderer changes */
            const ci = parseInt(vopt.getAttribute('data-cidx') || '0');
            this.ui.renderDeductionModal(this.deduceFor(vi, ci, oi));
        });
        $('#btn-close-deduction').onclick = () => this.ui.closeModal('deduction-modal');
    }
}

// --- helpers ---------------------------------------------------------------
function buildShareUrl(gameId) {
    const base = window.location.origin + window.location.pathname;
    return `${base}?game-id=${encodeURIComponent(gameId)}`;
}

function extractGameIdFromInput(input) {
    if (!input) return null;
    input = input.trim();
    // If it looks like a URL, pull the game-id param.
    try {
        if (/^https?:/i.test(input)) {
            const u = new URL(input);
            const fromQuery = u.searchParams.get('game-id') || u.searchParams.get('game') || u.searchParams.get('id');
            if (fromQuery) return fromQuery;
        }
    } catch (e) { /* ignore */ }
    // Plain id
    if (/^[EMH][0-9.\-]+$/i.test(input)) return input.toUpperCase();
    return null;
}
