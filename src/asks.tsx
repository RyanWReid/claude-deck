import { DialogButton, Focusable } from "@decky/ui";
import { useState } from "react";
import { Icon, IconName, toolIcon } from "./icons";
import { Markdown } from "./markdown";
import { v } from "./theme";

/** Approval, question and plan cards for Claude's permission requests. */

export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

export interface Ask {
  id: string;
  kind: "tool" | "question" | "plan";
  tool: string;
  tool_name?: string;
  title?: string;
  summary: string;
  reason: string;
  description: string;
  can_always: boolean;
  questions?: Question[] | null;
  plan?: string | null;
  ts: number;
}

export type Answer = (id: string, decision: "allow" | "always" | "deny", answers?: Record<string, string>) => void;

/** A Steam-style face-button glyph. */
export function Glyph({ k }: { k: string }) {
  return (
    <span
      style={{
        minWidth: "22px",
        height: "22px",
        padding: k.length > 1 ? "0 6px" : 0,
        borderRadius: k.length > 1 ? "6px" : "11px",
        background: "rgba(0,0,0,0.22)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "11px",
        fontWeight: 700,
      }}
    >
      {k}
    </span>
  );
}

const base = {
  boxSizing: "border-box" as const,
  height: "40px",
  minWidth: 0,
  width: "auto",
  padding: "0 16px 0 8px",
  borderRadius: v("r-sm"),
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontSize: "14px",
  fontFamily: v("font"),
};
export const primaryBtn = { ...base, background: v("accent"), color: v("on-accent"), fontWeight: 600, border: "none" };
export const ghostBtn = { ...base, background: "transparent", color: v("text"), border: `1px solid ${v("line")}` };

function Card({ attention, children }: { attention?: boolean; children: any }) {
  return (
    <div
      className={attention ? "cd-attn" : "cd-card"}
      style={{
        background: v("surface"),
        border: `1px solid ${attention ? `color-mix(in srgb, ${v("accent")} 55%, transparent)` : v("line")}`,
        borderRadius: v("r"),
        padding: "14px 16px",
        margin: "6px 0",
        boxSizing: "border-box",
        color: v("text"),
        fontSize: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {children}
    </div>
  );
}

function Head({ icon, title, sub }: { icon: IconName; title: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <div
        style={{
          width: "36px",
          height: "36px",
          flexShrink: 0,
          borderRadius: v("r-sm"),
          background: `color-mix(in srgb, ${v("accent")} 15%, transparent)`,
          color: v("accent"),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={19} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{title}</div>
        {sub && <div style={{ fontSize: "12.5px", color: v("dim"), lineHeight: 1.35 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ToolCard({ ask, answer, compact }: { ask: Ask; answer: Answer; compact?: boolean }) {
  const [details, setDetails] = useState(false);
  const title = ask.title || ask.description || `Use ${ask.tool}`;
  const sub = [ask.tool_name === "Bash" ? "Runs a command" : ask.tool, ask.reason].filter(Boolean).join(" · ");
  return (
    <Card attention>
      <Head icon={toolIcon(ask.tool_name || ask.tool)} title={title} sub={sub} />
      {details && ask.summary && (
        <div
          className="cd-fade"
          style={{
            fontFamily: v("mono"),
            fontSize: "12px",
            color: v("body"),
            background: v("sunken"),
            borderRadius: v("r-sm"),
            padding: "8px 10px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: compact ? "96px" : "160px",
            overflow: "hidden",
          }}
        >
          {ask.summary}
        </div>
      )}
      <Focusable flow-children="horizontal" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <DialogButton className="cd-btn" style={primaryBtn} onClick={() => answer(ask.id, "allow")}>
          <Glyph k="A" />
          Allow
        </DialogButton>
        {ask.can_always && !compact && (
          <DialogButton className="cd-btn" style={ghostBtn} onClick={() => answer(ask.id, "always")}>
            <Icon name="check" size={16} />
            Always this chat
          </DialogButton>
        )}
        <DialogButton className="cd-btn" style={ghostBtn} onClick={() => answer(ask.id, "deny")}>
          <Icon name="x" size={16} />
          Deny
        </DialogButton>
        {ask.summary && ask.summary !== title && (
          <DialogButton className="cd-btn" style={{ ...ghostBtn, border: "none", color: v("dim"), padding: "0 10px" }} onClick={() => setDetails(!details)}>
            <Icon name="terminal" size={15} />
            {details ? "Hide" : "Details"}
          </DialogButton>
        )}
      </Focusable>
    </Card>
  );
}

function QuestionCard({ ask, answer }: { ask: Ask; answer: Answer }) {
  const qs = ask.questions ?? [];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const done = qs.every((q) => (picked[q.question] ?? []).length > 0);
  const submit = (all: Record<string, string[]>) =>
    answer(ask.id, "allow", Object.fromEntries(qs.map((q) => [q.question, (all[q.question] ?? []).join(", ")])));
  const choose = (q: Question, label: string) => {
    const cur = picked[q.question] ?? [];
    const next = q.multiSelect ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label];
    const all = { ...picked, [q.question]: next };
    setPicked(all);
    if (!q.multiSelect && qs.length === 1) submit(all); // one tap answers a simple question
  };

  return (
    <Card attention>
      {qs.map((q) => (
        <div key={q.question} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <Head icon="question" title={q.question} sub={q.header} />
          <Focusable style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {q.options.map((o) => {
              const on = (picked[q.question] ?? []).includes(o.label);
              return (
                <DialogButton
                  key={o.label}
                  className="cd-btn"
                  style={{
                    ...ghostBtn,
                    height: "auto",
                    minHeight: "44px",
                    padding: "8px 14px",
                    textAlign: "left",
                    width: "100%",
                    background: on ? `color-mix(in srgb, ${v("accent")} 18%, transparent)` : v("sunken"),
                    borderColor: on ? v("accent") : v("line"),
                  }}
                  onClick={() => choose(q, o.label)}
                >
                  {q.multiSelect && <Icon name={on ? "check" : "x"} size={14} color={on ? undefined : "transparent"} />}
                  <div>
                    <div style={{ fontWeight: 600 }}>{o.label}</div>
                    {o.description && <div style={{ fontSize: "12px", color: v("dim") }}>{o.description}</div>}
                  </div>
                </DialogButton>
              );
            })}
          </Focusable>
        </div>
      ))}
      <Focusable flow-children="horizontal" style={{ display: "flex", gap: "8px" }}>
        {(qs.length > 1 || qs.some((q) => q.multiSelect)) && (
          <DialogButton className="cd-btn" style={primaryBtn} disabled={!done} onClick={() => submit(picked)}>
            <Icon name="send" size={16} />
            Send answers
          </DialogButton>
        )}
        <DialogButton className="cd-btn" style={ghostBtn} onClick={() => answer(ask.id, "deny")}>
          Skip
        </DialogButton>
      </Focusable>
    </Card>
  );
}

function PlanCard({ ask, answer }: { ask: Ask; answer: Answer }) {
  return (
    <Card attention>
      <Head icon="plan" title="Here's the plan" sub="Nothing changes until you say go." />
      <div style={{ color: v("body"), fontSize: "14px", lineHeight: 1.5 }}>
        <Markdown text={ask.plan || ""} accent={v("accent")} />
      </div>
      <Focusable flow-children="horizontal" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <DialogButton className="cd-btn" style={primaryBtn} onClick={() => answer(ask.id, "allow")}>
          <Glyph k="A" />
          Go ahead
        </DialogButton>
        <DialogButton className="cd-btn" style={ghostBtn} onClick={() => answer(ask.id, "always")}>
          <Icon name="pencil" size={16} />
          Go, accept edits
        </DialogButton>
        <DialogButton className="cd-btn" style={ghostBtn} onClick={() => answer(ask.id, "deny")}>
          Keep planning
        </DialogButton>
      </Focusable>
    </Card>
  );
}

export function AskCard({ ask, answer, compact }: { ask: Ask; answer: Answer; compact?: boolean }) {
  if (ask.kind === "question") return <QuestionCard ask={ask} answer={answer} />;
  if (ask.kind === "plan") return <PlanCard ask={ask} answer={answer} />;
  return <ToolCard ask={ask} answer={answer} compact={compact} />;
}
