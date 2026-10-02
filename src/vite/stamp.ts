import { parse, type ParserPlugin } from '@babel/parser';
import MagicString, { type SourceMap } from 'magic-string';
import { CALL_SITE_PROP, HOST_ATTR, sourceId } from '../shared/id.js';
import type { ManifestEntry } from '../shared/manifest.js';

export interface StampContext {
  /** The file as the manifest records it: relative to the repository root, `/`-separated. */
  file: string;
  /** Put a call-site prop on components as well as an attribute on elements. */
  stampComponents: boolean;
  /** True when a component imported from `source` is someone else's code that must not get extra props. */
  isExternal(source: string): Promise<boolean>;
  /** Told when a file can't be parsed and is left as it is. */
  warn?(message: string): void;
}

export interface Stamped {
  code: string;
  map: SourceMap;
  entries: Array<[string, ManifestEntry]>;
}

interface AstNode {
  type: string;
  [key: string]: unknown;
}

interface Site {
  node: AstNode;
  name: string;
  owner: string;
}

const SKIP_KEYS = new Set([
  'loc',
  'start',
  'end',
  'extra',
  'range',
  'leadingComments',
  'trailingComments',
  'innerComments',
]);
const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassDeclaration',
  'ClassExpression',
]);
/** React's own components accept only their documented props. */
const REACT_BUILTINS = new Set([
  'Fragment',
  'Suspense',
  'StrictMode',
  'Profiler',
  'Activity',
  'ViewTransition',
]);

const isNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';

const idName = (node: unknown): string | undefined =>
  isNode(node) && node.type === 'Identifier' ? (node.name as string) : undefined;

const isHostName = (name: string): boolean => /^[a-z]/.test(name) || name.includes('-');

/** What app code is written in: JSX, TypeScript, decorators (MobX, Angular-style) and import attributes. */
function parserPlugins(file: string): ParserPlugin[] {
  return [
    'jsx',
    ...(/\.tsx$/.test(file) ? (['typescript'] as const) : []),
    'decorators-legacy',
    'deprecatedImportAssert',
  ];
}

function parseProgram(code: string, file: string, ctx: StampContext): AstNode | undefined {
  try {
    const plugins = parserPlugins(file);
    return parse(code, { sourceType: 'module', plugins }).program as unknown as AstNode;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    ctx.warn?.(`${ctx.file} was left without Klipp IDs: it could not be parsed (${reason}).`);
    return undefined;
  }
}

function ownerFromFile(file: string): string {
  const parts = file.split('/');
  const base = (parts.at(-1) ?? file).replace(/\.[^.]+$/, '');
  return base === 'index' ? (parts.at(-2) ?? base) : base;
}

/** The name a function child of `node[key]` takes from its surroundings, as in `const Card = memo(() => …)`. */
function hintFor(node: AstNode, key: string, hint: string | undefined, file: string) {
  if (node.type === 'VariableDeclarator' && key === 'init') return idName(node.id);
  if (node.type === 'CallExpression' && key === 'arguments') return hint;
  if (node.type === 'ExportDefaultDeclaration' && key === 'declaration') return ownerFromFile(file);
  return undefined;
}

function collect(program: AstNode, file: string) {
  const sites: Site[] = [];
  const imports = new Map<string, string>();
  const fallback = ownerFromFile(file);

  const visit = (node: AstNode, owners: readonly string[], hint: string | undefined): void => {
    if (node.type === 'ImportDeclaration') {
      const source = (node.source as AstNode).value as string;
      for (const spec of node.specifiers as AstNode[]) {
        const local = idName(spec.local);
        if (local) imports.set(local, source);
      }
      return;
    }
    let inner = owners;
    if (FUNCTIONS.has(node.type)) {
      const name = idName(node.id) ?? hint;
      if (name) inner = [...owners, name];
    } else if (node.type === 'JSXOpeningElement') {
      const tag = node.name as AstNode;
      if (tag.type === 'JSXIdentifier') {
        const owner = owners.findLast((n) => /^[A-Z]/.test(n)) ?? owners.at(-1) ?? fallback;
        sites.push({ node, name: tag.name as string, owner });
      }
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = node[key];
      const childHint = hintFor(node, key, hint, file);
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child, inner, childHint);
      } else if (isNode(value)) {
        visit(value, inner, childHint);
      }
    }
  };
  visit(program, [], undefined);
  return { sites, imports };
}

async function externalComponents(
  sites: Site[],
  imports: Map<string, string>,
  ctx: StampContext,
): Promise<Set<string>> {
  const names = new Set(sites.map((s) => s.name).filter((n) => !isHostName(n) && imports.has(n)));
  const sources = new Set([...names].map((n) => imports.get(n)!));
  const verdicts = new Map<string, boolean>();
  await Promise.all([...sources].map(async (s) => verdicts.set(s, await ctx.isExternal(s))));
  return new Set([...names].filter((n) => verdicts.get(imports.get(n)!)));
}

function hasAttribute(node: AstNode, attr: string): boolean {
  return (node.attributes as AstNode[]).some(
    (a) => a.type === 'JSXAttribute' && (a.name as AstNode).name === attr,
  );
}

/**
 * Gives every JSX element in `code` an attribute naming where it is written, and every
 * component call site a prop doing the same. Returns undefined when nothing changes.
 */
export async function stamp(
  code: string,
  file: string,
  ctx: StampContext,
): Promise<Stamped | undefined> {
  if (!code.includes('<')) return undefined;
  const program = parseProgram(code, file, ctx);
  if (!program) return undefined;
  const { sites, imports } = collect(program, ctx.file);
  if (!sites.length) return undefined;
  // In react-three-fiber files, lowercase tags are three.js objects, not DOM elements.
  const threeFiber = [...imports.values()].some((s) => s.startsWith('@react-three/'));
  const external = ctx.stampComponents
    ? await externalComponents(sites, imports, ctx)
    : new Set<string>();

  const out = new MagicString(code);
  const entries: Array<[string, ManifestEntry]> = [];
  for (const { node, name, owner } of sites) {
    const host = isHostName(name);
    const skip = host
      ? threeFiber
      : !ctx.stampComponents || REACT_BUILTINS.has(name) || external.has(name);
    const attr = host ? HOST_ATTR : CALL_SITE_PROP;
    if (skip || hasAttribute(node, attr)) continue;
    // Last among the attributes, so a spread written before it cannot override it.
    const end = node.end as number;
    const closing = node.selfClosing === true ? '/>' : '>';
    const at = end - closing.length;
    if (code.slice(at, end) !== closing) continue;
    const start = (node.loc as { start: { line: number; column: number } }).start;
    const entry: ManifestEntry = {
      file: ctx.file,
      line: start.line,
      column: start.column + 1,
      name,
      owner,
      kind: host ? 'element' : 'component',
    };
    const sid = sourceId(entry.file, entry.line, entry.column);
    const pad = /\s/.test(code.charAt(at - 1)) ? '' : ' ';
    out.appendLeft(at, `${pad}${attr}="${sid}"`);
    entries.push([sid, entry]);
  }
  if (!entries.length) return undefined;
  return {
    code: out.toString(),
    map: out.generateMap({ source: file, includeContent: true, hires: true }),
    entries,
  };
}
