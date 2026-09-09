#!/usr/bin/env node
/**
 * Runs the project's Gradle wrapper with the right launcher for the platform.
 *
 * `cd android && gradlew.bat ...` in an npm script only works when npm happens
 * to run scripts through cmd.exe; under a POSIX shell (Git Bash, or npm
 * configured with script-shell) the current directory is not on PATH and the
 * bare name does not resolve. Spawning it by absolute path works from either.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ANDROID_DIR = path.join(__dirname, '..', 'android');
const wrapper = path.join(ANDROID_DIR, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

if (!fs.existsSync(wrapper)) {
  console.error(
    `[gradle] ${wrapper} not found. Run "npm run native:prebuild" to generate the Android project.`
  );
  process.exit(1);
}

const args = process.argv.slice(2);

// On Windows a .bat file is not a directly executable image, so it has to go
// through a shell. Node concatenates command and args into the shell string
// without quoting them, which breaks on any space in the path — and the
// default project location is under C:\Users\<First Last>. Quote it here and
// pass no separate args, so the shell sees one properly delimited command.
const result =
  process.platform === 'win32'
    ? spawnSync(`"${wrapper}" ${args.map((arg) => `"${arg}"`).join(' ')}`, [], {
        cwd: ANDROID_DIR,
        stdio: 'inherit',
        shell: true,
      })
    : spawnSync(wrapper, args, { cwd: ANDROID_DIR, stdio: 'inherit' });

process.exit(result.status ?? 1);
