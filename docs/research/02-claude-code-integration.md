# 02: Driving Claude Code from the claude-deck plugin

Research date: 2026-10-07. Verified against Claude Code CLI **2.1.286** installed on the Mac (`claude --help` plus live probes signed in to a Claude Max subscription), and against the Python Agent SDK **0.2.164** source, which bundles CLI 2.1.292. "VERIFIED" means I ran it and saw the result. "DOCS" means it comes from official docs (URL given). "UNDOCUMENTED" means I found it in the CLI or SDK wire protocol and it worked, but no public doc describes it.

Probe scripts and raw logs are in the session scratchpad and are not part of the repo: `probe.py`, `probe2.py`, `probe3.py`, `probe4.py`, `permmcp.py`, `spawn.py` and the `*_log.jsonl` files.

---

## TL;DR: recommended architecture

```
Decky frontend (React)                main.py (Decky backend)                     claude (one long-lived process)
──────────────────────               ───────────────────────                     ────────────────────────────────
send(text, ctx, shot) ──callable──▶  ClaudeSession.write_user(content[])  ──stdin NDJSON──▶  -p --input-format stream-json
stop()                ──callable──▶  control_request {interrupt}          ──────────────▶     --output-format stream-json
answer_permission(id, allow) ──────▶ control_response {behavior:...}      ──────────────▶     --permission-prompt-tool stdio
set_model / effort / mode ─────────▶ control_request set_model/... or "/effort low"           --permission-mode default
remote_control(on) ────────────────▶ control_request {remote_control}     ──────────────▶     --mcp-config steam  --strict-mcp-config
◀── claude_event / claude_delta ───  stdout reader task                   ◀─stdout NDJSON─    --include-partial-messages
◀── claude_permission (A/B card) ──  can_use_tool control_request         ◀──────────────     (--resume <id> on restart)
◀── claude_usage (5h / 7d bars) ───  rate_limit_event                     ◀──────────────
```

1. **Keep one persistent `claude` process per conversation** in bidirectional stream-json mode. Do not spawn one per message. main.py speaks the same NDJSON control protocol the official SDKs use, so it needs no new dependencies.
2. **Drop `--dangerously-skip-permissions`.** Use `--permission-prompt-tool stdio` plus `--permission-mode default`. A curated `--allowedTools` list lets read-only and safe Steam tools run without asking. Anything else arrives as a `can_use_tool` control request, which becomes an A/B approve card on the Deck. Add one `PreToolUse` hook callback (registered in `initialize`) for hard Deck policy: always ask for `steam_js`, `rm` and similar; deny some things outright.
3. **Send screenshots inline** as base64 `image` content blocks. Today's path is "Read this file", which costs a tool round-trip.
4. **Read `rate_limit_event` for usage bars.** It carries 5-hour and 7-day utilization plus reset times. Use `/usage` text for a details screen.
5. **Let the user hand the session to their phone.** The `remote_control` control request returns a `claude.ai/code/session_…` URL. Show it as a QR code.
6. **Don't adopt the Python Agent SDK inside the Decky process.** It is a convenience wrapper over exactly this protocol. It adds about 44 MB of compiled dependencies, or about 284 MB with its bundled CLI, and Decky's interpreter is not host python3. Reuse its source as a protocol reference.

---

## 0. What main.py does today

- Every `send()` spawns `claude -p --output-format stream-json --verbose --dangerously-skip-permissions --include-partial-messages --mcp-config <steam> --strict-mcp-config --append-system-prompt … [--resume id]`. It writes the plain-text prompt to stdin, closes stdin, then parses events until `result`.
- Messages sent while busy are queued in Python, joined with blank lines, and sent as the next spawn.
- `stop()` is SIGTERM, then SIGKILL. **Per the docs, SIGTERM leaves the turn unfinished and records no result** (https://code.claude.com/docs/en/headless#stop-a-run-with-sigterm). A graceful interrupt is better.
- Screenshots are passed as a file path in the text ("Read it to see the screen"). This costs an extra Read tool call per screenshot.
- Every tool is auto-approved. The system prompt asks Claude to confirm destructive actions in chat, but nothing enforces it.

---

## 1. Persistent process with `--input-format stream-json`

### 1.1 Launch (VERIFIED)

```bash
claude -p \
  --input-format stream-json --output-format stream-json --verbose \
  --include-partial-messages \
  --permission-prompt-tool stdio \
  --permission-mode default \
  --mcp-config "$MCP_CONFIG" --strict-mcp-config \
  --append-system-prompt "$SYSTEM_PROMPT" \
  --allowedTools "Read Glob Grep WebSearch mcp__steam__list_games ..." \
  [--resume <session_id>] [--model sonnet] [--effort medium]
```

- `--input-format stream-json` works only with `-p` (`claude --help`: "realtime streaming input").
- Optional extras: `--replay-user-messages` echoes each stdin user message back with `"isReplay": true` (VERIFIED). `--prompt-suggestions` emits a `prompt_suggestion` after some turns, a good fit for "quick reply" chips on a controller (DOCS: https://code.claude.com/docs/en/cli-reference).
- `--permission-prompt-tool stdio` is **not listed in `--help`**. It is the value the official SDKs pass when a `can_use_tool` callback is set (`claude_agent_sdk/types.py::_configure_can_use_tool` returns `permission_prompt_tool_name="stdio"`). The CLI reference notes that `--help` does not list every flag. Treat it as the SDK's wire protocol: stable in practice, but undocumented as a raw CLI flag.
- Do **not** use `--bare`. In bare mode "Claude Code never reads OAuth credentials or the system keychain", so a Pro/Max login stops working (https://code.claude.com/docs/en/headless#start-faster-with-bare-mode).

### 1.2 Handshake (VERIFIED, optional but recommended)

stdin:
```json
{"type":"control_request","request_id":"init1","request":{"subtype":"initialize","hooks":null}}
```
stdout (truncated), about 0.5 s after spawn:
```json
{"type":"control_response","response":{"subtype":"success","request_id":"init1","response":{
  "commands":[{"name":"compact","description":"…","argumentHint":""}, …],
  "agents":[…],
  "output_style":"default","available_output_styles":["default","Proactive","Concise","Explanatory","Learning"],
  "models":[{"value":"default","resolvedModel":"claude-opus-5-5","displayName":"Default (recommended)",
             "supportsEffort":true,"supportedEffortLevels":["low","medium","high","xhigh","max"],
             "supportsFastMode":true,"supportsAutoMode":true}, …],
  "account":{"email":"…","subscriptionType":"Claude Max","apiProvider":"firstParty"},
  "current_permission_mode":"default",
  "remote_control_available":true,
  "fast_mode_state":"off","fast_mode_disabled_reason":"sdk_opt_in_required",
  "session_state":"idle","capabilities":["ui_surface_v1"]}}}
```
This one response fills a model picker, an effort picker, a slash-command palette and an account badge. It also lets you feature-detect Remote Control and fast mode.

`initialize` is also where hook callbacks are registered (§2.5).

### 1.3 Sending a user message (VERIFIED)

Text:
```json
{"type":"user","message":{"role":"user","content":"What's my battery at?"},"parent_tool_use_id":null,"session_id":""}
```

Text plus screenshot as **base64 image blocks**. This is VERIFIED: a 16×16 red PNG was answered "Red". The CLI also saved the image under `~/.claude/projects/<cwd>/<session>/images/1.png`.
```json
{"type":"user","message":{"role":"user","content":[
  {"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBORw0KGgo…"}},
  {"type":"text","text":"<deck_context>\nGame: Elden Ring\nBattery: 41%\n</deck_context>\n\nWhy is my FPS bad here?"}
]},"parent_tool_use_id":null,"session_id":""}
```
DOCS: https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode (same message shape; "Image uploads … attach images directly to messages"). JPEG works with `media_type: "image/jpeg"`. Downscale Deck screenshots (1280×800 is fine; avoid 4K external-display captures) to keep tokens and upload time down.

Optional fields on the user message, from the TS `SDKUserMessage` type (https://code.claude.com/docs/en/agent-sdk/typescript):
- `"shouldQuery": false` appends to the transcript without starting a turn, merging into the next real message. Use it for silent context updates such as "game changed to X".
- `"priority": "now" | "next" | "later"` controls a message sent mid-turn. `next` is the default: read once the current tool calls finish. `later` waits for the turn to end. `now` interrupts or redirects.
- `"client_composed": true` sends text verbatim, so a leading `/` is not run as a command (CLI ≥ 2.1.248).

I did not probe these three fields on the wire. They are documented for the TS SDK, which writes the same NDJSON.

**Queueing (VERIFIED):** a second user message written while a turn was streaming was **processed as its own turn after the first `result`**: two `result` events, in order. Python-side queueing is no longer needed; just write to stdin. Each turn ends with exactly one `result`, so the UI's "running" flag can be "number of user messages sent minus number of results received".

### 1.4 Interrupt mid-turn (VERIFIED)

```json
{"type":"control_request","request_id":"int1","request":{"subtype":"interrupt"}}
```
Observed sequence, 5 ms after the request:
```json
{"type":"control_response","response":{"subtype":"success","request_id":"int1","response":{"still_queued":[]}}}
{"type":"assistant","message":{… partial text "1\n2\n…181" …}}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]}, …}
{"type":"result","subtype":"error_during_execution", …}
```
The process stays alive. The next message ("what was the last number you wrote?") answered "181": the partial output was kept in context. Compare with SIGTERM: exit 143, turn unrecorded. In the SDK, `ResultMessage.terminal_reason` is `"aborted_streaming"` or `"aborted_tools"` when interrupted.

The init capabilities include `interrupt_receipt_v1` and `interrupt_cancel_queued_v1`. `still_queued` lists queued user messages the interrupt did not cancel.

### 1.5 Other control requests that worked (VERIFIED)

| request | response / effect |
|---|---|
| `{"subtype":"set_model","model":"sonnet"}` | success. Emits a replayed `<local-command-stdout>Set model to sonnet (claude-sonnet-5-5)</local-command-stdout>` |
| `{"subtype":"set_permission_mode","mode":"plan"}` | success. The next turn ran in plan mode (ExitPlanMode went through `can_use_tool`) |
| `{"subtype":"get_context_usage"}` | `{"categories":[{"name":"System prompt","tokens":6601},…]}`: a context-window meter |
| `{"subtype":"mcp_status"}` | `{"mcpServers":[…]}`: shows whether the `steam` server is connected |
| `{"subtype":"get_status"}` (UNDOCUMENTED) | `/status` sections: version, session id, login method "Claude Max account", model |
| `{"subtype":"remote_control","enabled":true}` (UNDOCUMENTED) | see §5 |

Python SDK equivalents (`_internal/query.py`): `interrupt`, `set_permission_mode`, `set_model`, `get_context_usage`, `mcp_status`, `mcp_reconnect` (`serverName`), `mcp_toggle`, `stop_task` (`task_id`), `rewind_files`. The TS SDK also has `applyFlagSettings` (e.g. `effortLevel`), `setMaxThinkingTokens`, `reloadSkills`, `accountInfo` and `supportedCommands`.

### 1.6 Latency (VERIFIED on an M-series Mac; the Deck will be slower)

| scenario | `system/init` after spawn | first stream event | total "reply ok" (haiku) |
|---|---|---|---|
| spawn per message, isolated (`--setting-sources ""`, empty MCP), `--resume` | 0.51–0.59 s | 0.98–1.13 s | 1.7–2.0 s |
| spawn per message, full user config (plugins, MCP, hooks) | **2.55–2.58 s** | 3.2–4.8 s | 3.9–5.6 s |
| persistent process, turns 2+ | 0 (already up) | about 1.1–1.3 s (the model's own time to first token) | — |

So persistence removes the whole startup slice from every turn: 0.5 s at minimum and about 2.5 s with a realistic config. Add the Deck's slower Zen 2 CPU and the cold start of `steam_mcp.py` (python3 + aiohttp), which the CLI waits for before the first turn (`--mcp-config` with `-p` "waits for still-pending servers … up to MCP_TIMEOUT"). **Expect a 1–4 s saving per message on the Deck.** That is an estimate; measure it there. Idle RSS of a persistent process was about 210 MB, acceptable on a 16 GB Deck.

Persistence brings other gains too: a graceful interrupt, a live permission channel, no re-parse of the transcript on `--resume`, and control requests for model, mode and effort without restarting.

### 1.7 Lifecycle recommendations

- Spawn lazily on the first `send()`, or on plugin load if instant first replies matter. Keep the process across turns. On `new_chat`, either send `/clear` (the SDK documents a `ConversationResetMessage`; the session id changes) or kill the process and spawn without `--resume`.
- On crash or exit, respawn with `--resume <last session_id>`.
- On `_unload`, close stdin first. The CLI then cancels pending permission prompts and exits cleanly. Fall back to SIGTERM, then SIGKILL.
- Keep the 32 MB+ readline limit. `user` events carry full tool results, including base64 images.

---

## 2. Replacing `--dangerously-skip-permissions`

### 2.1 Order of evaluation (DOCS)

https://code.claude.com/docs/en/permissions and https://code.claude.com/docs/en/agent-sdk/user-input

1. **PreToolUse hooks** run first, for every tool. They can deny, force an ask, or allow, but a hook's allow does **not** override deny or ask rules.
2. **Rules**: deny, then ask, then allow. First match wins and specificity doesn't matter.
3. **Permission mode** (`default`/`manual`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`).
4. **Built-in auto-approvals**: file reads inside the working directory, and the read-only Bash set (`ls cat echo pwd head tail grep find wc which diff stat du cd`, read-only `git`). VERIFIED: `echo deck-ok` ran with no prompt.
5. Anything left goes to the **permission host**: the `can_use_tool` control request (stdio) or the `--permission-prompt-tool` MCP tool.

"The callback never fires for auto-approved tools." So the allowlist decides what is silent, and everything else reaches the Deck card.

### 2.2 Option A (recommended): stdio `can_use_tool` (VERIFIED)

The CLI writes this to stdout (real capture, with `--setting-sources ""`):
```json
{"type":"control_request","request_id":"e18c1c78-…","request":{
  "subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash",
  "input":{"command":"touch a.txt","description":"Create file a.txt"},
  "description":"Create file a.txt",
  "permission_suggestions":[
    {"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"touch a.txt"}],"behavior":"allow","destination":"localSettings"},
    {"type":"addDirectories","directories":["/…/work3"],"destination":"session"},
    {"type":"setMode","mode":"acceptEdits","destination":"session"}],
  "blocked_path":"/…/work3/a.txt",
  "tool_use_id":"toolu_01F3SJ3SgeF2BzYgAtvSL79r"}}
```
Further optional fields per the SDK types: `decision_reason`, `title`, `agent_id` (set when a subagent asks), `requires_user_interaction` (seen on AskUserQuestion and ExitPlanMode).

Reply **allow** (A button):
```json
{"type":"control_response","response":{"subtype":"success","request_id":"e18c1c78-…",
  "response":{"behavior":"allow","updatedInput":{"command":"touch a.txt","description":"Create file a.txt"}}}}
```
Reply **allow, always for this session or this rule** (e.g. hold A): add `"updatedPermissions":[<one of permission_suggestions>]`. A suggestion with `destination:"session"` lasts for the session. `localSettings` writes `.claude/settings.local.json` in the cwd. The plugin's cwd is `$HOME`, so prefer `session`, or keep your own allowlist.

Reply **deny** (B button). VERIFIED: Claude reported the command as "blocked":
```json
{"type":"control_response","response":{"subtype":"success","request_id":"…",
  "response":{"behavior":"deny","message":"User tapped B (deny) on the Deck.","interrupt":false}}}
```
`"interrupt": true` also ends the turn. If the host may disappear, the CLI can send `control_cancel_request`. The SDK handles that by dropping the pending answer, so the card should vanish.

The callback can stay pending indefinitely ("Execution remains paused until your callback returns"). This suits a Deck where the user may be mid-game. Consider a badge or notification on the QAM icon.

**AskUserQuestion arrives on the same channel (VERIFIED).** It shows up as `can_use_tool` with `tool_name:"AskUserQuestion"` and `input.questions[]`: question, header, 2–4 options with label and description, multiSelect. Answer with:
```json
{"behavior":"allow","updatedInput":{"questions":[…as received…],"answers":{"Do you prefer cats or dogs?":"Cats"}}}
```
Claude replied "You prefer cats!". This maps directly to a controller-friendly picker (D-pad plus A). DOCS: https://code.claude.com/docs/en/agent-sdk/user-input#handle-clarifying-questions.

**ExitPlanMode arrives on the same channel (VERIFIED)**, with `input.plan` (markdown) and `planFilePath`. Show the plan with Approve (A) / Keep planning (B). Allowing it let the edit run, after its own `can_use_tool` for Write, which suggested `setMode: acceptEdits`.

### 2.3 Option B: `--permission-prompt-tool mcp__<server>__<tool>` (VERIFIED)

The tool is called through normal MCP `tools/call`. Exact arguments captured from a test server:
```json
{"name":"approve","arguments":{
   "tool_name":"Bash",
   "input":{"command":"touch made-ok.txt","description":"Create made-ok.txt file"},
   "tool_use_id":"toolu_01G45q3CJXMRMEkvqDbBbG43"},
 "_meta":{"claudecode/toolUseId":"toolu_01G45q3CJXMRMEkvqDbBbG43","progressToken":2}}
```
It must return a text content block whose text is JSON:
```json
{"content":[{"type":"text","text":"{\"behavior\":\"allow\",\"updatedInput\":{…original input…}}"}]}
{"content":[{"type":"text","text":"{\"behavior\":\"deny\",\"message\":\"Denied on Deck (B)\"}"}]}
```
VERIFIED: the allow ran (`made-ok.txt` created). The deny appeared in `result.permission_denials`. Unlike stdio, **no `permission_suggestions` arrive**. It can't approve MCP tools marked `requiresUserInteraction` (DOCS: cli-reference `--permission-prompt-tool`).

This would fit `steam_mcp.py`'s existing `sign_in` pattern (CDP into `window.__claudeDeck`, long-poll). Option A is simpler, though: main.py already owns the CLI's stdout and can `decky.emit("claude_permission", …)` and wait on a frontend callable. Option B only wins if you want the approval to live inside the MCP server process.

### 2.4 Rules and modes for a Game Mode client

Pass these explicitly. The user's own `~/.claude/settings.json` may set `defaultMode: auto` (it does on this Mac) or broad allows. Choose whether the Deck session should inherit them.

- `--setting-sources ""` isolates the plugin from `~/.claude/settings.json` hooks, plugins and allowlists. VERIFIED: with it, `touch` correctly prompted. Without it, the user's Mac config would leak in. Alternatively use `--setting-sources user` plus `--settings '<json>'` for plugin-specific overrides.
- Suggested allowlist, as `--allowedTools` or `--settings '{"permissions":{...}}'`:
  ```json
  {"permissions":{
    "allow":["Read","Glob","Grep","WebSearch","WebFetch",
             "mcp__steam__list_games","mcp__steam__game_info","mcp__steam__screenshot",
             "mcp__steam__get_performance","mcp__steam__sign_in"],
    "ask":["mcp__steam__steam_js","mcp__steam__stop_game","mcp__steam__set_launch_options",
           "mcp__steam__set_proton","Bash(systemctl *)","Bash(flatpak uninstall *)"],
    "deny":["Bash(sudo *)","Bash(rm -rf *)","Read(~/.ssh/**)","Edit(~/.steam/**/config.vdf)"]}}
  ```
  The tool names above are illustrative; use the real names from `steam_mcp.py`'s `TOOLS`. Note that `mcp__` rules **with parentheses are skipped when loaded from settings files** (DOCS, permissions page). Bare `mcp__steam__tool` names are fine.
- Mode choice:
  - `default` (Manual) is the safe baseline. Edits and non-read-only Bash raise cards.
  - `acceptEdits` gives fewer cards. File edits plus `mkdir`/`touch`/`mv`/`cp` in the working dirs run silently.
  - `plan` gives a "think first" toggle. Switch live with `set_permission_mode`.
  - `auto` (Max plans; `supportsAutoMode: true` in the models list) uses a classifier to approve routine actions. Only what it escalates reaches the card. This is a good "low-interruption" preset, but it spends usage on classifier calls and is less predictable. Offer it as an opt-in.
  - `dontAsk` plus `--permission-prompts none` is for unattended or background jobs.
  - Bind a controller button to cycle modes, like Shift+Tab in the TUI, via `set_permission_mode`.

### 2.5 Hooks for hard Deck policy (VERIFIED via SDK hook callbacks)

Register in `initialize`:
```json
{"type":"control_request","request_id":"init1","request":{"subtype":"initialize",
  "hooks":{"PreToolUse":[{"matcher":"Bash","hookCallbackIds":["hook_0"]},
                         {"matcher":"mcp__steam__steam_js","hookCallbackIds":["hook_1"]}]}}}
```
The CLI calls back:
```json
{"type":"control_request","request_id":"c9f0…","request":{"subtype":"hook_callback","callback_id":"hook_0",
  "input":{"session_id":"…","transcript_path":"…","cwd":"…","permission_mode":"default",
           "hook_event_name":"PreToolUse","tool_name":"Bash",
           "tool_input":{"command":"rm a.txt","description":"Delete file a.txt"},"tool_use_id":"toolu_…"},
  "tool_use_id":"toolu_…"}}
```
Reply. `{}` means no opinion and falls through to rules or the card:
```json
{"type":"control_response","response":{"subtype":"success","request_id":"c9f0…","response":
  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
                         "permissionDecisionReason":"Deck policy: no rm"}}}}
```
VERIFIED: `rm` was blocked and Claude relayed "a Deck policy prevents rm commands". Other values are `"ask"` (force a card even if allowlisted) and `"allow"`. The hook runs before `can_use_tool`. Use it for logic that regexes can't express, such as "ask for steam_js only if the code calls SetSetting or Uninstall".

Shell hooks in a settings JSON (`"hooks":{"PreToolUse":[…{"type":"command","command":"…"}]}`) are the alternative. Callback hooks keep everything in main.py.

---

## 3. Python Agent SDK vs raw CLI

**What the SDK is.** `claude-agent-sdk` 0.2.164 (PyPI, `requires_python >=3.10`) spawns the same CLI with `--output-format stream-json --verbose --input-format stream-json` and speaks the control protocol above (`_internal/transport/subprocess_cli.py`, `_internal/query.py`). It adds:

- the `ClaudeSDKClient` async client with `query()`, `receive_response()`, `interrupt()`, `set_model()`, `set_permission_mode()`, `get_context_usage()`, `get_mcp_status()`, `stop_task()` and `rewind_files()`;
- a `can_use_tool` callback (sets `--permission-prompt-tool stdio` for you) and Python hook callbacks;
- in-process MCP servers (`create_sdk_mcp_server` plus the `@tool` decorator) bridged over `mcp_message` control requests. This would let the steam tools live inside main.py with no `steam_mcp.py` subprocess. However, steam_mcp.py talks to CEF over aiohttp, and Decky's own Python may lack aiohttp or the `mcp` package;
- typed messages (`RateLimitEvent`, `ResultMessage.terminal_reason`, `TaskStartedMessage`, `ConversationResetMessage`);
- session helpers `list_sessions()`, `get_session_messages()`, `get_session_info()`, `rename_session()`, `tag_session()`, `delete_session()` and fork (`fork_session=True`). DOCS: https://code.claude.com/docs/en/agent-sdk/sessions.

**Footprint (VERIFIED by vendoring for manylinux x86_64, cp313):** **284 MB**, of which **240 MB is the bundled `claude` binary** (CLI 2.1.292). The other ~44 MB is dependencies: `mcp`, `pydantic` + `pydantic_core` (compiled), `cryptography` (compiled), `rpds` (compiled), `jsonschema`, `httpx`, `starlette`, `uvicorn`, `anyio` and more. Pass `cli_path=~/.local/bin/claude` and the bundled binary can be deleted. You still carry the ABI-specific compiled wheels.

**Subscription auth.** The SDK just runs the CLI, which reads the user's `claude` OAuth login. VERIFIED: the raw CLI in SDK mode reported `"apiKeySource":"none"` and `"subscriptionType":"Claude Max"`. The policy caveat is DOCS (https://code.claude.com/docs/en/agent-sdk/overview): *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."* For a personal plugin driving the user's own installed and logged-in Claude Code, this is the user running Claude Code. If the plugin is **published to the Decky store**, it should not ship its own login and should present itself as a front end for the user's installed Claude Code. **Flag: get a policy read before public distribution.** Don't brand it "Claude Code" either (SDK branding guidelines).

**Does it run on the Deck's host python3 (3.13)?** Very likely yes: pure-Python SDK, cp313 manylinux wheels exist for every compiled dependency, and the bundled CLI is glibc-2.17 manylinux. Not tested on SteamOS. **But main.py does not run on host python3.** It runs inside Decky Loader's embedded interpreter; the `_env()` comment about Decky leaking `LD_LIBRARY_PATH`/`PYTHONHOME` confirms it is not system Python. Decky's Python version is unverified; I believe it is a PyInstaller-frozen 3.11-era build. Importing pydantic_core or cryptography built for 3.13 into it would fail. Using the SDK therefore means a **host-python3 sidecar** (like steam_mcp.py) plus an IPC hop to main.py. That adds complexity without removing the protocol work.

**Verdict.** Implement the protocol directly in main.py: about 200 lines of asyncio. The pieces needed (user messages, `initialize`, `can_use_tool`, `hook_callback`, `interrupt`, `set_model`, `set_permission_mode`, `remote_control`) are all shown verbatim above. Use the SDK source as the reference implementation and pin or feature-detect via `system/init.capabilities`. Revisit the SDK only if you move the backend into a host-python sidecar anyway.

---

## 4. Models, effort, usage, sessions, slash commands, plan mode

### 4.1 Model and fast mode

- `--model <alias|id>` at launch: aliases `opus`, `sonnet`, `haiku`, `fable`, `default`. Mid-session, use the `set_model` control request (VERIFIED) or send `/model sonnet` as a user message (VERIFIED: "Set model to Sonnet 5.5 for this session only"). The `initialize` response's `models[]` gives display names and supported effort levels for a picker.
- `--fallback-model sonnet,haiku` covers overload.
- **Fast mode** (DOCS https://code.claude.com/docs/en/fast-mode) is Opus only, up to 2.5× faster. **On Pro/Max it is billed only from usage credits, not plan limits**, and needs usage credits turned on. In `-p` mode, `/fast` works only if the process was launched with `--settings '{"fastMode": true}'`. This matches `fast_mode_disabled_reason: "sdk_opt_in_required"` seen in `initialize`. Recommendation: hide fast mode by default. If offered, label it "costs extra credits" and relaunch with that setting.

### 4.2 Effort and thinking

- `--effort low|medium|high|xhigh|max` at launch. Mid-session, send `/effort low` (VERIFIED: "Set effort level to low (this session only)"). The TS SDK exposes `applyFlagSettings({effortLevel})`.
- `low`/`medium` suit a chat client: snappier, cheaper on limits. Hidden flags used by the SDK transport: `--thinking adaptive|disabled`, `--max-thinking-tokens N`, `--thinking-display`. Unverified on the raw CLI. Stream events include `system/thinking_tokens` estimates (VERIFIED), which can drive a "thinking…" shimmer.

### 4.3 Usage and rate limits for the UI (VERIFIED)

After each API response the stream carried:
```json
{"type":"rate_limit_event","rate_limit_info":{
   "status":"allowed_warning","resetsAt":1791813600,"rateLimitType":"seven_day","utilization":0.59,
   "isUsingOverage":false,
   "unifiedWindows":{"five_hour":{"utilization":0.54,"resetsAt":1791401400},
                     "seven_day":{"utilization":0.59,"resetsAt":1791813600}}},
 "uuid":"…","session_id":"…"}
```
- `status` is `allowed`, `allowed_warning` or `rejected`. `rateLimitType` is `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet` or `overage`. Python SDK `RateLimitInfo` documents `utilization` as 0.0–1.0 and links https://docs.claude.com/en/docs/claude-code/rate-limits.
- **UI:** two thin bars in the QAM, "Session 54% · resets 12:30" and "Week 59% · resets Sun". Turn amber on `allowed_warning` and red on `rejected`. Persist the last event so the bars show before the first message.
- `/usage` (alias `/cost`) sent as a user message returns a text report with no model call (`duration_api_ms: 0`), VERIFIED:
  `Current session: 55% used · resets Oct 7 at 12:30pm … Current week (all models): 60% used … Current week (Fable): 29% used …`, plus a "what's contributing" breakdown. Good for a details page.
- `result` events carry `total_cost_usd`, `usage` (input, output, cache tokens), `modelUsage`, `duration_ms`, `num_turns` and `permission_denials`. For subscription users, `total_cost_usd` is a client-side API-equivalent estimate, not a bill. **Stop showing `$0.049` in the chat** (main.py's `done` entry does today). It misleads Pro/Max users. Show duration plus a utilization delta instead.
- `system/api_retry` events (`attempt`, `retry_delay_ms`, `error` such as `rate_limit` or `overloaded`) can show "Retrying in 4 s…" (DOCS: headless page).
- `get_context_usage` gives a context-fill meter. `system/compact_boundary` fires on compaction (VERIFIED: `pre_tokens: 22466 → post_tokens: 1344`).

### 4.4 Session history browser, resume and fork

- Transcripts live at `~/.claude/projects/<cwd with non-alphanumerics → '->/<session_id>.jsonl` (DOCS: sessions page). The plugin uses `cwd=HOME=/home/deck`, so it reads `~/.claude/projects/-home-deck/*.jsonl`. List them by mtime. The title is the first user line or a `summary`/title record. Read the messages to render history.
- Port the logic of the SDK's pure-Python `_internal/sessions.py` (`list_sessions`, `get_session_messages`) rather than importing it.
- To resume: respawn the persistent process with `--resume <id>`. To fork ("branch from here"): `--resume <id> --fork-session`. `--session-id <uuid>` pre-assigns ids. `-n/--name` sets a display name (shown in `/resume` and on claude.ai if remote-controlled).
- Python SDK `rename_session()`, `tag_session()` and `delete_session()` mutate the jsonl. Delete is just removing the file. Use a separate plugin-side index (`state.json`) for titles if you don't want to touch transcripts.
- `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` makes resume continue a cut-off turn (DOCS: headless page).

### 4.5 Slash commands and skills over stream-json (VERIFIED)

- Send them as plain user text: `/compact`, `/usage`, `/context`, `/effort low`, `/model sonnet`, `/clear`, `/output-style Concise`, `/config key=value`, plus user and plugin skills (`/skill-name args`). DOCS: headless page note "Command support differs in -p mode".
- Local commands return `result` immediately, with output in `result` or a replayed `<local-command-stdout>…` user message.
- `/compact` took about 11 s and emitted `system/compact_boundary`, a synthetic summary user message, and `result` with an empty string. Show "Conversation compacted".
- `initialize.commands[]` and `system/init.slash_commands` give the palette (114 entries on this Mac). Filter to a curated short list for a controller: compact, usage, context, clear, model, effort, plus skills. `system/commands_changed` fires when the set changes.
- Terminal-only commands such as `/login` and `/resume` are unavailable (listed in `terminal_slash_commands`).

### 4.6 Plan mode

Toggle with `set_permission_mode` → `plan` (VERIFIED), or start with `--permission-mode plan`. Claude explores read-only, may ask AskUserQuestion, then calls ExitPlanMode. The `can_use_tool` request carries `input.plan` (markdown) and `planFilePath`. Approving lets the session proceed. The mode after approval was not explicitly checked; follow-up edits still prompted in the probe. Set `acceptEdits` on approve if you want "approve plan and go".

---

## 5. Remote Control: continue a Deck session on the phone

DOCS: https://code.claude.com/docs/en/remote-control. Available on Pro, Max, Team and Enterprise with claude.ai login. API keys are not supported. The local process keeps running and the phone or browser at claude.ai/code mirrors and steers it. Messages, permission prompts and `AskUserQuestion` are forwarded. Photos sent from the phone reach Claude directly.

The documented entry points are interactive only: `claude --remote-control`, `/remote-control` in the TUI, or `claude remote-control` server mode, which needs a TTY for the workspace-trust prompt. Also `remoteControlAtStartup` in user settings (interactive sessions only).

**UNDOCUMENTED but VERIFIED in SDK/stream-json mode:**
```json
→ {"type":"control_request","request_id":"rc","request":{"subtype":"remote_control","enabled":true}}
← {"type":"system","subtype":"bridge_state","state":"ready", …}
← {"type":"control_response","response":{"subtype":"success","request_id":"rc","response":{
     "session_url":"https://claude.ai/code/session_017tJkskxXCNbjXoXhPaD3mg",
     "connect_url":"https://claude.ai/code?environment=","environment_id":"",
     "bridge_epoch":1,"bridge_session_id":"cse_017tJkskxXCNbjXoXhPaD3mg"}}}
← {"type":"system","subtype":"bridge_state","state":"connected","bridge_epoch":1, …}
→ {"type":"control_request","request_id":"rc2","request":{"subtype":"remote_control","enabled":false}}
← {"type":"control_response","response":{"subtype":"success","request_id":"rc2"}}
```
`initialize` also reports `remote_control_available: true`. **Deck UX:** a "Continue on phone" button sends `remote_control` and renders `session_url` as a QR code (the sign-in card already has a QR renderer). The phone opens the same live session.

Caveats, all unverified:
- How phone-originated user messages and permission answers appear on the host's stdout. Expect replayed `user` events, and possibly a `can_use_tool` that the phone answers first. Handle a `control_cancel_request` for a card the phone already resolved.
- That it survives the Deck sleeping. The docs say interactive sessions reconnect after sleep.
- Stability, since this is an internal protocol. Gate on `remote_control_available` and keep a fallback.

Related options:
- `claude --cloud "<task>"` / `--cloud <session_id> -p "<msg>"` queues work into a **cloud** session (claude.ai/code on Anthropic infrastructure). This could offload heavy tasks from the Deck, but cloud sessions can't touch the Deck's Steam.
- The `PushNotification` tool appears in the tool list (`system/init.tools`), and settings include `agentPushNotifEnabled`. It can ping the user's phone when a long task finishes. Not investigated further.

---

## 6. Other recent features worth using in a Game Mode client

| feature | how | why on a Deck |
|---|---|---|
| **AskUserQuestion** | arrives via `can_use_tool` (§2.2) | multiple-choice with D-pad and A beats typing on the OSK. Encourage it in the system prompt ("prefer AskUserQuestion with 2–4 options over open questions") |
| **Prompt suggestions** | `--prompt-suggestions` → `{"type":"prompt_suggestion","suggestion":"…"}` | one-tap follow-up chip. Not observed in short probes; docs say short conversations may produce none |
| **Output styles** | `/output-style Concise` or a custom style in `~/.claude/output-styles/` | move the "short replies, no tables" rules from `--append-system-prompt` into a reusable "Deck" style. Note the system-prompt snapshot (below) |
| **System prompt snapshot** | default `on`: the system prompt is recorded on the first request and reused on resume until compaction | **edits to SYSTEM_PROMPT in main.py won't reach existing conversations** until `/compact` or a new chat. Use `--system-prompt-snapshot off` while iterating |
| **`shouldQuery:false` messages** | user message flag (§1.3) | push deck_context changes (game launched, battery low) without spending a turn |
| **Background tasks / subagents** | `system/task_started`, `task_progress`, `task_notification`, `background_tasks_changed`; `stop_task` control request | "Claude is still working on X" chips. With a persistent process, background completions can start a follow-up turn whose `result.origin` is `{"kind":"task-notification"}`, i.e. a reply the user didn't trigger. Show it as a notification |
| **Memory** | `system/init.memory_paths.auto`: CLAUDE.md under `~/.claude/projects/<cwd>/memory/` | persistent "remembers your games and preferences" with no plugin code. Only loads if setting sources include user, or with CLAUDE.md in cwd (`/home/deck/CLAUDE.md`) |
| **Monitor / ScheduleWakeup / Cron tools** | built-in tools | "tell me when the download finishes" style tasks only work while the process persists |
| **`--max-budget-usd`, `--max-turns`** | flags | guard runaway agent loops. With stream-json, `--max-turns` applies per turn |
| **`--forward-subagent-text`** | flag | only if you want to render subagent transcripts. Probably noise on a small screen |
| **`--name`** | flag | names the session in claude.ai's list when remote-controlled |
| **`system/notification`** | event | e.g. "Fast mode disabled · usage credits exhausted". Surface it as a toast |

---

## 7. Implementation sketch for main.py (protocol only)

```python
class ClaudeSession:
    async def start(self, resume=None):
        args = [CLAUDE, "-p", "--input-format", "stream-json", "--output-format", "stream-json",
                "--verbose", "--include-partial-messages", "--permission-prompt-tool", "stdio",
                "--permission-mode", self.mode, "--mcp-config", MCP_CONFIG, "--strict-mcp-config",
                "--setting-sources", "", "--settings", json.dumps(DECK_SETTINGS),
                "--append-system-prompt", SYSTEM_PROMPT, "--model", self.model]
        if resume: args += ["--resume", resume]
        self.proc = await asyncio.create_subprocess_exec(*args, cwd=HOME, env=_env(),
            stdin=PIPE, stdout=PIPE, stderr=PIPE, limit=64 << 20)
        self.reader = asyncio.create_task(self._read())
        await self.control({"subtype": "initialize",
                            "hooks": {"PreToolUse": [{"matcher": None, "hookCallbackIds": ["deck_policy"]}]}})

    def _write(self, obj): self.proc.stdin.write((json.dumps(obj) + "\n").encode())

    async def control(self, req):           # returns response dict
        rid = uuid4().hex; fut = self.loop.create_future(); self.pending[rid] = fut
        self._write({"type": "control_request", "request_id": rid, "request": req})
        return await asyncio.wait_for(fut, 60)

    def send_user(self, blocks): self._write({"type": "user", "parent_tool_use_id": None, "session_id": "",
                                             "message": {"role": "user", "content": blocks}})

    async def _read(self):
        async for line in self.proc.stdout:
            ev = json.loads(line); t = ev.get("type")
            if t == "control_response": self.pending.pop(ev["response"]["request_id"]).set_result(ev["response"])
            elif t == "control_request": asyncio.create_task(self._on_request(ev))
            elif t == "control_cancel_request": self._cancel_card(ev)
            elif t == "rate_limit_event": await decky.emit("claude_usage", ev["rate_limit_info"])
            else: await self._handle(ev)    # existing stream_event / assistant / user / result mapping

    async def _on_request(self, ev):
        r = ev["request"]
        if r["subtype"] == "can_use_tool":
            resp = await self.ask_frontend(r)          # emits "claude_permission", awaits answer_permission()
        elif r["subtype"] == "hook_callback":
            resp = deck_policy(r["input"])             # {} or {"hookSpecificOutput": {...}}
        else:
            resp = None
        self._write({"type": "control_response", "response":
                     {"subtype": "success", "request_id": ev["request_id"], "response": resp or {}}})
```

Frontend additions: a `claude_permission` listener showing a card for Bash, Steam JS and edits, with A = allow, B = deny and Y = allow for the session; an AskUserQuestion picker; an ExitPlanMode plan viewer; usage bars; a "Continue on phone" QR; a model/effort/mode quick menu; and a session browser.

---

## 8. Open questions and uncertainty

1. **Deck latency.** All timings are from an M-series Mac. Re-run `spawn.py` and a persistent probe on the Deck.
2. **Decky's embedded Python version and the SDK.** Unverified. The raw-protocol recommendation avoids the issue.
3. **`--permission-prompt-tool stdio`, `remote_control` and `get_status`** are SDK-internal and undocumented as CLI surface. They work on 2.1.286 and 2.1.292. Feature-detect via `system/init.capabilities` and `initialize` fields, and pin a known-good CLI version in docs.
4. **Remote Control while the host also answers permissions:** race behavior not tested.
5. **The `priority`, `shouldQuery` and `client_composed` user-message fields** are documented for the TS SDK and not probed on the raw CLI.
6. **Policy:** the Agent SDK note on third-party products and claude.ai login. Fine for personal use; get a read before publishing to the Decky store.
7. **The `rate_limit_event` schema** was observed live. The TS doc summary I fetched described a different `rate_limit` shape (`rate_limit_header`), which may be a summarization error. Trust the observed `rate_limit_info` and parse defensively.

## Sources

- Headless / `-p` / stream-json: https://code.claude.com/docs/en/headless
- CLI flags: https://code.claude.com/docs/en/cli-reference
- Permissions and rule syntax: https://code.claude.com/docs/en/permissions ; modes: https://code.claude.com/docs/en/permission-modes
- Approvals and AskUserQuestion: https://code.claude.com/docs/en/agent-sdk/user-input
- Streaming input with images: https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- Sessions, resume and fork: https://code.claude.com/docs/en/agent-sdk/sessions
- Agent SDK overview (auth policy, branding): https://code.claude.com/docs/en/agent-sdk/overview
- TS SDK reference (Query methods, SDKUserMessage): https://code.claude.com/docs/en/agent-sdk/typescript
- Fast mode: https://code.claude.com/docs/en/fast-mode
- Remote Control: https://code.claude.com/docs/en/remote-control
- Changelog: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- Python SDK source: PyPI `claude-agent-sdk` 0.2.164 (`_internal/query.py`, `_internal/transport/subprocess_cli.py`, `types.py`)
