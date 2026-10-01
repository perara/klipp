// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { HOST_ATTR } from '../shared/id.js';
import type { KlippManifest } from '../shared/manifest.js';
import { identify } from './identify.js';
import { deepLink, issueFooter, redactedUrl, type Facts } from './report.js';

const manifest: KlippManifest = {
  version: 1,
  repo: 'https://github.com/acme/app',
  commit: '0123456789abcdef0123456789abcdef01234567',
  dirtyFiles: ['src/Toolbar.tsx'],
  entries: {
    aaaaaaaa: {
      file: 'src/Button.tsx',
      line: 4,
      column: 10,
      name: 'button',
      owner: 'Button',
      kind: 'element',
    },
    bbbbbbbb: {
      file: 'src/Toolbar.tsx',
      line: 9,
      column: 7,
      name: 'Button',
      owner: 'Toolbar',
      kind: 'component',
    },
  },
};

const facts: Facts = {
  tag: 'button',
  attributes: ['type="button"'],
  states: ['disabled'],
  box: '80×32 at 10,20',
};
const href = 'https://app.test/people/42?name=Kari+Nordmann&tab=2#/incident/7?person=Ola';

describe('redactedUrl', () => {
  it('keeps the path and the hash route but blanks every value', () => {
    expect(redactedUrl(href)).toBe('https://app.test/people/42?name=…&tab=…#/incident/7?person=…');
  });

  it('blanks a fragment that is not a route', () => {
    expect(redactedUrl('https://app.test/a#access_token=secret')).toBe('https://app.test/a#…');
  });

  it('keeps the parameters it is told to keep', () => {
    const page = 'https://app.test/map?demo=1&person=Ola&klipp=old#/x?demo=1&q=Kari';
    expect(redactedUrl(page, ['demo'])).toBe('https://app.test/map?demo=1&person=…#/x?demo=1&q=…');
  });
});

describe('deepLink', () => {
  it('drops the query, keeps the route, and adds the id', () => {
    expect(deepLink(href, 'aaaaaaaa.x7k2')).toBe(
      'https://app.test/people/42?klipp=aaaaaaaa.x7k2#/incident/7',
    );
  });

  it('keeps the parameters it is told to keep', () => {
    const page = 'https://app.test/map?demo=1&person=Ola#/x?demo=1&q=Kari';
    expect(deepLink(page, 'aaaaaaaa.x7k2', ['demo'])).toBe(
      'https://app.test/map?demo=1&klipp=aaaaaaaa.x7k2#/x?demo=1',
    );
  });
});

describe('issueFooter', () => {
  document.body.innerHTML = `<button ${HOST_ATTR}="aaaaaaaa">Delete Kari Nordmann</button>`;
  const button = document.querySelector('button')!;
  const identity = { ...identify(button), ancestry: { callSites: ['bbbbbbbb'], keys: [] } };
  const input = { identity, facts, manifest, href, browser: 'TestBrowser/1, 1280×800' };

  it('links the code at the build commit and leaves on-screen text out', () => {
    const text = issueFooter(input);
    expect(text).toContain(
      '[src/Button.tsx:4:10](https://github.com/acme/app/blob/0123456789abcdef0123456789abcdef01234567/src/Button.tsx#L4)',
    );
    expect(text).toContain('`<Button>` in [src/Toolbar.tsx:9:7]');
    expect(text).toContain('(changed locally)');
    expect(text).toContain('| State | disabled |');
    expect(text).toContain(
      '[acme/app@0123456](https://github.com/acme/app/commit/0123456789abcdef0123456789abcdef01234567), with local changes',
    );
    expect(text).toContain('<sub>klipp:aaaaaaaa</sub>');
    expect(text).not.toMatch(/Kari|Nordmann|Ola/);
  });

  it('describes just the page when no element was picked', () => {
    const text = issueFooter({ ...input, identity: undefined, facts: undefined });
    expect(text).not.toContain('| Element |');
    expect(text).toContain('| Page |');
    expect(text).not.toContain('klipp:');
  });
});
