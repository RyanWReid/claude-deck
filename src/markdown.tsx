import { Focusable } from "@decky/ui";
import { ReactNode } from "react";

/**
 * A tiny Markdown renderer for chat replies: paragraphs, headings, lists, code blocks,
 * **bold**, *italic*, `code` and [links](url). Each block is its own focus target so the
 * d-pad can walk through (and scroll) a long reply one paragraph at a time.
 */

type Block =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "li"; text: string; n?: string }
  | { t: "code"; text: string }
  | { t: "quote"; text: string };

export function parse(md: string): Block[] {
  const out: Block[] = [];
  const lines = md.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpMatchArray | null;
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push({ t: "code", text: code.join("\n") });
    } else if ((m = line.match(/^#{1,6}\s+(.*)/))) {
      flush();
      out.push({ t: "h", text: m[1] });
    } else if ((m = line.match(/^\s*(?:[-*+]|(\d+)[.)])\s+(.*)/))) {
      flush();
      out.push({ t: "li", text: m[2], n: m[1] });
    } else if ((m = line.match(/^>\s?(.*)/))) {
      flush();
      out.push({ t: "quote", text: m[1] });
    } else if (!line.trim() || /^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flush();
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      // Tables don't fit the Deck; show rows as plain lines.
      if (!/^\s*\|[\s:|-]+\|\s*$/.test(line)) para.push(line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join(" · "));
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

export function inline(text: string, accent: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (/^(\*\*|__)/.test(part)) return <b key={i}>{inline(part.slice(2, -2), accent)}</b>;
    if (part.startsWith("`"))
      return (
        <code key={i} style={{ background: "rgba(255,255,255,0.08)", borderRadius: "4px", padding: "0 4px", fontSize: "0.92em" }}>
          {part.slice(1, -1)}
        </code>
      );
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <span key={i} style={{ color: accent, textDecoration: "underline" }}>{link[1]}</span>;
    if (/^[*_]/.test(part) && part.length > 2) return <i key={i}>{inline(part.slice(1, -1), accent)}</i>;
    return part;
  });
}

export function Markdown({ text, accent, focusable = true }: { text: string; accent: string; focusable?: boolean }) {
  const blocks = parse(text);
  return (
    <>
      {blocks.map((b, i) => {
        let el: ReactNode;
        const gap = i ? { marginTop: b.t === "li" && blocks[i - 1].t === "li" ? "2px" : "8px" } : {};
        switch (b.t) {
          case "h":
            el = <div style={{ fontWeight: 700, fontSize: "1.05em", ...gap }}>{inline(b.text, accent)}</div>;
            break;
          case "li":
            el = (
              <div style={{ display: "flex", gap: "6px", ...gap }}>
                <span style={{ color: accent, minWidth: "1em", textAlign: "right" }}>{b.n ? `${b.n}.` : "•"}</span>
                <span style={{ flex: 1 }}>{inline(b.text, accent)}</span>
              </div>
            );
            break;
          case "code":
            el = (
              <pre
                style={{
                  margin: 0,
                  ...gap,
                  background: "rgba(0,0,0,0.3)",
                  borderRadius: "6px",
                  padding: "6px 8px",
                  fontSize: "12px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {b.text}
              </pre>
            );
            break;
          case "quote":
            el = <div style={{ borderLeft: `3px solid ${accent}`, paddingLeft: "8px", opacity: 0.85, ...gap }}>{inline(b.text, accent)}</div>;
            break;
          default:
            el = <div style={{ whiteSpace: "pre-wrap", ...gap }}>{inline(b.text, accent)}</div>;
        }
        return focusable && blocks.length > 1 ? (
          <Focusable key={i} onActivate={() => {}} noFocusRing={false}>
            {el}
          </Focusable>
        ) : (
          <div key={i}>{el}</div>
        );
      })}
    </>
  );
}
