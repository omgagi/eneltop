const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const avatars = require('./avatars');

const directory = process.env.ENELTOP_DATA_DIR || '/var/lib/eneltop';
const stateFile = path.join(directory, 'payments.json');
const apiKeyFile = process.env.ENELTOP_DODO_API_KEY_FILE || path.join(directory, 'dodo-live-api-key');
const productId = process.env.ENELTOP_DODO_PRODUCT_ID || '';
const categories = new Set(['Rankings', 'SEO', 'Marketing', 'Productividad', 'Agentes', 'Trading', 'Social Media', 'Otros', 'Desarrollo']);
const editorialCents = new Set(Array.from({ length: 72 }, (_, rank) => 443 - Math.round(rank * 343 / 71)));

function readState() {
  if (!fs.existsSync(stateFile)) return { orders: [], processed: [] };
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (!Array.isArray(state.orders) || !Array.isArray(state.processed)) throw new Error('Invalid payment state');
  return state;
}

function writeState(state) {
  const tmp = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, stateFile);
}

function enabled() {
  return Boolean(productId && /^pdt_[A-Za-z0-9]+$/.test(productId) && fs.existsSync(apiKeyFile) &&
    fs.readFileSync(apiKeyFile, 'utf8').trim().length >= 32);
}

function updateAvatar(id, patch) {
  const state = readState();
  const order = state.orders.find(item => item.id === id && item.status === 'paid');
  if (order) { Object.assign(order, patch); writeState(state); }
}

function refreshAvatars() {
  avatars.enrichMissing(readState().orders, updateAvatar);
}

function publicRanking() {
  const orders = readState().orders;
  avatars.enrichMissing(orders, updateAvatar);
  return orders.filter(order => order.status === 'paid').map(({ id, name, description, url, category, cents, paidAt, logo, fallbackLogo }) => ({
    id, name, description, url, category, bid: cents / 100, paidAt,
    logo: logo || fallbackLogo || null, profileImage: Boolean(logo)
  }));
}

function send(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
}

function readJson(request, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('Payload too large')); request.destroy(); }
      else chunks.push(chunk);
    });
    request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } });
    request.on('error', reject);
  });
}

function validate(input) {
  const name = String(input.name || '').trim();
  const description = String(input.description || '').trim();
  let category = String(input.category || '');
  const cents = input.cents;
  let url;
  try { url = new URL(String(input.url || '')); } catch { throw new Error('URL inválida'); }
  if (category === 'Rankings' && /^(?:www\.)?(?:(?:instagram|tiktok|facebook|youtube|linkedin|pinterest|threads)\.com|x\.com|twitch\.tv)$/i.test(url.hostname)) category = 'Social Media';
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 500 ||
      !name || name.length > 50 || !description || description.length > 120 || !categories.has(category) ||
      !Number.isSafeInteger(cents) || cents < 50) throw new Error('Datos inválidos');
  url.search = '';
  url.hash = '';
  return { name, description, category, cents, url: url.href };
}

function reserved(state, cents) {
  if (editorialCents.has(cents)) return true;
  const now = Date.now();
  return state.orders.some(order => order.cents === cents && (order.status === 'paid' ||
    (order.status === 'pending' && now - Date.parse(order.createdAt) < 24 * 60 * 60 * 1000)));
}

async function checkout(request, response) {
  if (!enabled()) return send(response, 503, { error: 'Los pagos aún no están disponibles.' });
  if (!['https://eneltop.com', 'https://www.eneltop.com'].includes(request.headers.origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' || !String(request.headers['content-type'] || '').startsWith('application/json')) {
    return send(response, 403, { error: 'Solicitud no permitida' });
  }
  let details, uploadedLogo;
  try { const input = await readJson(request, 450_000); details = validate(input); uploadedLogo = input.logo || null; }
  catch { return send(response, 400, { error: 'Revisa los datos del proyecto y el importe.' }); }
  const state = readState();
  if (reserved(state, details.cents)) return send(response, 409, { error: 'Ese importe ya ocupa o está reservando un puesto. Elige otro.' });
  const order = { ...details, id: crypto.randomUUID(), status: 'pending', createdAt: new Date().toISOString() };
  if (uploadedLogo) {
    try { order.logo = avatars.saveUpload(order.id, uploadedLogo); }
    catch { return send(response, 400, { error: 'La imagen no es válida. Usa JPG, PNG o WebP de hasta 3 MB.' }); }
  }
  state.orders.push(order);
  writeState(state);
  try {
    const key = fs.readFileSync(apiKeyFile, 'utf8').trim();
    if (key.length < 32) throw new Error('Invalid live key');
    const apiResponse = await fetch('https://live.dodopayments.com/checkouts', {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 eneltop.com' },
      body: JSON.stringify({ product_cart: [{ product_id: productId, quantity: 1, amount: details.cents }],
        return_url: `https://eneltop.com/checkout/resultado/?pedido=${order.id}`,
        metadata: { eneltop_order_id: order.id } })
    });
    if (!apiResponse.ok) throw new Error(`Dodo returned ${apiResponse.status}`);
    const session = await apiResponse.json();
    const checkoutUrl = session.checkout_url || session.url;
    const sessionId = session.session_id || session.id;
    if (!checkoutUrl || !sessionId || !/^https:\/\/([a-z0-9-]+\.)*dodopayments\.com\//i.test(checkoutUrl)) throw new Error('Invalid checkout response');
    const updated = readState();
    const savedOrder = updated.orders.find(item => item.id === order.id);
    savedOrder.sessionId = sessionId;
    writeState(updated);
    return send(response, 200, { checkoutUrl, orderId: order.id });
  } catch (error) {
    console.error('Checkout creation failed:', error.message);
    const updated = readState();
    const savedOrder = updated.orders.find(item => item.id === order.id);
    if (savedOrder && savedOrder.status === 'pending') { savedOrder.status = 'failed'; writeState(updated); }
    return send(response, 502, { error: 'No se pudo abrir el pago. Inténtalo de nuevo.' });
  }
}

function invoiceUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['live.dodopayments.com', 'api.dodopayments.com'].includes(url.hostname) &&
      /^\/invoices\/payments\/pay_[A-Za-z0-9]+$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

function applyPaymentSuccess(state, data, paidAt) {
  const order = state.orders.find(item => item.id === data.metadata?.eneltop_order_id);
  const hasDiscount = Boolean(data.discount_id) || (Array.isArray(data.discounts) && data.discounts.length > 0);
  if (!order || order.status !== 'pending' || order.sessionId !== data.checkout_session_id ||
      data.status !== 'succeeded' || !/^[A-Z]{3}$/.test(data.currency || '') ||
      !Number.isSafeInteger(data.total_amount) || data.total_amount <= 0 ||
      (data.currency === 'USD' && data.total_amount !== order.cents) || hasDiscount ||
      !data.product_cart?.some(item => item.product_id === productId && item.quantity === 1) ||
      typeof data.payment_id !== 'string' || !/^pay_[A-Za-z0-9]+$/.test(data.payment_id) ||
      state.orders.some(item => item.paymentId === data.payment_id) ||
      state.orders.some(item => item.id !== order.id && item.status === 'paid' && item.cents === order.cents)) return false;
  order.status = 'paid';
  order.paymentId = data.payment_id;
  order.paidAt = paidAt;
  order.paidCurrency = data.currency;
  order.paidAmount = data.total_amount;
  order.invoiceUrl = invoiceUrl(data.invoice_url);
  return true;
}

function applyWebhook(id, event) {
  const state = readState();
  if (state.processed.includes(id)) return;
  const data = event.data || {};
  if (event.type === 'payment.succeeded') {
    if (!applyPaymentSuccess(state, data, new Date().toISOString())) console.error('Payment requires review:', id);
  } else if (event.type === 'refund.succeeded') {
    const order = state.orders.find(item => item.paymentId === data.payment_id);
    if (order && order.status === 'paid') { order.status = 'refunded'; order.refundedAt = new Date().toISOString(); }
  } else if (event.type === 'payment.failed' || event.type === 'payment.cancelled') {
    const order = state.orders.find(item => item.id === data.metadata?.eneltop_order_id);
    if (order && order.status === 'pending' && order.sessionId === data.checkout_session_id &&
        data.product_cart?.some(item => item.product_id === productId && item.quantity === 1)) {
      order.status = 'failed';
    }
  }
  state.processed.push(id);
  writeState(state);
  if (event.type === 'payment.succeeded') avatars.enrichMissing(state.orders, updateAvatar);
}

function reconcileEvents(eventsFile) {
  if (!fs.existsSync(eventsFile)) return 0;
  const state = readState();
  let recovered = 0;
  for (const line of fs.readFileSync(eventsFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.event?.type !== 'payment.succeeded') continue;
    const data = record.event.data || {};
    if (applyPaymentSuccess(state, data, record.receivedAt || new Date().toISOString())) { recovered++; continue; }
    const order = state.orders.find(item => item.status === 'paid' && item.paymentId === data.payment_id);
    const link = invoiceUrl(data.invoice_url);
    if (order && !order.invoiceUrl && link) { order.invoiceUrl = link; recovered++; }
  }
  if (recovered) writeState(state);
  return recovered;
}

function orderStatus(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const order = readState().orders.find(item => item.id === id);
  return order ? { status: order.status, name: order.name, cents: order.cents, category: order.category,
    invoiceUrl: order.status === 'paid' ? order.invoiceUrl || null : null } : null;
}

module.exports = { enabled, publicRanking, refreshAvatars, checkout, applyWebhook, reconcileEvents, orderStatus, send };
