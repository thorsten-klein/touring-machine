import { test, expect } from './coverage-fixture.js';

test('main menu loads', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('#screen-main')).toBeVisible();
    await expect(page.locator('#btn-start-game')).toBeVisible();
});
