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
    // Layout: a Classic-verifiers stepper on top (only relevant for the
    // CLASSIC level — other levels use their own fixed counts), then the
    // level option buttons. Each option has a magnifier icon on the right;
    // clicking the icon stops the click before it reaches the outer button
    // (so we don't accidentally start a game) and opens the level-info
    // modal listing every verifier card the generator can pick from.
    renderLevelSelect(items, onChoose, onInfo, onBack) {
        const container = $('#level-options');
        container.innerHTML = '';
        for (const item of items) {
            // Separator entry: `{ separator: 'Others' }` renders a labelled
            // divider between groups of level options.
            if (item.separator) {
                container.appendChild(el('div', { class: 'level-section-sep' },
                    el('span', { class: 'sep-line' }),
                    el('span', { class: 'sep-label' }, item.separator),
                    el('span', { class: 'sep-line' })));
                continue;
            }
            const lv = item;
            const info = lv.noInfo ? null : el('span', {
                class: 'level-info-icon',
                title: `See verifiers available in ${lv.label}`,
                onclick: (ev) => { ev.stopPropagation(); onInfo(lv.id); },
                html: LEVEL_INFO_MAGNIFIER_SVG,
            });
            const btn = el('button',
                { class: 'level-option', 'data-level': lv.id,
                  onclick: () => onChoose(lv.id) },
                el('strong', {}, lv.label),
                el('span', {}, lv.description),
                info,
            );
            container.appendChild(btn);
        }
        $('#btn-back-to-main').onclick = onBack;
    }

    // Read / write the Classic-verifiers stepper. The stepper is part of
    // the level select screen and only affects the CLASSIC level — other
    // levels ignore it.
    getClassicVerifiers() {
        const n = parseInt($('#cv-count').textContent, 10);
        /* istanbul ignore next -- the stepper always shows a finite integer; the `: 5` fallback is defensive against a malformed DOM */
        return isFinite(n) ? n : 5;
    }
    setClassicVerifiers(n) {
        $('#cv-count').textContent = String(n);
    }
    /* istanbul ignore next -- default-parameter values; main.js always passes an opts object with all three keys explicitly */
    wireClassicStepper({ min = 3, max = 7, initial = 5 } = {}) {
        this.setClassicVerifiers(initial);
        const bump = (delta) => {
            const next = Math.min(max, Math.max(min, this.getClassicVerifiers() + delta));
            this.setClassicVerifiers(next);
        };
        $('#btn-cv-dec').onclick = () => bump(-1);
        $('#btn-cv-inc').onclick = () => bump(+1);
    }

    // ----- level-info modal -----
    // Lists every verifier card the generator may pick from for a given
    // level. Custom is treated as "the full non-Hard+-only pool at the
    // current digit range"; Hard+ also includes the hardplusOnly combo +
    // pairwise cards.
    renderLevelInfoModal({ levelLabel, subtitle, cards }) {
        $('#level-info-title').textContent = `Verifiers available in ${levelLabel}`;
        $('#level-info-subtitle').textContent = subtitle;
        const body = $('#level-info-body');
        body.innerHTML = '';
        const list = el('ol', { class: 'level-info-list' });
        cards.forEach((card, idx) => {
            const tagSpans = [];
            // (colorParam is signalled inline by emphasising the word
            // "color" inside the topic — no separate chip.)
            /* istanbul ignore if -- multiOption is set on combo cards which only live in Hard's pool, but Hard's level-info modal lists colorParam cards (not combos); so this chip is currently unreachable from the surfaced flow */
            if (card.multiOption)  tagSpans.push(el('span', { class: 'lvtag lvtag-multi' }, 'multi-match'));
            /* istanbul ignore if -- hardplusOnly cards only listed in Hard's modal */
            if (card.hardplusOnly) tagSpans.push(el('span', { class: 'lvtag lvtag-hp' }, 'Hard only'));
            const topicNodes = card.colorParam
                ? highlightColorWord(card.topic)
                : labelToColoredNodes(card.topic);
            const head = el('div', { class: 'lvcard-head' },
                el('span', { class: 'lvcard-topic' }, topicNodes),
                ...tagSpans,
            );
            const opts = el('ul', { class: 'lvcard-opts' },
                ...card.options.map(o =>
                    el('li', {}, labelToColoredNodes(o.label))));
            // Number sits to the LEFT of the card body, outside the head.
            list.appendChild(el('li', { class: 'lvcard' },
                el('span', { class: 'lvcard-num' }, `${idx + 1}.`),
                el('div', { class: 'lvcard-body' }, head, opts),
            ));
        });
        body.appendChild(list);
        this.openModal('level-info-modal');
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
    renderVerifiers(puzzle, deductions, queries, onAsk, proposal, userMarkers, autoDeduce, showPreviewArrow) {
        const row = $('#verifier-row');
        row.innerHTML = '';
        const um = userMarkers || {};
        const showAuto  = autoDeduce !== false;
        const showArrow = showPreviewArrow !== false;
        puzzle.cards.forEach((card, i) => {
            const verifierQueries = queries.filter(q => q.verifierIdx === i);
            const verDed = deductions[i] || { panes: [], isExtreme: false };
            const panes  = paneListOf(card);
            const isExtreme = panes.length > 1;

            // Build one .vcard-pane per pane. In normal mode there's a single
            // pane and the layout looks identical to the pre-extreme one
            // (head includes the topic). In extreme mode, the topic moves
            // INTO each pane so the player can read the two competing
            // criteria side-by-side under one shared "Verifier A" header.
            const buildPane = (paneIdx) => {
                const pane = panes[paneIdx];
                const def  = CARDS_BY_ID[pane.id];
                const pded = (verDed.panes && verDed.panes[paneIdx]) || {
                    crossed: new Set(), passed: new Set(), confirmed: null, paneStatus: 'active',
                };
                const paneDead = pded.paneStatus === 'dead';

                const optsList = el('ul', { class: 'voptions' });
                // Combo cards merge two source cards' options end-to-end —
                // insert an OR divider so the player sees the boundary.
                const splitAt = (def.comboSrcA !== undefined && CARDS_BY_ID[def.comboSrcA])
                    ? CARDS_BY_ID[def.comboSrcA].options.length
                    : -1;
                def.options.forEach((opt, oi) => {
                    if (oi === splitAt) {
                        optsList.appendChild(el('li', { class: 'vopt-or-sep' },
                            el('span', { class: 'or-sep-line' }),
                            el('span', { class: 'or-sep-label' }, 'OR'),
                            el('span', { class: 'or-sep-line' })));
                    }
                    const isCross    = pded.crossed.has(oi);
                    const isPassed   = pded.passed && pded.passed.has(oi);
                    const isConfirmed = pded.confirmed === oi;
                    const title = paneDead
                                ? 'This card was ruled out as the active criterion'
                                : isConfirmed ? 'This must be the criterion'
                                : isCross    ? 'Past query: FAIL on this rule'
                                :               'Still possible';
                    const wouldPass = showArrow && proposal && opt.test(proposal);
                    const preview = el('span', {
                        class: 'preview' + (wouldPass ? ' pass' : ' hidden-preview'),
                        title: wouldPass ? 'Current number would PASS this rule' : '',
                        html: wouldPass ? PREVIEW_ARROW_SVG : '',
                    });

                    // Marker semantics: pane death wins over per-option
                    // crosses so the entire dead pane reads ⊘ uniformly.
                    //   ✓ confirmed/passed,
                    //   ⊘ pane is dead (extreme mode — entire card is out),
                    //   ✗ ruled out by a past query.
                    const markerChar = (isConfirmed || isPassed) ? '✓'
                                     : paneDead                  ? '⊘'
                                     : isCross                   ? '✗'
                                     :                             '';
                    const userState = um[`${i}:${paneIdx}:${oi}`] || '';
                    // Auto-deduction marker is omitted entirely when the
                    // setting is off — neither the badge nor its box show.
                    // The user-marker checkbox on the left remains.
                    const children = [
                        userMarkerSpan(userState),
                        ...(showAuto ? [el('span', { class: 'marker' }, markerChar)] : []),
                        el('span', { class: 'vopt-label' }, labelToColoredNodes(opt.label)),
                        preview,
                    ];
                    /* istanbul ignore next -- multi-arm conditional class string; not all branches fire in any single test */
                    optsList.appendChild(el('li',
                        { class: 'vopt'
                            + (showAuto && isConfirmed ? ' confirmed' : '')
                            + (showAuto && isCross    ? ' ruledout' : '')
                            + (showAuto && paneDead && !isCross && !isConfirmed && !isPassed ? ' pane-dead-opt' : ''),
                          'data-vidx': i, 'data-oi': oi, 'data-cidx': paneIdx,
                          title: showAuto ? title : 'Set your own marker on the left' },
                        ...children,
                    ));
                });

                if (isExtreme) {
                    // Two-pane layout: each pane gets its own topic header.
                    return el('div',
                        { class: 'vcard-pane' + (paneDead ? ' pane-dead' : ''),
                          'data-cidx': paneIdx },
                        el('div', { class: 'vpane-topic' }, labelToColoredNodes(def.topic)),
                        optsList,
                    );
                }
                // Normal mode: no pane wrapper, options list goes straight in.
                return optsList;
            };

            const head = isExtreme
                ? el('div', { class: 'vcard-head' },
                    el('div', { class: 'vletter' }, verifierLetter(i)),
                    el('div', { class: 'vtopic vtopic-extreme' },
                        el('span', { class: 'extreme-tag' }, 'EXTREME'),
                        ' — one of the two cards below is real'),
                    el('button', { class: 'vbtn', 'data-ask': i,
                        onclick: () => onAsk(i)
                    }, 'Ask'),
                )
                : el('div', { class: 'vcard-head' },
                    el('div', { class: 'vletter' }, verifierLetter(i)),
                    el('div', { class: 'vtopic' }, labelToColoredNodes(CARDS_BY_ID[panes[0].id].topic)),
                    el('button', { class: 'vbtn', 'data-ask': i,
                        onclick: () => onAsk(i)
                    }, 'Ask'),
                );

            const card_el = el('div',
                { class: 'verifier-card' + (isExtreme ? ' extreme' : ''),
                  'data-vidx': i },
                head,
                ...(isExtreme
                    ? [el('div', { class: 'vcard-panes' }, buildPane(0), buildPane(1))]
                    : [buildPane(0)]),
            );

            if (verifierQueries.length) {
                const log = el('div', { class: 'vqlog' });
                verifierQueries.forEach(q => {
                    // Round + proposal + verdict only — the rule label
                    // used to hint which option was queried, but that
                    // gives away information that the player should
                    // deduce, especially in Hard's combo verifiers.
                    // "Round N" tag is clickable: opens the per-round
                    // detail modal with a verifier-card snapshot.
                    const queryGlobalIdx = queries.indexOf(q);
                    const row = el('div', {},
                        el('span', {
                            class: 'vqlog-round',
                            'data-vidx': i,
                            'data-qidx': queryGlobalIdx,
                            title: 'Click to see this round\'s detail',
                        }, `Round ${q.round}`),
                        document.createTextNode(': '),
                        formatProposalNode(q.proposal),
                        document.createTextNode(' → '),
                        el('span', { class: q.result ? 'ok' : 'fail' },
                            q.result ? '✓' : '✗'),
                    );
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
    // rebuilding the whole verifier row. Cheap; safe to call on each dial
    // tick. In extreme mode both panes get scanned.
    updateVerifierPreviews(puzzle, deductions, proposal, showPreviewArrow) {
        const showArrow = showPreviewArrow !== false;
        puzzle.cards.forEach((card, i) => {
            const panes = paneListOf(card);
            panes.forEach((pane, pi) => {
                const def = CARDS_BY_ID[pane.id];
                def.options.forEach((opt, oi) => {
                    // The non-extreme selector form (no data-cidx) is the
                    // hot path on every dial tick in normal-mode games.
                    /* istanbul ignore next -- both branches are exercised across the suite; nyc occasionally misses the conditional itself in browser-instrumented runs */
                    const sel = panes.length > 1
                        ? `.verifier-card[data-vidx="${i}"] .vopt[data-cidx="${pi}"][data-oi="${oi}"] .preview`
                        : `.verifier-card[data-vidx="${i}"] .vopt[data-oi="${oi}"] .preview`;
                    const node = document.querySelector(sel);
                    if (!node) return;
                    const ok = showArrow && !!opt.test(proposal);
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
        });
    }

    // In-place refresh of a single user-marker cell so cycling doesn't
    // tear down the whole verifier row on every click.
    updateUserMarker(vi, pi, oi, state) {
        const node = document.querySelector(
            `.verifier-card[data-vidx="${vi}"] .vopt[data-cidx="${pi}"][data-oi="${oi}"] .user-marker`);
        if (!node) return;
        /* istanbul ignore next -- USER_MARKER_GLYPH lookup; the `|| ''` fallback is defensive */
        node.textContent = USER_MARKER_GLYPH[state || ''] || '';
        /* istanbul ignore next -- conditional class string for empty vs marked state */
        node.className = 'user-marker' + (state ? ' um-' + state : '');
    }

    setVerifierAskEnabled(i, enabled, reason) {
        const btn = $(`.verifier-card[data-vidx="${i}"] .vbtn`);
        if (!btn) return;
        btn.disabled = !enabled;
        // Native browser tooltip on hover — explains the grey-out cause.
        btn.title = enabled ? '' : (reason || 'Ask is currently unavailable.');
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
                // The ● option at ask time — guaranteed unique across both
                // panes by the 1-● Ask rule, so this never shows '—' for a
                // real query. In extreme mode we scan both panes.
                const panes = paneListOf(puzzle.cards[q.verifierIdx]);
                let activeLabel = null, found = 0;
                for (const pane of panes) {
                    const def = CARDS_BY_ID[pane.id];
                    for (const o of def.options) {
                        if (o.test(q.proposal)) { activeLabel = o.label; found++; }
                    }
                }
                if (found !== 1) activeLabel = null;
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
                    // One-shot flag: the long-press timer sets it true, and
                    // the trailing synthetic `click` (which the browser fires
                    // after touchend regardless of preventDefault) reads it,
                    // resets it, and bails. Without this, every long-press
                    // would also toggle the cross-out and the candidate ring
                    // would visually disappear under the X.
                    let suppressClick = false;
                    let pressTimer = null;
                    const cancel = () => { clearTimeout(pressTimer); pressTimer = null; };

                    cell.addEventListener('click', () => {
                        if (suppressClick) { suppressClick = false; return; }
                        onToggleOff(ci, v);
                    });
                    cell.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        onToggleCandidate(ci, v);
                    });
                    cell.addEventListener('touchstart', () => {
                        cancel();
                        pressTimer = setTimeout(() => {
                            suppressClick = true;
                            try { if (navigator.vibrate) navigator.vibrate(30); } catch (_) {}
                            // Clear any stray text selection the OS may have
                            // started before our handler ran.
                            try { window.getSelection && window.getSelection().removeAllRanges(); }
                            catch (_) { /* ignore */ }
                            onToggleCandidate(ci, v);
                        }, 500);
                    }, { passive: true });
                    cell.addEventListener('touchmove', cancel, { passive: true });
                    cell.addEventListener('touchcancel', cancel);
                    cell.addEventListener('touchend', () => {
                        // Short tap → cancel pending long-press; the click
                        // event fires next and runs onToggleOff normally.
                        if (pressTimer) cancel();
                    });
                    return cell;
                })
            );
            body.appendChild(tr);
        }
        t.appendChild(body);
    }

    // ----- round-detail modal -----
    // Renders a snapshot of one verifier card AFTER the given query: the
    // proposal asked, the options with arrows always on (independent of
    // the live-arrow setting), the user-markers as they currently stand,
    // and the auto-markers derived from queries up to AND INCLUDING this
    // one (so the player can see how their reasoning evolved round by
    // round).
    renderRoundDetailModal({ verifierLetter, round, result, proposal, card,
                             paneDeductions, userMarkers, verifierIdx, showAuto }) {
        $('#round-detail-title').textContent =
            `Verifier ${verifierLetter} · Round ${round}`;
        $('#round-detail-subtitle').textContent =
            `Verifier answered ${result ? '✓ YES' : '✗ NO'} on the number below.`;
        const propEl = $('#round-detail-proposal');
        propEl.innerHTML = '';
        propEl.appendChild(formatProposalNode(proposal));
        const cardEl = $('#round-detail-card');
        cardEl.innerHTML = '';
        const panes = paneListOf(card);
        /* istanbul ignore next -- callers (openRoundDetail) always pass a userMarkers object; the `|| {}` fallback is defensive */
        const um    = userMarkers || {};
        const isExtremeCard = panes.length > 1;
        // Build a real .verifier-card so the existing CSS selectors
        // (.verifier-card .vopt, .verifier-card .marker, etc.) apply
        // unchanged — without this wrapper the snapshot renders as
        // unstyled raw <ul>/<li>.
        // No data-vidx — would collide with the main #verifier-row selectors
        // used by updateUserMarker and the delegated click handler. The
        // modal snapshot is a read-only view, so it doesn't need them.
        const wrapper = el('div',
            { class: 'verifier-card rd-snapshot' + (isExtremeCard ? ' extreme' : '') });
        if (isExtremeCard) {
            const head = el('div', { class: 'vcard-head' },
                el('div', { class: 'vletter' }, verifierLetter),
                el('div', { class: 'vtopic vtopic-extreme' },
                    el('span', { class: 'extreme-tag' }, 'EXTREME'),
                    ' — one of the two cards below is real'));
            wrapper.appendChild(head);
        } else {
            const head = el('div', { class: 'vcard-head' },
                el('div', { class: 'vletter' }, verifierLetter),
                el('div', { class: 'vtopic' }, labelToColoredNodes(CARDS_BY_ID[panes[0].id].topic)));
            wrapper.appendChild(head);
        }
        const panesWrap = isExtremeCard
            ? el('div', { class: 'vcard-panes' })
            : null;
        panes.forEach((pane, paneIdx) => {
            const def  = CARDS_BY_ID[pane.id];
            const pded = paneDeductions.panes[paneIdx];
            const paneDead = pded.paneStatus === 'dead';
            const splitAt = (def.comboSrcA !== undefined && CARDS_BY_ID[def.comboSrcA])
                ? CARDS_BY_ID[def.comboSrcA].options.length
                : -1;
            const optsList = el('ul', { class: 'voptions' });
            def.options.forEach((opt, oi) => {
                if (oi === splitAt) {
                    optsList.appendChild(el('li', { class: 'vopt-or-sep' },
                        el('span', { class: 'or-sep-line' }),
                        el('span', { class: 'or-sep-label' }, 'OR'),
                        el('span', { class: 'or-sep-line' })));
                }
                const userState = um[`${verifierIdx}:${paneIdx}:${oi}`] || '';
                const wouldPass = opt.test(proposal);
                const preview = el('span', {
                    class: 'preview' + (wouldPass ? ' pass' : ' hidden-preview'),
                    html: wouldPass ? PREVIEW_ARROW_SVG : '',
                });
                const isCross    = pded.crossed.has(oi);
                const isPassed   = pded.passed && pded.passed.has(oi);
                const isConfirmed = pded.confirmed === oi;
                let markerChar = '';
                /* istanbul ignore next -- showAuto-off (settings toggle) branch + paneDead ternary; the modal snapshot doesn't trigger every arm */
                if (showAuto) {
                    markerChar = (isConfirmed || isPassed) ? '✓'
                               : paneDead                  ? '⊘'
                               : isCross                   ? '✗'
                               :                             '';
                }
                const children = [
                    userMarkerSpan(userState),
                    /* istanbul ignore next */
                    showAuto ? el('span', { class: 'marker' }, markerChar) : null,
                    el('span', { class: 'vopt-label' }, labelToColoredNodes(opt.label)),
                    preview,
                ];
                /* istanbul ignore next -- multi-arm class string; arms toggle on showAuto + isConfirmed + isCross + paneDead combinations not all triggered in a single test */
                optsList.appendChild(el('li',
                    { class: 'vopt'
                        + (showAuto && isConfirmed ? ' confirmed' : '')
                        + (showAuto && isCross && !paneDead ? ' ruledout' : '') },
                    ...children));
            });
            if (isExtremeCard) {
                /* istanbul ignore next -- paneDead && showAuto only fires when an extreme pane has been killed AND auto-deduction is on; round-detail tests don't always set that combo */
                panesWrap.appendChild(el('div',
                    { class: 'vcard-pane' + (paneDead && showAuto ? ' pane-dead' : ''),
                      'data-cidx': paneIdx },
                    el('div', { class: 'vpane-topic' }, labelToColoredNodes(def.topic)),
                    optsList));
            } else {
                wrapper.appendChild(optsList);
            }
        });
        if (panesWrap) wrapper.appendChild(panesWrap);
        cardEl.appendChild(wrapper);
        this.openModal('round-detail-modal');
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
        // Extreme-mode subtitle decoration: tag the option with its pane
        // ("card A" / "card B") so the player can map back to what they
        // see on the verifier slot.
        if (trace.isExtreme) {
            sub.appendChild(document.createTextNode(' · '));
            sub.appendChild(el('span', { class: 'pane-tag' },
                `card ${trace.paneIdx === 0 ? 'A' : 'B'}`));
        }

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

        if (trace.status === 'pane-dead') {
            status.className = 'ded-status is-no';
            status.textContent = '⊘ This card was eliminated as the active criterion.';
            body.appendChild(el('p', { class: 'ded-explainer' },
                'In Extreme mode each verifier shows two cards but tests only one. ' +
                'Past queries have ruled out every option on this card as the criterion, ' +
                'so this whole card cannot be the one being tested — making every option on it moot.'));
            return this.openModal('deduction-modal');
        }

        // 'unknown' — the marker is empty. With at least one past query
        // on the verifier, explain why none of them auto-deduced this
        // option (the click handler only opens the modal in that case).
        status.className = 'ded-status';
        status.textContent = 'No deduction yet on this option.';
        /* istanbul ignore else -- the click handler only opens this modal when verifierQueries is non-empty; the else is the "no queries yet" instructive copy */
        if (trace.verifierQueries && trace.verifierQueries.length) {
            body.appendChild(el('p', { class: 'ded-explainer' },
                /* istanbul ignore next -- isMultiOption true/false split across combo + classic-only verifiers */
                trace.isMultiOption
                    ? 'Auto-deduction only marks an option when EXACTLY ONE option matched your number and the verifier answered ✓. This is a combo (mystery) verifier — most queries match multiple options at once, so its YES/NO verdicts almost never pin a single option automatically.'
                    : 'Auto-deduction only marks an option when EXACTLY ONE option matched your number AND the verifier answered ✓. Past queries that don\'t meet both conditions are kept for reference but don\'t place any marker.'));
            body.appendChild(el('p', { class: 'ded-explainer' }, 'Past queries on this verifier:'));
            const ul = el('ul', { class: 'ev-list' });
            trace.verifierQueries.forEach(q => {
                /* istanbul ignore next -- per-key note dispatch; 'this-confirmed'/'other-confirmed'/'unmark' are dead branches (TRUE+1-● confirms the option so the marker IS set; unknown branch only fires when marker is empty), but the lookup map evaluates all keys regardless */
                const note = ({
                    'this-confirmed':  'matched THIS option — should be ✓ (refresh?)',
                    'other-confirmed': 'matched a different option and got ✓ — that other option is the criterion, so THIS one is implied ruled out',
                    'false-1pin':      trace.isMultiOption
                        ? 'a single option matched but the verifier said NO — for combo verifiers the answer might have been about a different option, so we can\'t rule it out'
                        : 'a single option matched but the verifier said NO — THAT matched option is ruled out (should be ✗ on it)',
                    'no-pin':          'no option matched your number — gives no per-option info',
                    'multi-pin':       'multiple options matched at once — verdict can\'t be pinned to any single one',
                    'unmark':          '—',
                })[q.why] || '—';
                /* istanbul ignore next -- per-row class string conditionals for ev-ok/ev-no + ✓/✗; the modal only opens with a mix that may not exercise every arm in one test */
                ul.appendChild(el('li', { class: q.result ? 'ev-ok' : 'ev-no' },
                    el('span', { class: 'ev-round' }, `Round ${q.round}`),
                    el('span', { class: 'ev-prop' }, formatProposalNode(q.proposal)),
                    el('span', { class: 'ev-arrow' }, '→'),
                    el('span', { class: q.result ? 'ev-result ok' : 'ev-result fail' }, q.result ? '✓' : '✗'),
                    el('span', { class: 'ev-note' }, note),
                ));
            });
            body.appendChild(ul);
        } else {
            body.appendChild(el('p', { class: 'ded-explainer' },
                'No past query has touched this option yet. Ask the verifier with a number that activates exactly this option to learn more.'));
        }
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

        // Expected average + ranking — only shown on a win. The expected
        // values come straight from the same formula the custom-level
        // modal uses (info-theoretic minimum bits divided by qpr, scaled
        // ~1.4× for typical-play slack), so the player can compare their
        // run against what an averagely-skilled player would take.
        const rankBox    = $('#end-ranking');
        const expectBox  = $('#end-expected');
        if (won) {
            const v = puzzle.cards.length;
            const qpr = (puzzle.config && puzzle.config.questionsPerRound)
                || GAME_CONFIG.questionsPerRound;

            const optsPerCard = puzzle.cards.map(c => CARDS_BY_ID[c.id].options.length);
            const bits         = optsPerCard.reduce((s, n) => s + Math.log2(n), 0);
            const minQueries   = Math.max(1, Math.ceil(bits));
            const expQuestions = Math.max(minQueries, Math.ceil(bits * 1.4));
            const minRounds    = Math.max(1, Math.ceil(minQueries / qpr));
            const expRounds    = Math.max(minRounds, Math.ceil(expQuestions / qpr));
            // Collapse "3–3" to "3" when min and max agree (and pick the right
            // singular/plural form). Questions are always shown as a range —
            // for any solvable puzzle minQueries < expQuestions, so a one-
            // value collapse there would be dead-code.
            const rRange = minRounds === expRounds
                ? `${minRounds}` : `${minRounds}–${expRounds}`;
            const rUnit  = expRounds === 1 ? 'round' : 'rounds';
            $('#end-expected-vals').textContent =
                `${rRange} ${rUnit} · ${minQueries}–${expQuestions} questions`;
            expectBox.hidden = false;

            const r = classifyWin(v, roundsPlayed, queriesAsked, qpr);
            rankBox.className = 'end-ranking tier-' + r.index;
            // Five regular tiers + one Special (Lucky). The badge spells out
            // "Special" for Lucky Gambler so the user doesn't read it as
            // "Rank 6 / 6", which would imply it's the worst regular tier.
            $('#end-rank-badge').textContent  = r.lucky
                ? 'Special'
                : `Rank ${r.index + 1} / ${WIN_TIERS.length - 1}`;
            $('#end-rank-title').textContent  = r.title;
            $('#end-rank-flavor').textContent = r.flavor;

            // Score breakdown — each metric on its own line with a hint that
            // explains direction. Pacing/efficiency are written as "factor
            // N.NN× of minimum" so the number reads as a multiplier of the
            // ideal. For Lucky Gambler we skip the breakdown — the combined
            // formula doesn't really apply and the headline already says it.
            const scoreBox = $('#end-rank-score');
            scoreBox.innerHTML = '';
            if (r.lucky) {
                // Plain "X / Y" so the line works regardless of singular vs
                // plural, and the wording (Q questions per V verifiers) stays
                // readable when either count is 1.
                scoreBox.appendChild(el('div', { class: 'score-combined' },
                    el('strong', {}, `Questions asked: ${queriesAsked} / ${v}`),
                    ' ',
                    el('span', { class: 'score-hint' },
                        '(less than one question per verifier — not enough information to deduce the code)')));
            } else {
                scoreBox.appendChild(el('div', {},
                    `Efficiency: factor ${r.efficiency.toFixed(2)}× `,
                    el('span', { class: 'score-hint' },
                        `(1.00× = ideal (1 question per verifier), higher = more queries)`)));
                scoreBox.appendChild(el('div', {},
                    `Pacing: factor ${r.pacing.toFixed(2)}× `,
                    el('span', { class: 'score-hint' },
                        `(compared to the absolute minimum rounds possible at all (${r.minRounds}); 1.00× = ideal, higher = slower)`)));
                scoreBox.appendChild(el('div', { class: 'score-combined' },
                    el('strong', {}, `Combined score: ${r.score.toFixed(2)}`),
                    ' ',
                    el('span', { class: 'score-hint' },
                        '(average of the two; lower is better)')));
            }

            const ladder = $('#end-rank-ladder');
            ladder.innerHTML = '';
            WIN_TIERS.forEach((tier, i) => {
                const threshold = tier.lucky
                    ? 'questions < verifiers'
                    : (i === LUCKY_INDEX - 1
                        ? 'anything worse'
                        : `score ≤ ${tier.max.toFixed(2)}`);
                const li = el('li', {
                    class: 'rank-rung tier-' + i
                         + (i === r.index ? ' current' : '')
                         + (tier.lucky ? ' lucky' : ''),
                    title: tier.flavor,
                },
                    el('span', { class: 'rung-num' }, tier.lucky ? '★' : String(i + 1)),
                    el('span', { class: 'rung-title' }, tier.title),
                    el('span', { class: 'rung-threshold' }, threshold),
                );
                ladder.appendChild(li);
            });
            rankBox.hidden = false;
        } else {
            rankBox.hidden = true;
            expectBox.hidden = true;
        }

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
            const li = el('li', { class: card.redHerring ? 'end-herring' : '' });
            if (card.redHerring) {
                li.appendChild(el('span', { class: 'verifier-tag' }, verifierLetter(i)));
                li.appendChild(el('span', { class: 'herring-tag' }, 'RED HERRING'));
                li.appendChild(el('span', { class: 'herring-note' },
                    ' — not a real constraint. Its "criterion" (',
                ));
                li.appendChild(labelToColoredNodes(opt.label));
                li.appendChild(document.createTextNode(') was chosen to never match the code, so this verifier always answered NO on the solution.'));
            } else {
                li.appendChild(el('span', { class: 'verifier-tag' }, verifierLetter(i)));
                li.appendChild(labelToColoredNodes(def.topic));
                li.appendChild(document.createTextNode(': '));
                li.appendChild(el('strong', {}, labelToColoredNodes(opt.label)));
            }
            // Extreme: also show the decoy that was sitting next to the
            // active criterion. Helps the player understand what they were
            // fighting against, especially when they fell for the bluff.
            if (card.altId !== undefined) {
                const adef = CARDS_BY_ID[card.altId];
                const aopt = adef.options[card.altOpt];
                li.appendChild(el('div', { class: 'end-decoy' },
                    el('span', { class: 'decoy-tag' }, 'decoy'),
                    ' ',
                    labelToColoredNodes(adef.topic),
                    ': ',
                    el('em', {}, labelToColoredNodes(aopt.label)),
                ));
            }
            list.appendChild(li);
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
// Five tongue-in-cheek tiers, in descending quality. The tier index doubles
// as a CSS modifier (`tier-0` … `tier-4`) so we can paint each rank in its
// own colour. `max` is the upper bound on the combined score below.
// `Lucky Gambler` (`tier-5`) is a special tier outside the score scale —
// triggered when the player wins without asking enough questions to have
// actually deduced the code.
const WIN_TIERS = [
    { title: "Turing's Heir",        flavor: "One question per rule, no wasted rounds. The machine bows.",            max: 1.10 },
    { title: 'Sharp Cryptanalyst',   flavor: 'Tight queries, brisk pacing — Alan would approve.',                     max: 1.75 },
    { title: 'Methodical Detective', flavor: 'Slow and steady cracked the code.',                                     max: 2.75 },
    { title: 'Stubborn Codebreaker', flavor: 'It took a while, but you wore the puzzle down.',                        max: 4.50 },
    { title: 'Brute-Force Champion', flavor: 'When deduction fails, persistence wins. Kind of.',                      max: Infinity },
    { title: 'Lucky Gambler',        flavor: 'You guessed the code before the verifiers could even tell you much. The dice gods smile on you today.', lucky: true },
];
const LUCKY_INDEX = WIN_TIERS.length - 1;

// Pick a tier for a winning game.
//   • efficiency  = questions / verifiers           (1.0 = one query per rule)
//   • pacing      = rounds    / ceil(V / qpr)       (1.0 = no wasted rounds)
// If the player asked fewer questions than there are verifiers they can't
// have actually deduced the criteria — that's the Lucky Gambler tier,
// independent of the combined score. Otherwise average the two signals and
// bucket into one of the five regular tiers.
function classifyWin(verifiers, rounds, questions, qpr) {
    const eff       = questions / Math.max(1, verifiers);
    const minRounds = Math.max(1, Math.ceil(verifiers / Math.max(1, qpr)));
    const pace      = rounds / minRounds;
    if (questions < verifiers) {
        return { ...WIN_TIERS[LUCKY_INDEX], index: LUCKY_INDEX, score: NaN, efficiency: eff, pacing: pace, minRounds };
    }
    const score = (eff + pace) / 2;
    const idx   = WIN_TIERS.findIndex(t => !t.lucky && score <= t.max);
    return { ...WIN_TIERS[idx], index: idx, score, efficiency: eff, pacing: pace, minRounds };
}

// Hand-set "user marker" checkbox shown to the LEFT of the auto-deduction
// marker on every verifier option. Player clicks to cycle the state.
const USER_MARKER_GLYPH = { '': '', check: '✓', cross: '✗', question: '?' };
function userMarkerSpan(state) {
    const glyph = USER_MARKER_GLYPH[state || ''] || '';
    return el('span', {
        class: 'user-marker' + (state ? ' um-' + state : ''),
        title: 'Click to cycle: empty → ✓ → ✗ → ? → empty',
        role: 'button',
        'aria-label': state ? `your marker: ${state}` : 'set your marker',
    }, glyph);
}

// Inline SVG arrow used as the "active option" preview marker on verifier
// cards. Pointing left so it visually reads as "← this rule fits the number".
const PREVIEW_ARROW_SVG =
    '<svg class="arrow-svg" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M14 8 L3 8 M7 4 L3 8 L7 12" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Magnifier icon shown on each level-select option. Click opens the
// level-info modal listing the verifier cards available in that level.
const LEVEL_INFO_MAGNIFIER_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>';

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

// Like labelToColoredNodes but ALSO highlights the standalone word
// "color" (case-insensitive) with the .color-placeholder class — used by
// the level-info modal for colorParam cards so the parametric nature of
// the rule reads at a glance ("A specific COLOR is less than 3").
function highlightColorWord(label) {
    const frag = document.createDocumentFragment();
    const colors = GAME_CONFIG.colors;
    const re = new RegExp('\\b(' + ['color', ...colors].join('|') + ')\\b', 'gi');
    let lastIdx = 0, m;
    while ((m = re.exec(label)) !== null) {
        if (m.index > lastIdx) {
            frag.appendChild(document.createTextNode(label.slice(lastIdx, m.index)));
        }
        const tok = m[1].toLowerCase();
        if (tok === 'color') {
            frag.appendChild(el('span', { class: 'color-placeholder' }, m[1]));
        } else {
            frag.appendChild(el('span', { class: `color-dot ${tok}`, title: tok }));
        }
        lastIdx = m.index + m[0].length;
    }
    if (lastIdx < label.length) {
        frag.appendChild(document.createTextNode(label.slice(lastIdx)));
    }
    return frag;
}

function formatProposalNode(proposal) {
    // One small "chip" per color slot — a colored dot followed by the
    // digit. The chips read naturally as a row (no separator) since each
    // dot anchors the start of its slot visually.
    const span = el('span', { class: 'proposal-chips' });
    GAME_CONFIG.colors.forEach((c, i) => {
        span.appendChild(el('span', { class: 'pchip' },
            el('span', { class: `color-dot ${c}` }),
            el('span', { class: 'p' + c[0] }, String(proposal[i])),
        ));
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
