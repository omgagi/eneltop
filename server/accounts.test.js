const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eneltop-accounts-'));
process.env.ENELTOP_DATA_DIR = directory;
const accounts = require('./accounts');
const keyFile = path.join(directory, 'resend-api-key');

function response() {
  return { headers: {}, status: 0, body: '', setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); return this; },
    end(body = '') { this.body = body; return this; } };
}
function request(url, body, cookie = '') {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  stream.url = url;
  stream.headers = { origin: 'https://eneltop.com', 'content-type': 'application/json', cookie };
  stream.socket = { remoteAddress: '127.0.0.1' };
  return stream;
}

test('el acceso exige correo configurado, consume el enlace una sola vez y cierra la sesión', async () => {
  const unavailable = response();
  await accounts.requestLink(request('/api/auth/request', { email: 'buyer@example.com' }), unavailable);
  assert.equal(unavailable.status, 503);
  fs.writeFileSync(keyFile, 'test-provider-key', { mode: 0o600 });
  const originalFetch = global.fetch;
  let link;
  global.fetch = async (_url, options) => {
    link = JSON.parse(options.body).text.match(/https:\/\/eneltop\.com\/cuenta\/\?token=[A-Za-z0-9_-]+/)[0];
    return { ok: true };
  };
  try {
    const sent = response();
    await accounts.requestLink(request('/api/auth/request', { email: 'Buyer@Example.com' }), sent);
    assert.equal(sent.status, 200);
    const token = new URL(link).searchParams.get('token');
    const verified = response();
    accounts.verify(request(`/api/auth/verify?token=${token}`), verified);
    assert.equal(verified.status, 200);
    const cookie = verified.headers['Set-Cookie'].split(';')[0];
    assert.equal(accounts.currentEmail(request('/api/account', undefined, cookie)), 'buyer@example.com');
    const repeated = response();
    accounts.verify(request(`/api/auth/verify?token=${token}`), repeated);
    assert.equal(repeated.status, 400);
    const loggedOut = response();
    accounts.logout(request('/api/auth/logout', undefined, cookie), loggedOut);
    assert.equal(accounts.currentEmail(request('/api/account', undefined, cookie)), null);
  } finally { global.fetch = originalFetch; }
});

test('usa Postmark cuando se configura un token de servidor', async () => {
  fs.writeFileSync(path.join(directory, 'postmark-server-token'), 'postmark-test-token', { mode: 0o600 });
  const originalFetch = global.fetch;
  let endpoint, payload;
  global.fetch = async (url, options) => { endpoint = url; payload = JSON.parse(options.body); return { ok: true }; };
  try {
    const sent = response();
    await accounts.requestLink(request('/api/auth/request', { email: 'postmark@example.com' }), sent);
    assert.equal(sent.status, 200);
    assert.equal(endpoint, 'https://api.postmarkapp.com/email');
    assert.equal(payload.To, 'postmark@example.com');
    assert.match(payload.TextBody, /\/cuenta\/\?token=/);
  } finally { global.fetch = originalFetch; }
});
