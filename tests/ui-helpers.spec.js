import { test, expect } from './coverage-fixture.js';

// Free helpers in ui.js: el factory, labelToColoredNodes, formatProposalNode,
// autosize, copyText, webShareSupported, webShare, plus the toast lifecycle.

test('el() factory: attribute kinds (class, html, on*, true/false/null/undefined) and null children', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const n = el('div',
            { class: 'x', html: '<b>raw</b>', onclick: () => {}, 'data-x': false, 'data-y': null, 'data-z': undefined, boolish: true, plain: 'v' },
            null, undefined, 'text', el('span', {}, 'child'),
        );
        if (n.className !== 'x') throw new Error('class');
        if (!n.querySelector('b')) throw new Error('html');
        if (!n.hasAttribute('boolish')) throw new Error('boolish');
        if (n.hasAttribute('data-y')) throw new Error('null-attr');
    });
});

test('labelToColoredNodes: with matches, empty colors, no matches', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const f1 = labelToColoredNodes('blue greater than yellow');
        if (!f1.querySelector('.color-dot.blue'))  throw new Error('no blue dot');
        const saved = GAME_CONFIG.colors.slice();
        GAME_CONFIG.colors = [];
        const f2 = labelToColoredNodes('plain');
        if (f2.querySelector('.color-dot'))        throw new Error('unexpected dot');
        GAME_CONFIG.colors = saved;
        labelToColoredNodes('text with no color name');
    });
});

test('formatProposalNode + autosize coverage', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => {
        const n = formatProposalNode([1, 2, 3]);
        if (!n.querySelectorAll('span').length) throw new Error('no children');
        autosize();
    });
});

test('toast: shows then auto-hides after the 1800+250 ms timer chain', async ({ page }) => {
    await page.goto('');
    await page.evaluate(() => new UI().toast('hi'));
    await page.waitForFunction(() => document.getElementById('toast').hidden, null, { timeout: 4000 });
});

test('copyText: success + clipboard-failure + no-ui branches', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async (t) => { if (t === 'FAIL') throw new Error(); } },
        });
    });
    await page.goto('');
    await page.evaluate(async () => {
        const ui = { toast: () => {} };
        await copyText('ok', ui);   // success + with-ui
        await copyText('FAIL', ui); // failure + with-ui
        await copyText('ok');       // success + no-ui
        await copyText('FAIL');     // failure + no-ui
    });
});

test('webShareSupported + webShare: success, AbortError, generic, no-ui, no-support', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: async (opts) => {
                if (opts.text === 'ABORT') { const e = new Error(); e.name = 'AbortError'; throw e; }
                if (opts.text === 'BOOM')  throw new Error('boom');
            },
        });
    });
    await page.goto('');
    await page.evaluate(async () => {
        if (!webShareSupported()) throw new Error('expected support');
        await webShare({ title: 't', text: 'ok',    url: 'u' });             // success path, no ui
        await webShare({ title: 't', text: 'ABORT', url: 'u' });             // AbortError → silent
        await webShare({ title: 't', text: 'BOOM',  url: 'u' }, { toast: () => {} }); // generic + ui
        await webShare({ title: 't', text: 'BOOM',  url: 'u' });             // generic + no-ui
        // Flip support off → early-return.
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        if (webShareSupported()) throw new Error('expected no support');
        await webShare({ title: 't', text: 'x', url: 'u' });
    });
});
