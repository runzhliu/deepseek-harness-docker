'use strict';
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const net = require('node:net');
const crypto = require('node:crypto');
const image = process.argv[2] || 'docker.io/runzhliu/deepseek-harness:0.2.2-alpha.2-r1-superagent.1';
const suffix = `${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
const container = 'dsh-superagent-smoke-' + suffix;
const volume = container + '-home', existing = container + '-existing';
const run = args => cp.execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, timeout: 90000 }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
let port, cookie;
async function signIn() {
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const logs = run(['logs', container]);
      const token = [...logs.matchAll(/dsh web: http:\/\/127\.0\.0\.1:\d+\/\?token=([^\s)]+)/g)].at(-1)?.[1];
      if (token) {
        const login = await fetch(base + '/?token=' + encodeURIComponent(token), { redirect: 'manual', signal: AbortSignal.timeout(3000) });
        if ([302, 303, 307].includes(login.status)) {
          cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
          const r = await fetch(base, { headers: { cookie }, signal: AbortSignal.timeout(3000) });
          if (r.ok && (await r.text()).includes('dsh-superagent')) return;
        }
      }
    } catch {}
    await sleep(1000);
  }
  throw Error('Super Agent authenticated Web did not become ready');
}
async function api(path, method = 'GET', body) {
  const r = await fetch(`http://127.0.0.1:${port}/orchestrator/api/${path}`, {
    method, headers: { cookie, 'content-type': 'application/json', 'x-orchestrator-request': '1' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const value = await r.json(); assert.equal(r.status, 200, path + ': ' + JSON.stringify(value)); return value;
}
(async () => {
  const contract = JSON.parse(run(['run', '--rm', '--entrypoint', 'node', image, '-e', `
    const fs=require('node:fs'),cp=require('node:child_process');
    const p=require('/opt/dsh-superagent/package.json');
    if(fs.existsSync('/home/node/.dsh/.credentials.yaml')||fs.existsSync('/opt/deepseek-harness/superagent-template/.credentials.yaml'))throw Error('credentials in image');
    if(fs.existsSync('/opt/dsh-superagent/src')||fs.existsSync('/opt/dsh-superagent/tests'))throw Error('development tree in image');
    console.log(JSON.stringify({version:p.version,uid:process.getuid(),gh:cp.execFileSync('gh',['--version'],{encoding:'utf8'}).split('\\n')[0],tmux:cp.execFileSync('tmux',['-V'],{encoding:'utf8'}).trim(),gitLfs:cp.execFileSync('git',['lfs','version'],{encoding:'utf8'}).trim()}));
  `]));
  assert.equal(contract.version, '0.1.0'); assert.equal(contract.uid, 1000); assert(contract.gh.includes('2.103.3'));
  port = await unusedPort();
  run(['volume', 'create', volume]);
  run(['run', '-d', '--name', container, '--publish', `127.0.0.1:${port}:3080`, '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=512m', '--tmpfs', '/workspace:rw,nosuid,nodev,size=512m,uid=1000,gid=1000',
    '--shm-size', '1g', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--pids-limit', '512',
    '--env', `DSH_SUPERAGENT_PUBLIC_PORT=${port}`, '--volume', `${volume}:/home/node/.dsh`, image]);
  await signIn();
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/orchestrator/api/state`, { headers: { 'x-orchestrator-request': '1' } })).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/orchestrator/api/executor/resume`, {
    method: 'POST', headers: { 'x-orchestrator-request': '1' },
  })).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/orchestrator/api/state`, {
    headers: { 'x-orchestrator-request': '1', cookie: cookie.split('=')[0] + '=invalid' },
  })).status, 401);
  const badOrigin = await fetch(`http://127.0.0.1:${port}/orchestrator/api/state`, { headers: { cookie, origin: 'https://evil.example', 'x-orchestrator-request': '1' } });
  assert.equal(badOrigin.status, 403);
  const state = await api('state'); assert.equal(state.paused, true); assert.equal(state.load.running, 0); assert.equal(state.load.queued, 0); assert.equal(state.setup.accounts, null);
  let settings = await api('settings');
  assert(settings.sources.every(source => !source.value.enabled), 'Source was enabled by default');
  assert.equal(settings.blocks.eval.value.mode, 'off');
  assert.equal((await api('tickets')).items.length, 0);
  assert.equal((await api('threads?filter=all')).items.length, 0);
  await api('settings/eval', 'PUT', { revision: settings.blocks.eval.revision, value: { ...settings.blocks.eval.value, mode: 'observe' } });
  run(['exec', container, 'node', '-e', "require('node:fs').writeFileSync(process.env.DSH_HOME+'/smoke-preserved.txt','preserved')"]);
  run(['restart', container]);
  await signIn(); settings = await api('settings');
  assert.equal(settings.blocks.eval.value.mode, 'observe', 'Settings reset after restart');
  assert.equal((await api('state')).paused, true);
  assert(settings.sources.every(source => !source.value.enabled));
  assert.equal(run(['exec', container, 'node', '-e', "process.stdout.write(require('node:fs').readFileSync(process.env.DSH_HOME+'/smoke-preserved.txt','utf8'))"]), 'preserved');
  // A generic DSH profile must not be overwritten by this dedicated variant.
  run(['volume', 'create', existing]);
  run(['run', '--rm', '--entrypoint', 'node', '--volume', `${existing}:/home/node/.dsh`, image, '-e', "const f=require('node:fs');f.mkdirSync(process.env.DSH_HOME+'/profiles/web',{recursive:true});f.writeFileSync(process.env.DSH_HOME+'/profiles/web/cordis.yml','existing-profile')"]);
  let refused = false;
  try { run(['run', '--rm', '--volume', `${existing}:/home/node/.dsh`, image, '--profile', 'web', '--dump-config']); } catch { refused = true; }
  assert(refused, 'Existing personal profile was not refused');
  assert.equal(run(['run', '--rm', '--entrypoint', 'node', '--volume', `${existing}:/home/node/.dsh`, image, '-e', "process.stdout.write(require('node:fs').readFileSync(process.env.DSH_HOME+'/profiles/web/cordis.yml','utf8'))"]), 'existing-profile');
  console.log(JSON.stringify({ superagent: contract.version, gh: contract.gh, uid: contract.uid, authenticatedWeb: true,
    publishedLoopbackPort: true, crossOriginRejected: true, initiallyPaused: true, sourcesOff: true, persistedSettings: true,
    existingProfilePreserved: true, modelRequestsMade: false, repositoryConnected: false }));
})().catch(error => {
  const message = String(error.stderr || error.message).replace(/([?&]token=)[^\s"'<>]+/g, '$1[REDACTED]');
  console.error(message.slice(-2500)); process.exitCode = 1;
}).finally(() => {
  try { run(['rm', '-f', container]); } catch {}
  for (const name of [volume, existing]) try { run(['volume', 'rm', name]); } catch {}
});
