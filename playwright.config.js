// @ts-check
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.spec.js',
    globalSetup: './tests/global-setup.js',
    timeout: 15_000,
    expect: { timeout: 5_000 },
    fullyParallel: false,     // keep sequential — tests share no server state
    retries: 0,
    reporter: 'list',
    use: {
        // Open the instrumented copy so coverage shows up via window.__coverage__
        baseURL: 'file://' + path.resolve(__dirname, '.nyc_inst/index.html'),
        headless: true,
        viewport: { width: 1400, height: 900 },
        // Give the app 2s to finish initialising after page load
        actionTimeout: 8_000,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], channel: 'chrome' } // use system Chrome (no download needed)
        },
        // {
        //     name: 'firefox',
        //     use: { ...devices['Desktop Firefox'] }
        // },
        // {
        //     name: 'webkit',
        //     use: { ...devices['Desktop Safari'] }
        // },
    ],
    // Snapshot dir for visual regression baselines
    snapshotDir: './tests/snapshots',
});
