const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const payments = require('./payments');

const directory = process.env.ENELTOP_DATA_DIR || '/var/lib/eneltop';
const file = path.join(directory, 'accounts.json');
const mailKeyFile = process.env.ENELTOP_MAIL_KEY_FILE || path.join(directory, 'resend-api-key');
const postmarkKeyFile = process.env.ENELTOP_POSTMARK_KEY_FILE || path.join(directory, 'postmark-server-token');
const mailFrom = process.env.ENELTOP_MAIL_FROM || 'EnElTop <acceso@eneltop.com>';
const site = 'https://eneltop.com';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const now = () => Date.now();

function read() {
  if (!fs.existsSync(file)) return { links: [], sessions: [], requests: [], codes: [], recovery: [] };
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(state.links) || !Array.isArray(state.sessions) || !Array.isArray(state.requests)) throw new Error('Invalid account state');
  state.codes ||= [];
  state.recovery ||= [];
  return state;
}
function save(state) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function prune(state) {
  state.links = state.links.filter(item => item.expires > now());
  state.sessions = state.sessions.filter(item => item.expires > now());
  state.requests = state.requests.filter(item => item.at > now() - 3600000);
  state.codes = state.codes.filter(item => item.expires > now() && item.attempts < 5);
}
function secureOrigin(request) {
  return [site, 'https://www.eneltop.com'].includes(request.headers.origin) && request.headers['sec-fetch-site'] !== 'cross-site';
}
function tokenFromCookie(request) {
  return (request.headers.cookie || '').match(/(?:^|;\s*)eneltop_session=([A-Za-z0-9_-]{43})/)?.[1] || '';
}
function currentEmail(request) {
  const token = tokenFromCookie(request);
  if (!token) return null;
  const item = read().sessions.find(entry => entry.hash === hash(token) && entry.expires > now());
  return item?.email || null;
}
function cookie(token, age) {
  return `eneltop_session=${token}; Max-Age=${age}; Path=/; Domain=eneltop.com; HttpOnly; Secure; SameSite=Lax`;
}
async function sendEmail(email, subject, text) {
  let response;
  if (fs.existsSync(postmarkKeyFile) &&
      (!fs.existsSync(mailKeyFile) || process.env.ENELTOP_MAIL_PROVIDER === 'postmark')) {
    const key = fs.readFileSync(postmarkKeyFile, 'utf8').trim();
    response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'X-Postmark-Server-Token': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ From: mailFrom, To: email, Subject: subject, TextBody: text, MessageStream: 'outbound' })
    });
  } else {
    if (!fs.existsSync(mailKeyFile)) throw new Error('Email provider is not configured');
    const key = fs.readFileSync(mailKeyFile, 'utf8').trim();
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: mailFrom, to: [email], subject, text })
    });
  }
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
}
function sendAccess(email, link) {
  return sendEmail(email, 'Accede a tu cuenta de EnElTop',
    `Abre este enlace para acceder a tus proyectos en EnElTop:\n\n${link}\n\nEl enlace caduca en 15 minutos. Si no lo solicitaste, puedes ignorar este correo.`);
}
function sendInboxNotice(email, listingName) {
  return sendEmail(email, 'Tienes un mensaje nuevo en EnElTop',
    `Tienes un mensaje nuevo sobre ${listingName} en tu inbox de EnElTop.\n\nLéelo y responde aquí: ${site}/cuenta/#inbox\n\nTu correo no se muestra a otros miembros.`);
}
function requestAllowed(state, email, ip) {
  return state.requests.filter(item => item.email === email && item.at > now() - 900000).length < 3 &&
    state.requests.filter(item => item.ip === hash(ip) && item.at > now() - 3600000).length < 15;
}
function recordRequest(state, email, ip) { state.requests.push({ email, ip: hash(ip), at: now() }); }
function sessionFor(email, response) {
  const token = crypto.randomBytes(32).toString('base64url');
  response.setHeader('Set-Cookie', cookie(token, 30 * 86400));
  return { hash: hash(token), email, expires: now() + 30 * 86400000 };
}
async function requestLink(request, response) {
  if (!secureOrigin(request) || !String(request.headers['content-type'] || '').startsWith('application/json'))
    return payments.send(response, 403, { error: 'Solicitud no permitida' });
  let body;
  try { body = await payments.readJson(request, 1000); } catch { return payments.send(response, 400, { error: 'Correo inválido' }); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!validEmail(email)) return payments.send(response, 400, { error: 'Correo inválido' });
  if (!fs.existsSync(postmarkKeyFile) && !fs.existsSync(mailKeyFile))
    return payments.send(response, 503, { error: 'El acceso por correo estará disponible próximamente.' });
  const state = read(); prune(state);
  const ip = String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim();
  if (!requestAllowed(state, email, ip))
    return payments.send(response, 429, { error: 'Espera unos minutos antes de solicitar otro enlace.' });
  const token = crypto.randomBytes(32).toString('base64url');
  const contact = /^[0-9a-f-]{36}$/.test(body.contact || '') ? `&contact=${body.contact}` : '';
  const link = `${site}/cuenta/?token=${token}${contact}`;
  recordRequest(state, email, ip);
  state.links.push({ hash: hash(token), email, expires: now() + 900000 });
  save(state);
  try { await sendAccess(email, link); }
  catch (error) { console.error('Access email failed:', error.message); return payments.send(response, 502, { error: 'No se pudo enviar el correo. Inténtalo más tarde.' }); }
  return payments.send(response, 200, { ok: true });
}
async function requestCheckoutCode(request, response) {
  if (!secureOrigin(request) || !String(request.headers['content-type'] || '').startsWith('application/json'))
    return payments.send(response, 403, { error: 'Solicitud no permitida' });
  let body;
  try { body = await payments.readJson(request, 1000); } catch { return payments.send(response, 400, { error: 'Correo inválido' }); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!validEmail(email)) return payments.send(response, 400, { error: 'Correo inválido' });
  if (currentEmail(request) === email) return payments.send(response, 200, { verified: true, email });
  if (!fs.existsSync(postmarkKeyFile) && !fs.existsSync(mailKeyFile))
    return payments.send(response, 503, { error: 'La verificación por correo no está disponible.' });
  const state = read(); prune(state);
  const ip = String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim();
  if (!requestAllowed(state, email, ip))
    return payments.send(response, 429, { error: 'Espera unos minutos antes de solicitar otro código.' });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = crypto.randomBytes(16).toString('hex');
  state.codes = state.codes.filter(item => item.email !== email);
  state.codes.push({ email, salt, hash: hash(`${salt}:${code}`), expires: now() + 600000, attempts: 0 });
  recordRequest(state, email, ip); save(state);
  try { await sendEmail(email, 'Verifica tu correo para publicar en EnElTop',
    `Tu código para continuar con el pago en EnElTop es ${code}.\n\nCaduca en 10 minutos. Si no lo solicitaste, ignora este mensaje.`); }
  catch (error) { console.error('Checkout email failed:', error.message); return payments.send(response, 502, { error: 'No se pudo enviar el código. Inténtalo más tarde.' }); }
  return payments.send(response, 200, { sent: true, email });
}
async function verifyCheckoutCode(request, response) {
  if (!secureOrigin(request) || !String(request.headers['content-type'] || '').startsWith('application/json'))
    return payments.send(response, 403, { error: 'Solicitud no permitida' });
  let body;
  try { body = await payments.readJson(request, 1000); } catch { return payments.send(response, 400, { error: 'Código inválido' }); }
  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  if (!validEmail(email) || !/^\d{6}$/.test(code)) return payments.send(response, 400, { error: 'Código inválido' });
  const state = read(); prune(state);
  const item = state.codes.find(entry => entry.email === email);
  if (!item) return payments.send(response, 400, { error: 'Código caducado. Solicita otro.' });
  const expected = Buffer.from(item.hash, 'hex');
  const supplied = Buffer.from(hash(`${item.salt}:${code}`), 'hex');
  if (!crypto.timingSafeEqual(expected, supplied)) {
    item.attempts++; save(state);
    return payments.send(response, 400, { error: 'Código incorrecto.' });
  }
  state.codes = state.codes.filter(entry => entry !== item);
  state.sessions.push(sessionFor(email, response)); save(state);
  return payments.send(response, 200, { verified: true, email });
}
function verify(request, response) {
  if (!secureOrigin(request)) return payments.send(response, 403, { error: 'Solicitud no permitida' });
  const token = String(request.url && new URL(request.url, site).searchParams.get('token') || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return payments.send(response, 400, { error: 'Enlace inválido' });
  const state = read(); prune(state);
  const index = state.links.findIndex(item => item.hash === hash(token));
  if (index < 0) return payments.send(response, 400, { error: 'El enlace ha caducado o ya se utilizó.' });
  const [link] = state.links.splice(index, 1);
  state.sessions.push(sessionFor(link.email, response));
  save(state);
  return payments.send(response, 200, { ok: true });
}
function logout(request, response) {
  if (!secureOrigin(request)) return payments.send(response, 403, { error: 'Solicitud no permitida' });
  const token = tokenFromCookie(request);
  if (token) { const state = read(); state.sessions = state.sessions.filter(item => item.hash !== hash(token)); save(state); }
  response.setHeader('Set-Cookie', cookie('', 0));
  return payments.send(response, 200, { ok: true });
}
function account(request, response) {
  const email = currentEmail(request);
  if (!email) return payments.send(response, 401, { error: 'Inicia sesión con tu correo.' });
  return payments.send(response, 200, { email, projects: payments.ownedProjects(email) });
}
async function requestRecovery(request, response) {
  if (!secureOrigin(request) || !String(request.headers['content-type'] || '').startsWith('application/json'))
    return payments.send(response, 403, { error: 'Solicitud no permitida' });
  const email = currentEmail(request);
  if (!email) return payments.send(response, 401, { error: 'Verifica tu correo para solicitar una revisión.' });
  let body;
  try { body = await payments.readJson(request, 1500); } catch { return payments.send(response, 400, { error: 'Datos inválidos' }); }
  const id = String(body.orderId || '').trim().toLowerCase();
  const note = String(body.note || '').trim();
  if (!/^[0-9a-f-]{36}$/.test(id) || !note || note.length > 500)
    return payments.send(response, 400, { error: 'Incluye el enlace del puesto y una breve explicación.' });
  if (!payments.reviewableOrder(id, email))
    return payments.send(response, 404, { error: 'No encontramos ese puesto para revisar.' });
  const state = read();
  if (state.recovery.filter(item => item.email === email && item.at > now() - 86400000).length >= 3)
    return payments.send(response, 429, { error: 'Espera antes de enviar otra solicitud.' });
  const isNew = !state.recovery.some(item => item.orderId === id && item.email === email && item.status === 'pending');
  if (isNew) state.recovery.push({ id: crypto.randomUUID(), orderId: id, email, note, status: 'pending', at: now() });
  save(state);
  const reviewer = process.env.ENELTOP_RECOVERY_EMAIL;
  if (isNew && validEmail(reviewer)) {
    try { await sendEmail(reviewer, 'Revisión de propietario en EnElTop',
      `Hay una solicitud de revisión para https://eneltop.com/p/${id}.\n\nCorreo verificado del solicitante: ${email}\n\nConsulta la cola en ai1 y verifica el pago en Dodo antes de cambiar el propietario.`); }
    catch (error) { console.error('Recovery notification failed:', error.message); }
  }
  return payments.send(response, 200, { ok: true });
}

module.exports = { requestLink, requestCheckoutCode, verifyCheckoutCode, requestRecovery, verify, logout, account, currentEmail, secureOrigin, sendInboxNotice };
