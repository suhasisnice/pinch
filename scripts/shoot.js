#!/usr/bin/env node
/**
 * Screenshots of the web design preview, taken with a headless browser.
 *
 *   npm run preview            (in another terminal: serves the app on :8090)
 *   node scripts/shoot.js today insights settings
 *
 * Each name is a preview URL path (see previewLinking in RootNavigator).
 * Images land in .shots/ (gitignored). Uses its own throwaway browser
 * profile, so it never touches a browser the user has open.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.shots');
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const browser = BROWSERS.find((b) => fs.existsSync(b));
if (!browser) throw new Error('No Chrome or Edge found');

const args = process.argv.slice(2);
const height = Number((args.find((a) => a.startsWith('--h=')) ?? '--h=915').slice(4));
const names = args.filter((a) => !a.startsWith('--'));
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pinch-shot-'));

for (const name of names.length ? names : ['today']) {
  const file = path.join(OUT, `${name.replace(/[^\w-]/g, '_')}.png`);
  const url = `http://localhost:8090/${name}?h=${height}`;
  const result = spawnSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-prefers-reduced-motion',
      `--user-data-dir=${profile}`,
      `--window-size=412,${height}`,
      '--force-device-scale-factor=1',
      '--virtual-time-budget=20000',
      `--screenshot=${file}`,
      url,
    ],
    { encoding: 'utf8', timeout: 90000 }
  );
  console.log(fs.existsSync(file) ? `saved ${file}` : `FAILED ${name}: ${result.stderr?.slice(-400)}`);
}
fs.rmSync(profile, { recursive: true, force: true });
