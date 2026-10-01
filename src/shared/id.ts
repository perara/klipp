import { shortHash } from './hash.js';

/** The attribute the build puts on every element written in the app's JSX. */
export const HOST_ATTR = 'data-klipp';
/** The prop the build puts on every component call site; React keeps it on the component's fiber. */
export const CALL_SITE_PROP = 'data-klipp-at';

const SID_LENGTH = 8;
const INSTANCE_LENGTH = 4;

/**
 * A Klipp id names one element on the page:
 *
 *   3f9a2c1d.x7k2:2/1/0
 *   └ sid ──┘ └inst┘ │ └ path from that element into markup the build did not stamp
 *                    └ ordinal among identical instances, when there is more than one
 *
 * The sid is a hash of where the element is written in the source, so it is the same for
 * every user and every reload of a build. The instance hash covers the component call sites
 * and React keys above the element, which tells apart a component used in two places and the
 * rows of a keyed list.
 */
export interface KlippId {
  sid: string;
  /** Absent when an id names only a code site, such as `3f9a2c1d`. */
  instance?: string;
  /** 1-based. */
  ordinal: number;
  path: number[];
}

const ID_PATTERN = /^([0-9a-z]{8})(?:\.([0-9a-z]{4}))?(?::([1-9]\d*))?((?:\/\d+)*)$/;

export function sourceId(file: string, line: number, column: number): string {
  return shortHash(`${file}:${line}:${column}`, SID_LENGTH);
}

export function instanceHash(callSites: readonly string[], keys: readonly string[]): string {
  return shortHash(`${callSites.join('>')}|${keys.join('>')}`, INSTANCE_LENGTH);
}

export function formatId(id: KlippId): string {
  const instance = id.instance ? `.${id.instance}` : '';
  const ordinal = id.ordinal > 1 ? `:${id.ordinal}` : '';
  return `${id.sid}${instance}${ordinal}${id.path.map((index) => `/${index}`).join('')}`;
}

export function parseId(text: string): KlippId | undefined {
  const match = ID_PATTERN.exec(text.trim());
  if (!match) return undefined;
  const [, sid, instance, ordinal, path] = match;
  return {
    sid: sid!,
    ...(instance ? { instance } : {}),
    ordinal: ordinal ? Number(ordinal) : 1,
    path: path ? path.split('/').slice(1).map(Number) : [],
  };
}
