/**
 * The local OmniRoute gateway, shared by free.js and llm.js --cloud.
 *
 * The key is `setx`'d into the Windows user environment, but a terminal (or a
 * Claude Code session) opened before that never inherits it. So when it is not
 * in this process's env, read it from the registry instead of failing.
 */
const { execFileSync } = require('child_process');

const OMNIROUTE = 'http://localhost:20128';

function omniKey() {
  if (process.env.OMNIROUTE_KEY) return process.env.OMNIROUTE_KEY;
  if (process.platform !== 'win32') return '';
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'OMNIROUTE_KEY'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.match(/OMNIROUTE_KEY\s+REG_(?:EXPAND_)?SZ\s+(\S+)/)?.[1] ?? '';
  } catch {
    return '';
  }
}

module.exports = { OMNIROUTE, omniKey };
