import { addEventListener, callable, removeEventListener, toaster } from "@decky/api";
import { DialogButton, Focusable, Navigation, TextField } from "@decky/ui";
import { useEffect, useState } from "react";
import { ghostBtn, primaryBtn } from "./asks";
import { Icon } from "./icons";
import { qrDataUrl } from "./signin";
import { v } from "./theme";

/** First-run checklist (Claude Code, sign-in, voice) and in-place updates from GitHub releases. */

export interface SetupStatus {
  claude: boolean;
  version: string | null;
  signed_in: boolean;
  plan: string | null;
  voice: boolean;
  speech: boolean;
  controller: boolean;
  plugin_version: string | null;
}
interface Update {
  current?: string;
  latest?: string;
  update?: boolean;
  url?: string | null;
  notes?: string;
  error?: string;
}

const setupStatus = callable<[], SetupStatus>("setup_status");
const installClaude = callable<[], { ok: boolean; log: string }>("install_claude");
const loginStart = callable<[], { url?: string; error?: string; log?: string }>("login_start");
const loginFinish = callable<[code: string], { ok?: boolean; error?: string; plan?: string; log?: string }>("login_finish");
const setupVoice = callable<[], { ok: boolean; error?: string }>("setup_voice");
const checkUpdate = callable<[], Update>("check_update");

let status: SetupStatus | null = null;
let fetchedAt = 0;
let update: Update | null = null;
let checkedUpdate = 0;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

export async function refreshSetup() {
  fetchedAt = Date.now();
  status = await setupStatus().catch(() => status);
  changed();
  return status;
}

/** `claude_auth` from the backend: a reply failed because the login is gone (or sign-in just
 * worked). Flip the UI right away so Sign in shows, then confirm with a fresh status. */
export function onAuthEvent(e: { signed_in: boolean }) {
  if (status && !e?.signed_in) {
    status = { ...status, signed_in: false, plan: null };
    changed();
  }
  refreshSetup();
}

function useSetup() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((t) => t + 1);
    listeners.add(f);
    // The panel stays mounted, so also re-check on later mounts (chat page) once it's a minute old.
    if (!status || Date.now() - fetchedAt > 60e3) refreshSetup();
    if (Date.now() - checkedUpdate > 6 * 3600e3) {
      checkedUpdate = Date.now();
      checkUpdate()
        .then((u) => {
          update = u;
          changed();
        })
        .catch(() => {});
    }
    return () => {
      listeners.delete(f);
    };
  }, []);
}

const row = { display: "flex", alignItems: "center", gap: "10px", minHeight: "40px" } as const;
const small = { ...ghostBtn, height: "34px", padding: "0 12px", fontSize: "13px" };

function Check({ ok, label, detail, children }: { ok: boolean; label: string; detail?: string | null; children?: any }) {
  return (
    <Focusable flow-children="horizontal" style={row}>
      <span style={{ color: ok ? v("ok") : v("accent") }}>
        <Icon name={ok ? "check" : "alert"} size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13.5px" }}>{label}</div>
        {detail && <div style={{ fontSize: "11.5px", color: v("dim") }}>{detail}</div>}
      </div>
      {!ok && children}
    </Focusable>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [log, setLog] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setUrl(null);
    setErr("");
    setLog("");
    setCode("");
    loginStart()
      .then((r) => {
        if (r.url) setUrl(r.url);
        else {
          setErr(r.error ?? "Couldn't start sign-in");
          setLog(r.log ?? "");
        }
      })
      .catch((e) => setErr(`Couldn't start sign-in: ${e}`));
  }, [attempt]);
  const submit = async () => {
    setBusy(true);
    const r = await loginFinish(code).catch((e) => ({ error: String(e) }) as { ok?: boolean; error?: string; plan?: string; log?: string });
    setBusy(false);
    if (r.ok) {
      toaster.toast({ title: "Signed in to Claude", body: r.plan ? `Plan: ${r.plan}` : "You're all set." });
      onDone();
    } else {
      // The login command has exited by now, so a retry needs a fresh link.
      setUrl(null);
      setErr(r.error ?? "That code didn't work. Try again.");
      setLog(r.log ?? "");
    }
  };
  const retry = (
    <DialogButton className="cd-btn" style={{ ...small, alignSelf: "flex-start" }} onClick={() => setAttempt((a) => a + 1)}>
      Try again
    </DialogButton>
  );
  if (err && !url)
    return (
      <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px", borderRadius: v("r-sm"), background: v("sunken") }}>
        <div style={{ fontSize: "12.5px", color: v("warn") }}>{err}</div>
        {log && <div style={{ fontSize: "11px", color: v("dim"), fontFamily: v("mono"), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{log}</div>}
        {retry}
      </Focusable>
    );
  if (!url) return <div style={{ fontSize: "12.5px", color: v("dim") }}>Getting a sign-in link…</div>;
  const qr = qrDataUrl(url);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "10px", borderRadius: v("r-sm"), background: v("sunken") }}>
      <div style={{ fontSize: "12.5px", color: v("body"), lineHeight: 1.45 }}>
        Scan with your phone (or open it here), sign in, then paste the code it shows you.
      </div>
      {qr && <img src={qr} style={{ width: "150px", height: "150px", alignSelf: "center", background: "#fff", borderRadius: "8px", padding: "4px", imageRendering: "pixelated" }} />}
      <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value)} />
      {err && <div style={{ fontSize: "12px", color: v("warn") }}>{err}</div>}
      <Focusable flow-children="horizontal" style={{ display: "flex", gap: "8px" }}>
        <DialogButton className="cd-btn" style={{ ...primaryBtn, height: "36px", padding: "0 14px" }} disabled={!code.trim() || busy} onClick={submit}>
          {busy ? "Checking…" : "Sign in"}
        </DialogButton>
        <DialogButton className="cd-btn" style={small} onClick={() => Navigation.NavigateToExternalWeb(url)}>
          Open here
        </DialogButton>
        <DialogButton className="cd-btn" style={small} disabled={busy} onClick={() => setAttempt((a) => a + 1)}>
          New link
        </DialogButton>
      </Focusable>
    </div>
  );
}

/** "Signed out" bar for the top of the full chat page; the panel has the SetupCard instead. */
export function SignInBanner() {
  useSetup();
  const [signing, setSigning] = useState(false);
  if (!status || !status.claude || status.signed_in) return null;
  return (
    <div style={{ boxSizing: "border-box", width: "100%", display: "flex", flexDirection: "column", gap: "8px", padding: "12px", borderRadius: v("r"), background: v("surface"), border: `1px solid ${v("line")}` }}>
      <Check ok={false} label="Signed out of Claude" detail="Sign in with your Claude account (Pro or Max) to keep chatting.">
        {!signing && (
          <DialogButton className="cd-btn" style={small} onClick={() => setSigning(true)}>
            Sign in
          </DialogButton>
        )}
      </Check>
      {signing && (
        <SignIn
          onDone={() => {
            setSigning(false);
            refreshSetup();
          }}
        />
      )}
    </div>
  );
}

/** Shown at the top of the panel until everything works. */
export function SetupCard() {
  useSetup();
  const [busy, setBusy] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [voiceStep, setVoiceStep] = useState<string | null>(null);
  useEffect(() => {
    const l = addEventListener<[{ step: string; pct?: number; done?: boolean; error?: boolean }]>("claude_setup", (e) => {
      setVoiceStep(e.done ? null : `${e.step}${e.pct != null ? ` · ${e.pct}%` : ""}`);
      if (e.done) {
        if (e.error) toaster.toast({ title: "Voice setup failed", body: e.step });
        refreshSetup();
      }
    });
    return () => removeEventListener("claude_setup", l);
  }, []);
  if (!status || (status.claude && status.signed_in && status.voice)) return null;

  const run = async (name: string, fn: () => Promise<any>) => {
    setBusy(name);
    await fn().catch(() => {});
    setBusy(null);
    refreshSetup();
  };
  return (
    <div style={{ boxSizing: "border-box", width: "100%", display: "flex", flexDirection: "column", gap: "6px", padding: "12px", borderRadius: v("r"), background: v("surface"), border: `1px solid ${v("line")}` }}>
      <div style={{ fontFamily: v("display"), fontSize: "17px", marginBottom: "2px" }}>
        {status.claude && status.voice && !status.signed_in ? "Sign in to Claude" : "Finish setting up"}
      </div>
      <Check ok={status.claude} label="Claude Code" detail={status.claude ? status.version : "Needed to talk to Claude"}>
        <DialogButton className="cd-btn" style={small} disabled={!!busy} onClick={() => run("claude", installClaude)}>
          {busy === "claude" ? "Installing…" : "Install"}
        </DialogButton>
      </Check>
      {status.claude && (
        <Check ok={status.signed_in} label="Signed in" detail={status.signed_in ? status.plan : "Use your Claude account (Pro or Max)"}>
          {!signing && (
            <DialogButton className="cd-btn" style={small} onClick={() => setSigning(true)}>
              Sign in
            </DialogButton>
          )}
        </Check>
      )}
      {signing && !status.signed_in && (
        <SignIn
          onDone={() => {
            setSigning(false);
            refreshSetup();
          }}
        />
      )}
      <Check ok={status.voice} label="Voice" detail={voiceStep ?? (status.voice ? "Talk and listen" : "Optional: about 250 MB")}>
        <DialogButton className="cd-btn" style={small} disabled={!!busy || !!voiceStep} onClick={() => run("voice", setupVoice)}>
          {voiceStep ? "Working…" : "Set up"}
        </DialogButton>
      </Check>
    </div>
  );
}

/** "Update to vX" row for Settings, when GitHub has a newer release. */
export function UpdateRow() {
  useSetup();
  if (!update?.update || !update.url) return null;
  const install = () =>
    // Decky shows its own "Update Claude?" confirmation, downloads the release and reloads us.
    (window as any).DeckyBackend.call("utilities/install_plugin", update!.url, "Claude", update!.latest, null, 2).catch((e: any) =>
      toaster.toast({ title: "Update failed", body: String(e) }),
    );
  return (
    <DialogButton className="cd-btn" style={{ ...primaryBtn, width: "100%", boxSizing: "border-box", justifyContent: "center" }} onClick={install}>
      <Icon name="download" size={16} />
      Update to v{update.latest}
    </DialogButton>
  );
}

export function pluginVersion() {
  return status?.plugin_version ?? null;
}
