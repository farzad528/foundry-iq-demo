// Serves dist/vercel locally the way Vercel does: static files from public/ with the vercel.json headers, and the four
// API routes through the built server bundle. Binds 127.0.0.1 only. Usage: node scripts/serve.mjs (PORT defaults to 3000).
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROUTES = Object.freeze({ '/api/scenarios': 'scenarios', '/api/health': 'health', '/healthz': 'health', '/api/demo/prepare': 'prepare', '/api/demo/run': 'run' });
const TYPES = Object.freeze({ '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json' });
// The app enforces its own 64 KiB request limit; this only stops an unbounded local upload.
const MAX_BODY_BYTES = 1024 * 1024;

/** Creates (but doesn't start) a local server for a built dist/vercel directory. */
export async function createLocalServer({ dir = fileURLToPath(new URL('../dist/vercel', import.meta.url)), env = process.env } = {}) {
  const root = resolve(dir);
  if (!existsSync(join(root, 'server', 'app.mjs'))) throw new Error('dist/vercel is missing. Run npm run build first.');
  const { app } = await import(pathToFileURL(join(root, 'server', 'app.mjs')).href);
  const headers = Object.fromEntries(JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).headers[0].headers.map(({ key, value }) => [key, value]));
  const publicDir = join(root, 'public');
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const route = ROUTES[url.pathname];
      if (route) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) { res.writeHead(413).end(); return; }
          chunks.push(chunk);
        }
        const request = new Request(url, { method: req.method, headers: req.headers,
          ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
        const response = await app.handle(route, request, env);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      const name = url.pathname === '/' ? 'index.html' : url.pathname === '/about' ? 'about.html' : decodeURIComponent(url.pathname.slice(1));
      const path = resolve(publicDir, name);
      if (!path.startsWith(publicDir + sep) || !existsSync(path) || statSync(path).isDirectory()) {
        // Like Vercel: unmatched paths get public/404.html with status 404.
        res.writeHead(404, { ...headers, 'Content-Type': TYPES['.html'] });
        res.end(readFileSync(join(publicDir, '404.html')));
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(readFileSync(path));
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Local server error.');
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  const server = await createLocalServer();
  server.listen(port, '127.0.0.1', () => process.stdout.write(`Foundry IQ Demo Studio on http://localhost:${port} (Ctrl+C to stop)\n`));
}
