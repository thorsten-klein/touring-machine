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
    }

    showScreen(name) {
        for (const [n, node] of Object.entries(this.screens)) {
            node.classList.toggle('hidden', n !== name);
        }
        // Topbar buttons relevance
        $('#btn-back').hidden  = (name === 'main');
        $('#btn-share').hidden = (name !== 'game' && name !== 'end');
    }

    openModal(id)  { $('#' + id).classList.remove('hidden'); }
    closeModal(id) { $('#' + id).classList.add('hidden'); }

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
                const ded = deductions[i] || { crossed: new Set(), confirmed: null };
                const isCross = ded.crossed.has(oi);
                const isConfirmed = ded.confirmed === oi;
                const title = isConfirmed ? 'This must be the criterion'
                            : isCross    ? 'Ruled out by your previous queries'
                            :              'Still possible';
                // Live preview against the current proposal — only shown for
                // options not yet eliminated/confirmed. Updated in place by
                // updateVerifierPreviews() whenever the proposal changes.
                // Only show the ● when the current number activates the
                // option. Non-active options just show nothing — less visual
                // noise and matches the user's "active = ●" mental model.
                const wouldPass = proposal && !isCross && !isConfirmed
                    ? !!opt.test(proposal) : false;
                const preview = el('span', {
                    class: 'preview' + (wouldPass ? ' pass' : ' hidden-preview'),
                    title: wouldPass ? 'Current number would PASS this rule' : '',
                }, wouldPass ? '◀' : '');

                const li = el('li',
                    { class: 'vopt' + (isCross ? ' crossed' : '') + (isConfirmed ? ' confirmed' : ''),
                      'data-vidx': i, 'data-oi': oi,
                      title },
                    el('span', { class: 'marker' }, isCross ? '✗' : isConfirmed ? '✓' : ''),
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
    }

    // Recompute the live preview marker on every verifier option without
    // rebuilding the whole verifier row. Cheap; safe to call on each dial tick.
    updateVerifierPreviews(puzzle, deductions, proposal) {
        puzzle.cards.forEach((card, i) => {
            const def = CARDS_BY_ID[card.id];
            const ded = deductions[i] || { crossed: new Set(), confirmed: null };
            def.options.forEach((opt, oi) => {
                const node = document.querySelector(
                    `.verifier-card[data-vidx="${i}"] .vopt[data-oi="${oi}"] .preview`);
                if (!node) return;
                const live = !ded.crossed.has(oi) && ded.confirmed !== oi;
                const ok = live && !!opt.test(proposal);
                if (ok) {
                    node.className = 'preview pass';
                    node.textContent = '◀';
                    node.title = 'Current number would PASS this rule';
                } else {
                    node.className = 'preview hidden-preview';
                    node.textContent = '';
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
    // slot. Cells are toggle buttons; the click callback gets (colorIdx, digit).
    renderDigitMap(disabledDigits, onToggle) {
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
                    const off = disabledDigits[ci].has(v);
                    return el('td', {
                        class: 'dm-cell' + (off ? ' off' : ''),
                        'data-ci': ci, 'data-d': v,
                        title: off ? 'Click to bring back' : 'Click to cross out',
                        onclick: () => onToggle(ci, v),
                    }, String(v));
                })
            );
            body.appendChild(tr);
        }
        t.appendChild(body);
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
