// Tiny screenshot receiver: the game page POSTs canvas.toDataURL() here and
// this writes it to _acorn_work/shots/<name>.png. Dev/verification only.
const http = require('http');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'shots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
  const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot')
    .replace(/[^a-z0-9_-]/gi, '_');
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const m = body.match(/^data:image\/png;base64,(.+)$/);
    if (!m) { res.statusCode = 400; res.end('bad dataURL'); return; }
    const file = path.join(outDir, name + '.png');
    fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
    console.log('saved', file);
    res.end('ok');
  });
}).listen(8124, () => console.log('shot server on 8124'));
