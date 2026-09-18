const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eneltop-share-'));
process.env.ENELTOP_DATA_DIR = directory;
const avatars = require('./avatars');
avatars.enrichMissing = () => {};
const share = require('./share');
const id = '6337ea49-7d5c-4787-bfd4-b2da9c5071eb';
const stateFile = path.join(directory, 'payments.json');

function response() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers; return this; },
    end(body) { this.body = body; return this; } };
}

test('la página compartida muestra el puesto actual y metadatos de imagen', () => {
  fs.writeFileSync(stateFile, JSON.stringify({ processed: [], orders: [
    { id, name: 'Antonio Lozada', description: 'Proyecto', url: 'https://example.com/',
      category: 'Social Media', cents: 444, rankingCents: 50, status: 'paid',
      paidAt: '2026-09-17T22:26:11.333Z' }
  ] }));
  const first = response();
  share.sharePage({ url: `/p/${id}` }, first);
  assert.equal(first.status, 200);
  assert.match(first.body, /Llegué al #1 de Social Media/);
  assert.match(first.body, /property="og:image"/);
  const head = response();
  share.sharePage({ method: 'HEAD', url: `/p/${id}` }, head);
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.orders.push({ id: '8f3c315a-13be-43a2-80c6-278876f32f60', name: 'Otro',
    description: 'Proyecto', url: 'https://example.org/', category: 'Social Media',
    cents: 51, status: 'paid', paidAt: new Date().toISOString() });
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const second = response();
  share.sharePage({ url: `/p/${id}` }, second);
  assert.match(second.body, /Entré al #2 de Social Media/);
});

test('la imagen compartida es un PNG de 1200 × 630', async () => {
  const head = response();
  await share.shareCard({ method: 'HEAD', url: `/api/share/card?id=${id}` }, head);
  assert.equal(head.status, 200);
  const result = response();
  await share.shareCard({ url: `/api/share/card?id=${id}` }, result);
  assert.equal(result.status, 200);
  assert.equal(result.headers['Content-Type'], 'image/png');
  assert.equal(result.body.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(result.body.readUInt32BE(16), 1200);
  assert.equal(result.body.readUInt32BE(20), 630);
});
