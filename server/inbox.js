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
  activeMembers.set(email, { at: Date.now(), active });
}
function isOnline(email) {
  const presence = activeMembers.get(email);
  return Boolean(presence?.active && Date.now() - presence.at < onlineWindow);
}

function read() {
  if (!fs.existsSync(file)) return { threads: [], blocks: [], connections: [], connectionRequests: [] };
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(state.threads)) throw new Error('Invalid inbox state');
  state.blocks ||= [];
  state.connections ||= [];
  state.connectionRequests ||= [];
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
    .map(thread => {
      const other = thread.ownerEmail === email ? thread.senderEmail : thread.ownerEmail;
      const pair = [email, other].sort();
      const request = state.connectionRequests.find(item => item.status === 'pending' &&
        ((item.from === email && item.to === other) || (item.from === other && item.to === email)));
      const connectionState = state.connections.some(item => item.members[0] === pair[0] && item.members[1] === pair[1])
        ? 'connected' : request ? (request.from === email ? 'pending_sent' : 'pending_received') : 'none';
      return ({
      id: thread.id, listingId: thread.listingId, listingName: thread.listingName,
      contactName: thread.ownerEmail === email ? thread.senderName : thread.listingName,
      contactLogo: thread.ownerEmail === email
        ? payments.ownedProjects(thread.senderEmail)[0]?.logo || null
        : payments.shareProject(thread.listingId)?.logo || null,
      contactOnline: isOnline(thread.ownerEmail === email ? thread.senderEmail : thread.ownerEmail),
      contactLastSeen: activeMembers.get(other)?.at ? new Date(activeMembers.get(other).at).toISOString() : null,
      connectionState,
      rejected: Boolean(thread.rejectedAt),
      blocked: state.blocks.some(item => item.by === email && item.target ===
        (thread.ownerEmail === email ? thread.senderEmail : thread.ownerEmail)),
      updatedAt: thread.updatedAt,
      unreadCount: thread.messages.filter(item => item.from !== email && !item.readAt).length,
      messages: thread.messages.map(item => ({ id: item.id, mine: item.from === email,
        text: item.text, at: item.at }))
    });
    });
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
    state.connections = state.connections.filter(item => !item.members.includes(email) || !item.members.includes(other));
    state.connectionRequests = state.connectionRequests.filter(item =>
      !((item.from === email && item.to === other) || (item.from === other && item.to === email)));
  }
  save(state);
  return { ok: true };
}
function profile(email) {
  const project = payments.ownedProjects(email)[0];
  return { name: project?.name || 'Miembro de EnElTop', logo: project?.logo || null };
}
function connectionAction(email, input) {
  const threadId = String(input.threadId || '');
  const action = String(input.action || '');
  if (!validId.test(threadId) || !['request', 'accept', 'decline', 'remove'].includes(action))
    throw new Error('Acción inválida.');
  const state = read();
  const thread = state.threads.find(item => item.id === threadId &&
    (item.ownerEmail === email || item.senderEmail === email));
  if (!thread) throw new Error('Conversación no encontrada.');
  const other = thread.ownerEmail === email ? thread.senderEmail : thread.ownerEmail;
  if (state.blocks.some(item => (item.by === email && item.target === other) ||
    (item.by === other && item.target === email))) throw new Error('No puedes conectar con este miembro.');
  const pair = [email, other].sort();
  const connected = () => state.connections.some(item => item.members[0] === pair[0] && item.members[1] === pair[1]);
  const pending = () => state.connectionRequests.find(item => item.status === 'pending' &&
    ((item.from === email && item.to === other) || (item.from === other && item.to === email)));
  if (action === 'request') {
    if (!connected() && !pending()) state.connectionRequests.push({ id: crypto.randomUUID(), from: email, to: other, status: 'pending', at: new Date().toISOString() });
  } else if (action === 'accept') {
    const request = pending();
    if (!request || request.to !== email) throw new Error('Solicitud no encontrada.');
    request.status = 'accepted'; request.resolvedAt = new Date().toISOString();
    if (!connected()) state.connections.push({ members: pair, at: request.resolvedAt });
  } else if (action === 'decline') {
    const request = pending();
    if (!request || request.to !== email) throw new Error('Solicitud no encontrada.');
    request.status = 'declined'; request.resolvedAt = new Date().toISOString();
  } else {
    state.connections = state.connections.filter(item => item.members[0] !== pair[0] || item.members[1] !== pair[1]);
  }
  save(state);
  return { ok: true };
}
function connections(email) {
  const state = read();
  const threadFor = other => state.threads.find(thread =>
    (thread.ownerEmail === email && thread.senderEmail === other) ||
    (thread.senderEmail === email && thread.ownerEmail === other));
  return {
    requests: state.connectionRequests.filter(item => item.to === email && item.status === 'pending').map(item => {
      const member = profile(item.from), thread = threadFor(item.from);
      return { id: item.id, threadId: thread?.id || null, ...member };
    }),
    contacts: state.connections.filter(item => item.members.includes(email)).map(item => {
      const other = item.members.find(member => member !== email), member = profile(other), thread = threadFor(other);
      return { threadId: thread?.id || null, online: isOnline(other), ...member };
    })
  };
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

module.exports = { list, send, moderate, connectionAction, connections, markRead, setPresence, pendingNotifications, markNotified };
