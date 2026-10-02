// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { CALL_SITE_PROP, HOST_ATTR } from '../shared/id.js';
import { identify, resolve } from './identify.js';

const SID = {
  list: 'aaaaaaaa',
  row: 'bbbbbbbb',
  label: 'cccccccc',
};

function page(html: string) {
  document.body.innerHTML = html;
}

/** Hangs a fake React fiber chain on an element, nearest fiber first. */
function fibers(element: Element, chain: Array<{ key?: string; type?: unknown; site?: string }>) {
  let parent: object | null = null;
  const built = [...chain].reverse().map((f) => {
    const fiber: Record<string, unknown> = {
      key: f.key ?? null,
      type: f.type ?? (() => null),
      memoizedProps: f.site ? { [CALL_SITE_PROP]: f.site } : {},
      return: parent,
    };
    parent = fiber;
    return fiber;
  });
  (element as unknown as Record<string, unknown>)['__reactFiber$test'] = built.at(-1);
}

describe('identify without React', () => {
  beforeEach(() =>
    page(`
      <ul ${HOST_ATTR}="${SID.list}">
        <li ${HOST_ATTR}="${SID.row}"><span ${HOST_ATTR}="${SID.label}">A</span></li>
        <li ${HOST_ATTR}="${SID.row}"><span ${HOST_ATTR}="${SID.label}">B</span><i><b>x</b></i></li>
      </ul>`),
  );

  it('gives repeated elements ordinals in document order', () => {
    const [first, second] = document.querySelectorAll('li');
    const a = identify(first!);
    const b = identify(second!);
    expect(a.id).toMatch(/^bbbbbbbb\.[0-9a-z]{4}$/);
    expect(b.id).toBe(`${a.id}:2`);
  });

  it('reaches unstamped markup through a child path from the nearest stamped element', () => {
    const bold = document.querySelector('b')!;
    const identity = identify(bold);
    expect(identity.anchor).toBe(document.querySelectorAll('li')[1]);
    expect(identity.path).toEqual([1, 0]);
    expect(identity.id).toMatch(/:2\/1\/0$/);
    expect(resolve(identity.id).element).toBe(bold);
  });

  it('resolves every id it hands out back to the same element', () => {
    for (const el of document.querySelectorAll('*')) {
      const { id } = identify(el);
      if (id) expect(resolve(id).element).toBe(el);
    }
  });

  it('says so when nothing above an element was stamped', () => {
    expect(identify(document.body).id).toBe('');
    expect(resolve('not an id').candidates).toEqual([]);
  });

  it('resolves a bare sid to every element from that code site', () => {
    expect(resolve(SID.label).candidates).toHaveLength(2);
    expect(resolve(SID.label).element).toBeUndefined();
  });
});

describe('identify through shadow roots', () => {
  beforeEach(() => {
    page(`<section ${HOST_ATTR}="${SID.list}"><p>intro</p><star-rating></star-rating></section>
      <div ${HOST_ATTR}="${SID.row}" id="portal-host"></div>`);
    // A web component's own markup, which the build never stamped.
    const rating = document.querySelector('star-rating')!.attachShadow({ mode: 'open' });
    rating.innerHTML = '<style></style><div><button>1</button><button>2</button></div>';
    // Markup the app's own JSX rendered into a shadow root, stamped as usual.
    const portal = document.querySelector('#portal-host')!.attachShadow({ mode: 'open' });
    portal.innerHTML = `<p ${HOST_ATTR}="${SID.label}"><b>x</b></p>`;
  });

  const inRating = () =>
    document.querySelector('star-rating')!.shadowRoot!.querySelectorAll('button')[1]!;
  const inPortal = () => document.querySelector('#portal-host')!.shadowRoot!.querySelector('b')!;

  it('steps into a shadow root from the nearest stamped element outside it', () => {
    const identity = identify(inRating());
    expect(identity.anchor).toBe(document.querySelector('section'));
    expect(identity.path).toEqual([1, 's', 1, 1]);
    expect(identity.id).toMatch(/^aaaaaaaa\.[0-9a-z]{4}\/1\/s\/1\/1$/);
    expect(resolve(identity.id).element).toBe(inRating());
  });

  it('finds stamped elements inside a shadow root, and counts their hosts as call sites', () => {
    const identity = identify(inPortal());
    expect(identity.sid).toBe(SID.label);
    expect(identity.path).toEqual([0]);
    expect(identity.ancestry.callSites).toEqual([SID.row]);
    expect(resolve(identity.id).element).toBe(inPortal());
    expect(resolve(SID.label).candidates).toHaveLength(1);
  });

  it('resolves every id it hands out back to the same element', () => {
    const all = (root: Document | ShadowRoot): Element[] =>
      [...root.querySelectorAll('*')].flatMap((el) => [
        el,
        ...(el.shadowRoot ? all(el.shadowRoot) : []),
      ]);
    for (const el of all(document)) {
      const { id } = identify(el);
      if (id) expect(resolve(id).element).toBe(el);
    }
  });

  it('gives up on a path into a shadow root that is not there', () => {
    const id = identify(inRating()).id.replace('/s/', '/0/');
    expect(resolve(id).element).toBeUndefined();
  });
});

describe('identify with React fibers', () => {
  it('follows keys, so a row keeps its id when the list reorders', () => {
    page(`<li ${HOST_ATTR}="${SID.row}"></li><li ${HOST_ATTR}="${SID.row}"></li>`);
    const [first, second] = document.querySelectorAll('li');
    fibers(first!, [{ type: 'li', key: 'alpha' }, { site: 'pppppppp' }]);
    fibers(second!, [{ type: 'li', key: 'beta' }, { site: 'pppppppp' }]);
    const beta = identify(second!).id;
    expect(beta).not.toContain(':');

    document.body.prepend(second!);
    expect(identify(second!).id).toBe(beta);
    expect(resolve(beta).element).toBe(second);
  });

  it('tells apart one component used at two call sites', () => {
    page(`<button ${HOST_ATTR}="${SID.row}"></button><button ${HOST_ATTR}="${SID.row}"></button>`);
    const [save, cancel] = document.querySelectorAll('button');
    fibers(save!, [{ type: 'button' }, { site: 'ssssssss' }, { site: 'aaaaaaaa' }]);
    fibers(cancel!, [{ type: 'button' }, { site: 'cccccccc' }, { site: 'aaaaaaaa' }]);
    const a = identify(save!);
    const b = identify(cancel!);
    expect(a.sid).toBe(b.sid);
    expect(a.id).not.toBe(b.id);
    expect(a.ancestry.callSites).toEqual(['ssssssss', 'aaaaaaaa']);
  });

  it('counts a call site once when memo() repeats its props', () => {
    page(`<p ${HOST_ATTR}="${SID.label}"></p>`);
    const p = document.querySelector('p')!;
    fibers(p, [{ type: 'p' }, { site: 'mmmmmmmm' }, { site: 'mmmmmmmm' }, { site: 'rrrrrrrr' }]);
    expect(identify(p).ancestry.callSites).toEqual(['mmmmmmmm', 'rrrrrrrr']);
  });
});
