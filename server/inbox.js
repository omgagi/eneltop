const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const payments = require('./payments');

const directory = process.env.ENELTOP_DATA_DIR || '/var/lib/eneltop';
const file = path.join(directory, 'inbox.json');
const validId = /^[0-9a-f-]{36}$/;
const activeMembers = new Map();
const onlineWindow = 45_000;

function setPresence(email, active) {
  if (active) activeMembers.set(email, Date.now());
  else activeMembers.delete(email);
}
function isOnline(email) {
  const lastSeen = activeMembers.get(email) || 0;
  if (Date.now() - lastSeen < onlineWindow) return true;
  activeMembers.delete(email);
  return false;
}

function read() {
  if (!fs.existsSync(file)) return { threads: [], blocks: [] };
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(state.threads)) throw new Error('Invalid inbox state');
  state.blocks ||= [];
  return state;
}
function save(state) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function list(email) {
  const state = read();
  return state.threads.filter(thread => thread.ownerEmail === email || thread.senderEmail === email)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map(thread => ({
      id: thread.id, listingId: thread.listingId, listingName: thread.listingName,
      contactName: thread.ownerEmail === email ? thread.senderName : thread.listingName,
      contactLogo: thread.ownerEmail === email
        ? payments.ownedProjects(thread.senderEmail)[0]?.logo || null
        : payments.shareProject(thread.listingId)?.logo || null,
      contactOnline: isOnline(thread.ownerEmail === email ? thread.senderEmail : thread.ownerEmail),
      rejected: Boolean(thread.rejectedAt),
      blocked: state.blocks.some(item => item.by === email && item.target ===
        (thread.ownerEmail === email ? thread.senderEmail : thread.ownerEmail)),
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
    if (thread.rejectedAt) throw new Error('Esta conversación fue rechazada y está cerrada.');
    const other = thread.ownerEmail === email ? thread.senderEmail : thread.ownerEmail;
    if (state.blocks.some(item => (item.by === email && item.target === other) ||
      (item.by === other && item.target === email))) throw new Error('Esta conversación está bloqueada.');
  } else {
    const listingId = String(input.listingId || '');
    const recipient = payments.messageRecipient(listingId);
    if (!recipient) throw new Error('Este puesto no tiene un propietario disponible para mensajes.');
    if (recipient.email === email) throw new Error('Este puesto ya es tuyo.');
    if (state.blocks.some(item => (item.by === email && item.target === recipient.email) ||
      (item.by === recipient.email && item.target === email))) throw new Error('No puedes contactar a este miembro.');
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
  thread.messages.push({ id: crypto.randomUUID(), from: email, text, at,
    ...(thread.messages.length ? { notifiedAt: at } : {}) });
  thread.updatedAt = at;
  save(state);
  return { id: thread.id };
}
function moderate(email, input) {
  const threadId = String(input.threadId || '');
  const action = String(input.action || '');
  if (!validId.test(threadId) || !['reject', 'block'].includes(action)) throw new Error('Acción inválida.');
  const state = read();
  const thread = state.threads.find(item => item.id === threadId &&
    (item.ownerEmail === email || item.senderEmail === email));
  if (!thread) throw new Error('Conversación no encontrada.');
  const other = thread.ownerEmail === email ? thread.senderEmail : thread.ownerEmail;
  if (action === 'reject') {
    thread.rejectedAt ||= new Date().toISOString();
    thread.rejectedBy ||= email;
  } else if (!state.blocks.some(item => item.by === email && item.target === other)) {
    state.blocks.push({ by: email, target: other, at: new Date().toISOString() });
  }
  save(state);
  return { ok: true };
}
function pendingNotifications() {
  return read().threads.flatMap(thread => thread.messages.slice(0, 1).filter(item => !item.notifiedAt).map(item => ({
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

module.exports = { list, send, moderate, markRead, setPresence, pendingNotifications, markNotified };
