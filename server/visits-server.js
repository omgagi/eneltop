const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const payments = require('./payments');
const accounts = require('./accounts');
const avatars = require('./avatars');
const share = require('./share');
const inbox = require('./inbox');
const noticesInFlight = new Set();
async function deliverInboxNotices() {
  for (const notice of inbox.pendingNotifications()) {
    if (noticesInFlight.has(notice.messageId)) continue;
    noticesInFlight.add(notice.messageId);
    try { await accounts.sendInboxNotice(notice.to, notice.listingName); inbox.markNotified(notice.messageId); }
    catch (error) { console.error('Inbox notice failed:', error.message); }
    finally { noticesInFlight.delete(notice.messageId); }
  }
}
setTimeout(() => deliverInboxNotices().catch(console.error), 5000);
setInterval(() => deliverInboxNotices().catch(console.error), 60 * 1000);
setTimeout(() => { try { payments.refreshAvatars(); } catch (error) { console.error(error); } }, 1000);
setInterval(() => { try { payments.refreshAvatars(); } catch (error) { console.error(error); } }, 15 * 60 * 1000);

const file = process.env.ENELTOP_VISITS_FILE || '/var/lib/eneltop/visits.json';
const port = Number(process.env.ENELTOP_VISITS_PORT || 8788);
const baseline = Number(process.env.ENELTOP_VISITS_BASELINE || 0);
const allowedOrigins = new Set(['https://eneltop.com', 'https://www.eneltop.com']);
const secretFile = process.env.ENELTOP_VISITS_SECRET_FILE || path.join(path.dirname(file), 'visitor-secret');
const waitlistFile = process.env.ENELTOP_WAITLIST_FILE || path.join(path.dirname(file), 'waitlist.json');
const dodoSecretFile = process.env.ENELTOP_DODO_WEBHOOK_SECRET_FILE || path.join(path.dirname(file), 'dodo-webhook-secret');
const dodoEventsFile = process.env.ENELTOP_DODO_EVENTS_FILE || path.join(path.dirname(file), 'dodo-events.jsonl');
try { payments.reconcileEvents(dodoEventsFile); } catch (error) { console.error('Payment reconciliation failed:', error); }
setInterval(() => { try { payments.reconcileEvents(dodoEventsFile); } catch (error) { console.error('Payment reconciliation failed:', error); } }, 60 * 1000);
const cookieName = 'eneltop_visitor';
const waitlistCategories = new Set(['Rankings', 'SEO', 'Marketing', 'Productividad', 'Agentes', 'Trading', 'Social Media', 'Otros', 'Desarrollo']);
const validCustomCategory = value => typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} .,&/()+-]{1,39}$/u.test(value);

fs.mkdirSync(path.dirname(file), { recursive: true });
if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ count: baseline }), { mode: 0o600 });
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
const secret = fs.readFileSync(secretFile);

function signedVisitor() {
  const id = crypto.randomBytes(16).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(id).digest('base64url');
  return `${id}.${signature}`;
}

function hasValidVisitor(request) {
  const match = (request.headers.cookie || '').match(/(?:^|;\s*)eneltop_visitor=([^;]+)/);
  if (!match) return false;
  const [id, signature] = match[1].split('.');
  if (!id || !signature || !/^[A-Za-z0-9_-]{22}$/.test(id)) return false;
  const expected = crypto.createHmac('sha256', secret).update(id).digest('base64url');
  const actual = Buffer.from(signature);
  const correct = Buffer.from(expected);
  return actual.length === correct.length && crypto.timingSafeEqual(actual, correct);
}

function readCount() {
  const count = JSON.parse(fs.readFileSync(file, 'utf8')).count;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid visit count');
  return count;
}

function writeCount(count) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ count }), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function saveWaitlist(entry) {
  const entries = fs.existsSync(waitlistFile) ? JSON.parse(fs.readFileSync(waitlistFile, 'utf8')) : [];
  if (!Array.isArray(entries)) throw new Error('Invalid waitlist');
  const previous = entries.findIndex(item => item.email === entry.email);
  if (previous >= 0) entries[previous] = { ...entries[previous], ...entry };
  else entries.push(entry);
  const temporary = `${waitlistFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entries), { mode: 0o600 });
  fs.renameSync(temporary, waitlistFile);
  return entries.length;
}

function listCustomCategories() {
  if (!fs.existsSync(waitlistFile)) return [];
  const entries = JSON.parse(fs.readFileSync(waitlistFile, 'utf8'));
  if (!Array.isArray(entries)) throw new Error('Invalid waitlist');
  return [...new Set(entries.map(item => item.category).filter(name => validCustomCategory(name) && !waitlistCategories.has(name)))].slice(0, 100).sort((a, b) => a.localeCompare(b, 'es'));
}

function handleDodoWebhook(request, response) {
  if (request.method !== 'POST') return response.writeHead(405).end(JSON.stringify({ error: 'Method not allowed' }));
  if (!fs.existsSync(dodoSecretFile)) return response.writeHead(503).end(JSON.stringify({ error: 'Webhook not configured' }));
  const id = String(request.headers['webhook-id'] || '');
  const timestamp = String(request.headers['webhook-timestamp'] || '');
  const signatures = String(request.headers['webhook-signature'] || '');
  if (!/^[\w-]{1,128}$/.test(id) || !/^\d{10}$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return response.writeHead(401).end(JSON.stringify({ error: 'Invalid webhook' }));
  }
  const chunks = [];
  let length = 0;
  request.on('data', chunk => {
    length += chunk.length;
    if (length > 65536) { response.writeHead(413).end(JSON.stringify({ error: 'Payload too large' })); request.destroy(); }
    else chunks.push(chunk);
  });
  request.on('end', () => {
    try {
      const raw = Buffer.concat(chunks);
      const stored = fs.readFileSync(dodoSecretFile, 'utf8').trim();
      if (!/^whsec_[A-Za-z0-9+/=_-]+$/.test(stored)) throw new Error('Invalid webhook secret configuration');
      const key = Buffer.from(stored.slice(6), 'base64');
      const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), raw]);
      const expected = crypto.createHmac('sha256', key).update(signed).digest();
      const valid = signatures.split(/\s+/).some(item => {
        if (!item.startsWith('v1,')) return false;
        const given = Buffer.from(item.slice(3), 'base64');
        return given.length === expected.length && crypto.timingSafeEqual(given, expected);
      });
      if (!valid) return response.writeHead(401).end(JSON.stringify({ error: 'Invalid signature' }));
      const event = JSON.parse(raw.toString('utf8'));
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') return response.writeHead(400).end(JSON.stringify({ error: 'Invalid payload' }));
      // Keep an audit trail. Ranking changes require a verified checkout-to-listing mapping.
      if (['payment.succeeded', 'payment.failed', 'payment.cancelled', 'refund.succeeded'].includes(event.type)) {
        payments.applyWebhook(id, event);
        fs.appendFileSync(dodoEventsFile, JSON.stringify({ id, receivedAt: new Date().toISOString(), event }) + '\n', { mode: 0o600 });
      }
      response.writeHead(200).end(JSON.stringify({ received: true }));
    } catch (error) {
      console.error(error);
      response.writeHead(500).end(JSON.stringify({ error: 'Webhook unavailable' }));
    }
  });
}

function handleWaitlist(request, response) {
  if (request.method !== 'POST') return response.writeHead(405).end(JSON.stringify({ error: 'Method not allowed' }));
  if (!allowedOrigins.has(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site') return response.writeHead(403).end(JSON.stringify({ error: 'Forbidden' }));
  if (!String(request.headers['content-type'] || '').startsWith('application/json')) return response.writeHead(415).end(JSON.stringify({ error: 'Expected JSON' }));
  let body = '';
  request.on('data', chunk => { body += chunk; if (body.length > 4096) request.destroy(); });
  request.on('end', () => {
    try {
      const data = JSON.parse(body);
      const email = String(data.email || '').trim().toLowerCase();
      const url = new URL(String(data.url || ''));
      const category = String(data.category || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
          !['https:', 'http:'].includes(url.protocol) || url.href.length > 500 ||
          !(waitlistCategories.has(category) || validCustomCategory(category)) || data.consent !== true) {
        return response.writeHead(400).end(JSON.stringify({ error: 'Invalid submission' }));
      }
      saveWaitlist({ email, url: url.href, category, consentAt: new Date().toISOString() });
      response.writeHead(200).end(JSON.stringify({ ok: true, confirmationSent: false }));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) return response.writeHead(400).end(JSON.stringify({ error: 'Invalid submission' }));
      console.error(error);
      response.writeHead(500).end(JSON.stringify({ error: 'Unable to save' }));
    }
  });
}

const server = http.createServer((request, response) => {
  if (['GET', 'HEAD'].includes(request.method) && /^\/p\/[0-9a-f-]{36}(?:\/|\?|$)/.test(request.url || ''))
    return share.sharePage(request, response);
  if (['GET', 'HEAD'].includes(request.method) && request.url?.startsWith('/api/share/card?'))
    return share.shareCard(request, response);
  if (request.method === 'GET' && request.url?.startsWith('/api/avatar/'))
    return avatars.serve(request.url.slice('/api/avatar/'.length), response);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (request.url === '/api/ranking' && request.method === 'GET') {
    try { return payments.send(response, 200, { projects: payments.publicRanking(), paymentsEnabled: payments.enabled() }); }
    catch (error) { console.error(error); return payments.send(response, 500, { error: 'Ranking unavailable' }); }
  }
  if (request.url === '/api/checkout' && request.method === 'POST') return payments.checkout(request, response, accounts.currentEmail(request));
  if (request.url === '/api/auth/request' && request.method === 'POST') return accounts.requestLink(request, response);
  if (request.url === '/api/auth/checkout-code/request' && request.method === 'POST') return accounts.requestCheckoutCode(request, response);
  if (request.url === '/api/auth/checkout-code/verify' && request.method === 'POST') return accounts.verifyCheckoutCode(request, response);
  if (request.url?.startsWith('/api/auth/verify?') && request.method === 'POST') return accounts.verify(request, response);
  if (request.url === '/api/auth/logout' && request.method === 'POST') return accounts.logout(request, response);
  if (request.url === '/api/account' && request.method === 'GET') return accounts.account(request, response);
  if (request.url === '/api/account/messages' && request.method === 'GET') {
    const email = accounts.currentEmail(request);
    if (!email) return payments.send(response, 401, { error: 'Inicia sesión con tu correo.' });
    return payments.send(response, 200, { threads: inbox.list(email) });
  }
  if (request.url === '/api/account/messages/read' && request.method === 'POST') {
    if (!accounts.secureOrigin(request)) return payments.send(response, 403, { error: 'Solicitud no permitida' });
    const email = accounts.currentEmail(request);
    if (!email) return payments.send(response, 401, { error: 'Inicia sesión con tu correo.' });
    return payments.readJson(request, 1000).then(input =>
      payments.send(response, 200, inbox.markRead(email, input?.threadId)))
      .catch(error => payments.send(response, 400, { error: error.message }));
  }
  if (request.url === '/api/account/messages' && request.method === 'POST') {
    if (!accounts.secureOrigin(request)) return payments.send(response, 403, { error: 'Solicitud no permitida' });
    const email = accounts.currentEmail(request);
    if (!email) return payments.send(response, 401, { error: 'Inicia sesión con tu correo.' });
    return payments.readJson(request, 4000).then(input => {
      const result = inbox.send(email, input || {});
      setImmediate(() => deliverInboxNotices().catch(console.error));
      return payments.send(response, 200, result);
    })
      .catch(error => payments.send(response, 400, { error: error.message }));
  }
  if (request.url === '/api/account/recovery' && request.method === 'POST') return accounts.requestRecovery(request, response);
  if (request.url?.startsWith('/api/account/bid/') && request.method === 'POST') {
    if (!accounts.secureOrigin(request)) return payments.send(response, 403, { error: 'Solicitud no permitida' });
    const email = accounts.currentEmail(request);
    if (!email) return payments.send(response, 401, { error: 'Inicia sesión con tu correo.' });
    const id = request.url.slice('/api/account/bid/'.length);
    if (!/^[0-9a-f-]{36}$/.test(id)) return payments.send(response, 404, { error: 'Proyecto no encontrado' });
    return payments.readJson(request, 1000).then(input => payments.bidForOwnedProject(email, id, input.cents, response))
      .catch(() => payments.send(response, 400, { error: 'Importe inválido' }));
  }
  if (request.url?.startsWith('/api/account/projects/') && request.method === 'PATCH') {
    if (!accounts.secureOrigin(request)) return payments.send(response, 403, { error: 'Solicitud no permitida' });
    const email = accounts.currentEmail(request);
    if (!email) return payments.send(response, 401, { error: 'Inicia sesión con tu correo.' });
    const id = request.url.slice('/api/account/projects/'.length);
    if (!/^[0-9a-f-]{36}$/.test(id)) return payments.send(response, 404, { error: 'Proyecto no encontrado' });
    return payments.readJson(request, 450_000).then(input => {
      const result = payments.editOwnedProject(email, id, input);
      return payments.send(response, result ? 200 : 404, result || { error: 'Proyecto no encontrado' });
    }).catch(error => payments.send(response, 400, { error: error.message === 'URL inválida' ? error.message : 'Revisa la URL o la imagen.' }));
  }
  if (request.url?.startsWith('/api/checkout/status?') && request.method === 'GET') {
    try { const id = new URL(request.url, 'http://localhost').searchParams.get('id') || ''; const status = payments.orderStatus(id); return payments.send(response, status ? 200 : 404, status || { error: 'Pedido no encontrado' }); }
    catch (error) { console.error(error); return payments.send(response, 500, { error: 'Estado no disponible' }); }
  }
  if (request.url === '/api/waitlist/categories' && request.method === 'GET') {
    try { return response.writeHead(200).end(JSON.stringify({ categories: listCustomCategories() })); }
    catch (error) { console.error(error); return response.writeHead(500).end(JSON.stringify({ error: 'Unable to list categories' })); }
  }
  if (request.url === '/api/waitlist') return handleWaitlist(request, response);
  if (request.url === '/api/dodo/webhook') return handleDodoWebhook(request, response);
  if (request.url !== '/api/visits' || !['GET', 'POST'].includes(request.method)) {
    response.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  if (request.method === 'POST' &&
      ((request.headers.origin && !allowedOrigins.has(request.headers.origin)) ||
       request.headers['sec-fetch-site'] === 'cross-site')) {
    response.writeHead(403).end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }
  try {
    const current = readCount();
    const newVisitor = request.method === 'POST' && !hasValidVisitor(request);
    const count = newVisitor ? current + 1 : current;
    if (!Number.isSafeInteger(count)) throw new Error('Visit count overflow');
    if (newVisitor) {
      writeCount(count);
      response.setHeader('Set-Cookie', `${cookieName}=${signedVisitor()}; Max-Age=31536000; Path=/; Domain=eneltop.com; HttpOnly; Secure; SameSite=Lax`);
    }
    response.writeHead(200).end(JSON.stringify({ count }));
  } catch (error) {
    console.error(error);
    response.writeHead(500).end(JSON.stringify({ error: 'Counter unavailable' }));
  }
});

server.listen(port, '127.0.0.1');
