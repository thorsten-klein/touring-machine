'use strict';

// Entry point: build UI + Game, render the menu, then handle ?game-id=… deep
// links (analogous to orapa's shared-game flow).

document.addEventListener('DOMContentLoaded', () => {
    const ui   = new UI();
    const game = new Game(ui);
    window.game = game;

    // Standard levels above the "Others" separator; Custom + Create-game
    // sit below. Legacy LEVELS aliases (EASY/MEDIUM/HARDPLUS) are not
    // included — they exist only for backwards-compat with old game IDs.
    const items = [
        LEVELS.CLASSIC,
        LEVELS.HARD,
        LEVELS.EXTREME,
        { separator: 'Others' },
        LEVELS.CUSTOM,
        LEVELS.MYCODE,
    ];
    ui.wireClassicStepper({ min: 3, max: 7, initial: 5 });
    ui.renderLevelSelect(items,
        (lvId) => {
            if (lvId === 'CUSTOM')       game.openCustomLevelModal();
            else if (lvId === 'MYCODE')  game.openMyCodeModal();
            else if (lvId === 'CLASSIC') game.startNew('CLASSIC', undefined,
                                            { verifiers: ui.getClassicVerifiers() });
            else                         game.startNew(lvId);
        },
        (lvId) => game.openLevelInfo(lvId),
        () => {
            ui.showScreen('main');
            game.refreshMainMenu();
        });

    // Initial screen + menu state.
    ui.showScreen('main');
    game.refreshMainMenu();

    // Shared puzzle via URL.
    const params = new URLSearchParams(window.location.search);
    const gameIdParam = params.get('game-id') || params.get('game') || params.get('id');
    if (gameIdParam) {
        try {
            const puzzle = decodeGameId(gameIdParam);
            game.startWithPuzzle(puzzle);
        } catch (e) {
            ui.toast('Could not load shared puzzle: ' + (e.message || e));
        }
        // Clean the URL so navigating away doesn't re-trigger.
        try { history.replaceState(history.state, '', window.location.pathname); }
        catch (e) { /* ignore */ }
    }
});
