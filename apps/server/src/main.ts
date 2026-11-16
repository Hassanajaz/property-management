import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from './server.ts';

const port = Number(process.env.PORT ?? 4000);
const dataDir = resolve(process.env.LETTLY_DATA ?? join(import.meta.dirname, '..', '..', '..', 'data'));

const { port: actualPort } = await startServer({ dataDir, port });

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => a!.address);

console.log(`Lettly local server is running.`);
console.log(`  Database: ${join(dataDir, 'lettly.db')}`);
console.log(`  On this computer: http://localhost:${actualPort}`);
for (const address of addresses) console.log(`  From your phone (same Wi-Fi): http://${address}:${actualPort}`);
console.log('Leave this window open. Press Ctrl+C to stop.');
