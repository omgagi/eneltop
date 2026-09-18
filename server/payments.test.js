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
