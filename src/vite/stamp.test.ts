import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
import { sourceId } from '../shared/id.js';
import { stamp, type StampContext } from './stamp.js';

const ctx = (overrides: Partial<StampContext> = {}): StampContext => ({
  file: 'src/App.tsx',
  stampComponents: true,
  isExternal: (source) => Promise.resolve(!source.startsWith('.')),
  ...overrides,
});

async function run(code: string, overrides: Partial<StampContext> = {}) {
  const result = await stamp(code, '/repo/src/App.tsx', ctx(overrides));
  return result;
}

describe('stamp', () => {
  it('puts a source id on elements and a call-site prop on components', async () => {
    const result = await run(
      [
        "import { Card } from './Card';",
        'export function App() {',
        '  return <main className="app"><Card title="x" /></main>;',
        '}',
      ].join('\n'),
    );
    expect(result?.code).toContain(
      `<main className="app" data-klipp="${sourceId('src/App.tsx', 3, 10)}">`,
    );
    expect(result?.code).toContain(
      `<Card title="x" data-klipp-at="${sourceId('src/App.tsx', 3, 32)}"/>`,
    );
    expect(result?.entries.map(([, e]) => e)).toEqual([
      { file: 'src/App.tsx', line: 3, column: 10, name: 'main', owner: 'App', kind: 'element' },
      { file: 'src/App.tsx', line: 3, column: 32, name: 'Card', owner: 'App', kind: 'component' },
    ]);
  });

  it('writes the attribute after spreads so they cannot override it', async () => {
    const result = await run('const B = (p) => <button {...p}>go</button>;');
    expect(result?.code).toMatch(/<button \{\.\.\.p\} data-klipp="[0-9a-z]{8}">go<\/button>/);
  });

  it("leaves React's built-ins, member tags and third-party components alone", async () => {
    const result = await run(
      [
        "import { Fragment, Suspense } from 'react';",
        "import { Layer } from 'react-map-gl';",
        "import * as UI from './ui';",
        'export const App = () => (',
        '  <Suspense><Fragment><><Layer id="x" /><UI.Button /></></Fragment></Suspense>',
        ');',
      ].join('\n'),
    );
    expect(result).toBeUndefined();
  });

  it('still stamps components imported from the app itself', async () => {
    const result = await run("import { Layer } from './Layer';\nexport const A = () => <Layer />;");
    expect(result?.code).toMatch(/<Layer data-klipp-at="[0-9a-z]{8}"\/>/);
  });

  it('can leave components out', async () => {
    const result = await run(
      "import { Card } from './Card';\nexport const A = () => <div><Card /></div>;",
      { stampComponents: false },
    );
    expect(result?.code).toContain('<Card />');
    expect(result?.entries).toHaveLength(1);
  });

  it('skips lowercase tags in react-three-fiber files, which are three.js objects', async () => {
    const result = await run(
      "import { Canvas } from '@react-three/fiber';\nexport const S = () => <mesh><boxGeometry /></mesh>;",
    );
    expect(result).toBeUndefined();
  });

  it('keeps an attribute the author already wrote', async () => {
    const result = await run('export const A = () => <div data-klipp="custom" />;');
    expect(result).toBeUndefined();
  });

  it('names the owner from declarations, arrows, wrappers and default exports', async () => {
    const result = await stamp(
      [
        "import { memo, forwardRef } from 'react';",
        'function Plain() { return <p />; }',
        'const Arrow = () => <p />;',
        'const Memo = memo(forwardRef((props, ref) => <p ref={ref} />));',
        'export default function () { return <p />; }',
        'const rows = items.map((item) => <li key={item} />);',
      ].join('\n'),
      '/repo/src/widgets/index.tsx',
      ctx({ file: 'src/widgets/index.tsx' }),
    );
    expect(result?.entries.map(([, e]) => e.owner)).toEqual([
      'Plain',
      'Arrow',
      'Memo',
      'widgets',
      'rows',
    ]);
  });

  it('handles TypeScript generics and keeps the output parseable', async () => {
    const result = await run(
      [
        'function List<T,>({ items }: { items: T[] }) {',
        '  return <ul>{items.map((i) => <li key={String(i)} />)}</ul>;',
        '}',
        'export const A = () => <List<number> items={[1]} />;',
      ].join('\n'),
    );
    expect(result?.entries).toHaveLength(3);
    expect(() =>
      parse(result!.code, { sourceType: 'module', plugins: ['jsx', 'typescript'] }),
    ).not.toThrow();
    expect(result?.map.mappings.length).toBeGreaterThan(0);
  });

  it('returns nothing for code without JSX, and says so for code that does not parse', async () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    expect(await run('export const x = 1;', { warn })).toBeUndefined();
    expect(await run('export const x = <div>;', { warn })).toBeUndefined();
    expect(warnings).toEqual([expect.stringMatching(/^src\/App\.tsx was left without Klipp IDs/)]);
  });

  it('reads decorators and import attributes, old and new', async () => {
    const code = [
      "import data from './data.json' with { type: 'json' };",
      "import old from './old.json' assert { type: 'json' };",
      '@observer',
      'export class Panel extends Component {',
      '  render() { return <div>{data.x}{old.y}</div>; }',
      '}',
    ].join('\n');
    expect((await run(code))?.code).toMatch(/<div data-klipp="[0-9a-z]{8}">\{data\.x\}/);
  });
});
