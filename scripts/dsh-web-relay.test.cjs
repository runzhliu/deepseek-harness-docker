'use strict';
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const { selectAddress, webPort, createRelay } = require('./dsh-web-relay.cjs');
const ipv4 = address => ({ address, family: 'IPv4', internal: false });
const ipv6 = address => ({ address, family: 'IPv6', internal: false });

test('choose one concrete interface address, excluding loopback and wildcards', () => {
  assert.equal(selectAddress({ lo: [{...ipv4('127.0.0.1'), internal: true}], eth0: [ipv4('172.18.0.2'), ipv6('fe80::2')] }), '172.18.0.2');
  assert.throws(() => selectAddress({ eth0: [ipv4('0.0.0.0'), ipv4('127.0.0.2'), ipv6('::'), ipv6('::1')] }));
  assert.throws(() => selectAddress({}));
  assert.throws(() => selectAddress({eth0: [ipv4('172.18.0.2')], eth1: [ipv4('172.19.0.2')]}));
  assert.equal(selectAddress({eth0: [ipv4('172.18.0.2')], eth1: [ipv4('172.19.0.2')]}, 'eth1'), '172.19.0.2');
  assert.throws(() => selectAddress({eth0: [ipv4('172.18.0.2')]}, 'missing'));
  assert.equal(selectAddress({eth0: [ipv6('fd00::2'), ipv6('fe80::2')]}), 'fd00::2');
});

test('honor fixed CLI ports and reject invalid or ephemeral ports', () => {
  assert.equal(webPort(['web', '--no-open']), 3080);
  assert.equal(webPort(['--profile', 'web', '--port', '4000']), 4000);
  assert.equal(webPort(['web', '--port=4001']), 4001);
  for (const value of ['0', '-1', '65536', 'x', '']) assert.throws(() => webPort(['--port', value]));
  assert.throws(() => webPort(['--port']));
});

test('relay preserves request bytes and long-lived bidirectional traffic', async t => {
  const target = net.createServer(socket => socket.pipe(socket));
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  t.after(() => new Promise(resolve => target.close(resolve)));
  const relay = createRelay({host: '127.0.0.1', port: 0, targetPort: target.address().port});
  await relay.listen();
  t.after(() => relay.close());
  const client = net.connect(relay.server.address().port, '127.0.0.1');
  t.after(() => client.destroy());
  await once(client, 'connect');
  for (const payload of [Buffer.from('GET /api HTTP/1.1\r\nHost: dsh.test\r\nOrigin: https://dsh.test\r\nCookie: demo=1\r\nUpgrade: websocket\r\n\r\n'), Buffer.from([0, 255, 1, 2, 3])]) {
    const response = once(client, 'data');
    client.write(payload);
    assert.deepEqual((await response)[0], payload);
  }
  const closed = once(client, 'close');
  await relay.close();
  await closed;
});

test('client half-close does not truncate the upstream response', async t => {
  const target = net.createServer({allowHalfOpen: true}, socket => {
    socket.resume();
    socket.on('end', () => socket.end('complete response'));
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  t.after(() => new Promise(resolve => target.close(resolve)));
  const relay = createRelay({host: '127.0.0.1', port: 0, targetPort: target.address().port});
  await relay.listen();
  t.after(() => relay.close());
  const client = net.connect(relay.server.address().port, '127.0.0.1');
  let response = '';
  client.on('data', chunk => { response += chunk; });
  const closed = once(client, 'close');
  client.end('request');
  await closed;
  assert.equal(response, 'complete response');
});

test('invalid interface fails closed and stops its supervisor', {timeout: 5000}, async t => {
  const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
  t.after(() => parent.kill());
  const parentExit = once(parent, 'exit');
  const child = spawn(process.execPath, [path.join(__dirname, 'dsh-web-relay.cjs'), String(parent.pid), 'web'], {
    env: {...process.env, DSH_WEB_RELAY_INTERFACE: 'dsh-test-nonexistent-interface'},
    stdio: 'ignore',
  });
  t.after(() => child.kill());
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.equal((await parentExit)[1], 'SIGTERM');
});
