'use strict';

// Thin DOM façade. All visible state changes go through here so the rest of
// the code never touches the DOM directly.

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class')      node.className = v;
        else if (k === 'html')  node.innerHTML = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (v === false || v === null || v === undefined) continue;
        else if (v === true)    node.setAttribute(k, '');
        else                    node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
        if (c == null) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
};

class UI {
    constructor() {
        this.screens = {
            main:  $('#screen-main'),
            level: $('#screen-level'),
            game:  $('#screen-game'),
            end:   $('#screen-end'),
        };
        this.toastTimer = null;

        // Phone-back integration. We mirror two app states into the browser
        // history stack: (1) "on a non-main screen" pushes one entry; (2) each
        // open modal pushes one entry on top. A `popstate` then unwinds the
        // matching app-state, so the phone back button closes the topmost
        // modal first, then leaves a non-main screen back to the menu.
        this._modalStack = [];
        this._navDepth = 0;
        this._suppressNextPop = false;
        this._skipNextScreenRewind = false;
        this._currentScreen = null;
        this._onBackToMain = null;
        window.addEventListener('popstate', () => this._onPopState());
    }

    setOnBackToMain(fn) { this._onBackToMain = fn; }

    _onPopState() {
        if (this._suppressNextPop) { this._suppressNextPop = false; return; }
        // Browser already popped one entry — mirror that locally.
        if (this._navDepth > 0) this._navDepth--;
        if (this._modalStack.length) {
            const id = this._modalStack.pop();
            $('#' + id).classList.add('hidden');
            return;
        }
        if (this._currentScreen && this._currentScreen !== 'main') {
            // History is already aligned; skip showScreen's rewind logic.
            this._skipNextScreenRewind = true;
            /* istanbul ignore else -- game.js always installs the handler */
            if (this._onBackToMain) this._onBackToMain();
        }
    }

    showScreen(name) {
        for (const [n, node] of Object.entries(this.screens)) {
            node.classList.toggle('hidden', n !== name);
        }
        // Topbar buttons relevance
        $('#btn-back').hidden  = (name === 'main');
        $('#btn-share').hidden = (name !== 'game' && name !== 'end');

        const prev = this._currentScreen;
        if (name === 'main' && prev && prev !== 'main') {
            // Returning to main — close any open modals and unwind history.
            while (this._modalStack.length) {
                const id = this._modalStack.pop();
                $('#' + id).classList.add('hidden');
            }
            if (this._skipNextScreenRewind) {
                this._skipNextScreenRewind = false;
            } else /* istanbul ignore else -- navDepth is always ≥1 when leaving a non-main screen */ if (this._navDepth > 0) {
                const n = this._navDepth;
                this._navDepth = 0;
                this._suppressNextPop = true;
                history.go(-n);
            }
        } else if (name !== 'main' && (!prev || prev === 'main')) {
            // Leaving main — register a single "back-to-main" history entry.
            this._navDepth++;
            history.pushState({ tm_nav: this._navDepth }, '');
        }
        this._currentScreen = name;
    }

    openModal(id)  {
        const node = $('#' + id);
        /* istanbul ignore if -- defensive against double-open; no caller does this today */
        if (this._modalStack.includes(id)) return;
        node.classList.remove('hidden');
        this._modalStack.push(id);
        this._navDepth++;
        history.pushState({ tm_nav: this._navDepth }, '');
    }
    closeModal(id) {
        const node = $('#' + id);
        const idx = this._modalStack.indexOf(id);
        node.classList.add('hidden');
        /* istanbul ignore if -- defensive: closing an already-closed modal is a no-op for history */
        if (idx === -1) return;
        // Pop this modal and anything stacked above it from both lists. Today
        // no caller stacks modals, but the loop keeps history consistent if
        // one ever does.
        const pops = this._modalStack.length - idx;
        for (let k = 0; k < pops; k++) {
            const otherId = this._modalStack.pop();
            /* istanbul ignore if -- only fires for stacked modals, which no caller creates today */
            if (otherId !== id) $('#' + otherId).classList.add('hidden');
        }
        this._navDepth -= pops;
        this._suppressNextPop = true;
        history.go(-pops);
    }

    toast(msg) {
        const t = $('#toast');
        t.textContent = msg;
        t.hidden = false;
        // restart transition
        requestAnimationFrame(() => t.classList.add('show'));
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            t.classList.remove('show');
            setTimeout(() => { t.hidden = true; }, 250);
        }, 1800);
    }

    // ----- main menu wiring -----
    renderMainMenu({ hasActive, onResume, onStart, onPlayShared }) {
        $('#btn-resume-game').hidden = !hasActive;
        $('#btn-resume-game').onclick = onResume;
        $('#btn-start-game').onclick = onStart;
        $('#btn-play-friends').onclick = onPlayShared;
    }

    // ----- level select -----
    renderLevelSelect(levels, onChoose, onBack) {
        const container = $('#level-options');
        container.innerHTML = '';
        for (const lv of levels) {
            const btn = el('button',
                { class: 'level-option', onclick: () => onChoose(lv.id) },
                el('strong', {}, lv.label),
                el('span', {}, lv.description)
            );
            container.appendChild(btn);
        }
        $('#btn-back-to-main').onclick = onBack;
    }

    // ----- proposal dials -----
    renderProposalDials(containerSel, proposal, onChange, opts = {}) {
        const locked = !!opts.locked;
        const root = $(containerSel);
        root.innerHTML = '';
        root.classList.toggle('locked', locked);
        const colors = GAME_CONFIG.colors;
        const min = GAME_CONFIG.digitMin, max = GAME_CONFIG.digitMax;
        const span = max - min + 1;
        colors.forEach((c, i) => {
            // Build the value node first so the +/- handlers can update its
            // text directly — onChange persists state, but the visible digit
            // must change at click time without waiting for a full re-render.
            const valueNode = el('div', { class: 'dial-value', 'data-dial': c }, String(proposal[i]));
            const bump = (delta) => {
                proposal[i] = ((proposal[i] - min + delta + span) % span) + min;
                valueNode.textContent = String(proposal[i]);
                onChange(proposal);
            };
            const dial = el('div', { class: `dial ${c}` + (locked ? ' locked' : '') },
                el('div', { class: 'dial-head' },
                    el('div', { class: 'dial-color' }),
                    el('div', { class: 'dial-label' }, c.toUpperCase()),
                ),
                el('div', { class: 'dial-row' },
                    el('button', {
                        class: 'dial-step', 'aria-label': `decrease ${c}`,
                        disabled: locked ? true : false,
                        onclick: locked ? null : () => bump(-1),
                    }, '−'),
                    valueNode,
                    el('button', {
                        class: 'dial-step', 'aria-label': `increase ${c}`,
                        disabled: locked ? true : false,
                        onclick: locked ? null : () => bump(+1),
                    }, '+')
                )
            );
            root.appendChild(dial);
        });
    }

    updateProposalDials(containerSel, proposal) {
        const root = $(containerSel);
        const vals = root.querySelectorAll('.dial-value');
        vals.forEach((node, i) => { node.textContent = String(proposal[i]); });
    }

    // ----- verifier cards row -----
    renderVerifiers(puzzle, deductions, queries, onAsk, proposal) {
        const row = $('#verifier-row');
        row.innerHTML = '';
        puzzle.cards.forEach((card, i) => {
            const def = CARDS_BY_ID[card.id];
            const verifierQueries = queries.filter(q => q.verifierIdx === i);
            const exhausted = !!deductions[i] && deductions[i].confirmed !== null;

            const optsList = el('ul', { class: 'voptions' });
            def.options.forEach((opt, oi) => {
                const ded = deductions[i] || { crossed: new Set(), passed: new Set(), confirmed: null };
                const isCross = ded.crossed.has(oi);
                const isPassed = ded.passed && ded.passed.has(oi);
                const isConfirmed = ded.confirmed === oi;
                const title = isConfirmed ? 'This must be the criterion'
                            : isCross    ? 'Past query: FAIL on this rule'
                            :               'Still possible';
                // Right-side indicator: just the live ● for whatever option
                // the current number activates. Past verdicts show on the
                // LEFT marker as ✓/✗.
                const wouldPass = proposal && !isConfirmed && opt.test(proposal);
                const preview = el('span', {
                    class: 'preview' + (wouldPass ? ' pass' : ' hidden-preview'),
                    title: wouldPass ? 'Current number would PASS this rule' : '',
                    html: wouldPass ? PREVIEW_ARROW_SVG : '',
                });

                // Left marker reflects accumulated query knowledge:
                //   ✓ confirmed / passed,   ✗ ruled out by a past query.
                // We deliberately don't apply ANY "ruled out" styling to the
                // row itself (no strike-through, no dimming) — only the
                // marker itself signals the verdict.
                const markerChar = (isConfirmed || isPassed) ? '✓'
                                 : isCross                   ? '✗'
                                 :                             '';
                const li = el('li',
                    { class: 'vopt'
                        + (isConfirmed ? ' confirmed' : '')
                        + (isCross    ? ' ruledout' : ''),
                      'data-vidx': i, 'data-oi': oi,
                      title },
                    el('span', { class: 'marker' }, markerChar),
                    el('span', { class: 'vopt-label' }, labelToColoredNodes(opt.label)),
                    preview,
                );
                optsList.appendChild(li);
            });

            const head = el('div', { class: 'vcard-head' },
                el('div', { class: 'vletter' }, VERIFIER_LETTERS[i]),
                el('div', { class: 'vtopic' }, labelToColoredNodes(def.topic)),
                el('button', { class: 'vbtn', 'data-ask': i,
                    onclick: () => onAsk(i)
                }, 'Ask'),
            );

            const card_el = el('div', { class: 'verifier-card', 'data-vidx': i },
                head,
                optsList,
            );

            if (verifierQueries.length) {
                const log = el('div', { class: 'vqlog' });
                verifierQueries.forEach(q => {
                    // The "active" option at ask time is the one whose
                    // predicate matched the number — by the 1-● Ask rule
                    // there's always exactly one. Show its label so the
                    // log reads as a complete deduction sentence.
                    const activeOpts = def.options.filter(o => o.test(q.proposal));
                    const activeLabel = activeOpts.length === 1
                        ? activeOpts[0].label : null;
                    const row = el('div', {},
                        `Round ${q.round}: `,
                        formatProposalNode(q.proposal),
                    );
                    if (activeLabel) {
                        row.appendChild(document.createTextNode(' → '));
                        row.appendChild(el('span', { class: 'vqlog-rule' },
                            labelToColoredNodes(activeLabel)));
                    }
                    row.appendChild(document.createTextNode(' → '));
                    row.appendChild(el('span',
                        { class: q.result ? 'ok' : 'fail' },
                        q.result ? '✓' : '✗'));
                    log.appendChild(row);
                });
                card_el.appendChild(log);
            }

            row.appendChild(card_el);
        });
        // Equalize widths so every card matches the widest one (driven by
        // unwrapped vqlog rows). Runs after layout so scrollWidth is accurate.
        this._equalizeVerifierCardWidths();
    }

    // Measure each card's intrinsic width (with `width: max-content` so the
    // card sizes to its widest unwrappable child — typically a vqlog row or
    // the vtopic), then apply the max as a fixed width to all cards. The
    // wrapper is flex-wrap so cards wrap to a new row when total width
    // exceeds the container, but every visible card has identical width.
    _equalizeVerifierCardWidths() {
        const cards = Array.from(document.querySelectorAll('#verifier-row .verifier-card'));
        if (!cards.length) return;
        cards.forEach(c => { c.style.width = 'max-content'; });
        const widest = cards.reduce((m, c) => Math.max(m, c.getBoundingClientRect().width), 0);
        cards.forEach(c => { c.style.width = widest + 'px'; });
    }

    // Recompute the live preview marker on every verifier option without
    // rebuilding the whole verifier row. Cheap; safe to call on each dial tick.
    updateVerifierPreviews(puzzle, deductions, proposal) {
        puzzle.cards.forEach((card, i) => {
            const def = CARDS_BY_ID[card.id];
            const ded = deductions[i] || { crossed: new Set(), passed: new Set(), confirmed: null };
            def.options.forEach((opt, oi) => {
                const node = document.querySelector(
                    `.verifier-card[data-vidx="${i}"] .vopt[data-oi="${oi}"] .preview`);
                if (!node) return;
                // Right side only ever shows the live ● for currently-active
                // options. Past verdicts (✓) live in the LEFT marker, which
                // is set in renderVerifiers and is not touched on dial ticks.
                // We don't rule anything out on the verifier card, so even
                // options previously seen as FAIL still get the live ● when
                // the current number activates them.
                const live = ded.confirmed !== oi
                          && !(ded.passed && ded.passed.has(oi));
                const ok = live && !!opt.test(proposal);
                if (ok) {
                    node.className = 'preview pass';
                    node.innerHTML = PREVIEW_ARROW_SVG;
                    node.title = 'Current number would PASS this rule';
                } else {
                    node.className = 'preview hidden-preview';
                    node.innerHTML = '';
                    node.title = '';
                }
            });
        });
    }

    setVerifierAskEnabled(i, enabled) {
        const btn = $(`.verifier-card[data-vidx="${i}"] .vbtn`);
        if (btn) btn.disabled = !enabled;
    }

    setAllAskButtons(enabled) {
        $$('.verifier-card .vbtn').forEach(b => b.disabled = !enabled);
    }

    // ----- header info -----
    setHeader({ levelLabel, round, questions }) {
        $('#info-level').textContent = levelLabel;
        $('#info-round').textContent = `Round ${round}`;
        $('#info-questions').textContent = `${questions} question${questions === 1 ? '' : 's'}`;
    }

    // ----- notes table -----
    // One row per asked question, in chronological order:
    //   Round | Number | Asked (rule) | Result
    // Carries everything the per-query detail modal used to show, so that
    // modal is no longer needed.
    renderNotesTable(puzzle, queries /* currentRound, currentProposal unused */) {
        const t = $('#notes-table');
        t.innerHTML = '';
        t.appendChild(el('thead', {}, el('tr', {},
            el('th', { class: 'col-round' }, 'Round'),
            el('th', {}, 'Number'),
            el('th', {}, 'Asked'),
            el('th', {}, 'Result'),
        )));
        const body = el('tbody');
        if (!queries.length) {
            body.appendChild(el('tr', {},
                el('td', { class: 'res-blank empty-row', colspan: '4' },
                    'No questions asked yet.')
            ));
        } else {
            queries.forEach(q => {
                const def = CARDS_BY_ID[puzzle.cards[q.verifierIdx].id];
                // The ● option at ask time — guaranteed unique by the 1-●
                // Ask rule, so this never shows '—' for a real query.
                const activeOpts = def.options.filter(o => o.test(q.proposal));
                const activeLabel = activeOpts.length === 1 ? activeOpts[0].label : null;
                body.appendChild(el('tr', {},
                    el('td', { class: 'col-round' }, String(q.round)),
                    el('td', { class: 'prop-cell' }, formatProposalNode(q.proposal)),
                    el('td', { class: 'col-rule' },
                        activeLabel ? labelToColoredNodes(activeLabel)
                                    : document.createTextNode('—')
                    ),
                    el('td', { class: q.result ? 'res-ok' : 'res-no' },
                        q.result ? '✓' : '✗'),
                ));
            });
        }
        t.appendChild(body);
    }

    // ----- digit map -----
    // Rows = each value in the configured digit range, columns = each color
    // slot. Two manual overlays per cell, independent:
    //   • click               → toggle "off" (✗ crossed)
    //   • right-click / long-press → toggle "candidate" (blue circle)
    // A cell can carry both — useful when narrowing then re-questioning.
    renderDigitMap(disabledDigits, candidateDigits, onToggleOff, onToggleCandidate) {
        const t = $('#digitmap-table');
        t.innerHTML = '';
        const head = el('thead', {}, el('tr', {},
            ...GAME_CONFIG.colors.map(c =>
                el('th', { class: `dm-th dm-${c}`, title: c },
                    el('span', { class: `color-dot ${c}` }),
                    el('span', { class: 'dm-th-label' }, c.toUpperCase()),
                )
            )
        ));
        t.appendChild(head);
        const body = el('tbody');
        for (let v = GAME_CONFIG.digitMin; v <= GAME_CONFIG.digitMax; v++) {
            const tr = el('tr', {},
                ...GAME_CONFIG.colors.map((c, ci) => {
                    const off  = disabledDigits[ci].has(v);
                    const cand = candidateDigits[ci].has(v);
                    const cls  = 'dm-cell'
                        + (off  ? ' off'  : '')
                        + (cand ? ' candidate' : '');
                    const cell = el('td', {
                        class: cls,
                        'data-ci': ci, 'data-d': v,
                        title: 'Click: cross out · Right-click / long-press: mark candidate',
                    }, String(v));
                    cell.addEventListener('click', () => onToggleOff(ci, v));
                    cell.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        onToggleCandidate(ci, v);
                    });
                    // Long-press for touch devices: ~500 ms hold fires the
                    // candidate toggle and suppresses the trailing click.
                    let pressTimer = null;
                    let longFired  = false;
                    const cancel = () => { clearTimeout(pressTimer); pressTimer = null; };
                    cell.addEventListener('touchstart', () => {
                        longFired = false;
                        cancel();
                        pressTimer = setTimeout(() => {
                            longFired = true;
                            try { if (navigator.vibrate) navigator.vibrate(30); } catch (_) {}
                            // Some browsers select the cell text the moment
                            // the long-press fires; clear it so the cell
                            // doesn't end up looking selected.
                            try { window.getSelection && window.getSelection().removeAllRanges(); }
                            catch (_) { /* ignore */ }
                            onToggleCandidate(ci, v);
                        }, 500);
                    }, { passive: true });
                    cell.addEventListener('touchmove', cancel, { passive: true });
                    cell.addEventListener('touchend', (e) => {
                        if (pressTimer) cancel();
                        if (longFired) { e.preventDefault(); longFired = false; }
                    });
                    return cell;
                })
            );
            body.appendChild(tr);
        }
        t.appendChild(body);
    }

    // ----- deduction trace modal -----
    // `trace` comes from Game#deduceFor. Lays out a short status line and a
    // list of "evidence" rows — past queries that produced the verdict, or,
    // for confirm-by-elimination, the queries that knocked out every other
    // option.
    renderDeductionModal(trace) {
        $('#ded-title').textContent = 'How was this deduced?';
        const sub = $('#ded-subtitle');
        sub.innerHTML = '';
        sub.appendChild(el('span', { class: 'verifier-tag' }, `Verifier ${trace.verifierLetter}`));
        sub.appendChild(document.createTextNode(' · '));
        sub.appendChild(labelToColoredNodes(trace.label));

        const status = $('#ded-status');
        status.innerHTML = '';
        const body = $('#ded-body');
        body.innerHTML = '';

        const evidenceRow = (q, ok) => el('li', { class: ok ? 'ev-ok' : 'ev-no' },
            el('span', { class: 'ev-round' }, `Round ${q.round}`),
            el('span', { class: 'ev-prop' }, formatProposalNode(q.proposal)),
            el('span', { class: 'ev-arrow' }, '→'),
            el('span', { class: ok ? 'ev-result ok' : 'ev-result fail' }, ok ? '✓' : '✗'),
        );

        if (trace.status === 'crossed') {
            status.className = 'ded-status is-no';
            status.textContent = '✗ Ruled out by a past query.';
            body.appendChild(el('p', { class: 'ded-explainer' },
                'When you asked this verifier with the numbers below, this option was the only one that matched (●). The verifier answered FAIL — so this option cannot be the criterion.'));
            const ul = el('ul', { class: 'ev-list' });
            trace.target.failQueries.forEach(q => ul.appendChild(evidenceRow(q, false)));
            body.appendChild(ul);
            return this.openModal('deduction-modal');
        }

        if (trace.status === 'crossed-implied') {
            status.className = 'ded-status is-no';
            status.textContent = '✗ Ruled out by implication.';
            body.appendChild(el('p', { class: 'ded-explainer' },
                'Another option on this card has been directly confirmed by a past query — and a card has exactly one true criterion, so every other option must be ruled out.'));
            const ul = el('ul', { class: 'ev-list' });
            trace.directlyConfirmed.passQueries.forEach(q => ul.appendChild(evidenceRow(q, true)));
            body.appendChild(el('p', { class: 'ded-explainer' },
                'Confirmed option:'));
            body.appendChild(el('p', { class: 'elim-label' },
                labelToColoredNodes(trace.directlyConfirmed.label)));
            body.appendChild(ul);
            return this.openModal('deduction-modal');
        }

        if (trace.status === 'passed') {
            status.className = 'ded-status is-ok';
            status.textContent = '✓ Confirmed directly by a past query.';
            body.appendChild(el('p', { class: 'ded-explainer' },
                'This option was the ● in the query below and the verifier answered PASS — so this rule fits the criterion.'));
            const ul = el('ul', { class: 'ev-list' });
            trace.target.passQueries.forEach(q => ul.appendChild(evidenceRow(q, true)));
            body.appendChild(ul);
            return this.openModal('deduction-modal');
        }

        if (trace.status === 'confirmed-direct') {
            status.className = 'ded-status is-ok';
            status.textContent = '✓ Confirmed — directly proved AND only one option remained.';
            body.appendChild(el('p', { class: 'ded-explainer' }, 'Direct evidence:'));
            const ul = el('ul', { class: 'ev-list' });
            trace.target.passQueries.forEach(q => ul.appendChild(evidenceRow(q, true)));
            body.appendChild(ul);

            const others = trace.perOpt.filter(p => p.idx !== trace.optionIdx);
            const elim   = others.filter(p => p.ruledOut);
            if (elim.length) {
                body.appendChild(el('p', { class: 'ded-explainer' },
                    'And the other options were ruled out:'));
                body.appendChild(this._renderEliminationList(elim, evidenceRow));
            }
            return this.openModal('deduction-modal');
        }

        if (trace.status === 'confirmed-elim') {
            status.className = 'ded-status is-ok';
            status.textContent = '✓ Confirmed by elimination — it\'s the only option left.';
            const others = trace.perOpt.filter(p => p.idx !== trace.optionIdx);
            body.appendChild(el('p', { class: 'ded-explainer' },
                'Every other option on this card has been ruled out by a past query, so this one must be the criterion:'));
            body.appendChild(this._renderEliminationList(others.filter(p => p.ruledOut), evidenceRow));
            return this.openModal('deduction-modal');
        }

        // Fallback / unknown — shouldn't be clickable since marker is empty.
        status.className = 'ded-status';
        status.textContent = 'No deduction yet — no past query has touched this option.';
        return this.openModal('deduction-modal');
    }

    _renderEliminationList(eliminated, evidenceRowFn) {
        const wrap = el('div', { class: 'elim-list' });
        eliminated.forEach(p => {
            wrap.appendChild(el('div', { class: 'elim-block' },
                el('div', { class: 'elim-label' }, labelToColoredNodes(p.label)),
                (() => {
                    const ul = el('ul', { class: 'ev-list' });
                    p.failQueries.forEach(q => ul.appendChild(evidenceRowFn(q, false)));
                    return ul;
                })()
            ));
        });
        return wrap;
    }

    // ----- end screen -----
    renderEnd({ won, puzzle, queriesAsked, roundsPlayed, guessedCode, gameId, shareUrl,
                onReplaySame, onNewPuzzle, onMenu }) {
        $('#end-title').textContent = won ? 'You cracked the code!' : 'No luck this time';
        $('#end-title').classList.toggle('win',  won);
        $('#end-title').classList.toggle('lose', !won);

        const stats = won
            ? `Solved in ${roundsPlayed} round${roundsPlayed===1?'':'s'} · ${queriesAsked} question${queriesAsked===1?'':'s'}.`
            : (guessedCode
                ? `Your guess: ${guessedCode.join('-')} · the correct code was ${puzzle.solution.join('-')}.`
                : `You gave up after ${roundsPlayed} round${roundsPlayed===1?'':'s'} and ${queriesAsked} question${queriesAsked===1?'':'s'}. The code was ${puzzle.solution.join('-')}.`);
        $('#end-stats').textContent = stats;

        const row = $('#end-solution-row');
        row.innerHTML = '';
        GAME_CONFIG.colors.forEach((c, i) => {
            row.appendChild(el('div', { class: `code-bead ${c}` }, String(puzzle.solution[i])));
        });

        const list = $('#end-criteria-list');
        list.innerHTML = '';
        puzzle.cards.forEach((card, i) => {
            const def = CARDS_BY_ID[card.id];
            const opt = def.options[card.opt];
            list.appendChild(el('li', {},
                el('span', { class: 'verifier-tag' }, VERIFIER_LETTERS[i]),
                labelToColoredNodes(def.topic),
                ': ',
                el('strong', {}, labelToColoredNodes(opt.label)),
            ));
        });

        $('#end-share-url').value = shareUrl;
        $('#end-share-game-id').value = gameId;

        $('#btn-replay-same').onclick = onReplaySame;
        $('#btn-new-puzzle').onclick  = onNewPuzzle;
        $('#btn-end-menu').onclick    = onMenu;
        $('#btn-end-copy-url').onclick = () => copyText(shareUrl, this);
        $('#btn-end-copy-id').onclick  = () => copyText(gameId, this);

        // Web Share buttons — visible only when navigator.share exists.
        const shareUrlBtn = $('#btn-end-share-url');
        const shareIdBtn  = $('#btn-end-share-id');
        const supported = webShareSupported();
        shareUrlBtn.hidden = !supported;
        shareIdBtn.hidden  = !supported;
        if (supported) {
            shareUrlBtn.onclick = () => webShare({ title: 'Turing Machine puzzle', text: 'Try this puzzle:', url: shareUrl }, this);
            shareIdBtn.onclick  = () => webShare({ title: 'Turing Machine puzzle', text: `Game ID: ${gameId}` }, this);
        }
    }
}

// --- helpers ---------------------------------------------------------------
// Inline SVG arrow used as the "active option" preview marker on verifier
// cards. Pointing left so it visually reads as "← this rule fits the number".
const PREVIEW_ARROW_SVG =
    '<svg class="arrow-svg" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M14 8 L3 8 M7 4 L3 8 L7 12" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Replace every occurrence of a configured color name in `label` with a small
// colored dot (`<span class="color-dot blue"/>` etc). Returns a DocumentFragment
// so the result can be appended directly. The match is whole-word + case-
// insensitive so substrings inside other words ("blueprint") are left alone.
function labelToColoredNodes(label) {
    const frag = document.createDocumentFragment();
    const names = GAME_CONFIG.colors;
    if (!names.length) { frag.appendChild(document.createTextNode(label)); return frag; }
    const re = new RegExp('\\b(' + names.join('|') + ')\\b', 'gi');
    let lastIdx = 0, m;
    while ((m = re.exec(label)) !== null) {
        if (m.index > lastIdx) {
            frag.appendChild(document.createTextNode(label.slice(lastIdx, m.index)));
        }
        const colorName = m[1].toLowerCase();
        frag.appendChild(el('span', { class: `color-dot ${colorName}`, title: colorName }));
        lastIdx = m.index + m[0].length;
    }
    if (lastIdx < label.length) {
        frag.appendChild(document.createTextNode(label.slice(lastIdx)));
    }
    return frag;
}

function formatProposalNode(proposal) {
    // One small span per color slot — coloring driven by the slot name so the
    // helper keeps working when GAME_CONFIG.colors changes.
    const span = el('span', {});
    GAME_CONFIG.colors.forEach((c, i) => {
        if (i > 0) span.appendChild(document.createTextNode('-'));
        span.appendChild(el('span', { class: 'p' + c[0] }, String(proposal[i])));
    });
    return span;
}

function autosize(_textarea) {
    // No-op kept for call-site compatibility: the share textareas are now
    // single-line, fixed-height, horizontally scrollable — growing their
    // height to fit the content would re-introduce the cramped wrap.
}

async function copyText(text, ui) {
    try {
        await navigator.clipboard.writeText(text);
        if (ui) ui.toast('Copied to clipboard');
    } catch (e) {
        if (ui) ui.toast('Copy failed — long-press to select');
    }
}

// True iff the browser offers the Web Share API. The share buttons stay
// hidden when this is false (desktop browsers without the API).
function webShareSupported() {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

async function webShare({ title, text, url }, ui) {
    if (!webShareSupported()) return;
    try {
        await navigator.share({ title, text, url });
    } catch (e) {
        // user cancelled — silent
        if (e && e.name !== 'AbortError' && ui) ui.toast('Share failed');
    }
}
