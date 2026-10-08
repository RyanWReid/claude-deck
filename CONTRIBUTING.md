# Contributing

Thanks for helping. A few things that keep this plugin pleasant on a handheld:

- **Controller first.** Everything must be reachable with the d-pad and A/B. Check focus order.
- **No emoji in the UI.** Use the icon set in `src/icons.tsx`; colors come from `src/theme.ts` variables.
- **Safety rules live in `main.py`** (`SAFE_TOOLS`, `DENY_BASH`, `ASK_BASH`, `deck_policy`). Loosening
  them needs a clear reason in the PR.
- **Test on a real Deck** in Game Mode. `scripts/deploy.sh` builds and installs over SSH;
  `scripts/deckctl.py` takes screenshots so you can attach before/after images.
- Keep the backend stdlib-only: Decky runs `main.py` in its own Python.

Bug reports: include your SteamOS, Decky and `claude --version`, and the plugin log
(`journalctl -u plugin_loader | grep -i claude`).
