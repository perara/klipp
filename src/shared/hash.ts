/**
 * cyrb53 by bryc (public domain): a fast 53-bit string hash with good distribution.
 * The build and the browser both use it, so they derive the same ids.
 */
export function cyrb53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A lowercase base-36 hash of `input`, exactly `length` characters long (at most 10). */
export function shortHash(input: string, length: number): string {
  return (cyrb53(input) % 36 ** length).toString(36).padStart(length, '0');
}
