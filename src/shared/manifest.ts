/** One place in the source where JSX is written, keyed in the manifest by its sid. */
export interface ManifestEntry {
  /** Relative to the repository root, `/`-separated. */
  file: string;
  line: number;
  column: number;
  /** The JSX tag: `button` for an element, `Button` for a component. */
  name: string;
  /** The component or function the JSX is written in. */
  owner: string;
  kind: 'element' | 'component';
}

export interface KlippManifest {
  version: 1;
  /** Web address of the repository, such as `https://github.com/owner/repo`. */
  repo?: string;
  commit?: string;
  /** Files that differed from `commit` in the working tree the build was made from. */
  dirtyFiles?: string[];
  entries: Record<string, ManifestEntry>;
}

export function permalink(manifest: KlippManifest, entry: ManifestEntry): string | undefined {
  if (!manifest.repo || !manifest.commit) return undefined;
  const path = entry.file.split('/').map(encodeURIComponent).join('/');
  return `${manifest.repo}/blob/${manifest.commit}/${path}#L${entry.line}`;
}

export function isDirty(manifest: KlippManifest, entry: ManifestEntry): boolean {
  return manifest.dirtyFiles?.includes(entry.file) ?? false;
}
