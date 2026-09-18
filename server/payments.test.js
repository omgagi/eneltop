const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eneltop-payments-'));
process.env.ENELTOP_DATA_DIR = directory;
process.env.ENELTOP_DODO_PRODUCT_ID = 'pdt_testproduct';
const avatars = require('./avatars');
avatars.enrichMissing = () => {};
const payments = require('./payments');
const stateFile = path.join(directory, 'payments.json');

test('acepta una imagen PNG subida y comprueba su formato real', () => {
  const id = '4fffd52c-c92b-4613-a7c6-d035b8a2a853';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lK0AAAAASUVORK5CYII=';
  const uploaded = avatars.saveUpload(id, `data:image/png;base64,${png}`);
  assert.equal(uploaded, `/api/avatar/${id}.png`);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'avatars', `${id}.png`)), Buffer.from(png, 'base64'));
  assert.throws(() => avatars.saveUpload('4fffd52c-c92b-4613-a7c6-d035b8a2a854', `data:image/webp;base64,${png}`));
});

function setOrder() {
  fs.writeFileSync(stateFile, JSON.stringify({ orders: [{
    id: '33b74c11-57ed-4ae2-a55e-2817b99514c9', name: 'Proyecto', description: 'Descripción',
    url: 'https://example.com/', category: 'Otros', cents: 444, status: 'pending',
    createdAt: new Date().toISOString(), sessionId: 'cks_real'
  }], processed: [] }));
}

function event(overrides = {}) {
  return { type: 'payment.succeeded', data: {
    metadata: { eneltop_order_id: '33b74c11-57ed-4ae2-a55e-2817b99514c9' },
    checkout_session_id: 'cks_real', status: 'succeeded', currency: 'USD', total_amount: 444,
    product_cart: [{ product_id: 'pdt_testproduct', quantity: 1 }], payment_id: 'pay_real', ...overrides
  } };
}

test('solo publica el pago asociado al pedido y al importe exacto', () => {
  setOrder();
  payments.applyWebhook('msg_sample', event({ checkout_session_id: 'cks_example' }));
  assert.equal(payments.publicRanking().length, 0);
  payments.applyWebhook('msg_wrong_amount', event({ total_amount: 400 }));
  assert.equal(payments.publicRanking().length, 0);
  payments.applyWebhook('msg_real', event());
  payments.applyWebhook('msg_real', event());
  assert.equal(payments.publicRanking().length, 1);
  assert.equal(payments.orderStatus('33b74c11-57ed-4ae2-a55e-2817b99514c9').status, 'paid');
  payments.applyWebhook('msg_refund', { type: 'refund.succeeded', data: { payment_id: 'pay_real' } });
  assert.equal(payments.publicRanking().length, 0);
  assert.equal(payments.orderStatus('33b74c11-57ed-4ae2-a55e-2817b99514c9').status, 'refunded');
});

test('publica la oferta original cuando Dodo cobra en moneda local', () => {
  setOrder();
  payments.applyWebhook('msg_eur', event({ currency: 'EUR', total_amount: 387 }));
  assert.equal(payments.publicRanking()[0].bid, 4.44);
  assert.equal(payments.orderStatus('33b74c11-57ed-4ae2-a55e-2817b99514c9').status, 'paid');
});

test('reiniciar el ranking conserva el cobro original y excluye pedidos anteriores', () => {
  setOrder();
  payments.applyWebhook('msg_reset', event({ currency: 'EUR', total_amount: 387 }));
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const order = state.orders[0];
  order.rankingCents = 50;
  order.rankedAt = '2026-09-18T12:00:00.000Z';
  state.orders.push({ id: 'old-paid', name: 'Anterior', description: 'Archivado',
    url: 'https://example.org/', category: 'Otros', cents: 55, status: 'paid',
    paidAt: '2026-09-17T19:00:00.000Z', hiddenFromRanking: true });
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const ranking = payments.publicRanking();
  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].bid, 0.50);
  assert.equal(ranking[0].rankedAt, '2026-09-18T12:00:00.000Z');
  assert.equal(payments.orderStatus(order.id).cents, 444);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).orders[0].paidAmount, 387);
});

test('el puesto compartido cambia cuando otro proyecto supera la oferta', () => {
  setOrder();
  payments.applyWebhook('msg_first', event());
  const id = '33b74c11-57ed-4ae2-a55e-2817b99514c9';
  assert.equal(payments.shareProject(id).rank, 1);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.orders[0].customerEmail = 'owner@example.com';
  state.orders.push({ id: '64df84f4-a579-47a0-9674-83c9b58c6b1e', name: 'Nuevo líder',
    description: 'Proyecto', url: 'https://example.org/', category: 'Otros',
    cents: 445, status: 'paid', paidAt: new Date().toISOString() });
  fs.writeFileSync(stateFile, JSON.stringify(state));
  assert.equal(payments.shareProject(id).rank, 2);
  assert.equal(payments.orderStatus(id).share.rank, 2);
  assert.equal(payments.ownedProjects('owner@example.com')[0].rank, 2);
  assert.equal(payments.ownedProjects('owner@example.com')[0].firstPlaceBid, 4.46);
});

test('recupera un evento firmado que se había archivado sin publicar', () => {
  setOrder();
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.processed.push('msg_previous');
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const eventsFile = path.join(directory, 'dodo-events.jsonl');
  fs.writeFileSync(eventsFile, JSON.stringify({ id: 'msg_previous', receivedAt: '2026-09-17T22:26:11.333Z',
    event: event({ currency: 'EUR', total_amount: 387 }) }) + '\n');
  assert.equal(payments.reconcileEvents(eventsFile), 1);
  assert.equal(payments.reconcileEvents(eventsFile), 0);
  assert.equal(payments.publicRanking()[0].bid, 4.44);
});

test('recupera el enlace de factura de un pago ya confirmado', () => {
  setOrder();
  const url = 'https://live.dodopayments.com/invoices/payments/pay_real';
  payments.applyWebhook('msg_paid', event({ invoice_url: url }));
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  delete state.orders[0].invoiceUrl;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const eventsFile = path.join(directory, 'dodo-events-invoice.jsonl');
  fs.writeFileSync(eventsFile, JSON.stringify({ id: 'msg_paid', receivedAt: new Date().toISOString(),
    event: event({ invoice_url: url }) }) + '\n');
  assert.equal(payments.reconcileEvents(eventsFile), 1);
  assert.equal(payments.orderStatus('33b74c11-57ed-4ae2-a55e-2817b99514c9').invoiceUrl, url);
});

test('dos pagos del mismo importe se publican y el primero confirmado conserva el puesto', () => {
  setOrder();
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.orders.push({ ...state.orders[0], id: 'a29c59c4-aacf-44ec-84ec-1c908a700397', sessionId: 'cks_second' });
  fs.writeFileSync(stateFile, JSON.stringify(state));
  payments.applyWebhook('msg_same_first', event({ customer: { email: 'buyer@example.com' } }));
  payments.applyWebhook('msg_same_second', event({ metadata: { eneltop_order_id: 'a29c59c4-aacf-44ec-84ec-1c908a700397' },
    checkout_session_id: 'cks_second', payment_id: 'pay_second', customer: { email: 'other@example.com' } }));
  assert.equal(payments.publicRanking().length, 2);
  assert.equal(payments.shareProject(state.orders[0].id).rank, 1);
  assert.equal(payments.shareProject(state.orders[1].id).rank, 2);
  assert.equal(payments.ownedProjects('buyer@example.com').length, 1);
  assert.equal(payments.ownedProjects('other@example.com').length, 1);
  assert.equal(payments.editOwnedProject('other@example.com', state.orders[0].id, { url: 'https://changed.example/' }), null);
  assert.equal(payments.editOwnedProject('buyer@example.com', state.orders[0].id, { url: 'https://changed.example/' }).url, 'https://changed.example/');
});

test('una nueva oferta pagada actualiza la ficha existente y el reembolso restaura su importe', () => {
  setOrder();
  payments.applyWebhook('msg_base', event({ customer: { email: 'owner@example.com' } }));
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const base = state.orders[0];
  const upgradeId = '302ee845-c088-49cd-afb7-992501d0ad8c';
  state.orders.push({ ...base, id: upgradeId, cents: 500, status: 'pending',
    sessionId: 'cks_upgrade', upgradeOf: base.id, paymentId: undefined });
  fs.writeFileSync(stateFile, JSON.stringify(state));
  payments.applyWebhook('msg_upgrade', event({ metadata: { eneltop_order_id: upgradeId },
    checkout_session_id: 'cks_upgrade', total_amount: 500, payment_id: 'pay_upgrade',
    customer: { email: 'owner@example.com' } }));
  assert.equal(payments.publicRanking().length, 1);
  assert.equal(payments.publicRanking()[0].bid, 5);
  assert.equal(payments.orderStatus(upgradeId).share.id, base.id);
  payments.applyWebhook('msg_upgrade_refund', { type: 'refund.succeeded', data: { payment_id: 'pay_upgrade' } });
  assert.equal(payments.publicRanking()[0].bid, 4.44);
});

test('el checkout exige correo verificado y el puesto conserva ese propietario aunque Dodo use otro correo', async () => {
  const key = path.join(directory, 'dodo-live-api-key');
  fs.writeFileSync(key, 'a'.repeat(40), { mode: 0o600 });
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ checkout_url: 'https://checkout.dodopayments.com/session/cks_test', session_id: 'cks_test' }) };
  };
  const body = { name: 'Verificado', description: 'Proyecto', url: 'https://example.org/',
    category: 'Otros', cents: 50, email: 'owner@example.com' };
  const { Readable } = require('node:stream');
  const request = () => {
    const stream = Readable.from([Buffer.from(JSON.stringify(body))]);
    stream.headers = { origin: 'https://eneltop.com', 'content-type': 'application/json' };
    return stream;
  };
  const response = () => ({ status: 0, body: '', writeHead(status) { this.status = status; return this; },
    end(body) { this.body = body; return this; } });
  try {
    const blocked = response();
    await payments.checkout(request(), blocked, null);
    assert.equal(blocked.status, 401);
    const mismatch = response();
    await payments.checkout(request(), mismatch, 'someoneelse@example.com');
    assert.equal(mismatch.status, 403);
    const accepted = response();
    await payments.checkout(request(), accepted, 'owner@example.com');
    assert.equal(accepted.status, 200);
    assert.equal(payload.customer.email, 'owner@example.com');
    const orderId = JSON.parse(accepted.body).orderId;
    payments.applyWebhook('msg_verified_owner', { type: 'payment.succeeded', data: {
      metadata: { eneltop_order_id: orderId }, checkout_session_id: 'cks_test', status: 'succeeded',
      currency: 'USD', total_amount: 50, product_cart: [{ product_id: 'pdt_testproduct', quantity: 1 }],
      payment_id: 'pay_verifiedowner', customer: { email: 'mistyped@example.com' }
    } });
    assert.equal(payments.ownedProjects('owner@example.com').some(item => item.id === orderId), true);
    assert.equal(payments.ownedProjects('mistyped@example.com').some(item => item.id === orderId), false);
  } finally { global.fetch = originalFetch; }
});
