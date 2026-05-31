const http = require('http');
const fs = require('fs');
const path = require('path');

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url);
  const file = path.join(__dirname, url === '/' ? 'index.html' : url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); }
    else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end(data); }
  });
}).listen(8888, () => console.log('Serving deploy pages on http://localhost:8888'));
