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
  process.env.ENELTOP_MAIL_PROVIDER = 'postmark';
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
  } finally { global.fetch = originalFetch; delete process.env.ENELTOP_MAIL_PROVIDER; }
});

test('el código de compra verifica el correo una vez y crea una sesión', async () => {
  const originalFetch = global.fetch;
  let code;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    code = (body.TextBody || body.text).match(/\b\d{6}\b/)[0];
    return { ok: true };
  };
  try {
    const sent = response();
    await accounts.requestCheckoutCode(request('/api/auth/checkout-code/request', { email: 'New@Example.com' }), sent);
    assert.equal(sent.status, 200);
    assert.match(code, /^\d{6}$/);
    const wrong = response();
    await accounts.verifyCheckoutCode(request('/api/auth/checkout-code/verify', { email: 'new@example.com', code: 'abcdef' }), wrong);
    assert.equal(wrong.status, 400);
    const verified = response();
    await accounts.verifyCheckoutCode(request('/api/auth/checkout-code/verify', { email: 'new@example.com', code }), verified);
    assert.equal(verified.status, 200);
    const session = verified.headers['Set-Cookie'].split(';')[0];
    assert.equal(accounts.currentEmail(request('/api/account', undefined, session)), 'new@example.com');
    const replay = response();
    await accounts.verifyCheckoutCode(request('/api/auth/checkout-code/verify', { email: 'new@example.com', code }), replay);
    assert.equal(replay.status, 400);
  } finally { global.fetch = originalFetch; }
});

test('la recuperación requiere una sesión verificada y nunca cambia el propietario automáticamente', async () => {
  const orderId = '50f391c5-34b1-456e-a272-2cac2b03ae66';
  fs.writeFileSync(path.join(directory, 'payments.json'), JSON.stringify({ orders: [{
    id: orderId, status: 'paid', customerEmail: 'wrong@example.com',
    paymentId: 'pay_recovery', name: 'Recuperar', description: 'Prueba',
    url: 'https://example.com/', category: 'Otros', cents: 50
  }], processed: [] }));
  const denied = response();
  await accounts.requestRecovery(request('/api/account/recovery', { orderId, note: 'Correo equivocado' }), denied);
  assert.equal(denied.status, 401);
  const originalFetch = global.fetch;
  let code;
  global.fetch = async (_url, options) => { code = JSON.parse(options.body).text.match(/\b\d{6}\b/)[0]; return { ok: true }; };
  try {
    const sent = response();
    await accounts.requestCheckoutCode(request('/api/auth/checkout-code/request', { email: 'correct@example.com' }), sent);
    const verified = response();
    await accounts.verifyCheckoutCode(request('/api/auth/checkout-code/verify', { email: 'correct@example.com', code }), verified);
    const session = verified.headers['Set-Cookie'].split(';')[0];
    const accepted = response();
    await accounts.requestRecovery(request('/api/account/recovery', { orderId, note: 'Escribí mal el correo' }, session), accepted);
    assert.equal(accepted.status, 200);
    const state = JSON.parse(fs.readFileSync(path.join(directory, 'accounts.json'), 'utf8'));
    assert.equal(state.recovery.at(-1).status, 'pending');
    assert.equal(state.recovery.at(-1).email, 'correct@example.com');
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'payments.json'), 'utf8')).orders[0].customerEmail, 'wrong@example.com');
  } finally { global.fetch = originalFetch; }
});
