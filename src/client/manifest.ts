import type { KlippManifest } from '../shared/manifest.js';
import type { RuntimeConfig } from '../shared/runtime-config.js';

let cached: Promise<KlippManifest | undefined> | undefined;

/** The build's manifest; refetched every time under the dev server, where edits change it. */
export function loadManifest(config: RuntimeConfig): Promise<KlippManifest | undefined> {
  if (cached && !config.dev) return cached;
  cached = fetch(new URL(config.manifestUrl, document.baseURI), {
    cache: config.dev ? 'no-store' : 'default',
  })
    .then((response) => (response.ok ? (response.json() as Promise<KlippManifest>) : undefined))
    .catch(() => undefined);
  return cached;
}
