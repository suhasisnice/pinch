#!/usr/bin/env node
/**
 * Forwards the Metro port from a USB-connected Android device back to this
 * machine (`adb reverse tcp:8081 tcp:8081`).
 *
 * Expo CLI normally does this itself, but only if it can find `adb`. On this
 * machine ANDROID_HOME is unset and adb is not on PATH, so the dev build boots
 * pointing at localhost:8081 with nothing listening on the device side and
 * fails with "Could not connect to development server".
 *
 * This resolves adb from (in order) ANDROID_HOME, ANDROID_SDK_ROOT,
 * android/local.properties `sdk.dir`, then the usual install locations.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.RCT_METRO_PORT || '8081';
const EXE = process.platform === 'win32' ? 'adb.exe' : 'adb';

function sdkDirFromLocalProperties() {
  const file = path.join(__dirname, '..', 'android', 'local.properties');
  if (!fs.existsSync(file)) return null;
  const match = fs.readFileSync(file, 'utf8').match(/^\s*sdk\.dir\s*=\s*(.+)$/m);
  // local.properties escapes backslashes, e.g. C:\Android\Sdk
  return match ? match[1].trim().replace(/\\\\/g, path.sep) : null;
}

function findAdb() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    sdkDirFromLocalProperties(),
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    path.join(os.homedir(), 'Android', 'Sdk'),
    path.join('C:', 'Android', 'Sdk'),
  ].filter(Boolean);

  for (const root of roots) {
    const candidate = path.join(root, 'platform-tools', EXE);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  const adb = findAdb();
  if (!adb) {
    console.warn(
      '[adb-reverse] Could not locate adb. Set ANDROID_HOME to your Android SDK ' +
        'directory, or start Metro with `npx expo start --lan` and point the device ' +
        "at this machine's IP instead."
    );
    return;
  }

  let devices;
  try {
    devices = execFileSync(adb, ['devices'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.endsWith('\tdevice'))
      .map((line) => line.split('\t')[0]);
  } catch (error) {
    console.warn(`[adb-reverse] \`adb devices\` failed: ${error.message}`);
    return;
  }

  if (devices.length === 0) {
    console.warn(
      '[adb-reverse] No Android device or emulator attached. Plug in the device ' +
        'with USB debugging enabled and re-run, or use `npx expo start --lan`.'
    );
    return;
  }

  for (const device of devices) {
    try {
      execFileSync(adb, ['-s', device, 'reverse', `tcp:${PORT}`, `tcp:${PORT}`], {
        stdio: 'ignore',
      });
      console.log(`[adb-reverse] ${device}: tcp:${PORT} -> localhost:${PORT}`);
    } catch (error) {
      console.warn(`[adb-reverse] ${device}: failed to reverse port — ${error.message}`);
    }
  }
}

main();
