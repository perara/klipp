// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.js';

const html = (source: string) => {
  const div = document.createElement('div');
  div.append(renderMarkdown(source));
  return div.innerHTML;
};

describe('renderMarkdown', () => {
  it('renders the inline forms a reply uses', () => {
    expect(html('See `Button.tsx:5`, **twice**, *maybe*, [docs](https://example.com).')).toBe(
      '<p>See <code>Button.tsx:5</code>, <strong>twice</strong>, <em>maybe</em>, <a href="https://example.com" target="_blank" rel="noreferrer">docs</a>.</p>',
    );
  });

  it('renders lists, paragraphs and fenced code', () => {
    expect(html('One\ntwo\n\n- a\n- b\n\n1. x\n\n```ts\nconst a = 1;\n```')).toBe(
      '<p>One<br>two</p><ul><li>a</li><li>b</li></ul><ol><li>x</li></ol><pre><code>const a = 1;</code></pre>',
    );
  });

  it('never turns model output into markup or script links', () => {
    expect(html('<img src=x onerror=alert(1)> [x](javascript:alert(1))')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt; [x](javascript:alert(1))</p>',
    );
  });
});
