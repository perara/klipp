import { h } from './dom.js';

/** `\`-escaped punctuation, `code`, **bold**, *emphasis* and [links](…); anything else stays text. */
const INLINE =
  /\\([!-/:-@[-`{-~])|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|\*([^*\s][^*\n]*)\*/g;

function inline(text: string): Array<Node | string> {
  const out: Array<Node | string> = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    out.push(text.slice(last, match.index));
    const [, escaped, code, bold, label, href, em] = match;
    if (escaped !== undefined) out.push(escaped);
    else if (code !== undefined) out.push(h('code', {}, code));
    else if (bold !== undefined) out.push(h('strong', {}, ...inline(bold)));
    else if (label !== undefined && /^https?:\/\//.test(href!)) {
      out.push(h('a', { href: href!, target: '_blank', rel: 'noreferrer' }, label));
    } else if (label !== undefined) {
      // Agents link files by their local path; the page can't open those, so show the place.
      out.push(h('code', {}, label));
    } else out.push(h('em', {}, em));
    last = match.index + match[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function list(lines: string[], ordered: boolean): HTMLElement {
  const items = lines.map((line) =>
    h('li', {}, ...inline(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))),
  );
  return ordered ? h('ol', {}, ...items) : h('ul', {}, ...items);
}

/**
 * The small Markdown a chat reply uses, built as DOM nodes: model output is never parsed as HTML.
 * Paragraphs, lists, fenced code and the inline forms above.
 */
export function renderMarkdown(source: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const parts = source.split(/^```[^\n]*\n?/m);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      fragment.append(h('pre', {}, h('code', {}, part.replace(/\n$/, ''))));
      return;
    }
    for (const block of part.split(/\n{2,}/)) {
      const lines = block.split('\n').filter((line) => line.trim());
      if (!lines.length) continue;
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) fragment.append(list(lines, false));
      else if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) fragment.append(list(lines, true));
      else {
        const paragraph = h('p');
        lines.forEach((line, i) => {
          if (i) paragraph.append(h('br'));
          paragraph.append(...inline(line.replace(/^#+\s+/, '')));
        });
        fragment.append(paragraph);
      }
    }
  });
  return fragment;
}
