// cache-server.mjs — serves the bridge's on-disk cache of large external files
// (the Kokoro ONNX model, ~92 MB) with CORS and Range support, so they never
// travel through the DevTools protocol. Usage: CACHE_DIR=... node cache-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const DIR = process.env.CACHE_DIR || './cache';
const PORT = Number(process.env.CACHE_PORT || 10064);
http.createServer((req, res) => {
  const file = path.join(DIR, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(path.resolve(DIR)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(file).size;
  const MIME = { '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.onnx': 'application/octet-stream' };
  const h = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), end = m[2] && m[1] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { ...h, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...h, 'content-length': size });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`cache-server on http://127.0.0.1:${PORT} serving ${path.resolve(DIR)}`));
