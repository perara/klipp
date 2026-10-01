export const CSS = /* css */ `
:host { all: initial; }
:host(.probing) * { pointer-events: none !important; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }

.layer {
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #59636e;
  --line: #d1d9e0;
  --soft: #f6f8fa;
  --accent: #0969da;
  --accent-fg: #ffffff;
  --accent-soft: rgba(9, 105, 218, 0.12);
  --pick: #bf3989;
  --pick-soft: rgba(191, 57, 137, 0.1);
  --warn: #9a6700;
  --bubble: #fff8c5;
  --bubble-line: #d4a72c;
  --wire: #8c959f;
  --wire-shade: #57606a;
  --wire-shine: #eef2f5;
  --shadow: 0 10px 30px rgba(31, 35, 40, 0.2), 0 1px 3px rgba(31, 35, 40, 0.12);
  font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .layer {
    --bg: #161b22;
    --fg: #e6edf3;
    --muted: #9198a1;
    --line: #3d444d;
    --soft: #21262d;
    --accent: #4493f8;
    --accent-fg: #0d1117;
    --accent-soft: rgba(68, 147, 248, 0.16);
    --pick: #ff7bc4;
    --pick-soft: rgba(255, 123, 196, 0.12);
    --warn: #d29922;
    --bubble: #3b3417;
    --bubble-line: #9e6a03;
    --wire: #9aa4ae;
    --wire-shade: #484f58;
    --wire-shine: #f0f3f6;
    --shadow: 0 10px 30px rgba(0, 0, 0, 0.55), 0 1px 3px rgba(0, 0, 0, 0.4);
  }
}

button, textarea, input { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code, .mono { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; }

/* The character */
.clip { display: block; overflow: visible; }
.clip path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.clip .wire-shade { stroke: var(--wire-shade); stroke-width: 4.8; }
.clip .wire { stroke: var(--wire); stroke-width: 3.4; }
.clip .wire-shine { stroke: var(--wire-shine); stroke-width: 1.1; opacity: 0.8; }
.clip .brow { stroke: var(--wire-shade); stroke-width: 1.7; }
.clip .eye-white { fill: #ffffff; stroke: var(--wire-shade); stroke-width: 0.9; }
.clip .pupil { fill: #1f2328; }
.clip .glint { fill: #ffffff; }
.clip .eyes { transform-box: fill-box; transform-origin: center; animation: blink 5.5s infinite; }
@keyframes blink { 0%, 95%, 100% { transform: scaleY(1); } 97% { transform: scaleY(0.1); } }

/* Launcher and speech bubble */
.launcher {
  position: fixed;
  width: 56px;
  height: 72px;
  padding: 4px 6px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  pointer-events: auto;
  z-index: 5;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.25));
  transition: transform 160ms ease;
}
.launcher:hover { transform: translateY(-3px) rotate(-4deg); }
.launcher.active { transform: rotate(8deg); }
.launcher .clip { width: 44px; height: 62px; }
.bubble {
  position: fixed;
  max-width: 260px;
  padding: 10px 30px 10px 12px;
  border: 1px solid var(--bubble-line);
  border-radius: 12px;
  background: var(--bubble);
  box-shadow: var(--shadow);
  pointer-events: auto;
  z-index: 5;
}
.bubble .dismiss {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
}
kbd {
  font: 11px ui-monospace, Menlo, Consolas, monospace;
  padding: 0 4px;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--bg);
}

.bottom-right .launcher { right: 16px; bottom: 16px; }
.bottom-left .launcher { left: 16px; bottom: 16px; }
.top-right .launcher { right: 16px; top: 16px; }
.top-left .launcher { left: 16px; top: 16px; }
.bottom-right .bubble { right: 80px; bottom: 44px; }
.bottom-left .bubble { left: 80px; bottom: 44px; }
.top-right .bubble { right: 80px; top: 24px; }
.top-left .bubble { left: 80px; top: 24px; }

/* Picking */
.glass {
  position: fixed;
  inset: 0;
  cursor: crosshair;
  pointer-events: auto;
  touch-action: pan-x pan-y;
  background: transparent;
  z-index: 1;
}
.box {
  position: fixed;
  left: 0;
  top: 0;
  border: 2px solid var(--accent);
  border-radius: 3px;
  background: var(--accent-soft);
  pointer-events: none;
  z-index: 2;
}
.box.selected { border-color: var(--pick); background: var(--pick-soft); border-style: dashed; }
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
.banner {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 32px);
  padding: 6px 6px 6px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--bg);
  box-shadow: var(--shadow);
  pointer-events: none;
  transition: opacity 120ms ease;
  z-index: 3;
}
.banner .btn { pointer-events: auto; }
.banner.faded { opacity: 0.3; }
.banner.faded:has(.btn:hover) { opacity: 1; }
.banner .clip { width: 16px; height: 22px; flex: none; }
.banner .hint { color: var(--muted); }

/* Panel */
.panel {
  position: fixed;
  width: 380px;
  max-width: calc(100vw - 32px);
  max-height: min(600px, calc(100vh - 120px));
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--bg);
  box-shadow: var(--shadow);
  pointer-events: auto;
  z-index: 4;
}
.bottom-right .panel { right: 16px; bottom: 96px; }
.bottom-left .panel { left: 16px; bottom: 96px; }
.top-right .panel { right: 16px; top: 96px; }
.top-left .panel { left: 16px; top: 96px; }
.bottom-right .panel.flip, .bottom-left .panel.flip { top: 16px; bottom: auto; }
.top-right .panel.flip, .top-left .panel.flip { bottom: 16px; top: auto; }
@media (max-width: 520px) {
  .layer .panel { left: 16px; right: 16px; width: auto; max-width: none; max-height: 55vh; }
}
.panel header {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 12px 8px;
  border-bottom: 1px solid var(--line);
}
.panel header .clip { width: 22px; height: 30px; flex: none; }
.panel h2 { margin: 0; font-size: 14px; line-height: 1.3; font-weight: 600; }
.panel .id-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.panel .id { padding: 1px 6px; border-radius: 6px; background: var(--soft); user-select: all; }
.panel .close {
  margin-left: auto;
  width: 28px;
  height: 28px;
  flex: none;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 18px;
  line-height: 1;
}
.panel .close:hover, .bubble .dismiss:hover { background: var(--soft); }
.panel .body { padding: 10px 12px 12px; display: grid; gap: 10px; }
.panel dl { display: grid; grid-template-columns: 84px 1fr; gap: 6px 10px; margin: 0; }
.panel dt { color: var(--muted); }
.panel dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.panel ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.panel a { color: var(--accent); text-decoration: none; }
.panel a:hover { text-decoration: underline; }
.panel summary { cursor: pointer; margin-top: 2px; }
.panel details ol { margin-top: 2px; }
.panel .chips { display: flex; flex-wrap: wrap; gap: 4px; }
.panel .chip { padding: 0 6px; border-radius: 999px; background: var(--soft); border: 1px solid var(--line); font-size: 12px; }
.panel .warning { color: var(--warn); font-size: 12px; }
.panel textarea {
  width: 100%;
  min-height: 64px;
  resize: vertical;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
}
.panel label.opt { display: flex; gap: 8px; align-items: flex-start; }
.panel label.opt input { margin: 3px 0 0; }
.panel .small { color: var(--muted); font-size: 12px; }
.row { display: flex; flex-wrap: wrap; gap: 6px; }
.btn {
  padding: 5px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--soft);
  font-weight: 500;
}
.btn:hover { border-color: var(--muted); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.link { border-color: transparent; background: transparent; color: var(--accent); padding-inline: 6px; }
.status { min-height: 18px; color: var(--muted); font-size: 12px; }

@media (prefers-reduced-motion: reduce) {
  .clip .eyes { animation: none; }
  .launcher { transition: none; }
}
`;
