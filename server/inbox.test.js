const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eneltop-inbox-'));
process.env.ENELTOP_DATA_DIR = directory;
require('./avatars').enrichMissing = () => {};
const inbox = require('./inbox');
const ownerId = '11111111-1111-4111-8111-111111111111';
const senderId = '22222222-2222-4222-8222-222222222222';
fs.writeFileSync(path.join(directory, 'payments.json'), JSON.stringify({ orders: [
  { id: ownerId, name: 'Proyecto Uno', url: 'https://one.example/', category: 'Otros',
    cents: 100, status: 'paid', customerEmail: 'owner@example.com' },
  { id: senderId, name: 'Proyecto Dos', url: 'https://two.example/', category: 'Otros',
    cents: 99, status: 'paid', customerEmail: 'sender@example.com' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Proyecto Tres', url: 'https://three.example/', category: 'Otros',
    cents: 98, status: 'paid', customerEmail: 'third@example.com' }
], processed: [] }));

test('solo los miembros pueden escribir y cada participante ve su conversación sin correos ajenos', () => {
  assert.throws(() => inbox.send('visitor@example.com', { listingId: ownerId, text: 'Hola' }), /Debes ser miembro/);
  assert.throws(() => inbox.send('owner@example.com', { listingId: ownerId, text: 'Hola' }), /ya es tuyo/);
  const first = inbox.send('sender@example.com', { listingId: ownerId, text: 'Hola' });
  const notice = inbox.pendingNotifications()[0];
  assert.equal(notice.to, 'owner@example.com');
  inbox.markNotified(notice.messageId);
  assert.equal(inbox.pendingNotifications().length, 0);
  assert.equal(inbox.list('stranger@example.com').length, 0);
  const received = inbox.list('owner@example.com')[0];
  assert.equal(received.contactName, 'Proyecto Dos');
  assert.equal(received.contactOnline, false);
  inbox.setPresence('sender@example.com', true);
  assert.equal(inbox.list('owner@example.com')[0].contactOnline, true);
  inbox.setPresence('sender@example.com', false);
  assert.equal(inbox.list('owner@example.com')[0].contactOnline, false);
  assert.equal(received.messages[0].text, 'Hola');
  assert.equal(received.unreadCount, 1);
  assert.equal(inbox.list('sender@example.com')[0].unreadCount, 0);
  assert.throws(() => inbox.markRead('stranger@example.com', first.id), /Conversación no encontrada/);
  assert.deepEqual(inbox.markRead('owner@example.com', first.id), { read: 1 });
  assert.equal(inbox.list('owner@example.com')[0].unreadCount, 0);
  assert.equal(JSON.stringify(received).includes('sender@example.com'), false);
  assert.throws(() => inbox.send('stranger@example.com', { threadId: first.id, text: 'Intrusión' }), /Debes ser miembro/);
  assert.throws(() => inbox.send('other@example.com', { threadId: first.id, text: 'Intrusión' }), /Debes ser miembro/);
  inbox.send('owner@example.com', { threadId: first.id, text: 'Gracias' });
  assert.equal(inbox.list('sender@example.com')[0].unreadCount, 1);
  assert.equal(inbox.pendingNotifications().length, 0);
  inbox.send('sender@example.com', { listingId: ownerId, text: 'Otra pregunta' });
  assert.equal(inbox.list('sender@example.com').length, 1);
  assert.deepEqual(inbox.list('sender@example.com')[0].messages.map(message => message.mine), [true, false, true]);
  assert.deepEqual(inbox.moderate('owner@example.com', { threadId: first.id, action: 'reject' }), { ok: true });
  assert.equal(inbox.list('owner@example.com')[0].rejected, true);
  assert.throws(() => inbox.send('sender@example.com', { threadId: first.id, text: '¿Sigues ahí?' }), /rechazada/);
});

test('bloquear un miembro impide conversaciones actuales y nuevas', () => {
  const thread = inbox.send('third@example.com', { listingId: ownerId, text: 'Nuevo chat' });
  inbox.moderate('owner@example.com', { threadId: thread.id, action: 'block' });
  assert.equal(inbox.list('owner@example.com')[0].blocked, true);
  assert.throws(() => inbox.send('third@example.com', { listingId: ownerId, text: 'Insistir' }), /No puedes contactar/);
});
