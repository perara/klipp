import type { KlippManifest } from '../shared/manifest.js';
import type { RuntimeConfig } from '../shared/runtime-config.js';

let cached: Promise<KlippManifest | undefined> | undefined;

/** The build's manifest; refetched every time under the dev server, where edits change it. */
export function loadManifest(
  config: RuntimeConfig,
  signal?: AbortSignal,
): Promise<KlippManifest | undefined> {
  if (cached && !config.dev && !signal) return cached;
  const loading = fetch(new URL(config.manifestUrl, document.baseURI), {
    signal: signal ?? null,
    cache: config.dev ? 'no-store' : 'default',
  })
    .then((response) => (response.ok ? (response.json() as Promise<KlippManifest>) : undefined))
    .catch(() => undefined);
  if (!signal) cached = loading;
  return loading;
}
