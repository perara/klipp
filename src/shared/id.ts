import { shortHash } from './hash.js';

/** The attribute the build puts on every element written in the app's JSX. */
export const HOST_ATTR = 'data-klipp';
/** The prop the build puts on every component call site; React keeps it on the component's fiber. */
export const CALL_SITE_PROP = 'data-klipp-at';
/** Where react-three-fiber objects keep their sid: `object.userData.klipp`. */
export const OBJECT_KEY = 'klipp';

const SID_LENGTH = 8;
const INSTANCE_LENGTH = 4;

/** A step down from an element: to its nth child, or (`s`) into its shadow root. */
export type PathStep = number | 's';

/**
 * A Klipp id names one element on the page, or something drawn on a canvas:
 *
 *   3f9a2c1d.x7k2:2/1/s/0@roads%3A42
 *   └ sid ──┘ └inst┘ │ └──┬──┘ └ something a canvas adapter drew there, by its key
 *                    │    └ path from that element into markup the build did not stamp,
 *                    │      where `s` steps into a shadow root
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
  path: PathStep[];
  /** The key of something drawn on a canvas, as the canvas's adapter names it. */
  target?: string;
}

/** A target is written percent-encoded, but `:` and `/` typed by hand are read as they are. */
const ID_PATTERN =
  /^([0-9a-z]{8})(?:\.([0-9a-z]{4}))?(?::([1-9]\d*))?((?:\/(?:\d+|s))*)(?:@((?:[\w.~:/-]|%[0-9A-Fa-f]{2})+))?$/;

/** Percent-encodes all but letters, digits and `_ . ~ -`, so an id stays one token anywhere. */
const encodeTarget = (key: string) =>
  encodeURIComponent(key).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export function sourceId(file: string, line: number, column: number): string {
  return shortHash(`${file}:${line}:${column}`, SID_LENGTH);
}

export function instanceHash(callSites: readonly string[], keys: readonly string[]): string {
  return shortHash(`${callSites.join('>')}|${keys.join('>')}`, INSTANCE_LENGTH);
}

export function formatId(id: KlippId): string {
  const instance = id.instance ? `.${id.instance}` : '';
  const ordinal = id.ordinal > 1 ? `:${id.ordinal}` : '';
  const path = id.path.map((step) => `/${step}`).join('');
  const target = id.target === undefined ? '' : `@${encodeTarget(id.target)}`;
  return `${id.sid}${instance}${ordinal}${path}${target}`;
}

/** Adds a canvas target's key to an element's id. */
export const withTarget = (id: string, key: string): string => `${id}@${encodeTarget(key)}`;

export function parseId(text: string): KlippId | undefined {
  const match = ID_PATTERN.exec(text.trim());
  if (!match) return undefined;
  const [, sid, instance, ordinal, path, target] = match;
  let key: string | undefined;
  try {
    key = target === undefined ? undefined : decodeURIComponent(target);
  } catch {
    return undefined;
  }
  const steps = path ? path.split('/').slice(1) : [];
  return {
    sid: sid!,
    ...(instance ? { instance } : {}),
    ordinal: ordinal ? Number(ordinal) : 1,
    path: steps.map((step): PathStep => (step === 's' ? 's' : Number(step))),
    ...(key === undefined ? {} : { target: key }),
  };
}
