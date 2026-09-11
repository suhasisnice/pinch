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

const env = { ...process.env };

// Recent JDK builds implement java.nio.channels.Pipe on Windows using an
// AF_UNIX domain socket rather than a TCP loopback connection, and Windows'
// AF_UNIX support has a short limit on that socket's path length. A long
// %TEMP% — as under C:\Users\<full name>\AppData\Local\Temp for an account
// with a multi-word display name — overflows it on its own, so every Gradle
// invocation fails before a single task runs: "Unable to establish loopback
// connection", really a java.net.SocketException: Invalid argument: connect
// underneath. A short, dedicated temp directory sidesteps the limit.
if (process.platform === 'win32') {
  const shortTemp = path.join(process.env.SystemDrive || 'C:', 'pinch-gradle-tmp');
  fs.mkdirSync(shortTemp, { recursive: true });
  env.TMP = shortTemp;
  env.TEMP = shortTemp;
}

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
        env,
      })
    : spawnSync(wrapper, args, { cwd: ANDROID_DIR, stdio: 'inherit', env });

process.exit(result.status ?? 1);
