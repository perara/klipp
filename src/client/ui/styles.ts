export const CSS = /* css */ `
:host { all: initial; }
.screenshot-preview { display:block; width:100%; height:auto; border-radius:8px; margin:8px 0; }
.screenshot-card .btn { min-height:44px; }
.screenshot-attachment { display:flex; align-items:center; gap:8px; min-height:44px; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }

.layer {
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #59636e;
  --line: #d1d9e0;
  --soft: rgba(31, 35, 40, 0.06);
  --accent: #0969da;
  --accent-fg: #ffffff;
  --accent-soft: rgba(9, 105, 218, 0.12);
  --pick: #bf3989;
  --pick-soft: rgba(191, 57, 137, 0.1);
  --bubble: #fffbdd;
  --bubble-line: #d4a72c;
  --wire: #9aa4ae;
  --wire-shade: #57606a;
  --wire-shine: #f2f5f7;
  --shadow: 0 12px 32px rgba(31, 35, 40, 0.22), 0 1px 3px rgba(31, 35, 40, 0.12);
  --gap: 16px;
  font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .layer {
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #9198a1;
    --line: #3d444d;
    --soft: rgba(230, 237, 243, 0.08);
    --accent: #4493f8;
    --accent-fg: #0d1117;
    --accent-soft: rgba(68, 147, 248, 0.16);
    --pick: #ff7bc4;
    --pick-soft: rgba(255, 123, 196, 0.12);
    --bubble: #2b2717;
    --bubble-line: #9e6a03;
    --wire: #a8b1ba;
    --wire-shade: #4b525b;
    --wire-shine: #f0f3f6;
    --shadow: 0 12px 32px rgba(0, 0, 0, 0.6), 0 1px 3px rgba(0, 0, 0, 0.4);
  }
}

button, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code, pre { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace; font-size: 12.5px; }
a { color: var(--accent); }

/* Where things sit: the paperclip in its corner, its bubbles just above it. */
.figure-button, .chat, .hint { position: fixed; }
.bottom-right .figure-button { right: calc(var(--gap) + var(--dx)); bottom: calc(var(--gap) + var(--dy)); }
.bottom-left .figure-button { left: calc(var(--gap) + var(--dx)); bottom: calc(var(--gap) + var(--dy)); }
.top-right .figure-button { right: calc(var(--gap) + var(--dx)); top: calc(var(--gap) + var(--dy)); }
.top-left .figure-button { left: calc(var(--gap) + var(--dx)); top: calc(var(--gap) + var(--dy)); }
.bottom-right :is(.chat, .hint) { right: calc(var(--gap) + var(--dx)); bottom: calc(var(--gap) + var(--dy) + 112px); }
.bottom-left :is(.chat, .hint) { left: calc(var(--gap) + var(--dx)); bottom: calc(var(--gap) + var(--dy) + 112px); }
.top-right :is(.chat, .hint) { right: calc(var(--gap) + var(--dx)); top: calc(var(--gap) + var(--dy) + 112px); }
.top-left :is(.chat, .hint) { left: calc(var(--gap) + var(--dx)); top: calc(var(--gap) + var(--dy) + 112px); }

/* The paperclip */
.figure-button {
  width: 68px;
  height: 102px;
  padding: 0;
  border: 0;
  border-radius: 16px;
  background: transparent;
  pointer-events: auto;
  z-index: 5;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.22));
}
.figure-button:hover { filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.3)); }
.figure { display: block; width: 100%; height: 100%; overflow: visible; }
.figure path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.figure .wire-shade { stroke: var(--wire-shade); stroke-width: 5.6; }
.figure .wire { stroke: var(--wire); stroke-width: 4; }
.figure .wire-shine { stroke: var(--wire-shine); stroke-width: 1.3; opacity: 0.85; }
.figure .brow { stroke: var(--wire-shade); stroke-width: 2.3; transform-box: fill-box; transform-origin: center; transition: transform 220ms ease; }
.figure .white { fill: #ffffff; stroke: var(--wire-shade); stroke-width: 1; }
.figure .iris { fill: #1f2328; }
.figure .glint { fill: #ffffff; }
.figure .pupil { transition: transform 140ms ease-out; }
.figure .eye { transform-box: fill-box; transform-origin: center; animation: blink 6s infinite; }
.figure .body { transform-box: view-box; transform-origin: 32px 88px; transition: transform 250ms ease; }
.figure .shadow { fill: rgba(0, 0, 0, 0.18); transform-box: fill-box; transform-origin: center; }
.figure .dots { opacity: 0; transition: opacity 200ms ease; }
.figure .dots circle { fill: var(--wire-shine); stroke: var(--wire-shade); stroke-width: 0.8; }

.mood-idle .body { animation: bob 3.4s ease-in-out infinite; }
.mood-idle .shadow { animation: shadow 3.4s ease-in-out infinite; }
.mood-hello .body { animation: hop 0.9s ease-out 2; }
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
.mood-sad .body { transform: translateY(2px) rotate(4deg); }
.mood-sad .brow-left { transform: translateY(1px) rotate(-16deg); }
.mood-sad .brow-right { transform: translateY(1px) rotate(16deg); }
.mood-sad .pupil { transform: translate(0, 2px); }

@keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2.5px); } }
@keyframes shadow { 0%, 100% { transform: scaleX(1); opacity: 1; } 50% { transform: scaleX(0.85); opacity: 0.7; } }
@keyframes hop {
  0% { transform: translateY(0) rotate(0); }
  30% { transform: translateY(-12px) rotate(-8deg); }
  55% { transform: translateY(0) rotate(6deg); }
  75% { transform: translateY(-4px) rotate(-3deg); }
  100% { transform: translateY(0) rotate(0); }
}
@keyframes sway { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
@keyframes chatter { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes brows { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }
@keyframes blink { 0%, 94%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
@keyframes dot { 0%, 100% { opacity: 0.25; } 40% { opacity: 1; } }

/* The speech bubble */
.chat, .hint {
  border: 1px solid var(--bubble-line);
  border-radius: 16px;
  background: var(--bubble);
  box-shadow: var(--shadow);
  z-index: 4;
}
.chat::after, .hint::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  background: var(--bubble);
  border: 1px solid var(--bubble-line);
  border-top: 0;
  border-left: 0;
  transform: rotate(45deg);
}
.bottom-right :is(.chat, .hint)::after { right: 22px; bottom: -8px; }
.bottom-left :is(.chat, .hint)::after { left: 22px; bottom: -8px; }
.top-right :is(.chat, .hint)::after { right: 22px; top: -8px; transform: rotate(225deg); }
.top-left :is(.chat, .hint)::after { left: 22px; top: -8px; transform: rotate(225deg); }

.chat {
  display: flex;
  flex-direction: column;
  width: 360px;
  max-width: calc(100vw - 2 * var(--gap));
  max-height: min(560px, calc(100vh - 160px));
  pointer-events: auto;
}
.chat .close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 18px;
  line-height: 1;
  z-index: 1;
}
.chat .close:hover, .icon:hover { background: var(--soft); }
.agents { display: flex; gap: 2px; margin: 10px 44px 0 12px; padding: 2px; align-self: flex-start; border-radius: 999px; background: var(--soft); }
.agent { padding: 2px 10px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font-size: 12.5px; font-weight: 500; }
.agent[aria-pressed='true'] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
.log {
  flex: 1 1 auto;
  min-height: 64px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding: 14px 14px 8px;
  overscroll-behavior: contain;
}
.msg { max-width: 92%; overflow-wrap: anywhere; }
.msg.klipp { align-self: flex-start; padding-right: 22px; }
.msg.klipp > :first-child { margin-top: 0; }
.msg.klipp > :last-child { margin-bottom: 0; }
.msg p, .msg ul, .msg ol { margin: 0 0 6px; }
.msg ul, .msg ol { padding-left: 20px; }
.msg code { padding: 1px 4px; border-radius: 5px; background: var(--soft); }
.msg pre { margin: 0 0 6px; padding: 8px; border-radius: 8px; background: var(--soft); overflow-x: auto; }
.msg pre code { padding: 0; background: none; }
.msg.user {
  align-self: flex-end;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 14px 14px 4px 14px;
  background: var(--bg);
  white-space: pre-wrap;
}
.activity { align-self: flex-start; color: var(--muted); font-size: 12.5px; font-style: italic; }
.activity::before { content: '📎 '; font-style: normal; }
.msg.card {
  align-self: stretch;
  max-width: none;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
}
.card-tags { display: flex; gap: 6px; align-items: center; }
.badge { padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #fff; background: var(--muted); }
.type-bug .badge { background: #cf222e; }
.type-feature .badge { background: #0969da; }
.type-suggestion .badge { background: #8250df; }
.type-question .badge { background: #1a7f37; }
.tag { padding: 0 6px; border: 1px solid var(--line); border-radius: 999px; font-size: 12px; color: var(--muted); }
.card-title { font-weight: 600; margin: 2px 0 4px; }
.card-body { max-height: 220px; overflow: auto; margin-bottom: 6px; overscroll-behavior: contain; }
.card details { margin-bottom: 8px; font-size: 13px; }
.card summary { cursor: pointer; color: var(--muted); }
.card-footer { max-height: 160px; overflow: auto; font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }
.card-status { color: var(--muted); font-size: 13px; }
.chip {
  display: flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  margin: 0 12px 6px;
  padding: 2px 2px 2px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--bg);
  font: 12.5px ui-monospace, Menlo, Consolas, monospace;
}
.chip .detach { width: 22px; height: 22px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); }
.composer { display: flex; align-items: flex-end; gap: 6px; padding: 8px; border-top: 1px solid var(--bubble-line); }
.composer textarea {
  flex: 1;
  min-height: 38px;
  max-height: 120px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
  resize: none;
}
.icon { width: 38px; height: 38px; flex: none; border: 0; border-radius: 999px; background: transparent; font-size: 17px; }
.icon.send { color: var(--accent); }
.row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.btn { padding: 5px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); font-weight: 500; }
.btn.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-fg); }

/* Picking: only the Cancel button takes clicks, so everything else stays pickable. */
.hint { display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 2 * var(--gap)); padding: 8px 8px 8px 14px; pointer-events: none; }
.hint .btn { pointer-events: auto; }
.glass { position: fixed; inset: 0; cursor: crosshair; pointer-events: auto; touch-action: pan-x pan-y; background: transparent; z-index: 1; }
.box { position: fixed; left: 0; top: 0; border: 2px solid var(--accent); border-radius: 3px; background: var(--accent-soft); pointer-events: none; z-index: 2; }
.box.selected { border-color: var(--pick); border-style: dashed; background: var(--pick-soft); }
.label {
  position: fixed;
  left: 0;
  top: 0;
  max-width: min(480px, calc(100vw - 16px));
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-fg);
  font: 600 12px/20px ui-monospace, Menlo, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  z-index: 2;
}
.label.selected { background: var(--pick); }

@media (max-width: 520px) {
  .layer { --gap: 12px; }
  .figure-button { width: 48px; height: 72px; }
  .layer :is(.chat, .hint) { left: var(--gap); right: var(--gap); width: auto; max-width: none; }
  .bottom-right :is(.chat, .hint), .bottom-left :is(.chat, .hint) { bottom: calc(var(--gap) + var(--dy) + 80px); }
  .chat { max-height: min(480px, calc(100vh - 120px)); }
}
@media (prefers-reduced-motion: reduce) {
  .figure *, .figure-button { animation: none !important; transition: none !important; }
}
`;
