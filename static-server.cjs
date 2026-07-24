// Tiny static server for the game/ directory (for local screenshots / playtest).
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "game");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const fp = path.join(root, p);
  if (!fp.startsWith(root)) { res.writeHead(403); res.end("403"); return; }
  fs.readFile(fp, (e, data) => {
    if (e) { res.writeHead(404); res.end("404 " + p); return; }
    res.writeHead(200, { "content-type": types[path.extname(fp)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(3010, () => console.log("serving game/ on http://localhost:3010"));
