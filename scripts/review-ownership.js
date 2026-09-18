#!/usr/bin/env node
'use strict';

// Run on ai1 only, after stopping eneltop-visits.service and verifying proof in Dodo.
const fs = require('node:fs');
const path = require('node:path');

const directory = process.env.ENELTOP_DATA_DIR || '/var/lib/eneltop';
const accountsFile = path.join(directory, 'accounts.json');
const paymentsFile = path.join(directory, 'payments.json');
const [action, requestId, paymentId, evidence] = process.argv.slice(2);

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  const original = fs.statSync(file);
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  if (process.getuid?.() === 0) fs.chownSync(temp, original.uid, original.gid);
  fs.renameSync(temp, file);
}

if (action === 'list') {
  const accounts = read(accountsFile);
  const payments = read(paymentsFile);
  for (const item of accounts.recovery || []) {
    if (item.status !== 'pending') continue;
    const order = payments.orders.find(entry => entry.id === item.orderId);
    console.log(JSON.stringify({ requestId: item.id, orderId: item.orderId,
      claimantEmail: item.email, currentOwner: order?.customerEmail || null,
      paymentId: order?.paymentId || null, note: item.note,
      createdAt: new Date(item.at).toISOString() }));
  }
} else if (action === 'approve') {
  if (!/^[0-9a-f-]{36}$/.test(requestId || '') || !/^pay_[A-Za-z0-9]+$/.test(paymentId || '') ||
      !evidence || evidence.length < 8 || evidence.length > 200) {
    console.error('Uso: review-ownership.js approve REQUEST_UUID DODO_PAYMENT_ID "referencia de prueba revisada"');
    process.exit(2);
  }
  const accounts = read(accountsFile);
  const request = (accounts.recovery || []).find(item => item.id === requestId && item.status === 'pending');
  if (!request) throw new Error('Solicitud pendiente no encontrada');
  const payments = read(paymentsFile);
  const order = payments.orders.find(item => item.id === request.orderId && item.status === 'paid' && !item.hiddenFromRanking);
  if (!order || order.paymentId !== paymentId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.email))
    throw new Error('El pago confirmado de Dodo no coincide con este puesto');
  const previousOwner = order.customerEmail || null;
  order.customerEmail = request.email;
  order.ownershipReviewedAt = new Date().toISOString();
  write(paymentsFile, payments);
  request.status = 'approved';
  request.previousOwner = previousOwner;
  request.reviewedAt = order.ownershipReviewedAt;
  request.evidence = evidence;
  write(accountsFile, accounts);
  console.log(`Propietario actualizado para ${order.id}. Solicitud ${request.id} aprobada.`);
} else {
  console.error('Uso: review-ownership.js list | approve REQUEST_UUID DODO_PAYMENT_ID "referencia de prueba revisada"');
  process.exit(2);
}
