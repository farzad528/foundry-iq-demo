import { createNodeServer } from '../lib/http.mjs';

let application;
try {
  ({ default: application } = await import('../dist/server/index.mjs'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  throw new Error('Explorer prebuilt artifact is missing. Run npm run build before npm start.');
}
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const server = createNodeServer(application, process.env);
server.listen(port, '0.0.0.0', () => process.stdout.write(`Foundry IQ customer demos listening on port ${port}\n`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
