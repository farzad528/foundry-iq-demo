// Vercel Git builds: npm run build:vercel writes dist/vercel; this serves its server bundle. See docs/OPERATIONS.md.
import { app } from '../../dist/vercel/server/app.mjs';

export function POST(request) {
  return app.handle('prepare', request, process.env);
}
