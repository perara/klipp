// Prints the CHANGELOG.md section for one version, for its GitHub release.
// Usage: node scripts/release-notes.mjs 0.4.0
import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) throw new Error('Usage: node scripts/release-notes.mjs <version>');
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const start = changelog.search(new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?`, 'm'));
if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}.`);
const rest = changelog.slice(start).split('\n').slice(1);
const end = rest.findIndex((line) => /^## |^\[[^\]]+\]: /.test(line));
const notes = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
if (!notes) throw new Error(`The CHANGELOG.md section for ${version} is empty.`);
const install = `npm install -D https://github.com/perara/klipp/releases/download/v${version}/klipp-${version}.tgz`;
process.stdout.write(`${notes}\n\n**Install**\n\n\`\`\`bash\n${install}\n\`\`\`\n`);
