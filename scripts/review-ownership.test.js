const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

test('la revisión manual exige el identificador de pago y deja constancia del cambio', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eneltop-review-'));
  const requestId = '510fe742-a503-4dae-ad41-7045fe179529';
  const orderId = '4eca68d8-6e88-457a-a164-28069c21dd9e';
  const accountsFile = path.join(directory, 'accounts.json');
  const paymentsFile = path.join(directory, 'payments.json');
  fs.writeFileSync(accountsFile, JSON.stringify({ recovery: [{ id: requestId, orderId,
    email: 'correct@example.com', status: 'pending', at: Date.now(), note: 'Correo erróneo' }] }));
  fs.writeFileSync(paymentsFile, JSON.stringify({ orders: [{ id: orderId, paymentId: 'pay_real',
    status: 'paid', customerEmail: 'wrong@example.com' }] }));
  const run = (...args) => execFileSync(process.execPath, [path.join(__dirname, 'review-ownership.js'), ...args],
    { env: { ...process.env, ENELTOP_DATA_DIR: directory }, encoding: 'utf8' });
  assert.match(run('list'), /correct@example.com/);
  const rejected = spawnSync(process.execPath, [path.join(__dirname, 'review-ownership.js'),
    'approve', requestId, 'pay_other', 'Dodo ticket 123'],
  { env: { ...process.env, ENELTOP_DATA_DIR: directory }, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /no coincide/);
  assert.equal(JSON.parse(fs.readFileSync(paymentsFile)).orders[0].customerEmail, 'wrong@example.com');
  run('approve', requestId, 'pay_real', 'Dodo ticket 123');
  assert.equal(JSON.parse(fs.readFileSync(paymentsFile)).orders[0].customerEmail, 'correct@example.com');
  assert.equal(JSON.parse(fs.readFileSync(accountsFile)).recovery[0].status, 'approved');
});
