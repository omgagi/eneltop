const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const payments = require('./payments');

const dataDir = process.env.ENELTOP_DATA_DIR || '/var/lib/eneltop';
const validId = /^[0-9a-f-]{36}$/;
const html = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function avatarPath(logo) {
  const match = String(logo || '').match(/^\/api\/avatar\/([0-9a-f-]{36}(?:-fallback)?)\.(png|jpg|webp)$/);
  if (!match) return '';
  const file = path.join(dataDir, 'avatars', `${match[1]}.${match[2]}`);
  return fs.existsSync(file) ? file : '';
}

function sharePage(request, response) {
  const id = request.url.match(/^\/p\/([0-9a-f-]{36})(?:\/|\?|$)/)?.[1];
  const project = id && validId.test(id) ? payments.shareProject(id) : null;
  if (!project) return response.writeHead(404).end('Proyecto no disponible');
  if (request.method === 'HEAD')
    return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end();
  const name = html(project.name), category = html(project.category);
  const headline = project.rank === 1
    ? `¡Llegué al #1 de ${category}!`
    : `¡Entré al #${project.rank} de ${category}!`;
  const description = project.rank === 1
    ? `${name} llegó al primer puesto de ${category} en eneltop.com. ¿Quién se anima a superarlo?`
    : `${name} entró al puesto #${project.rank} de ${category} en eneltop.com.`;
  const image = `https://eneltop.com/api/share/card?id=${id}&puesto=${project.rank}`;
  const url = `https://eneltop.com/p/${id}`;
  const ranking = `/?proyecto=${id}#ranking`;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' }).end(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${headline} — eneltop.com</title><meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:site_name" content="eneltop.com">
<meta property="og:title" content="${headline}"><meta property="og:description" content="${description}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${headline}">
<meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${image}">
<style>body{margin:0;background:#f8fafc;color:#1d2a3d;font:18px system-ui,-apple-system,sans-serif}.wrap{max-width:880px;margin:7vh auto;padding:24px}.card{background:white;border:1px solid #dbe4ed;border-radius:28px;overflow:hidden;box-shadow:0 20px 55px #1d2a3d12}.card img{display:block;width:100%;height:auto}.content{padding:26px 36px 38px}.brand{color:#bd503f;font-weight:800;letter-spacing:.06em}.content h1{font-size:clamp(30px,6vw,54px);line-height:1.1;margin:12px 0}.content p{color:#607186;line-height:1.5}.button{display:inline-block;margin-top:14px;padding:15px 26px;border-radius:999px;background:#17576c;color:white;text-decoration:none;font-weight:800}@media(max-width:600px){.wrap{margin:2vh auto;padding:12px}.content{padding:22px}}</style>
</head><body><main class="wrap"><div class="card"><img src="${image}" alt="Tarjeta de ${name} en el ranking de ${category}" width="1200" height="630"><div class="content"><div class="brand">ENELTOP.COM</div><h1>${headline}</h1><p>${name} está en el ranking de ${category}. La posición puede cambiar cuando llegan nuevas ofertas.</p><a class="button" href="${ranking}">Ver el ranking actual →</a></div></div></main><script>fetch('/api/visits',{method:'POST',cache:'no-store',credentials:'same-origin'}).catch(()=>{});</script></body></html>`);
}

function renderCard(project) {
  return new Promise((resolve, reject) => {
    const vendor = path.join(__dirname, 'vendor');
    const child = spawn('python3', [path.join(__dirname, 'share-card.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONPATH: [vendor, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) }
    });
    const chunks = []; let bytes = 0; let errorText = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 3_000_000) child.kill('SIGKILL'); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { errorText += chunk.toString().slice(0, 500); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && bytes > 8) resolve(Buffer.concat(chunks));
      else reject(new Error(`Share image failed: ${errorText || code}`));
    });
    child.stdin.end(JSON.stringify({ name: project.name, category: project.category,
      rank: project.rank, avatarPath: avatarPath(project.logo) }));
  });
}

async function shareCard(request, response) {
  const id = new URL(request.url, 'http://localhost').searchParams.get('id') || '';
  const project = validId.test(id) ? payments.shareProject(id) : null;
  if (!project) return response.writeHead(404).end('Proyecto no disponible');
  if (request.method === 'HEAD')
    return response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff' }).end();
  try {
    const image = await renderCard(project);
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(image);
  } catch (error) {
    console.error(error);
    response.writeHead(503).end('Imagen no disponible');
  }
}

module.exports = { sharePage, shareCard };
