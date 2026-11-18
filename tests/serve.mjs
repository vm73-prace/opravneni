// Jednoduchý statický server pro testy: node tests/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2] || 8123);
const typy = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = normalize(join(root, p));
  if (!f.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
  try { const b = await readFile(f); res.writeHead(200, { 'content-type': typy[extname(f)] || 'application/octet-stream' }).end(b); }
  catch { res.writeHead(404).end('404'); }
}).listen(port, () => console.log('http://localhost:' + port));
