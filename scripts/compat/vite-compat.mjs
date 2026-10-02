// Checks Klipp against each supported Vite major, the way an app would install it: the packed
// tarball next to that Vite. Builds a small JSX app with Klipp on, and starts its dev server.
// Usage: node scripts/compat/vite-compat.mjs [majors...]   (default: 5 6 7 8)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const majors = process.argv.slice(2).length ? process.argv.slice(2) : ['5', '6', '7', '8'];
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Always a fresh tarball, made from the current build.
const packs = mkdtempSync(join(tmpdir(), 'klipp-pack-'));
run('npm', ['pack', '--quiet', '--pack-destination', packs], root);
const packed = join(packs, `klipp-${version}.tgz`);

const app = {
  'index.html':
    '<!doctype html><html><head><title>compat</title></head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>',
  'main.jsx': [
    '/** @jsx h */',
    'const h = (tag, props, ...children) => ({ tag, props, children });',
    'function Card() { return <section className="card"><button type="button">Save</button></section>; }',
    'export const tree = <main><Card /><p>hello</p></main>;',
    'document.getElementById("root").textContent = JSON.stringify(tree);',
  ].join('\n'),
  'vite.config.mjs':
    // Classic JSX with h(): esbuild's options for Vite 5-7, Oxc's for Vite 8.
    "import klipp from 'klipp/vite';\nexport default { esbuild: { jsxFactory: 'h' }, oxc: { jsx: { runtime: 'classic', pragma: 'h' } }, plugins: [klipp({ repo: 'https://github.com/a/b', commit: 'abc', chat: false })] };\n",
};

let failed = 0;
for (const major of majors) {
  const dir = mkdtempSync(join(tmpdir(), `klipp-vite${major}-`));
  const check = (ok, what) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed++;
  };
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'compat', private: true, type: 'module' }),
    );
    for (const [file, text] of Object.entries(app)) writeFileSync(join(dir, file), text);
    run(
      'npm',
      ['install', '--no-audit', '--no-fund', '--ignore-scripts', `vite@${major}`, packed],
      dir,
    );
    const vite = JSON.parse(
      readFileSync(join(dir, 'node_modules/vite/package.json'), 'utf8'),
    ).version;
    console.log(`vite ${vite}`);

    // Build, with Klipp turned on.
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
      cwd: dir,
      env: { ...process.env, KLIPP: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const manifest = JSON.parse(readFileSync(join(dir, 'dist/klipp-manifest.json'), 'utf8'));
    const names = Object.values(manifest.entries)
      .map((e) => e.name)
      .sort();
    check(
      names.join(',') === 'Card,button,main,p,section',
      `build: manifest lists the JSX sites (${names.join(', ')})`,
    );
    const js = readdirSync(join(dir, 'dist/assets')).filter((f) => f.endsWith('.js'));
    const bundle = js.map((f) => readFileSync(join(dir, 'dist/assets', f), 'utf8')).join('\n');
    check(/data-klipp/.test(bundle), 'build: elements carry data-klipp');
    check(/klipp-manifest\.json/.test(bundle), 'build: the runtime is bundled');

    // Dev server.
    const { createServer } = await import(join(dir, 'node_modules/vite/dist/node/index.js'));
    const server = await createServer({
      root: dir,
      configFile: join(dir, 'vite.config.mjs'),
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
    });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    try {
      const html = await (await fetch(`${base}/`)).text();
      check(html.includes('/@klipp/entry'), 'dev: the runtime script is injected');
      const entry = await fetch(`${base}/@klipp/entry`);
      check(entry.ok && (await entry.text()).includes('start('), 'dev: the runtime entry loads');
      const main = await (await fetch(`${base}/main.jsx`)).text();
      check(main.includes('data-klipp'), 'dev: modules are stamped');
      const live = await (await fetch(`${base}/@klipp/manifest.json`)).json();
      check(Object.keys(live.entries).length === 5, 'dev: the manifest is served');
    } finally {
      await server.close();
    }
  } catch (error) {
    failed++;
    console.log(
      `  FAIL ${String(error.stderr || error.message)
        .split('\n')
        .slice(0, 6)
        .join('\n       ')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
rmSync(packs, { recursive: true, force: true });
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall Vite majors pass');
