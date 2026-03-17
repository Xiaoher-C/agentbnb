/**
 * take-screenshot.mjs
 * Captures a 1280x800 screenshot of the Hub UI and saves it to docs/hub-screenshot.png.
 *
 * Usage:
 *   pnpm build:hub
 *   node scripts/take-screenshot.mjs
 */

import { spawn } from 'child_process';
import { chromium } from 'playwright';
import { statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const HUB_DIR = resolve(ROOT, 'hub');
const SCREENSHOT_PATH = resolve(ROOT, 'docs', 'hub-screenshot.png');
const PORT = 4173;
const HUB_URL = `http://localhost:${PORT}/hub/`;

/** Poll until the server responds or timeout */
async function waitForServer(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200 || res.status === 304) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`);
}

async function main() {
  // Spawn vite preview from hub/
  console.log(`Spawning vite preview on port ${PORT}...`);
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
    cwd: HUB_DIR,
    stdio: 'pipe',
  });

  server.stderr.on('data', (d) => process.stderr.write(d));
  server.stdout.on('data', (d) => process.stdout.write(d));

  try {
    // Wait for server to be ready
    console.log(`Waiting for ${HUB_URL} ...`);
    await waitForServer(HUB_URL, 10000);
    console.log('Server ready.');

    // Launch Playwright Chromium headless
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    console.log(`Navigating to ${HUB_URL} ...`);
    await page.goto(HUB_URL, { waitUntil: 'networkidle' });

    // Wait for CSS animations/transitions to settle
    await new Promise((r) => setTimeout(r, 1000));

    // Take screenshot
    console.log(`Saving screenshot to ${SCREENSHOT_PATH} ...`);
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });

    await browser.close();

    // Log file size to confirm success
    const { size } = statSync(SCREENSHOT_PATH);
    console.log(`hub-screenshot.png saved: ${size} bytes`);
  } finally {
    // Kill the preview server
    server.kill('SIGTERM');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
