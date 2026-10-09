#!/usr/bin/env node
'use strict';

// Keep upstream DSH on loopback. Docker/Podman/Service traffic enters through
// one concrete container interface, never a wildcard listener. This is a raw
// TCP relay: tokens, cookies, Host/Origin headers, TLS and WebSockets are not
// interpreted or rewritten here.
const net = require('node:net');
const os = require('node:os');

function selectAddress(interfaces, requestedInterface) {
  const entries = Object.entries(interfaces).filter(([name]) => !requestedInterface || name === requestedInterface);
  const addresses = entries.flatMap(([, rows]) => (rows || []).filter(row => !row.internal));
  const ipv4 = addresses.filter(row => row.family === 'IPv4' && net.isIP(row.address) === 4 && !row.address.startsWith('127.') && row.address !== '0.0.0.0');
  const ipv6 = addresses.filter(row => row.family === 'IPv6' && net.isIP(row.address) === 6 && row.address !== '::' && row.address !== '::1' && !row.address.toLowerCase().startsWith('fe80:'));
  const candidates = [...new Set((ipv4.length ? ipv4 : ipv6).map(row => row.address))];
  if (candidates.length !== 1) {
    throw new Error('expected one concrete container address; set DSH_WEB_RELAY_INTERFACE to a single container network interface (host networking is not supported)');
  }
  return candidates[0];
}

function webPort(args) {
  let port = '3080';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = args[++i];
    else if (args[i].startsWith('--port=')) port = args[i].slice(7);
    else if (args[i] === '--') break;
  }
  if (!/^\d+$/.test(port ?? '') || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('container Web relay requires a fixed --port between 1 and 65535');
  }
  return Number(port);
}

function createRelay({ host, port, targetPort = port }) {
  const sockets = new Set();
  const server = net.createServer({ allowHalfOpen: true }, client => {
    const upstream = net.connect({ host: '127.0.0.1', port: targetPort, allowHalfOpen: true });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    }
    const destroyPair = () => { client.destroy(); upstream.destroy(); };
    client.on('error', destroyPair);
    upstream.on('error', destroyPair);
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
    client.pipe(upstream);
    upstream.pipe(client);
  });
  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host, port }, () => { server.off('error', reject); resolve(); });
      });
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise(resolve => server.close(resolve));
    },
  };
}

async function main() {
  const parentPid = Number(process.argv[2]);
  if (!Number.isInteger(parentPid) || parentPid <= 1) throw new Error('missing supervisor PID');
  let relay;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (relay) await relay.close();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
  const fail = async error => {
    console.error(`container Web relay failed: ${error.message}`);
    process.exitCode = 1;
    try { process.kill(parentPid, 'SIGTERM'); } catch {}
    await stop();
  };
  try {
    relay = createRelay({
      host: selectAddress(os.networkInterfaces(), process.env.DSH_WEB_RELAY_INTERFACE),
      port: webPort(process.argv.slice(3)),
    });
    await relay.listen();
    relay.server.on('error', fail);
    const address = relay.server.address();
    console.log(`container Web relay: ${address.address}:${address.port} -> 127.0.0.1:${address.port}`);
  } catch (error) {
    await fail(error);
  }
}

module.exports = { selectAddress, webPort, createRelay };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
