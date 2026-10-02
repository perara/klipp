// Generates Klipp's README art in .github/assets: the logo (light and dark) and an animated
// strip of moods, drawn like the paperclip in the app. The wordmark is Nunito (SIL Open Font
// Licence), fetched from Google Fonts and turned into outlines, so it looks the same everywhere.
// Run with `npm run brand`.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const out = fileURLToPath(new URL('../../.github/assets', import.meta.url));
mkdirSync(out, { recursive: true });

/** A static Nunito weight as TTF, cached between runs. */
async function nunito(weight) {
  const file = join(tmpdir(), `klipp-nunito-${weight}.ttf`);
  if (!existsSync(file)) {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=Nunito:wght@${weight}`)
    ).text();
    const url = /https:[^)]+\.ttf/.exec(css)?.[0];
    if (!url) throw new Error('Google Fonts did not offer a TTF for Nunito.');
    writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  }
  return opentype.loadSync(file);
}

const heavy = await nunito(800);
const bold = await nunito(700);

const WIRE = 'M27 34 V66 A6 6 0 0 0 39 66 V18 A10 10 0 0 0 19 18 V72 A13.5 13.5 0 0 0 46 72 V32';

/** The paperclip, as in the app: one nested SVG per figure, so CSS pivots match. */
function clip({ x, y, width, mood, extra = '' }) {
  const eye = (cx, cy) => `
      <g class="eye"><circle class="white" cx="${cx}" cy="${cy}" r="6.2"/>
        <g class="pupil"><circle class="iris" cx="${cx}" cy="${cy + 0.6}" r="2.9"/><circle class="glint" cx="${cx + 1}" cy="${cy - 0.5}" r="0.9"/></g></g>`;
  return `
  <svg x="${x}" y="${y}" width="${width}" height="${width * 1.5}" viewBox="0 0 64 96" overflow="visible" class="figure mood-${mood} ${extra}">
    <ellipse class="shadow" cx="32" cy="91" rx="15" ry="3"/>
    <g class="body">
      <path class="wire-shade" d="${WIRE}"/><path class="wire" d="${WIRE}"/><path class="wire-shine" d="${WIRE}"/>
      <path class="brow brow-left" d="M17.5 19.5 Q23 15.5 30 18"/><path class="brow brow-right" d="M34.5 18 Q41 15 47 19"/>
      ${eye(25, 28)}${eye(40, 28)}
      <g class="dots"><circle cx="51" cy="12" r="1.8"/><circle cx="56" cy="7" r="2.2"/><circle cx="61.5" cy="1.5" r="2.6"/></g>
    </g>
  </svg>`;
}

const FIGURE_CSS = `
  .figure path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .wire-shade { stroke: #57606a; stroke-width: 5.6; }
  .wire { stroke: #9aa4ae; stroke-width: 4; }
  .wire-shine { stroke: #f2f5f7; stroke-width: 1.3; opacity: 0.85; }
  .brow { stroke: #57606a; stroke-width: 2.3; transform-box: fill-box; transform-origin: center; }
  .white { fill: #fff; stroke: #57606a; stroke-width: 1; }
  .iris { fill: #1f2328; } .glint { fill: #fff; }
  .eye { transform-box: fill-box; transform-origin: center; animation: blink 6s infinite; }
  .body { transform-box: view-box; transform-origin: 32px 88px; }
  .shadow { fill: #000; fill-opacity: 0.16; transform-box: fill-box; transform-origin: center; }
  .dots { opacity: 0; } .dots circle { fill: #f2f5f7; stroke: #57606a; stroke-width: 0.8; }
  .mood-idle .body { animation: bob 3.4s ease-in-out infinite; }
  .mood-idle .shadow { animation: shadow 3.4s ease-in-out infinite; }
  .mood-hello .body { animation: hop 2.6s ease-out infinite; }
  .mood-hello .brow { transform: translateY(-2.5px); }
  .mood-thinking .body { animation: sway 1.8s ease-in-out infinite; }
  .mood-thinking .pupil { transform: translate(1.8px, -2.2px); }
  .mood-thinking .brow-left { transform: translateY(-2.5px) rotate(-8deg); }
  .mood-thinking .dots { opacity: 1; }
  .mood-thinking .dots circle { animation: dot 1.2s ease-in-out infinite; }
  .mood-thinking .dots circle:nth-child(2) { animation-delay: 0.2s; }
  .mood-thinking .dots circle:nth-child(3) { animation-delay: 0.4s; }
  .mood-talking .body { animation: chatter 0.5s ease-in-out infinite; }
  .mood-talking .brow { animation: brows 0.5s ease-in-out infinite; }
  .mood-pointing .body { transform: rotate(-9deg); }
  .mood-pointing .brow { transform: translateY(-1.5px); }
  .mood-pointing .pupil { animation: track 3s ease-in-out infinite; }
  .mood-sad .body { transform: translateY(2px) rotate(4deg); }
  .mood-sad .brow-left { transform: translateY(1px) rotate(-16deg); }
  .mood-sad .brow-right { transform: translateY(1px) rotate(16deg); }
  .mood-sad .pupil { transform: translate(0, 2px); }
  .glance .pupil { animation: glance 7s ease-in-out infinite; }
  @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2.5px); } }
  @keyframes shadow { 0%, 100% { transform: scaleX(1); opacity: 1; } 50% { transform: scaleX(0.85); opacity: 0.7; } }
  @keyframes hop { 0% { transform: translateY(0) rotate(0); } 12% { transform: translateY(-12px) rotate(-8deg); }
    22% { transform: translateY(0) rotate(6deg); } 30% { transform: translateY(-4px) rotate(-3deg); } 38%, 100% { transform: translateY(0) rotate(0); } }
  @keyframes sway { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
  @keyframes chatter { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes brows { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }
  @keyframes blink { 0%, 94%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
  @keyframes dot { 0%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
  @keyframes track { 0%, 100% { transform: translate(-2px, 1px); } 50% { transform: translate(2px, 1.5px); } }
  @keyframes glance { 0%, 30%, 100% { transform: translate(0, 0); } 36%, 48% { transform: translate(-2px, 0.5px); }
    54%, 66% { transform: translate(2px, 0.5px); } 72% { transform: translate(0, 0); } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`;

/** Text as outlines, left-aligned at x or centred on it. */
function text(font, value, x, baseline, size, fill, centre = false) {
  const width = font.getAdvanceWidth(value, size, { kerning: true });
  const left = centre ? x - width / 2 : x;
  const path = font.getPath(value, left, baseline, size, { kerning: true });
  return { svg: `<path d="${path.toPathData(2)}" fill="${fill}"/>`, width };
}

function logo(ink) {
  const word = text(heavy, 'Klipp', 118, 112, 104, ink);
  const width = Math.ceil(118 + word.width + 12);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 160" width="${width}" height="160" role="img" aria-label="Klipp">
  <title>Klipp</title>
  <style>${FIGURE_CSS}</style>
  <g transform="rotate(-7 58 82)">${clip({ x: 10, y: 6, width: 96, mood: 'idle', extra: 'glance' })}</g>
  ${word.svg}
</svg>
`;
}

function moods() {
  const list = ['idle', 'hello', 'thinking', 'talking', 'pointing', 'sad'];
  const cell = 128;
  const width = cell * list.length;
  const figures = list
    .map((mood, i) => clip({ x: i * cell + (cell - 64) / 2, y: 16, width: 64, mood }))
    .join('');
  const labels = list
    .map((mood, i) => text(bold, mood, i * cell + cell / 2, 150, 17, '#848d97', true).svg)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 164" width="${width}" height="164" role="img" aria-label="Klipp's moods: idle, hello, thinking, talking, pointing and sad">
  <title>Klipp's moods</title>
  <style>${FIGURE_CSS}</style>
  ${figures}
  ${labels}
</svg>
`;
}

writeFileSync(join(out, 'klipp-logo.svg'), logo('#1f2328'));
writeFileSync(join(out, 'klipp-logo-dark.svg'), logo('#e6edf3'));
writeFileSync(join(out, 'klipp-moods.svg'), moods());
console.log(`wrote ${out}`);
