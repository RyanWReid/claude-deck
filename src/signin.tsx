import { toaster } from "@decky/api";
import { DialogButton, Focusable, Navigation, TextField } from "@decky/ui";
import qrcode from "qrcode-generator";
import { useState } from "react";

/**
 * Sign-in cards. steam_mcp.py's `sign_in` tool reaches these through the CEF debugger:
 * it calls window.__claudeDeck.signIn(req) and then long-polls wait(id) until the user
 * finishes, so the whole login happens inside the chat.
 */
export interface SignInRequest {
  service: string;
  url?: string;
  code?: string;
  instructions?: string;
  ask_for?: "none" | "text" | "secret";
  input_label?: string;
}

export interface SignInResult {
  status: "done" | "submitted" | "cancelled";
  value?: string;
}

interface Pending extends SignInRequest {
  id: string;
  result?: SignInResult;
  waiters: ((r: SignInResult) => void)[];
}

const pending = new Map<string, Pending>();
let seq = 0;

export function pendingSignIns(): Pending[] {
  return [...pending.values()].filter((p) => !p.result);
}

function finish(p: Pending, result: SignInResult, notify: () => void) {
  if (p.result) return;
  p.result = result;
  p.waiters.splice(0).forEach((w) => w(result));
  // Keep the result around briefly in case the tool's poll is between requests.
  setTimeout(() => pending.delete(p.id), 120_000);
  notify();
}

export function installSignInBridge(notify: () => void, isViewing: () => boolean, openChat: () => void) {
  (window as any).__claudeDeck = {
    signIn(req: SignInRequest): string {
      const id = `si${Date.now().toString(36)}${seq++}`;
      pending.set(id, { ...req, id, waiters: [] });
      notify();
      if (!isViewing()) {
        toaster.toast({
          title: `Sign in to ${req.service}`,
          body: "Claude needs you to sign in. Tap to open the chat.",
          onClick: openChat,
        });
      }
      return id;
    },
    wait(id: string, ms: number): Promise<SignInResult | null> {
      const p = pending.get(id);
      if (!p) return Promise.resolve({ status: "cancelled", value: "The sign-in card is gone (plugin reloaded?)" } as SignInResult);
      if (p.result) return Promise.resolve(p.result);
      return new Promise((res) => {
        const t = setTimeout(() => {
          p.waiters = p.waiters.filter((w) => w !== done);
          res(null);
        }, ms);
        const done = (r: SignInResult) => {
          clearTimeout(t);
          res(r);
        };
        p.waiters.push(done);
      });
    },
    cancel(id: string) {
      const p = pending.get(id);
      if (p) finish(p, { status: "cancelled" }, notify);
    },
  };
  return () => {
    pending.forEach((p) => finish(p, { status: "cancelled", value: "Plugin unloaded" }, notify));
    delete (window as any).__claudeDeck;
  };
}

export function qrDataUrl(text: string): string | null {
  try {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createDataURL(4, 2);
  } catch {
    return null; // too long for a QR code
  }
}

const C = {
  bg: "var(--cd-surface)",
  border: "var(--cd-accent)",
  text: "var(--cd-text)",
  dim: "var(--cd-dim)",
  code: "var(--cd-accent)",
};

export function SignInCard({ req, notify, compact }: { req: Pending; notify: () => void; compact?: boolean }) {
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);
  const qr = req.url && !compact ? qrDataUrl(req.url) : null;
  const ask = req.ask_for && req.ask_for !== "none" ? req.ask_for : null;
  const copy = () => {
    navigator.clipboard?.writeText(req.code!).then(() => setCopied(true), () => {});
  };
  const btn = { width: "auto", minWidth: 0, padding: "6px 14px", fontSize: "13px" };

  return (
    <div
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: "var(--cd-r)",
        padding: "14px 16px",
        margin: "6px 0",
        color: C.text,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "6px" }}>Sign in to {req.service}</div>
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
        {qr && (
          <img src={qr} style={{ width: "132px", height: "132px", imageRendering: "pixelated", borderRadius: "6px", background: "#fff" }} />
        )}
        <div style={{ flex: 1, minWidth: "160px", fontSize: "13px" }}>
          {req.instructions && <div style={{ whiteSpace: "pre-wrap", marginBottom: "6px" }}>{req.instructions}</div>}
          {req.url && (
            <div style={{ color: C.dim, wordBreak: "break-all", marginBottom: "6px" }}>
              {req.url}
              {qr && <div style={{ fontSize: "11px" }}>Scan with your phone, or open it here.</div>}
            </div>
          )}
          {req.code && (
            <div style={{ fontFamily: "monospace", fontSize: compact ? "18px" : "26px", letterSpacing: "3px", color: C.code, margin: "4px 0" }}>
              {req.code}
            </div>
          )}
        </div>
      </div>

      {ask && (
        <div style={{ margin: "8px 0" }}>
          <TextField
            label={req.input_label || (ask === "secret" ? "Password / token" : "Paste the code here")}
            value={value}
            bIsPassword={ask === "secret"}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) finish(req, { status: "submitted", value: value.trim() }, notify);
            }}
          />
        </div>
      )}

      <Focusable flow-children="horizontal" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
        {req.url && (
          <DialogButton style={btn} onClick={() => Navigation.NavigateToExternalWeb(req.url!)}>
            Open here
          </DialogButton>
        )}
        {req.code && (
          <DialogButton style={btn} onClick={copy}>
            {copied ? "Copied" : "Copy code"}
          </DialogButton>
        )}
        {ask ? (
          <DialogButton
            style={btn}
            disabled={!value.trim()}
            onClick={() => finish(req, { status: "submitted", value: value.trim() }, notify)}
          >
            Submit
          </DialogButton>
        ) : (
          <DialogButton style={btn} onClick={() => finish(req, { status: "done" }, notify)}>
            I'm signed in
          </DialogButton>
        )}
        <DialogButton style={btn} onClick={() => finish(req, { status: "cancelled" }, notify)}>
          Cancel
        </DialogButton>
      </Focusable>
    </div>
  );
}
