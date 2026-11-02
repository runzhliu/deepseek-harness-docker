'use strict';
const fs = require('node:fs');
const path = require('node:path');

// This variant owns a dedicated Web instance. Never turn an existing personal
// profile into an autonomous-agent deployment or reset its saved settings.
if (process.argv.slice(2).some(arg => ['--version', '--help', '-h'].includes(arg))) process.exit(0);
const args = process.argv.slice(2);
const published = process.env.DSH_SUPERAGENT_PUBLIC_PORT;
if (published && (!/^[1-9]\d{0,4}$/.test(published) || Number(published) > 65535))
  throw Error('DSH_SUPERAGENT_PUBLIC_PORT must be a valid port number');
const profileAt = args.indexOf('--profile');
if (profileAt >= 0 && args[profileAt + 1] !== 'web') process.exit(0);
if (args.length && args[0] !== 'web' && args[0] !== '--profile') process.exit(0);
const root = process.env.DSH_HOME;
if (!root || !path.isAbsolute(root) || root === '/') throw Error('Super Agent requires an absolute DSH_HOME');
const marker = path.join(root, '.superagent-container.json');
const profile = path.join(root, 'profiles/web');
const state = path.join(root, 'state/superagent');
if (fs.existsSync(marker)) {
  const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (saved.schema !== 1 || !fs.existsSync(path.join(profile, 'cordis.yml')) || !fs.existsSync(path.join(state, 'orchestrator.sqlite')))
    throw Error('Super Agent data is incomplete; restore its dedicated volume before starting');
  process.exit(0);
}
for (const name of ['profiles', 'sessions', '.credentials.yaml', 'state']) {
  if (fs.existsSync(path.join(root, name))) throw Error('Super Agent needs its own empty data volume; existing DSH data was left unchanged');
}
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const temporary = path.join(root, '.superagent-init-' + process.pid);
fs.mkdirSync(temporary, { mode: 0o700 });
try {
  fs.cpSync('/opt/deepseek-harness/superagent-template/profiles', path.join(temporary, 'profiles'), { recursive: true, verbatimSymlinks: true });
  fs.mkdirSync(path.join(temporary, 'state/superagent'), { recursive: true, mode: 0o700 });
  fs.copyFileSync('/opt/deepseek-harness/superagent-defaults/orchestrator.sqlite', path.join(temporary, 'state/superagent/orchestrator.sqlite'));
  fs.chmodSync(path.join(temporary, 'state/superagent/orchestrator.sqlite'), 0o600);
  fs.renameSync(path.join(temporary, 'profiles'), path.join(root, 'profiles'));
  fs.renameSync(path.join(temporary, 'state'), path.join(root, 'state'));
  fs.writeFileSync(marker, JSON.stringify({ schema: 1, profile: 'web', initializedAt: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 });
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log('Super Agent initialized in its dedicated volume; sources and processing are off until configured.');
