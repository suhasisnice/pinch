#!/usr/bin/env node
/**
 * Decides whether a build can reuse the existing android/ project, or needs
 * `expo prebuild --clean` first — and does whichever is safe.
 *
 * A clean prebuild wipes android/ and costs minutes (3m41s measured, against
 * 14s for a build with nothing to do). It is only *needed* when something
 * that shapes the native project changed: app.json config, a config plugin,
 * or a dependency. The one thing that changes on almost every release — the
 * version — does not need it; that is two lines in app/build.gradle.
 *
 * The danger of skipping prebuild is shipping an APK built from stale native
 * config (a permission or plugin change silently missing). So this never
 * guesses: it fingerprints every native-affecting input at prebuild time and
 * compares on each build. Anything different, or anything it cannot verify,
 * falls back to the full clean prebuild.
 *
 *   node scripts/android-sync.js          sync, prebuilding only if needed
 *   node scripts/android-sync.js --stamp  record the fingerprint (after prebuild)
 */
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');
const BUILD_GRADLE = path.join(ANDROID, 'app', 'build.gradle');
// Inside android/, so a clean prebuild deleting the folder also deletes the
// stamp — an unstamped project is never trusted.
const STAMP = path.join(ANDROID, '.pinch-prebuild-stamp');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

/** Everything prebuild reads to generate android/, except the version. */
function fingerprint() {
  const app = readJson('app.json');
  const expo = JSON.parse(JSON.stringify(app.expo));
  delete expo.version;
  if (expo.android) delete expo.android.versionCode;

  const pkg = readJson('package.json');
  const pluginsDir = path.join(ROOT, 'plugins');
  const plugins = fs.existsSync(pluginsDir)
    ? fs
        .readdirSync(pluginsDir)
        .sort()
        .map((name) => [name, fs.readFileSync(path.join(pluginsDir, name), 'utf8').replace(/\r\n/g, '\n')])
    : [];

  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ expo, dependencies: pkg.dependencies ?? {}, plugins }))
    .digest('hex');
}

function version() {
  const expo = readJson('app.json').expo;
  return { name: String(expo.version), code: Number(expo.android?.versionCode) };
}

/** Rewrites exactly one versionCode and one versionName, or reports failure. */
function patchVersion(contents, { name, code }) {
  const codeRe = /(\n\s*versionCode )\d+/g;
  const nameRe = /(\n\s*versionName )"[^"]*"/g;
  if ((contents.match(codeRe) ?? []).length !== 1) return null;
  if ((contents.match(nameRe) ?? []).length !== 1) return null;
  return contents.replace(codeRe, `$1${code}`).replace(nameRe, `$1"${name}"`);
}

function writeStamp() {
  fs.writeFileSync(STAMP, fingerprint() + '\n');
  console.log('[android-sync] Recorded native config fingerprint.');
}

function cleanPrebuild(reason) {
  console.log(`[android-sync] ${reason} — running a clean prebuild (slow, but safe).`);
  // One fixed command string, no argument array: npm is a .cmd on Windows and
  // has to go through a shell, and nothing here comes from outside the repo.
  const result = spawnSync('npm run native:prebuild', { cwd: ROOT, stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
  // native:prebuild writes the stamp itself; nothing more to do.
}

function main() {
  if (process.argv.includes('--stamp')) {
    writeStamp();
    return;
  }

  if (!fs.existsSync(BUILD_GRADLE)) return cleanPrebuild('No android/ project yet');
  if (!fs.existsSync(STAMP)) return cleanPrebuild('android/ has no fingerprint, so it cannot be trusted');

  const recorded = fs.readFileSync(STAMP, 'utf8').trim();
  if (recorded !== fingerprint()) {
    return cleanPrebuild('Native config changed since the last prebuild (app.json, a plugin, or a dependency)');
  }

  const wanted = version();
  if (!wanted.name || !Number.isInteger(wanted.code)) {
    return cleanPrebuild('Could not read version/versionCode from app.json');
  }

  const contents = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const patched = patchVersion(contents, wanted);
  if (patched === null) {
    return cleanPrebuild('Could not find exactly one versionCode/versionName in app/build.gradle');
  }
  if (patched !== contents) {
    fs.writeFileSync(BUILD_GRADLE, patched);
    console.log(`[android-sync] Version set to ${wanted.name} (${wanted.code}); no prebuild needed.`);
  } else {
    console.log(`[android-sync] android/ is current (${wanted.name}, ${wanted.code}); no prebuild needed.`);
  }
}

module.exports = { fingerprint, patchVersion };

if (require.main === module) main();
