/** Themes are sets of CSS variables applied to each plugin root, so switching is instant. */

export type ThemeId = "claude" | "midnight" | "tokyo" | "minecraft" | "steamos";

export interface Theme {
  id: ThemeId;
  name: string;
  tag: string;
  bg: string;
  surface: string; // cards, composer
  surface2: string; // user bubble, hover
  sunken: string; // activity rows, usage card
  text: string;
  body: string; // assistant prose, a touch softer than text
  dim: string;
  faint: string;
  accent: string;
  onAccent: string;
  ok: string;
  warn: string;
  err: string;
  line: string; // hairlines
  radius: number;
  font: string;
  display: string;
  mono: string;
}

const PLEX = "'IBM Plex Sans', 'Motiva Sans', system-ui, sans-serif";
const MONO = "'JetBrains Mono', 'Fira Mono', monospace";

export const THEMES: Theme[] = [
  {
    id: "claude", name: "Claude", tag: "Default",
    bg: "#1A1918", surface: "#262624", surface2: "#30302E", sunken: "#1F1E1D",
    text: "#FAF9F5", body: "#E8E6DC", dim: "#9C9A92", faint: "#87867F",
    accent: "#D97757", onAccent: "#141413", ok: "#8FA876", warn: "#D9A557", err: "#E07A6B",
    line: "rgba(250,249,245,0.08)", radius: 14,
    font: PLEX, display: "'Source Serif 4', Georgia, serif", mono: MONO,
  },
  {
    id: "midnight", name: "Midnight", tag: "Deep blue",
    bg: "#0B0D12", surface: "#151922", surface2: "#1E2330", sunken: "#10131A",
    text: "#E6E9EF", body: "#D3D8E2", dim: "#8A93A6", faint: "#737C90",
    accent: "#7C9CFF", onAccent: "#0B0D12", ok: "#7FC8A0", warn: "#E5B86A", err: "#F0808A",
    line: "rgba(230,233,239,0.08)", radius: 14,
    font: PLEX, display: PLEX, mono: MONO,
  },
  {
    id: "tokyo", name: "Tokyo", tag: "Neon night",
    bg: "#1A1B26", surface: "#24283B", surface2: "#2F3549", sunken: "#1F2131",
    text: "#C0CAF5", body: "#B4BDE6", dim: "#8C94BF", faint: "#737AA2",
    accent: "#BB9AF7", onAccent: "#1A1B26", ok: "#9ECE6A", warn: "#E0AF68", err: "#F7768E",
    line: "rgba(192,202,245,0.09)", radius: 14,
    font: PLEX, display: PLEX, mono: MONO,
  },
  {
    id: "minecraft", name: "Minecraft", tag: "Blocky",
    bg: "#2B2B2B", surface: "#3C3C3C", surface2: "#4A4A4A", sunken: "#333333",
    text: "#F0F0F0", body: "#E2E2E2", dim: "#A8A8A8", faint: "#909090",
    accent: "#6CBF3A", onAccent: "#1B2A10", ok: "#6CBF3A", warn: "#FCDB05", err: "#FF5555",
    line: "rgba(0,0,0,0.45)", radius: 0,
    font: "'Pixelify Sans', monospace", display: "'Pixelify Sans', monospace", mono: "'Pixelify Sans', monospace",
  },
  {
    id: "steamos", name: "SteamOS", tag: "Native",
    bg: "#0E141B", surface: "#1F242C", surface2: "#2A303A", sunken: "#151A21",
    text: "#DCDEDF", body: "#C8CBCE", dim: "#8B929A", faint: "#767D86",
    accent: "#1A9FFF", onAccent: "#0E141B", ok: "#59BF40", warn: "#E5B143", err: "#E35E5E",
    line: "rgba(220,222,223,0.08)", radius: 4,
    font: "'Motiva Sans', system-ui, sans-serif", display: "'Motiva Sans', system-ui, sans-serif", mono: MONO,
  },
];

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** CSS variables for a plugin root element. */
export function themeVars(t: Theme): Record<string, string> {
  return {
    "--cd-bg": t.bg,
    "--cd-surface": t.surface,
    "--cd-surface2": t.surface2,
    "--cd-sunken": t.sunken,
    "--cd-text": t.text,
    "--cd-body": t.body,
    "--cd-dim": t.dim,
    "--cd-faint": t.faint,
    "--cd-accent": t.accent,
    "--cd-on-accent": t.onAccent,
    "--cd-ok": t.ok,
    "--cd-warn": t.warn,
    "--cd-err": t.err,
    "--cd-line": t.line,
    "--cd-r": `${t.radius}px`,
    "--cd-r-sm": `${Math.round(t.radius * 0.72)}px`,
    "--cd-r-pill": t.radius ? "999px" : "0px",
    "--cd-font": t.font,
    "--cd-display": t.display,
    "--cd-mono": t.mono,
  };
}

export const v = (name: string) => `var(--cd-${name})`;

const FONTS_ID = "claude-deck-fonts";
const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500" +
  "&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Pixelify+Sans:wght@400;600&display=swap";

/** Load the theme fonts once. Offline, every stack falls back to Steam's own fonts. */
export function installFonts(): () => void {
  if (document.getElementById(FONTS_ID)) return () => {};
  const link = document.createElement("link");
  link.id = FONTS_ID;
  link.rel = "stylesheet";
  link.href = FONTS_URL;
  document.head.appendChild(link);
  return () => link.remove();
}

/** Keyframes and focus styles shared by every view. */
export const CSS = `
@keyframes cdMsgIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes cdCardIn { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes cdThink { 0% { transform: rotate(0) scale(1); } 50% { transform: rotate(45deg) scale(.84); } 100% { transform: rotate(90deg) scale(1); } }
@keyframes cdCaret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes cdRing { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--cd-accent) 45%, transparent); } 100% { box-shadow: 0 0 0 10px transparent; } }
@keyframes cdWave { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
@keyframes cdFade { from { opacity: 0; } to { opacity: 1; } }
.cd-root { font-family: var(--cd-font); color: var(--cd-text); }
.cd-msg { animation: cdMsgIn 260ms cubic-bezier(.2,.8,.2,1) both; }
.cd-card { animation: cdCardIn 320ms cubic-bezier(.2,.8,.2,1) both; }
.cd-attn { animation: cdCardIn 320ms cubic-bezier(.2,.8,.2,1) both, cdRing 1.6s ease-out 320ms infinite; }
.cd-think { animation: cdThink 1.6s cubic-bezier(.65,0,.35,1) infinite; transform-origin: center; }
.cd-caret { display: inline-block; width: 2px; height: 1.05em; background: var(--cd-accent); vertical-align: -2px; margin-left: 2px; animation: cdCaret 1s steps(1) infinite; }
.cd-bar { display: inline-block; width: 3px; height: 18px; border-radius: 2px; background: var(--cd-accent); transform-origin: center; animation: cdWave 900ms ease-in-out infinite; }
.cd-fade { animation: cdFade 200ms ease-out both; }
.cd-root .cd-btn, .cd-root .cd-btn:hover { box-shadow: none !important; }
.cd-btn.gpfocus, .cd-btn:focus-visible { outline: 2px solid var(--cd-text) !important; outline-offset: 2px; }
.cd-field input { background: transparent !important; border: none !important; box-shadow: none !important; outline: none !important; color: var(--cd-text) !important; font-family: var(--cd-font) !important; font-size: 15px !important; padding: 0 !important; }
.cd-field input::placeholder { color: var(--cd-faint); }
.cd-field > div, .cd-field .DialogInputLabelGroup { margin: 0 !important; padding: 0 !important; }
.cd-root .gpfocus.cd-focus-soft { background: var(--cd-surface2) !important; border-radius: var(--cd-r-sm); }
`;
