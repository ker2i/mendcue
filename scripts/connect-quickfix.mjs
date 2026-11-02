// Build first. Only public settings are copied into the static website.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tenantConfigSchema } from '../dist/tenant-config.js';
const [origin, tenantPath, outputPath] = process.argv.slice(2);
try {
  if (!origin || !tenantPath) throw Error('Usage: node scripts/connect-quickfix.mjs https://intake.example.com /private/tenant.json [output.json]');
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) throw Error('Use an exact HTTPS backend origin, without a trailing slash.');
  const tenant = tenantConfigSchema.parse(JSON.parse(readFileSync(tenantPath, 'utf8')));
  if (!tenant.allowedOrigins.includes('https://quickfixphx.com')) throw Error('Tenant must allow https://quickfixphx.com.');
  if (tenant.publicKey.includes('replace')) throw Error('Generate a random public widget key before connecting.');
  const path = outputPath || fileURLToPath(new URL('../quickfix-site/mendcue-config.json', import.meta.url));
  writeFileSync(path, JSON.stringify({ enabled: true, backendOrigin: origin, publicKey: tenant.publicKey, tenantSlug: tenant.slug }, null, 2) + '\n');
  console.log('Public website connection settings written. Publish quickfix-site after backend provisioning and HTTPS verification.');
} catch (error) {
  console.error(error instanceof Error && !error.issues ? error.message : 'Invalid tenant configuration. Check the private JSON file.');
  process.exitCode = 1;
}
