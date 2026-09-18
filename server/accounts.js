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
  if (!fs.existsSync(file)) return { links: [], sessions: [], requests: [] };
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(state.links) || !Array.isArray(state.sessions) || !Array.isArray(state.requests)) throw new Error('Invalid account state');
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
async function sendAccess(email, link) {
  const subject = 'Accede a tu cuenta de EnElTop';
  const text = `Abre este enlace para acceder a tus proyectos en EnElTop:\n\n${link}\n\nEl enlace caduca en 15 minutos. Si no lo solicitaste, puedes ignorar este correo.`;
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
  if (state.requests.filter(item => item.email === email && item.at > now() - 900000).length >= 3 ||
      state.requests.filter(item => item.ip === hash(ip) && item.at > now() - 3600000).length >= 15)
    return payments.send(response, 429, { error: 'Espera unos minutos antes de solicitar otro enlace.' });
  const token = crypto.randomBytes(32).toString('base64url');
  const link = `${site}/cuenta/?token=${token}`;
  state.requests.push({ email, ip: hash(ip), at: now() });
  state.links.push({ hash: hash(token), email, expires: now() + 900000 });
  save(state);
  try { await sendAccess(email, link); }
  catch (error) { console.error('Access email failed:', error.message); return payments.send(response, 502, { error: 'No se pudo enviar el correo. Inténtalo más tarde.' }); }
  return payments.send(response, 200, { ok: true });
}
function verify(request, response) {
  if (!secureOrigin(request)) return payments.send(response, 403, { error: 'Solicitud no permitida' });
  const token = String(request.url && new URL(request.url, site).searchParams.get('token') || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return payments.send(response, 400, { error: 'Enlace inválido' });
  const state = read(); prune(state);
  const index = state.links.findIndex(item => item.hash === hash(token));
  if (index < 0) return payments.send(response, 400, { error: 'El enlace ha caducado o ya se utilizó.' });
  const [link] = state.links.splice(index, 1);
  const session = crypto.randomBytes(32).toString('base64url');
  state.sessions.push({ hash: hash(session), email: link.email, expires: now() + 30 * 86400000 });
  save(state);
  response.setHeader('Set-Cookie', cookie(session, 30 * 86400));
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

module.exports = { requestLink, verify, logout, account, currentEmail, secureOrigin };
