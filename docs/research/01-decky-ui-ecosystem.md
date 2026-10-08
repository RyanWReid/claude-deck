# 01 — Decky UI ecosystem, competitors, input/overlay/TTS, and store policy

Researched 2026-10-07 for claude-deck v0.3.0 (`src/index.tsx`, `src/signin.tsx`, `main.py`, `steam_mcp.py`, `deck_tools.py`).
Method: web search plus shallow clones of the reference repos. The API claims below come from reading their source, not from memory. Anything I could not verify is marked **UNVERIFIED**.

---

## 0. Read this first: three findings that change the plan

1. **The official Decky Plugin Store does not accept LLM plugins.** The wiki's *Submitting Plugins* page (section added 2024-08-01, still live) says: *"No. We do not accept any plugin that uses any LLM based code … Any LLM focused plugins will be rejected outright and there will be no appeals."* The PR template also requires the author to tick *"Generative AI was NOT used to write a majority of the code I am submitting."* Store listing is therefore off the table. Distribution has to go through GitHub Releases plus *Install from URL*, or through a **Custom Store Channel** (details in section 5).
   - https://github.com/SteamDeckHomebrew/wiki/blob/main/plugin-dev/submitting-plugins.md (section "AI, LLMs and so on")
   - https://github.com/SteamDeckHomebrew/decky-plugin-database/blob/main/.github/PULL_REQUEST_TEMPLATE/plugin_addition.md
2. **In-game push-to-talk works today through `/dev/hidraw`.** It does not work through `SteamClient.Input`. Decky Translator, which is in the official store, reads the Deck controller's raw HID reports (VID 28DE / PID 1205) from Python and detects button chords while a game has focus. `SteamClient.Input.RegisterForControllerInputMessages` is unreliable once a game has focus (sources conflict; see section 4).
3. **Replies can be drawn over a running game without opening the QAM.** Decky Translator does this with `routerHook.addGlobalComponent(...)` plus Steam's internal `useUIComposition(UIComposition.Notification)` hook, located with `findModuleChild`. This is the technique for a floating Claude bubble or caption strip over the game.

Smaller fact-checks on the brief:
- **The QAM is not 854 px wide.** The Deck screen is 1280×800 and the QAM is a narrow right-hand panel. Decky content gets roughly 300 CSS px at the default UI scale (**UNVERIFIED exact number**; measure it with `el.getBoundingClientRect()` over CEF). The full-screen route gets about 1280×(800 − header/footer).
- The project pins `@decky/ui ^4.7.0`. The current release is **4.12.1** (decky-frontend-lib HEAD, 2026-09-14). `@decky/api` is 1.1.3. There is no `LICENSE` file in the repo yet, which every distribution channel needs.

---

## 1. Existing AI / LLM plugins and tools on Steam Deck

| Project | What it is | Notable features | Weaknesses / gaps |
|---|---|---|---|
| **Deckling** (formerly *AI-Assistant*), SMwaterSHLDhelp, MIT. https://github.com/SMwaterSHLDhelp/Deckling and https://github.com/SMwaterSHLDhelp/AI-Assistant | Multi-provider QAM chat (OpenAI, Anthropic API, **Claude Code CLI**, Gemini, Grok, Ollama, llama.cpp, any OpenAI-compatible endpoint) | "Now playing" card with capsule art, achievements and rich presence; per-game chat threads; **openWakeWord** wake word ("hey jarvis"); faster-whisper STT with whisper.cpp fallback; **Piper TTS (default) + KittenTTS**; spoken-reply speed 0.8–1.5×; voice confirmations ("go ahead / cancel"); screen help via gamescope control socket, then PipeWire node, then `/tmp` PNG, resized to 1280 px JPEG; DuckDuckGo/SearXNG/Brave web search tools; error→next-step hints (`src/hints.ts`); pauses on suspend | 0 stars, release candidates only, not in the store. Its "Steam + X / Steam + Y" chords call `SteamClient.Input.RegisterForControllerAction` / `RegisterForControllerChord`, and **neither exists in the decky-frontend-lib typings**, so the chords are probably dead code (`src/hearing.ts`, `src/screenHelp.ts`). Its markdown renderer is a 52-line hand-rolled escape-then-regex with no code blocks. QAM only, no full-screen chat. "No headless renders" on a real Deck. |
| **bonsAI**, qd313, Apache-2.0. https://github.com/qd313/bonsAI | Ollama-only, self-hosted, "FOSS first" | Speed / Strategy / Expert modes; spoiler-safe strategy tips with a per-game checklist; preset chips; **TDP suggestions that can be applied**; searches Steam/QAM settings offline; a **Permissions tab** gating screenshots, power changes, voice, links and logging; mDNS LAN discovery of Ollama; UI-scale setting; uses `react-markdown` 10; splits answers into focusable chunks so the d-pad can read long replies (`src/utils/answerBubbleNavigation.ts`, `chatPanelScroll.ts`) | Beta, 3 stars, Ollama only, local inference costs game performance |
| **AI-ssistant Deck**, Lukather, GPL-2. https://github.com/Lukather/deck-ai-assistant | Gemini-only QAM assistant | Offline **Vosk** STT, game-aware context, last 20 turns | Needs a PulseAudio monitor source ("PulseAudio must be running…"). 0 stars. |
| **DeckClaw / Steam Deck Assistant** (itch.io). https://clotruad.itch.io/steam-deck-assistant | FastAPI + React web app on `localhost:8787` with a QAM entry | Claude by default (BYO key), launches games, brightness and volume, web search, persistent memory, local Whisper | Separate web service rather than native Decky UI; in development |
| **Decktation**, silverfoxy. https://github.com/nukeador/decktation | Not an AI chat but the closest UX peer: **hold L1+R1 in-game, whisper.cpp transcribes, text is typed into the focused game** | Runs as `root`. Uses a Custom Store channel (`https://homebrew.imsilverfoxy.com/plugins.json`). Store PR #1126 has been open for months. | Tester report: non-root backend "cannot open the user's PipeWire session" (`PortAudioError: Error querying device -1`); non-ASCII characters dropped when typing. https://github.com/SteamDeckHomebrew/decky-plugin-database/pull/1126 |
| **Decky Translator**, cat-in-a-box (in the store). https://github.com/cat-in-a-box/Decky-Translator | Screen OCR and translation drawn over the game | **hidraw chord detection** with hold-to-activate progress; **global overlay component** over the game | Reference implementation for sections 4a and 4b |

**What users liked or complained about.** Reddit and Steam forum coverage of these plugins is thin. None of them has visible traction, and searches returned no substantive r/SteamDeck threads. That is a signal: no AI plugin has broken out yet. Recurring pain points from issues and test reports:
- Mic and PipeWire access from the Decky backend (Decktation, AI-ssistant).
- Chords that only work while Steam UI has focus (Steamcord #60, https://github.com/Necrosiak/Steamcord/issues/60).
- Long answers unreadable with the d-pad in the narrow QAM (bonsAI built a chunking system for this).
- Local models hurting game FPS (bonsAI disclaimer).
- Store exclusion means **no auto-updates**. Decktation's README walks users through uninstalling and reinstalling to update.

**Gaps claude-deck can beat:**
- **Real agency.** Nobody else has an agent with Steam control (launch/stop, Proton, launch options, TDP/FPS) through an MCP server plus arbitrary `steam_js`. Competitors are chatbots with at most a TDP slider. Claude Code's tools (Bash, Read, web) plus Steam MCP is a different category.
- **A full-screen chat route.** Every competitor is QAM-only.
- **In-chat sign-in cards** with QR codes. Nobody else has them.
- **True in-game push-to-talk and an over-game reply overlay.** Nobody ships either well. Deckling's chord is likely non-functional and Decktation types text but doesn't converse.
- **Ships with Claude Code subscription auth.** The Anthropic API path in Deckling is "API key only (OAuth unavailable for third-party apps)". Using the official `claude` CLI avoids that problem.

---

## 2. `@decky/ui` (4.12.1) and `@decky/api` (1.1.3) capabilities

All names below were checked against decky-frontend-lib source at HEAD (`src/components/*`, `src/globals/steam-client/*`) and the published `@decky/api` `.d.ts`.

### 2.1 `@decky/api` exports
```ts
call, callable, addEventListener, removeEventListener,
routerHook,   // addRoute, addPatch, removePatch, removeRoute, addGlobalComponent, removeGlobalComponent
toaster,      // toast(ToastData) -> { data, dismiss }
openFilePicker, executeInTab, injectCssIntoTab, removeCssFromTab,
fetchNoCors, getExternalResourceURL, useQuickAccessVisible, definePlugin
```
- `ToastData`: `title, body, subtext, logo, icon, timestamp, onClick, className, contentClassName, duration, expiration, critical, eType, sound, playSound, showToast, showNewIndicator`. You can set `duration` for long replies, `logo` for a Claude avatar, and `critical` for sign-in requests.
- `Plugin`: `{ name, version?, icon, content?, titleView?, alwaysRender?, onDismount? }`. **`alwaysRender: true`** keeps the panel mounted when the QAM closes, so focus position and draft text survive.
- **`routerHook.addGlobalComponent(name, Component)`** renders a component permanently in the Steam UI tree. This is the basis for over-game overlays and an always-mounted listener UI.
- `useQuickAccessVisible()` lets the panel pause animations and polling while the QAM is hidden.
- `injectCssIntoTab("QuickAccess_uid2" | "SP", css)` handles global CSS. The `<style>` tag inside components (TabMaster pattern) is usually enough.

### 2.2 Components (`@decky/ui`)
- **Layout:** `PanelSection`, `PanelSectionRow`, `Field`, `ButtonItem`, `DialogButton` (= `DialogButtonSecondary`), `DialogButtonPrimary`, `DialogBody`, `DialogHeader`, `DialogSubHeader`, `DialogFooter`, `DialogControlsSection`, `DialogControlsSectionHeader`, `DialogLabel`, `DialogBodyText`, `Marquee` (scrolling long titles), `Spinner`, `SteamSpinner`, `ProgressBar`, `ProgressBarWithInfo`, `ProgressBarItem`, `FocusRing`, `ControlsList`.
- **Inputs:** `TextField`, `Toggle`, `ToggleField`, `SliderField`, `Dropdown`, `DialogCheckbox`.
- **Navigation:** `Tabs` (`{tabs:[{id,title,content,footer?,renderTabAddon?}], activeTab, onShowTab, autoFocusContents}`), `SidebarNavigation` (Steam-settings-style left rail, good for a full-screen Settings page), `Carousel` (`fnItemRenderer`, `nNumItems`, `nItemHeight`, `enableBumperPaging`, `scrollToAlignment:"center"`, as used by Deck-Shelves for home shelves).
- **Scroll:** `ScrollPanel`, `ScrollPanelGroup` (wrap the chat log so the d-pad and right stick scroll natively), `scrollPanelClasses`.
- **Modals:** `showModal(node, parent?, {strTitle, bHideMainWindowForPopouts, bNeverPopOut, popupWidth, popupHeight, fnOnClose})` → `{Close, Update}`. Also `ModalRoot` (`onCancel`, `bAllowFullSize`, `strClassName`…), `ConfirmModal` (`strTitle`, `strDescription`, `strOKButtonText`, `onOK`, `onCancel`, `bDestructiveWarning`), `SimpleModal`, `ModalPosition`. **Use `ConfirmModal` for destructive-action confirmations**, so Claude's "ask before deleting" becomes a real A/B dialog rather than a typed reply.
- **Menus:** `showContextMenu(<Menu label="…"><MenuItem onSelected={…}>…</MenuItem><MenuSeparator/></Menu>, e.currentTarget)` → `{Hide, Show}`. Plus `MenuGroup`. This is the native long-press / Options-button menu (Copy, Retry, Read aloud, Delete).
- **Custom components:** `ReorderableList`, `ColorPickerModal`, `SuspensefulImage`.
- **Routing:** `Navigation.Navigate(path)`, `NavigateBack()`, `CloseSideMenus()`, `OpenQuickAccessMenu(QuickAccessTab.Decky /*999*/)`, `OpenMainMenu()`, `NavigateToExternalWeb(url)`, `NavigateToAppProperties()`, `NavigateToChat()`. Also `Router.MainRunningApp` and `QuickAccessTab` enum values `{Notifications, RemotePlayTogetherControls, VoiceChat, Friends, Settings, Perf, Help, Music, Decky=999}`.
- **Patching / webpack:** `findModule`, `findModuleChild`, `findModuleExport`, `findModuleByExport`, `findSP()`, `findClass`, `findClassByName`, `afterPatch`, `beforePatch`, `replacePatch`, `wrapReactType`, `wrapReactClass`, `findInReactTree`, `findInTree`, `getReactInstance`, `getReactRoot`, `useWindowRef`, `getGamepadNavigationTrees`.
- **Class modules for native look:** `staticClasses`, `quickAccessMenuClasses`, `quickAccessControlsClasses`, `gamepadDialogClasses`, `gamepadSliderClasses`, `scrollPanelClasses`, `gamepadContextMenuClasses`, `focusRingClasses`, `footerClasses`, `appDetailsClasses`, `appDetailsHeaderClasses`, `playSectionClasses`, `libraryAssetImageClasses`, `steamSpinnerClasses`, `gamepadTabbedPageClasses`, `achievementClasses`.

### 2.3 Gamepad handling on `Focusable` / `DialogButton` / `Menu*` (from `FooterLegendProps`)
```ts
// Handlers
onActivate, onCancel,               // Focusable
onOKButton, onCancelButton, onSecondaryButton /*X*/, onOptionsButton /*Y? see note*/, onMenuButton,
onButtonDown, onButtonUp, onGamepadDirection, onGamepadFocus, onGamepadBlur
// Footer hints (the bottom-bar glyph legend)
onOKActionDescription, onCancelActionDescription, onSecondaryActionDescription,
onOptionsActionDescription, onMenuActionDescription,
actionDescriptionMap: { [GamepadButton.DIR_UP]: "Scroll up", … }
// Focus behaviour
"flow-children": "horizontal" | "vertical" | "row" | "column" | "grid"?,   // (string)
navEntryPreferPosition: NavEntryPositionPreferences.{FIRST,LAST,MAINTAIN_X,MAINTAIN_Y,PREFERRED_CHILD},
preferredFocus, noFocusRing, focusClassName, focusWithinClassName
```
`GamepadButton` enum: `OK, CANCEL, SECONDARY, OPTIONS, BUMPER_LEFT, BUMPER_RIGHT, TRIGGER_LEFT, TRIGGER_RIGHT, DIR_UP/DOWN/LEFT/RIGHT, SELECT, START, LSTICK_CLICK, RSTICK_CLICK, LSTICK_TOUCH, RSTICK_TOUCH, LPAD_TOUCH, LPAD_CLICK, RPAD_TOUCH, RPAD_CLICK, REAR_LEFT_UPPER, REAR_LEFT_LOWER, REAR_RIGHT_UPPER, REAR_RIGHT_LOWER, STEAM_GUIDE, STEAM_QUICK_MENU`.

> Note: OK = A, CANCEL = B, SECONDARY = X, OPTIONS = Y in Steam's mapping (**UNVERIFIED exact Y/X↔SECONDARY/OPTIONS mapping**; verify on-device by logging `evt.detail.button` in `onButtonDown`). `REAR_*` are L4/L5/R4/R5. **These only fire while Steam UI has focus**, i.e. inside the QAM or the chat route.

Suggested controller map for the chat route (a sketch):
```tsx
<Focusable
  onSecondaryButton={toggleMic}            // X: hold-to-talk inside the UI
  onOptionsButton={captureScreen}          // Y: attach screenshot
  onMenuButton={openChatMenu}              // ☰: New chat / Settings / Model
  onButtonDown={(e) => {                   // L4/R4 etc.
    if (e.detail.button === GamepadButton.TRIGGER_RIGHT) jumpToLatest();
  }}
  onSecondaryActionDescription="Talk"
  onOptionsActionDescription="Screenshot"
  onMenuActionDescription="Chat menu"
>
```

### 2.4 Steam client APIs (from `globals/steam-client`)
- `SteamClient.Input.RegisterForControllerInputMessages((ctrlIdx, button: ControllerInputGamepadButton, pressed) => …)` gives button events. **Delivery while a game has focus is disputed**; see section 4.
- `SteamClient.Input.RegisterForControllerStateChanges((changes: ControllerStateChange[]) => …)` gives `ulButtons` (bit 0 R2, 1 L2, 2 R1, 3 L1, 4 Y, 5 B, 6 X, 7 A, 8–11 d-pad, 12 Select, 13 Steam, 14 Start, 15 L5, 16 R5, 17/18 pad clicks, 22 L3, 26 R3) and `ulUpperButtons` (bit 9 L4, 10 R4, 18 QAM), plus sticks, triggers and gyro.
- `SteamClient.Input.RegisterForControllerAnalogInputMessages` **does nothing for plugins** even after `EnableControllerAnalogInputMessages(true)` (audio-output-switcher README).
- `SteamClient.System.UI.RegisterForSystemKeyEvents(({eKey, nControllerIndex}) => …)` covers the Steam (eKey 0) and QAM (eKey 1) buttons, **as a single instant event only, so they can't be held in a chord**.
- `SteamClient.System.UI.RegisterForFocusChangeEvents` gives which app/window has focus, so the plugin knows if a game is in front.
- `SteamClient.System.RegisterForOnSuspendRequest` / `RegisterForOnResumeFromSuspend`, `RegisterForBatteryStateChanges`, `GetSystemInfo`, `CopyFilesToClipboard`, `OpenInSystemBrowser`.
- **Steam's input stream dies after suspend.** audio-output-switcher re-subscribes when it detects a gap in a 10 s interval timer. Do the same with the hidraw reader.
- `SteamClient.Input.ControllerKeyboardSendText(text)` and `ControllerKeyboardSetKeyState(EHIDKeyboardKey, bool)` **type into the focused game**. This enables "dictate to game chat", and is how a Claude reply can be pasted.
- `SteamClient.Screenshots.GetLastScreenshotTaken()` / `GetLocalScreenshotPath(appId, handle)` reuse Steam's own screenshot (Steam + R1), which is better than the xprop route when the user just took one.
- `SteamClient.GameSessions.RegisterForAppLifetimeNotifications` reports game start/stop, for proactive "you just launched X" context (Deckling uses it).
- Settings, perf store and app details are already used in `steam_mcp.py`.
- **On-screen keyboard:** `TextField` opens the Steam OSK automatically on A in Game Mode. `RegisterForUserDismissKeyboardMessages` exists. There is no clean public "open OSK" call; **UNVERIFIED** whether `SteamClient.Input.SetGamepadKeyboardText` helps. Prefer voice-first.

---

## 3. How the best plugins get their polish

Observations from the TabMaster, CSS Loader, Junk-Store, ProtonDB Badges, HLTB, Deck-Shelves and Decky Loader sources. (I could not find a plugin called "MagicBlackDecky"; **UNVERIFIED** that it exists.)

**3.1 Use Steam's own classes and controls, not a custom palette.** TabMaster and CSS Loader compose `gamepadDialogClasses.*`, `scrollPanelClasses.ScrollPanel`, `gamepadSliderClasses` and the `gpfocus` / `gpfocuswithin` state classes. That way focus rings, fonts (Motiva Sans) and colours follow the user's theme, including CSS Loader themes. claude-deck currently hard-codes a Tokyo-Night palette (`C = {user:"#3d59a1", bot:"#24283b", …}`), which looks foreign next to Steam's grey and blue. Recommendations:
- Use Steam's surface colours (dark blue-greys) with Steam blue `#1a9fff` as the accent (**UNVERIFIED exact token**; sample it from a focused `DialogButton` in CEF). Reserve Claude's brand orange (#D97757) for the avatar and spark only.
- Drive focus styling from `.gpfocus` / `.gpfocuswithin`, e.g. `.cd-bubble.gpfocus { outline: 2px solid #fff; transform: scale(1.01) }`. Steam's look is "focused item lifts and brightens".
- Scope every rule under a plugin root class to avoid leaking into Steam.

**3.2 Scrolling with the d-pad (claude-deck's biggest UX bug).** Each message is one `<Focusable>`. When a reply is taller than the viewport, Steam scrolls to the element's top and the next d-pad press skips past it, so **the middle of long replies is unreachable in the QAM**. Fixes used by the good plugins:
- **TabMaster `ScrollableWindow`**: wrap content in `ScrollPanelGroup` with a single non-ring `Focusable` carrying `actionDescriptionMap={{[DIR_UP]:"Scroll Up",[DIR_DOWN]:"Scroll Down"}}`, a fade mask at the edges, and a thin scrollbar visible only on `.gpfocuswithin`. https://github.com/Tormak9970/TabMaster/blob/main/src/components/generic/ScrollableWindow.tsx
- **bonsAI**: split each answer into paragraph-sized focusable chunks, and when focus is inside a tall chunk, `onGamepadDirection` scrolls `TabContentsScroll` by about 35% of the viewport before moving focus on. https://github.com/qd313/bonsAI/blob/main/src/utils/chatPanelScroll.ts
- Recommended: render assistant markdown **per block** (paragraph, list, code block), with each block its own `Focusable`, inside a `ScrollPanelGroup`. Right-stick scrolling then comes free, and focus doesn't jump to the bottom while streaming unless the user is already at the bottom.

**3.3 Layout: QAM vs. route.**
- QAM (~300 px): one column, no side-by-side buttons wider than three icons, 13–14 px body text, avoid `ButtonItem layout="below"` stacks (they look like a settings page). Pattern: status header (game capsule + battery), a compact last exchange, then a single row of `[🎤 Talk] [📷] [⤢ Open]`.
- Route (1280 wide): Steam pages use `marginTop: 40px` for the header and leave room for the bottom footer legend (~40 px); the current page already does this. Cap message width at about 760 px and centre it. A **two-pane layout** (chat left, "context" rail right with the current game capsule, recent tool actions and screenshot thumbnails) would use the width well.
- Use `Router.MainRunningApp` plus `appStore.GetAppOverviewByAppID()` and the library asset classes for real capsule art (Deckling's "Now playing" card is its best visual).

**3.4 Animation.** Steam UI animates with short (~150–250 ms) ease-out transforms and opacity. Keep to transform/opacity only; the Deck's CEF handles them fine, but avoid animating `height` or box-shadow during streaming. Good candidates: a typing indicator with three pulsing dots, a mic level ring (backend sends RMS through `decky.emit` at ~15 Hz), a sliding toast-style overlay bubble, and a spark logo that "breathes" while Claude works.

**3.5 Markdown and code highlighting (bundle sizes measured with esbuild, minified, React external):**

| Library | min | gzip | Notes |
|---|---|---|---|
| snarkdown | 1.9 KB | 1.0 KB | Too minimal (no lists or code fences done properly) |
| **marked** | 45.7 KB | 13.6 KB | Best size/feature ratio. Returns an HTML string, so it needs sanitising. |
| dompurify | 30.1 KB | 11.6 KB | Pair with marked. Works in CEF. |
| markdown-it | 98.9 KB | 40.6 KB | TabMaster uses it for docs |
| react-markdown | 119 KB | 36.8 KB | Decky Loader itself, bonsAI and Junk-Store use it |
| react-markdown + remark-gfm | 157 KB | 47.8 KB | What Decky Loader ships (`frontend/src/components/Markdown.tsx`) |
| highlight.js core + bash/python/js/json/ini | 36.1 KB | 13.6 KB | Register only the languages you need |

Current `dist/index.js` is 80 KB. There is no hard size limit, but load time on every Steam boot matters.

Recommendation: either use **marked + DOMPurify (~25 KB gz)** or write a **custom tokenizer that emits React elements per block**, which keeps blocks Focusable. Avoid `dangerouslySetInnerHTML` inside a Focusable when you want per-block focus. Copy Decky's Markdown component pattern for links: wrap `<a>` in `Focusable onOKButton={() => Navigation.NavigateToExternalWeb(href)}`.

For code blocks, use highlight.js core with about five languages, horizontal scroll via `onGamepadDirection` LEFT/RIGHT, and a "Copy" action on X.

Streaming tip: re-parse only the trailing (open) block on each delta, and batch deltas in the backend (~40–60 ms) rather than emitting each token. At the moment `main.py` emits on every `text_delta`.

**3.6 Route patching for "Claude everywhere".** ProtonDB Badges and HLTB patch `/library/app/:appid` with `routerHook.addPatch` + `afterPatch` to inject UI into the game page. claude-deck could inject an **"Ask Claude" button on every game page** that opens chat pre-filled with that appid ("Why does this crash?", "Best settings for this game?"). Guide: https://github.com/SteamDeckHomebrew/wiki/blob/main/plugin-dev/route-patching.md. Example: https://github.com/OMGDuke/protondb-decky/blob/main/src/lib/patchLibraryApp.tsx

---

## 4. Global hotkeys, over-game overlay, and TTS

### 4a. Push-to-talk anywhere, even in-game

| Approach | Works with a game focused? | Notes |
|---|---|---|
| `Focusable.onButtonDown` etc. | No | UI only |
| `SteamClient.Input.RegisterForControllerInputMessages` | **Disputed** | audio-output-switcher claims "nothing is intercepted: a game with L4 and R4 bound receives them too", meaning it fires in-game (https://github.com/zomars/audio-output-switcher). Steamcord #60 says events arrive "only while Steam's own UI has input focus", apart from the 2026 Steam Controller. **Test on-device.** |
| `RegisterForControllerStateChanges` | Probably the same as above | Has full `ulButtons` bitmask |
| `RegisterForSystemKeyEvents` | Yes, but Steam/QAM buttons only, single instant events | Can't hold; also Steam/QAM are reserved |
| **`/dev/hidraw*` (VID 28DE, PID 1205) read in Python** | **Yes**: independent of the game's Steam Input layout, read-only alongside Steam | **Decky Translator does this and is in the store**, without the `root` flag. It parses `struct.unpack('<I', data[8:12])` (low buttons) and `data[12:16]` (high buttons), and auto-reconnects. Bits match the `ulButtons` table above (L4 = bit 41, R4 = bit 42, QAM = bit 50 in its 64-bit enum). https://github.com/cat-in-a-box/Decky-Translator/blob/main/main.py (`HidrawButtonMonitor`) |
| `/dev/input/event*` (evdev) | Keyboard/mouse yes, Deck gamepad unreliable while Steam owns hidraw | Needs `uaccess` ACL (Steamcord README) |

**Recommended design:**
- Port the hidraw monitor into `deck_tools.py`.
- Default chord: **hold L4+R4** (or a single back button such as R5), configurable via a "press your combo" recorder (audio-output-switcher's capture UX). Ignore the chord while the plugin's own UI has focus.
- Hold to record, release to transcribe and send. Show a progress ring through the global overlay.
- **Never bind Steam or QAM chords.** The store's denial list includes "Hijacking controller inputs (e.g. using an existing Steam button shortcut…)" (https://github.com/SteamDeckHomebrew/wiki/blob/main/user-guide/plugin-safety.md). Even off-store, that is the community norm.
- The buttons still reach the game, so warn when the chosen combo is bound in the current game, or suggest back buttons that most games leave unbound.

**Mic access:** `deck_tools.Recorder` uses `pw-record` as `deck` with `XDG_RUNTIME_DIR` set, which is right. Decktation's tester found that a root backend could not reach the user's PipeWire. Keep the backend non-root.

### 4b. Showing replies over a running game

1. **Global component plus a UI composition request (best).** This is Decky Translator's `Overlay.tsx`:
   ```ts
   enum UIComposition { Hidden = 0, Notification = 1, Overlay = 2, Opaque = 3, OverlayKeyboard = 4 }
   const useUIComposition: (c: UIComposition) => void = findModuleChild((m) => {
     if (typeof m !== "object") return;
     for (const p in m) {
       const s = typeof m[p] === "function" && m[p].toString();
       if (s && s.includes("AddMinimumCompositionStateRequest") &&
           s.includes("ChangeMinimumCompositionStateRequest") &&
           s.includes("RemoveMinimumCompositionStateRequest") &&
           !s.includes("m_mapCompositionStateRequests")) return m[p];
     }
   });
   const CompositionRequest = ({ level }: { level: UIComposition }) => { useUIComposition(level); return null; };
   // definePlugin():
   routerHook.addGlobalComponent("ClaudeOverlay", () => <ClaudeOverlay />);
   // inside ClaudeOverlay, only while visible:
   {visible && <CompositionRequest level={UIComposition.Notification} />}
   ```
   `Notification` makes Steam's layer visible over the game, and from Translator's usage it appears to leave the game with input (**UNVERIFIED exact semantics**; `Overlay` likely takes input). Translator's comment says unmounting the request "fully releas[es] the request so Steam's own UI sections can get input focus". Use this for a subtitle-style "Claude says…" strip or corner bubble that auto-hides after N seconds. Render it with `position: fixed` and pointer-events none.
   https://github.com/cat-in-a-box/Decky-Translator/blob/main/src/Overlay.tsx
2. **`toaster.toast({... duration, logo, onClick: openChat})`** is already used. It is cheap and native, but limited to about 140 characters and two lines.
3. **Gamescope external overlay window** (`xprop -f GAMESCOPE_EXTERNAL_OVERLAY 32c -set GAMESCOPE_EXTERNAL_OVERLAY 1 -id <win>`). There is only **one** slot and **mangoapp permanently occupies it**, even when hidden. Avoid it. https://github.com/electron/electron/pull/45387
4. **Open the QAM on the plugin**: `Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky)`. Decky remembers the last plugin. Fine as a fallback for "long reply, tap to read".

### 4c. TTS for spoken replies
- **espeak-ng ships with SteamOS 3.7.10+** ("Added Orca screen reader and espeak-ng text-to-speech tools"). That gives zero-install TTS, robotic but instant, so use it as the fallback. https://www.gamingonlinux.com/2025/06/steamos-3-7-10-beta-brings-a-steam-deck-oled-wifi-fix-new-accessibility-options-and-more-work-for-other-handhelds/
- **Piper** is the quality default (Deckling ships it with Lessac, Amy, Ryan, Alan, Jenny medium voices). It runs faster than real time on the Deck CPU (**UNVERIFIED perf numbers**). Note the project moved from `rhasspy/piper` (MIT, archived) to `OHF-Voice/piper1-gpl` (**GPL-3**, so check licence compatibility with MIT if bundling). Download it on first use rather than bundling it, and pipe output to `pw-play`.
- KittenTTS (nano int8) is the alternative Deckling offers. Kokoro-82M sounds better but is heavier.
- Expected UX:
  - Speak only the first sentence or two, or a summary. Have Claude emit a `<speak>` short form, or ask it to keep the first line speakable.
  - Duck or stop TTS when the user presses talk.
  - Never speak tool chatter.
  - Expose a "Read aloud" action on X (`onSecondaryButton`) per message.
- **Barge-in.** Kill the TTS process on chord press, the same as Deckling's "interrupts on message send, new chat or Stop".

---

## 5. Publishing

**Official store: not possible for this plugin.** Section 0 has the quotes and links (LLM ban plus the "Generative AI was NOT used to write a majority of the code" attestation). The general rules are still useful because the community grades off-store plugins by the same standard.

The review process (https://github.com/SteamDeckHomebrew/wiki/blob/main/plugin-dev/review-and-testing.md) checks:
- the submodule;
- `remote_binary` entries in package.json (checksummed downloads);
- `pnpm-lock.yaml` with `lockfileVersion: 9.0`;
- a code scan for remote code and URLs;
- that config files live in `defaults/`;
- that `backend/`, `assets/` and `defaults/` are deleted when unused;
- a third-party test on Stable/Beta (Python backend) or **Preview** (custom or non-static binaries).

Other rules:
- A `LICENSE` file is mandatory. When the plugin is built from the template, keep the template's BSD-3 notice.
- No private repos, no "black-box" binaries (binaries need a link to source and build docs), and minified JS is reviewed case by case.
- The denial list (https://github.com/SteamDeckHomebrew/wiki/blob/main/user-guide/plugin-safety.md) includes:
  - no checksum verification for downloaded executables;
  - **self-update systems**;
  - **hijacking Steam button shortcuts**;
  - code that can easily delete or corrupt data;
  - excessive generative AI use;
  - unwillingness to work with reviewers.
- Root (`"flags": ["root"]`) is allowed but forces extra scrutiny. claude-deck doesn't need it.

**Practical distribution path for claude-deck:**
1. Public GitHub repo with a `LICENSE` (MIT) and a CI-built release zip (folder `claude-deck/` with `dist/`, `main.py`, `plugin.json`, `package.json`, `py_modules`/helpers, `LICENSE`, `README`).
2. **Install from URL** using a stable `…/releases/latest/download/claude-deck.zip` link (Deckling's and Decktation's model). Users must enable Decky developer mode.
3. Optional **Custom Store Channel**: host a `plugins.json` in the store-API format. Users set *Decky Settings → General → Store Channel → Custom*. This gives one-tap installs and **update notifications**, but it *replaces* the default catalog, so users lose official-store updates while it is selected (Decktation documents the trade-off). An "aggregator" JSON that mirrors the official catalog plus claude-deck would avoid the trade-off. That is **UNVERIFIED** as acceptable to Decky maintainers and fragile; see Decktation's `doc/DECKY_STORE.md`.
4. Follow the store's hygiene even off-store, since that's what reviewers and Reddit judge:
   - no self-updater, or at most a "new version available, tap for the URL" check;
   - checksummed model and binary downloads (whisper-cli, ggml model, piper) with source links;
   - non-root;
   - a visible permissions/safety screen.
5. Fix `plugin.json`: set a real `author`, a `publish.image` URL and `"tags": ["ai","assistant","voice"]`.

**Safety posture is the main reputational risk.** `--dangerously-skip-permissions` plus `steam_js` plus a Bash-capable agent running as `deck` is exactly what plugin-safety reviewers warn about. Before sharing publicly:
- add a per-category permission screen (bonsAI's Permissions tab is the model);
- route destructive tool calls through a `ConfirmModal` (a PreToolUse hook in Claude Code that calls back into the UI, reusing the `sign_in` long-poll bridge);
- default to `--permission-mode` with an allowlist rather than skipping permissions.

---

## Sources (primary)
- Decky wiki source: https://github.com/SteamDeckHomebrew/wiki (`plugin-dev/submitting-plugins.md`, `plugin-dev/review-and-testing.md`, `plugin-dev/route-patching.md`, `user-guide/plugin-safety.md`)
- Plugin DB and PR templates: https://github.com/SteamDeckHomebrew/decky-plugin-database
- decky-frontend-lib (`@decky/ui` 4.12.1): https://github.com/SteamDeckHomebrew/decky-frontend-lib
- `@decky/api` 1.1.3 typings: https://www.npmjs.com/package/@decky/api
- Decky Loader Markdown component: https://github.com/SteamDeckHomebrew/decky-loader/blob/main/frontend/src/components/Markdown.tsx
- Deckling: https://github.com/SMwaterSHLDhelp/Deckling · AI-Assistant: https://github.com/SMwaterSHLDhelp/AI-Assistant
- bonsAI: https://github.com/qd313/bonsAI · AI-ssistant Deck: https://github.com/Lukather/deck-ai-assistant · DeckClaw: https://clotruad.itch.io/steam-deck-assistant
- Decky Translator (hidraw + overlay): https://github.com/cat-in-a-box/Decky-Translator
- Decktation: https://github.com/nukeador/decktation · store PR: https://github.com/SteamDeckHomebrew/decky-plugin-database/pull/1126
- audio-output-switcher (controller chord): https://github.com/zomars/audio-output-switcher
- Steamcord in-game input issue: https://github.com/Necrosiak/Steamcord/issues/60
- TabMaster ScrollableWindow: https://github.com/Tormak9970/TabMaster · CSS Loader: https://github.com/DeckThemes/SDH-CssLoader · ProtonDB Badges: https://github.com/OMGDuke/protondb-decky · HLTB: https://github.com/hulkrelax/hltb-for-deck · Junk-Store: https://github.com/ebenbruyns/junkstore · Deck-Shelves: https://steamdeckhq.com/news/add-game-shelves-to-steam-deck-deck-shelves/
- Gamescope external overlay: https://github.com/electron/electron/pull/45387
- SteamOS 3.7.10 espeak-ng/Orca: https://www.gamingonlinux.com/2025/06/steamos-3-7-10-beta-brings-a-steam-deck-oled-wifi-fix-new-accessibility-options-and-more-work-for-other-handhelds/
- bitsteam (raw Deck HID in Python): https://pypi.org/project/bitsteam/
