export const CSS = `
@font-face { font-family: Nunito; src: url('/ui/box/ui/assets/nunito.woff2') format('woff2'); font-weight: 400 800; font-display: swap; }
:root { color-scheme: light dark; --bg: #f7f7f2; --fg: #1f2328; --muted: #59636e;
  --line: #d0d7de; --card: #fff; --accent: #755100; --on-accent: #fff; --warm: #fff8c5;
  --ok: #176b32; --bad: #b4232a; --soft: #f0f2f4; --ring: #0969da; }
@media (prefers-color-scheme: dark) { :root { --bg: #101419; --fg: #e6edf3; --muted: #a6b1be;
  --line: #424c58; --card: #1b222b; --accent: #f1cf65; --on-accent: #1f2328; --warm: #342e19;
  --ok: #7cdda0; --bad: #ff9ea4; --soft: #252e39; --ring: #80bdff; } }
* { box-sizing: border-box; }
body { margin: 0; font: 1rem/1.6 Nunito, ui-rounded, system-ui, sans-serif; background: var(--bg); color: var(--fg); }
[hidden] { display: none !important; }
header { display: flex; justify-content: space-between; gap: 24px; align-items: center;
  max-width: 1160px; margin: auto; padding: 24px 32px; border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 12px; color: var(--fg); text-decoration: none; }
.brand strong { font-size: 32px; line-height: 1.1; letter-spacing: -1px; }
.brand-byline { display: block; color: var(--muted); font-size: 13px; }
.identity { max-width: 55%; padding: 8px 14px; border: 1px solid var(--line); border-radius: 24px;
  background: var(--card); font-size: 14px; overflow-wrap: anywhere; }
.shell { max-width: 1160px; margin: auto; padding: 0 32px; }
.intro { display: flex; align-items: center; justify-content: space-between; gap: 32px; padding: 44px 0 28px; }
.eyebrow { font-size: 12px; font-weight: 800; letter-spacing: 2px; color: var(--accent); margin: 0 0 8px; }
h1 { font-size: clamp(28px, 4vw, 42px); line-height: 1.15; letter-spacing: -1px; margin: 0; }
.intro p:last-child { margin: 16px 0 0; max-width: 620px; }
.forge-mark { font-size: 58px; font-weight: 800; color: var(--accent); background: var(--warm);
  width: 96px; height: 96px; flex-shrink: 0; text-align: center; border-radius: 26px; transform: rotate(-8deg); }
nav { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 8px 0 32px; }
.section-link { display: flex; align-items: center; gap: 12px; padding: 18px; border-radius: 14px;
  border: 1px solid var(--line); background: var(--card); text-decoration: none; color: var(--fg); }
.section-link[aria-current="page"] { border-color: var(--accent); background: var(--warm); }
.section-link:hover { border-color: var(--accent); }
.nav-number { font: 12px ui-monospace, monospace; color: var(--accent); }
.nav-description { display: block; font-size: 13px; color: var(--muted); }
.nav-arrow { margin-left: auto; color: var(--accent); }
main { min-height: 300px; }
.section-heading { margin-bottom: 20px; }
h2 { font-size: 22px; letter-spacing: -.4px; margin: 0; }
h3 { font-size: 22px; margin: 0 auto 0 0; }
.section-heading p { margin: 4px 0 0; }
.agent-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 24px; margin-bottom: 20px; }
.agent-card { border-top: 3px solid var(--accent); }
.agent-description { margin: 16px 0 4px; }
.agent-version { font-size: 13px; margin-top: 0; }
.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.muted { color: var(--muted); } .ok { color: var(--ok); } .bad { color: var(--bad); }
.chip { display: inline-flex; padding: 4px 10px; border: 1px solid currentColor; border-radius: 24px; font-size: 13px; font-weight: 800; }
.notice { padding: 12px; background: var(--soft); border-radius: 10px; }
button { font: inherit; font-weight: 700; min-height: 44px; padding: 9px 18px; border-radius: 10px;
  border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
input { font: inherit; min-height: 44px; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--muted);
  background: var(--bg); color: var(--fg); flex: 1; min-width: 0; }
label { display: block; font-weight: 700; margin-bottom: 8px; }
a { color: var(--accent); overflow-wrap: anywhere; }
:focus-visible { outline: 3px solid var(--ring); outline-offset: 4px; }
.skip { position: absolute; left: 16px; top: -100px; background: var(--card); padding: 12px; z-index: 1; }
.skip:focus { top: 16px; }
pre, code { font: 14px/1.65 ui-monospace, monospace; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0; }
.secret, .answer { padding: 20px; background: var(--soft); border-radius: 12px; }
.run-steps { border-left: 2px solid var(--line); padding-left: 20px; }
summary { cursor: pointer; min-height: 44px; padding: 8px 0; }
.table-card { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 14px 8px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
th { color: var(--muted); font-weight: 800; }
td a { display: inline-block; min-height: 44px; padding: 10px 0; }
.empty { padding: 24px 0; text-align: center; }
footer { padding: 32px 0; border-top: 1px solid var(--line); margin-top: 24px; font-size: 13px; color: var(--muted); }
@media (max-width: 680px) {
  header { padding: 16px; gap: 12px; flex-wrap: wrap; }
  .identity { max-width: 100%; }
  .shell { padding: 0 16px; }
  .intro { padding: 28px 0 20px; }
  .forge-mark { display: none; }
  nav { gap: 8px; margin-bottom: 24px; }
  .section-link { padding: 14px 8px; justify-content: center; }
  .nav-number, .nav-description, .nav-arrow { display: none; }
  .agent-grid { grid-template-columns: 1fr; gap: 0; }
  .card { padding: 18px; }
  .token-form .row { flex-direction: column; align-items: stretch; }
  th, td { padding: 10px 5px; }
}
`;
