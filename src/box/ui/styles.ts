export const CSS = `
:root { color-scheme: light dark; --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --line: #e7e5e4;
  --card: #fff; --accent: #2563eb; --on-accent: #fff; --ok: #15803d; --bad: #b91c1c; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --fg: #f5f5f4; --muted: #a8a29e;
  --line: #44403c; --card: #292524; --accent: #60a5fa; --on-accent: #1c1917; --ok: #4ade80;
  --bad: #f87171; } }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px 16px;
  border-bottom: 1px solid var(--line); }
header h1 { font-size: 17px; margin: 0 8px 0 0; }
nav { display: flex; gap: 4px; }
nav a { color: var(--muted); text-decoration: none; padding: 4px 10px; border-radius: 6px; }
nav a[aria-current="page"] { color: var(--fg); background: var(--line); }
main { max-width: 880px; margin: 0 auto; padding: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 14px 16px; margin: 0 0 12px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.muted { color: var(--muted); } .ok { color: var(--ok); } .bad { color: var(--bad); }
button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--card); color: var(--fg); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
input { font: inherit; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--bg); color: var(--fg); flex: 1; min-width: 0; }
a { color: var(--accent); word-break: break-all; }
pre, code { font: 13px/1.45 ui-monospace, monospace; }
pre { white-space: pre-wrap; word-break: break-word; margin: 6px 0; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
`;
