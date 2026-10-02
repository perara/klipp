/**
 * A web component, as a design system might ship it: its markup lives in its own shadow root,
 * which the app's build never sees or stamps.
 */
class StarRating extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      'div { display: flex; gap: 4px; } button { font-size: 22px; border: 0; background: none; cursor: pointer; color: #d4a72c; }';
    const row = document.createElement('div');
    for (let stars = 1; stars <= 5; stars++) {
      const star = document.createElement('button');
      star.type = 'button';
      star.textContent = '★';
      star.setAttribute('aria-label', `${stars} stars`);
      row.append(star);
    }
    root.append(style, row);
  }
}

if (!customElements.get('star-rating')) customElements.define('star-rating', StarRating);
