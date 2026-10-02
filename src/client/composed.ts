/**
 * The page as the user sees it: the composed tree, where an open shadow root's content sits
 * inside its host. The DOM's own walks (`closest`, `parentElement`, `querySelectorAll`,
 * `elementsFromPoint`) stop at a shadow boundary; these go through it.
 */

/** An element's parent, or for the top of a shadow tree, its host. */
export function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const parent = element.parentNode;
  return parent instanceof ShadowRoot ? parent.host : null;
}

export function composedContains(ancestor: Element, element: Element | null): boolean {
  for (let node = element; node; node = composedParent(node)) if (node === ancestor) return true;
  return false;
}

export function composedClosest(element: Element, selector: string): Element | null {
  for (let node: Element | null = element; node;) {
    const found = node.closest(selector);
    if (found) return found;
    const root = node.getRootNode();
    node = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

/** Elements under a point, topmost first, inside open shadow roots too. */
export function elementsAt(x: number, y: number): Element[] {
  return deepen(document.elementsFromPoint(x, y), x, y);
}

/** Puts what is under the point inside the topmost element's shadow root in front of it. */
export function deepen(stack: Element[], x: number, y: number): Element[] {
  const root = stack[0]?.shadowRoot;
  if (!root) return stack;
  const inner = root.elementsFromPoint(x, y).filter((element) => root.contains(element));
  return inner.length ? [...deepen(inner, x, y), ...stack] : stack;
}

/** Every element matching a selector, in tree order, with each open shadow root after its host. */
export function deepQueryAll(root: Document | Element | ShadowRoot, selector: string): Element[] {
  const found: Element[] = [];
  const visit = (scope: Document | Element | ShadowRoot) => {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node as Element;
      if (element.matches(selector)) found.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  if (root instanceof Element && root.matches(selector)) found.push(root);
  visit(root);
  return found;
}
