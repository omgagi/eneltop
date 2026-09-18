const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const net = require('node:net');

const dataDir = process.env.ENELTOP_DATA_DIR || '/var/lib/eneltop';
const avatarDir = path.join(dataDir, 'avatars');
const retryMs = 6 * 60 * 60 * 1000;
const inFlight = new Set();

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const p = address.split('.').map(Number);
    return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127));
  }
  if (net.isIP(address) === 6) return !/^(::|::1$|f[cd]|fe[89ab]|::ffff:(?:10\.|127\.|192\.168\.|172\.))/i.test(address);
  return false;
}

async function safeFetch(url, maxBytes = 2_000_000, redirects = 2) {
  let target = new URL(url);
  for (let i = 0; i <= redirects; i++) {
    if (target.protocol !== 'https:' || target.username || target.password || target.port ||
        net.isIP(target.hostname) || target.hostname === 'localhost') throw new Error('Unsafe image URL');
    const addresses = await dns.lookup(target.hostname, { all: true });
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Unsafe image host');
    const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; eneltop-image-fetch/1.0)' } });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      target = new URL(response.headers.get('location'), target);
      continue;
    }
    if (!response.ok) throw new Error(`Image source ${response.status}`);
    const size = Number(response.headers.get('content-length') || 0);
    if (size > maxBytes) throw new Error('Image too large');
    const chunks = []; let count = 0;
    for await (const chunk of response.body) {
      count += chunk.length;
      if (count > maxBytes) { await response.body.cancel().catch(() => {}); throw new Error('Image too large'); }
      chunks.push(chunk);
    }
    return { body: Buffer.concat(chunks), type: response.headers.get('content-type') || '' };
  }
  throw new Error('Too many redirects');
}

function imageExtension(data) {
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function decodeHtml(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
}

function metaImage(html, base) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["']/i.test(tag)) continue;
    const match = tag.match(/content\s*=\s*["']([^"']+)["']/i);
    if (match) return new URL(decodeHtml(match[1]), base).href;
  }
  return null;
}

function sourceCandidates(profileUrl) {
  const url = new URL(profileUrl);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const handle = url.pathname.split('/').filter(Boolean)[0]?.replace(/^@/, '') || '';
  const candidates = [url.href];
  if (host === 'instagram.com' && /^[A-Za-z0-9._]{1,30}$/.test(handle)) candidates.push(`https://linktr.ee/${handle}`);
  return { host, handle, candidates };
}

async function resolveAvatar(order) {
  const { host, handle, candidates } = sourceCandidates(order.url);
  for (const pageUrl of candidates) {
    try {
      const page = (await safeFetch(pageUrl, 1_000_000)).body.toString('utf8');
      let image = metaImage(page, pageUrl);
      if (host === 'tiktok.com' && pageUrl === order.url) {
        const foundHandle = page.match(/"uniqueId":"([^"]+)"/);
        const foundAvatar = page.match(/"avatarLarger":"([^"]+)"/);
        if (foundHandle?.[1]?.toLowerCase() === handle.toLowerCase() && foundAvatar) image = JSON.parse('"' + foundAvatar[1] + '"');
      }
      if (pageUrl.startsWith('https://linktr.ee/')) {
        const normalized = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
        const title = page.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
        const match = page.match(/<img\b[^>]*data-testid="ProfileImage"[^>]*>/i)?.[0];
        const source = match?.match(/src="([^"]+)"/)?.[1];
        if (!normalized(title).includes(normalized(order.name)) || !source) continue;
        image = decodeHtml(source);
      }
      if (!image) continue;
      const data = (await safeFetch(image)).body;
      const ext = imageExtension(data);
      if (ext && data.length >= 1000) return { data, ext };
    } catch (error) { console.error('Avatar source failed:', new URL(pageUrl).hostname, error.message); }
  }
  // Website logos are resolved from the submitted domain when its page has no usable image.
  if (!['instagram.com', 'tiktok.com'].includes(host)) {
    try {
      const favicon = await fetchFavicon(host);
      if (favicon) return favicon;
    } catch (error) { console.error('Site favicon failed:', host, error.message); }
  }
  return null;
}

async function fetchFavicon(host) {
  const data = (await safeFetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`)).body;
  const ext = imageExtension(data);
  return ext && data.length >= 300 ? { data, ext } : null;
}

async function enrichOne(order, update) {
  if (inFlight.has(order.id)) return;
  inFlight.add(order.id);
  try {
    const image = await resolveAvatar(order);
    if (image) {
      fs.mkdirSync(avatarDir, { recursive: true, mode: 0o755 });
      const filename = `${order.id}.${image.ext}`;
      fs.writeFileSync(path.join(avatarDir, filename), image.data, { mode: 0o644 });
      update(order.id, { logo: `/api/avatar/${filename}`, avatarCheckedAt: new Date().toISOString() });
    } else {
      const patch = { avatarCheckedAt: new Date().toISOString() };
      if (!order.fallbackLogo) {
        patch.faviconCheckedAt = new Date().toISOString();
        try {
          const host = new URL(order.url).hostname.replace(/^www\./, '').toLowerCase();
          const fallback = await fetchFavicon(host);
          if (fallback) {
            fs.mkdirSync(avatarDir, { recursive: true, mode: 0o755 });
            const filename = `${order.id}-fallback.${fallback.ext}`;
            fs.writeFileSync(path.join(avatarDir, filename), fallback.data, { mode: 0o644 });
            patch.fallbackLogo = `/api/avatar/${filename}`;
          }
        } catch (error) { console.error('Fallback favicon failed:', order.id, error.message); }
      }
      update(order.id, patch);
    }
  } catch (error) { console.error('Avatar enrichment failed:', order.id, error.message); }
  finally { inFlight.delete(order.id); }
}

function enrichMissing(orders, update) {
  const now = Date.now();
  for (const order of orders) {
    const profileDue = !order.avatarCheckedAt || now - Date.parse(order.avatarCheckedAt) >= retryMs;
    const fallbackDue = !order.fallbackLogo && !order.faviconCheckedAt;
    if (order.status !== 'paid' || order.logo || inFlight.has(order.id) || (!profileDue && !fallbackDue)) continue;
    void enrichOne(order, update);
  }
}

function serve(filename, response) {
  if (!/^[0-9a-f-]{36}(?:-fallback)?\.(?:jpg|png|webp)$/.test(filename)) return response.writeHead(404).end();
  try {
    const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'payments.json'), 'utf8'));
    const imagePath = `/api/avatar/${filename}`;
    if (!state.orders?.some(order => order.status === 'paid' &&
        (order.logo === imagePath || order.fallbackLogo === imagePath))) return response.writeHead(404).end();
  } catch { return response.writeHead(404).end(); }
  const fullPath = path.join(avatarDir, filename);
  try {
    const data = fs.readFileSync(fullPath);
    const type = filename.endsWith('.jpg') ? 'image/jpeg' : filename.endsWith('.png') ? 'image/png' : 'image/webp';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' }).end(data);
  } catch { response.writeHead(404).end(); }
}

function saveUpload(id, encoded) {
  if (!/^[0-9a-f-]{36}$/.test(id) || typeof encoded !== 'string' || encoded.length > 400_000 ||
      !/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid uploaded image');
  const [,format,payload] = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(encoded);
  const data = Buffer.from(payload, 'base64');
  if (data.length < 50 || data.length > 300_000 || imageExtension(data) !== format) throw new Error('Invalid uploaded image');
  fs.mkdirSync(avatarDir, { recursive: true, mode: 0o755 });
  const filename = `${id}.${format}`;
  fs.writeFileSync(path.join(avatarDir, filename), data, { mode: 0o644, flag: 'wx' });
  return `/api/avatar/${filename}`;
}

module.exports = { enrichMissing, serve, saveUpload };
