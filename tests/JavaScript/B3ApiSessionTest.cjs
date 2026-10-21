'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../public/js/cat-day/b3-api.js'), 'utf8');

function harness(responses) {
  const meta = {content: 'page-token'};
  const calls = [];
  const events = [];
  const window = {dispatchEvent: event => events.push(event)};
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  const fetch = async (url, options) => {
    calls.push({url, options});
    assert.ok(responses.length, 'Unexpected request: ' + url);
    const {status = 200, body = {success: true}, token = null, networkError = false} = await responses.shift();
    if (networkError) throw new Error('offline');
    return {status, ok: status >= 200 && status < 300, json: async () => body,
      headers: {get: name => name.toLowerCase() === 'x-csrf-token' ? token : null}};
  };
  vm.runInNewContext(source, {window, document: {querySelector: () => meta}, fetch, CustomEvent});
  return {api: window.B3Api, meta, calls, events};
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

test('session token rotation updates the next protected request', async () => {
  const h = harness([{body: {success: true, csrf_token: 'session-token'}}, {}]);
  await h.api.session();
  await h.api.resolveQr('QR-1');
  assert.equal(h.calls[1].options.headers['X-CSRF-TOKEN'], 'session-token');
  assert.equal(h.meta.content, 'session-token');
});

test('cut recovery uses a read request with encoded original QR and transaction identity',async()=>{
  const h=harness([{}]);
  await h.api.cutSession({raw_qr:'cuontp;264772;500;A&B',ke_hoach_id:1,group_id:50,operation_token:'original-token',detail_id:60});
  assert.ok(h.calls[0].url.startsWith('/api/b3/cut-session?'));
  assert.ok(h.calls[0].url.includes('raw_qr=cuontp%3B264772%3B500%3BA%26B'));
  assert.ok(h.calls[0].url.includes('operation_token=original-token'));
  assert.equal(h.calls[0].options.method,undefined);
  assert.equal(h.calls[0].options.body,undefined);
});

test('login synchronizes before posting then uses the rotated token until logout', async () => {
  const h = harness([
    {status: 401, body: {success: false, error_code: 'AUTH_REQUIRED', csrf_token: 'guest-token'}},
    {body: {success: true, csrf_token: 'login-token'}},
    {body: {success: true, csrf_token: 'logout-token'}},
    {status: 401, body: {success: false, error_code: 'AUTH_REQUIRED', csrf_token: 'logout-token'}},
    {body: {success: true, csrf_token: 'next-login-token'}},
    {},
  ]);
  await h.api.login('USER', 'CaseSensitive');
  assert.equal(h.calls[0].url, '/api/b3/session');
  assert.equal(h.calls[1].url, '/login');
  assert.equal(h.calls[1].options.headers['X-CSRF-TOKEN'], 'guest-token');
  assert.equal(JSON.parse(h.calls[1].options.body).password, 'CaseSensitive');
  await h.api.logout();
  assert.equal(h.calls[2].options.headers['X-CSRF-TOKEN'], 'login-token');
  assert.equal(h.meta.content, 'logout-token');
  await h.api.login('user', 'CaseSensitive');
  await h.api.cut({operation_token: 'operation'});
  assert.equal(h.calls[5].options.headers['X-CSRF-TOKEN'], 'next-login-token');
});

test('419 synchronizes the token and rejects without resending a write or expiring authentication', async () => {
  const h = harness([{status: 419, token: 'current-token', body: {
    success: false, error_code: 'CSRF_TOKEN_MISMATCH', message: 'Phiên bảo mật đã thay đổi. Vui lòng thử lại.',
  }}, {}, {}]);
  await assert.rejects(h.api.cut({operation_token: 'one-use'}), error => error.status === 419 && error.code === 'CSRF_TOKEN_MISMATCH');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].url, '/api/b3/session');
  assert.equal(h.events.length, 0);
  await h.api.plans();
  assert.equal(h.calls[2].options.headers['X-CSRF-TOKEN'], 'current-token');
});

test('419 with an expired session checks auth and notifies once without replaying the mutation', async () => {
  const h = harness([
    {status: 419, body: {success: false, error_code: 'CSRF_TOKEN_MISMATCH', csrf_token: 'guest-token'}},
    {status: 401, body: {success: false, error_code: 'AUTH_REQUIRED', csrf_token: 'guest-token'}},
  ]);
  await assert.rejects(h.api.cut({operation_token: 'one-use'}), error => error.status === 419 && error.sessionExpired === true);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, '/api/b3/execute/cut');
  assert.equal(h.calls[1].url, '/api/b3/session');
  assert.equal(h.calls[1].options.method, undefined);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].type, 'b3:session-expired');
});

test('an offline session check after 419 preserves the original error and never retries', async () => {
  const h = harness([
    {status: 419, body: {success: false, error_code: 'CSRF_TOKEN_MISMATCH'}},
    {networkError: true},
  ]);
  await assert.rejects(h.api.takeWhole({}), error => error.status === 419 && error.code === 'CSRF_TOKEN_MISMATCH');
  assert.equal(h.calls.length, 2);
  assert.equal(h.events.length, 0);
});

for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'USER_INACTIVE'], [401, undefined]]) {
  test(`auth expiry ${status}/${code} notifies the UI once and never retries`, async () => {
    const h = harness([{status, body: {success: false, error_code: code, message: 'Đăng nhập lại.'}}]);
    await assert.rejects(h.api.takeWhole({}), error => error.status === status);
    assert.equal(h.calls.length, 1);
    assert.equal(h.events.length, 1);
    assert.equal(h.events[0].type, 'b3:session-expired');
    assert.equal(h.events[0].detail.status, status);
  });
}

test('login stops on an unexpected session-check failure', async () => {
  const h = harness([{status: 500, body: {success: false, error_code: 'EXECUTION_FAILED'}}]);
  await assert.rejects(h.api.login('user', 'password'), error => error.status === 500);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, '/api/b3/session');
});

for (const status of [401, 419]) {
  test(`a delayed ${status} from before login cannot expire the new session or overwrite its token`, async () => {
    const oldResponse = deferred();
    const h = harness([
      oldResponse.promise,
      {body: {success: true, csrf_token: 'before-login'}},
      {body: {success: true, csrf_token: 'new-login-token'}},
    ]);
    const oldRequest = h.api.cut({operation_token: 'old-operation'});
    const rejection = assert.rejects(oldRequest, error => error.status === status && !error.sessionExpired);
    await h.api.login('user', 'PassSecret');
    oldResponse.resolve({status, body: {success: false,
      error_code: status === 401 ? 'AUTH_REQUIRED' : 'CSRF_TOKEN_MISMATCH', csrf_token: 'obsolete-token'}});
    await rejection;
    assert.equal(h.meta.content, 'new-login-token');
    assert.equal(h.events.length, 0);
    assert.equal(h.calls.length, 3, 'The old write must not be replayed or probed');
  });
}

test('duplicate delayed auth errors expire one generation only once', async () => {
  const first = deferred();
  const second = deferred();
  const h = harness([first.promise, second.promise]);
  const firstRejection = assert.rejects(h.api.plans(), error => error.status === 401 && error.sessionExpired === true);
  const secondRejection = assert.rejects(h.api.allWorklist(), error => error.status === 401 && !error.sessionExpired);
  first.resolve({status: 401, body: {success: false, error_code: 'AUTH_REQUIRED', csrf_token: 'guest-token'}});
  await firstRejection;
  second.resolve({status: 401, body: {success: false, error_code: 'AUTH_REQUIRED', csrf_token: 'obsolete-token'}});
  await secondRejection;
  assert.equal(h.events.length, 1);
  assert.equal(h.meta.content, 'guest-token');
  assert.equal(h.calls.length, 2);
});

test('a delayed pre-logout auth error cannot overwrite the logout token or expire again', async () => {
  const oldResponse = deferred();
  const h = harness([oldResponse.promise, {body: {success: true, csrf_token: 'logout-token'}}]);
  const rejection = assert.rejects(h.api.plans(), error => error.status === 401 && !error.sessionExpired);
  await h.api.logout();
  oldResponse.resolve({status: 401, body: {success: false, error_code: 'AUTH_REQUIRED', csrf_token: 'old-token'}});
  await rejection;
  assert.equal(h.events.length, 0);
  assert.equal(h.meta.content, 'logout-token');
});

test('successful login adopts its token even if authentication expires while login is pending', async () => {
  const loginResponse = deferred();
  const expiredResponse = deferred();
  const h = harness([{}, loginResponse.promise, expiredResponse.promise]);
  const login = h.api.login('user', 'PassSecret');
  // Wait until login POST has started, then expire another request from the same generation.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls[1].url, '/login');
  const rejection = assert.rejects(h.api.plans(), error => error.sessionExpired === true);
  expiredResponse.resolve({status: 401, body: {success: false, error_code: 'AUTH_REQUIRED', csrf_token: 'guest-token'}});
  await rejection;
  loginResponse.resolve({body: {success: true, csrf_token: 'fresh-login-token'}});
  await login;
  assert.equal(h.meta.content, 'fresh-login-token');
});
