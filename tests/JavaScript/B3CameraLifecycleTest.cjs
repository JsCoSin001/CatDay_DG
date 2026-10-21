'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../public/js/qr-scanner/qr-camera-scanner.js'), 'utf8');

function harness(Camera, onResult) {
  const target = {id: 'camera', innerHTML: '', querySelector: () => null};
  const window = {Html5Qrcode: Camera};
  const document = {getElementById: () => target};
  vm.runInNewContext(source, {window, document, setTimeout, clearTimeout});
  return new window.QrCameraScanner({elementId: 'camera', adaptiveScan: false, onResult});
}

test('a QR decoded during camera startup is delivered once after startup and releases the camera', async () => {
  const results = [];
  let stops = 0;
  class Camera {
    async start(camera, config, success) {
      success('cuontp;BIN1;400;001', {});
      success('cuontp;BIN1;400;001', {});
    }
    async stop() { stops++; }
    async clear() {}
  }
  const scanner = harness(Camera, text => results.push(text));
  await scanner.start();
  assert.deepEqual(results, ['cuontp;BIN1;400;001']);
  assert.equal(stops, 1);
  assert.equal(scanner.running, false);
  assert.equal(scanner.pendingStart, null);
});

test('closing during startup discards decoded QR and reopening accepts a new result', async () => {
  const results = [];
  let release;
  let starts = 0;
  class Camera {
    async start(camera, config, success) {
      success(`QR-${++starts}`, {});
      if (starts === 1) await new Promise(resolve => { release = resolve; });
    }
    async stop() {}
    async clear() {}
  }
  const scanner = harness(Camera, text => results.push(text));
  const opening = scanner.start();
  const closing = scanner.stop();
  release();
  await Promise.allSettled([opening, closing]);
  assert.deepEqual(results, []);
  await scanner.start();
  assert.deepEqual(results, ['QR-2']);
});

test('a QR detected after the camera is ready is delivered, while stale callbacks are ignored', async () => {
  const results = [];
  const callbacks = [];
  class Camera {
    async start(camera, config, success) { callbacks.push(success); }
    async stop() {}
    async clear() {}
  }
  const scanner = harness(Camera, text => results.push(text));
  await scanner.start();
  callbacks[0]('QR-READY', {});
  await scanner.stopPromise;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(results, ['QR-READY']);
  await scanner.start();
  callbacks[0]('QR-STALE', {});
  assert.deepEqual(results, ['QR-READY']);
  callbacks[1]('QR-NEW', {});
  await scanner.stopPromise;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(results, ['QR-READY', 'QR-NEW']);
});
