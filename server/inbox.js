const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const payments = require('./payments');

const directory = process.env.ENELTOP_DATA_DIR || '/var/lib/eneltop';
const file = path.join(directory, 'inbox.json');
const validId = /^[0-9a-f-]{36}$/;

function read() {
  if (!fs.existsSync(file)) return { threads: [] };
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(state.threads)) throw new Error('Invalid inbox state');
  return state;
}
function save(state) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function list(email) {
  return read().threads.filter(thread => thread.ownerEmail === email || thread.senderEmail === email)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map(thread => ({
      id: thread.id, listingId: thread.listingId, listingName: thread.listingName,
      contactName: thread.ownerEmail === email ? thread.senderName : thread.listingName,
      updatedAt: thread.updatedAt,
      unreadCount: thread.messages.filter(item => item.from !== email && !item.readAt).length,
      messages: thread.messages.map(item => ({ id: item.id, mine: item.from === email,
        text: item.text, at: item.at }))
    }));
}
function markRead(email, threadId) {
  if (!validId.test(threadId)) throw new Error('Conversación no encontrada.');
  const state = read();
  const thread = state.threads.find(item => item.id === threadId &&
    (item.ownerEmail === email || item.senderEmail === email));
  if (!thread) throw new Error('Conversación no encontrada.');
  const unread = thread.messages.filter(item => item.from !== email && !item.readAt);
  if (unread.length) {
    const at = new Date().toISOString();
    for (const item of unread) item.readAt = at;
    save(state);
  }
  return { read: unread.length };
}
function send(email, input) {
  if (!payments.ownedProjects(email).length)
    throw new Error('Debes ser miembro del ranking para poder contactar a alguien.');
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > 2000) throw new Error('Escribe un mensaje de hasta 2000 caracteres.');
  const state = read();
  let thread;
  if (input.threadId) {
    if (!validId.test(input.threadId)) throw new Error('Conversación no encontrada.');
    thread = state.threads.find(item => item.id === input.threadId &&
      (item.ownerEmail === email || item.senderEmail === email));
    if (!thread) throw new Error('Conversación no encontrada.');
  } else {
    const listingId = String(input.listingId || '');
    const recipient = payments.messageRecipient(listingId);
    if (!recipient) throw new Error('Este puesto no tiene un propietario disponible para mensajes.');
    if (recipient.email === email) throw new Error('Este puesto ya es tuyo.');
    thread = state.threads.find(item => item.listingId === listingId && item.senderEmail === email &&
      item.ownerEmail === recipient.email);
    if (!thread) {
      thread = { id: crypto.randomUUID(), listingId, listingName: recipient.name,
        ownerEmail: recipient.email, senderEmail: email,
        senderName: payments.ownedProjects(email)[0]?.name || 'Miembro de EnElTop',
        messages: [], updatedAt: new Date().toISOString() };
      state.threads.push(thread);
    }
  }
  const at = new Date().toISOString();
  thread.messages.push({ id: crypto.randomUUID(), from: email, text, at });
  thread.updatedAt = at;
  save(state);
  return { id: thread.id };
}
function pendingNotifications() {
  return read().threads.flatMap(thread => thread.messages.filter(item => !item.notifiedAt).map(item => ({
    messageId: item.id, to: item.from === thread.ownerEmail ? thread.senderEmail : thread.ownerEmail,
    listingName: thread.listingName
  })));
}
function markNotified(messageId) {
  const state = read();
  const message = state.threads.flatMap(thread => thread.messages).find(item => item.id === messageId);
  if (!message || message.notifiedAt) return;
  message.notifiedAt = new Date().toISOString();
  save(state);
}

module.exports = { list, send, markRead, pendingNotifications, markNotified };
