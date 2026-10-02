type Child = Node | string | false | null | undefined;
type Attrs = Record<string, string | number | boolean | undefined | ((event: Event) => void)>;

function apply(el: Element, attrs: Attrs, children: Child[]) {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') el.addEventListener(name.slice(2), value);
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  el.append(...children.filter((c): c is Node | string => c !== false && c != null));
}

/** Builds DOM without innerHTML, so page text shown in the panel is never parsed as markup. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs, children);
  return el;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  apply(el, attrs, children);
  return el;
}

/** Styles through CSSOM, which a strict `style-src` policy allows. */
export function adoptStyles(root: ShadowRoot, css: string) {
  if ('adoptedStyleSheets' in root && typeof CSSStyleSheet.prototype.replaceSync === 'function') {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } else {
    root.append(h('style', {}, css));
  }
}
