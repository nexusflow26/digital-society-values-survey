// Local preview: serves public/ and the api/ functions on http://localhost:3000
// Uses the in-memory store unless KV_REST_API_URL / KV_REST_API_TOKEN are set.
// Usage: node scripts/dev-server.js   (optionally ADMIN_KEY=test node scripts/dev-server.js)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const apiMatch = url.pathname.match(/^\/api\/([a-z]+)$/);
    if (apiMatch) {
      const file = path.join(ROOT, 'api', `${apiMatch[1]}.js`);
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
      return require(file)(req, res);
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(ROOT, 'public', path.normalize(rel));
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`Survey running at http://localhost:${PORT}`));
}
module.exports = { createServer };
