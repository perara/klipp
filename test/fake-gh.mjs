// GitHub CLI stand-in: refuses inherited host credentials and stores its marker under the box.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (
  process.env.GH_TOKEN ||
  process.env.GITHUB_TOKEN ||
  !process.env.GH_CONFIG_DIR ||
  !process.env.HOME
)
  process.exit(9);
const marker = join(process.env.GH_CONFIG_DIR, 'fake-login');
if (args[0] === '--version') {
  console.log('gh version 9.9.9 (fake)');
  process.exit(0);
}
if (args[0] !== 'auth' || !args.includes('github.com')) process.exit(8);
if (args[1] === 'status') process.exit(existsSync(marker) ? 0 : 1);
if (args[1] === 'token') {
  if (!existsSync(marker)) process.exit(1);
  console.log(readFileSync(marker, 'utf8'));
  process.exit(0);
}
if (args[1] === 'logout') {
  rmSync(marker, { force: true });
  process.exit(0);
}
if (args[1] === 'login') {
  if (!args.includes('--web') || !args.includes('--insecure-storage') || !args.includes('https'))
    process.exit(7);
  console.error('! First copy your one-time code: GHAB-CDEF');
  console.error('Open https://github.com/login/device');
  await new Promise((done) => setTimeout(done, 2000));
  writeFileSync(marker, 'gho_fake_secret', { mode: 0o600 });
  process.exit(0);
}
process.exit(6);
