// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { HOST_ATTR } from '../shared/id.js';
import type { KlippManifest } from '../shared/manifest.js';
import { identify } from './identify.js';
import { buildReport, deepLink, redactedUrl, visibleText, type Facts } from './report.js';

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
const env = {
  href: 'https://app.test/people/42?name=Kari+Nordmann&tab=2#/incident/7?person=Ola',
  userAgent: 'TestBrowser/1',
  viewport: '1280×800 @1x',
  colorScheme: 'light',
};

describe('redactedUrl', () => {
  it('keeps the path and the hash route but blanks every value', () => {
    expect(redactedUrl(env.href)).toBe(
      'https://app.test/people/42?name=…&tab=…#/incident/7?person=…',
    );
  });

  it('blanks a fragment that is not a route', () => {
    expect(redactedUrl('https://app.test/a#access_token=secret')).toBe('https://app.test/a#…');
  });
});

describe('deepLink', () => {
  it('drops the query, keeps the route, and adds the id', () => {
    expect(deepLink(env.href, 'aaaaaaaa.x7k2')).toBe(
      'https://app.test/people/42?klipp=aaaaaaaa.x7k2#/incident/7',
    );
  });
});

describe('buildReport', () => {
  document.body.innerHTML = `<button ${HOST_ATTR}="aaaaaaaa" aria-label="Delete Kari">Delete Kari Nordmann</button>`;
  const button = document.querySelector('button')!;
  const identity = { ...identify(button), ancestry: { callSites: ['bbbbbbbb'], keys: [] } };

  it('links the code at the build commit and leaves on-screen text out by default', () => {
    const text = buildReport({ identity, manifest, facts, note: 'Stays disabled', env });
    expect(text).toContain('### Klipp: `<button>` in `Button`');
    expect(text).toContain('> Stays disabled');
    expect(text).toContain(
      '[src/Button.tsx:4:10](https://github.com/acme/app/blob/0123456789abcdef0123456789abcdef01234567/src/Button.tsx#L4)',
    );
    expect(text).toContain('`<Button>` in [src/Toolbar.tsx:9:7]');
    expect(text).toContain('(changed locally)');
    expect(text).toContain(
      '[acme/app@0123456](https://github.com/acme/app/commit/0123456789abcdef0123456789abcdef01234567), with local changes',
    );
    expect(text).toContain(`<sub>klipp:aaaaaaaa</sub>`);
    expect(text).not.toMatch(/Kari|Nordmann|Ola/);
  });

  it('includes the text when the reporter opts in', () => {
    const text = buildReport({
      identity,
      manifest,
      facts,
      note: '',
      text: visibleText(button),
      env,
    });
    expect(text).toContain('aria-label: Delete Kari');
    expect(text).toContain('Delete Kari Nordmann');
  });

  it('works without a manifest', () => {
    const text = buildReport({ identity, manifest: undefined, facts, note: '', env });
    expect(text).toContain('### Klipp: `<button>`');
    expect(text).toContain('| Build | unknown |');
  });
});

describe('visibleText', () => {
  it('never reads form values', () => {
    document.body.innerHTML = '<input type="password" placeholder="Password" value="hunter2">';
    const input = document.querySelector('input')!;
    expect(visibleText(input)).toEqual(['placeholder: Password']);
  });
});
