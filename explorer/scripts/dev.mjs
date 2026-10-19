import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
process.env.PUBLIC_ORIGIN ||= `http://localhost:${process.env.PORT || 3000}`;
await import('./start.mjs');
