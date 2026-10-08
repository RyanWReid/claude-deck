#!/usr/bin/env python3
"""Drive the Deck's Game Mode UI for screenshots and recordings (used to make the README media).

Run on the Deck from the repo folder:
  python3 scripts/deckctl.py qam | chat | home | close | back
  python3 scripts/deckctl.py shot NAME            -> docs/media/raw/NAME.png (with overlays)
  python3 scripts/deckctl.py gameshot             -> game-only screenshot path for `send`
  python3 scripts/deckctl.py rec NAME SECONDS     -> docs/media/raw/NAME.mp4 + NAME.wav (screen + speakers)
  python3 scripts/deckctl.py ui ACTION [ARG]      -> plugin UI hooks: talk, talkChat, lookAndAsk, theme X...
  python3 scripts/deckctl.py theme ID | model ID | mode ID
  python3 scripts/deckctl.py call METHOD [JSON_ARGS...]
  python3 scripts/deckctl.py js 'return 1+1'
"""
import asyncio
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import deck_tools  # noqa: E402
from steam_mcp import cdp_eval  # noqa: E402

OUT = os.path.join(HERE, "docs/media/raw")
CLIPPER_GST = os.path.expanduser("~/homebrew/plugins/Decky-Clipper/bin/gstreamer-1.0")


def js(code, **args):
    return json.loads(asyncio.run(cdp_eval(code, args)) or "null")


def call(method, *args):
    return js("return await DeckyBackend.call('loader/call_plugin_method', 'Claude', ARGS.m, ...ARGS.a);", m=method, a=list(args))


NAV = {
    "qam": "DFL.Navigation.OpenQuickAccessMenu(999); await sleep(400); DeckyPluginLoader.deckyState.setActivePlugin('Claude'); return 1;",
    "chat": "DFL.Navigation.CloseSideMenus(); DFL.Navigation.Navigate('/claude-chat'); return 1;",
    "home": "DFL.Navigation.CloseSideMenus(); DFL.Navigation.Navigate('/library/home'); return 1;",
    "close": "DFL.Navigation.CloseSideMenus(); return 1;",
    "back": "DFL.Navigation.NavigateBack(); return 1;",
}


def shot(name):
    """Full composition (overlays like the Quick Access menu included), unlike the plugin's own
    screenshots, which capture only the game for Claude to look at."""
    import glob
    import time
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    subprocess.run(["xprop", "-root", "-f", "GAMESCOPECTRL_REQUEST_SCREENSHOT", "32c", "-set",
                    "GAMESCOPECTRL_REQUEST_SCREENSHOT", "2"], env=deck_tools.clean_env() | {"DISPLAY": ":0"}, check=True)
    for _ in range(60):
        time.sleep(0.15)
        new = [f for f in glob.glob("/tmp/gamescope*.png") if os.path.getmtime(f) >= t0 - 0.05]
        if new:
            size = -1
            while size != os.path.getsize(new[0]):
                size = os.path.getsize(new[0])
                time.sleep(0.25)
            dst = os.path.join(OUT, name + ".png")
            shutil.move(new[0], dst)
            print(dst)
            return
    raise SystemExit("no screenshot")


def game_shot():
    """A game-only screenshot in the plugin's cache, ready to attach to a message."""
    print(asyncio.run(deck_tools.screenshot()))


def rec(name, seconds):
    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, name + ".mp4")
    env = deck_tools.clean_env() | {"GST_PLUGIN_PATH": CLIPPER_GST}
    pipe = (f"gst-launch-1.0 -e pipewiresrc do-timestamp=true target-object=gamescope ! queue ! videorate ! "
            f"video/x-raw,framerate=30/1 ! videoconvert ! video/x-raw,format=NV12 ! vah264enc ! h264parse ! "
            f"mp4mux ! filesink location={dst}")
    p = subprocess.Popen(pipe, shell=True, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    # What the speakers play (Claude's voice, game audio), muxed in later with ffmpeg.
    wav = os.path.join(OUT, name + ".wav")
    a = subprocess.Popen(["pw-record", "-P", "stream.capture.sink=true", "--rate", "48000", "--channels", "2", wav],
                         env=deck_tools.clean_env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        p.wait(timeout=float(seconds))
    except subprocess.TimeoutExpired:
        p.send_signal(2)  # SIGINT -> -e sends EOS so the mp4 is finalised
        p.wait(timeout=15)
    a.terminate()
    a.wait(timeout=5)
    print(dst, os.path.getsize(dst) if os.path.exists(dst) else "missing", p.stderr.read().decode()[-300:] if p.returncode else "")


def main():
    cmd, *rest = sys.argv[1:] or ["help"]
    if cmd in NAV:
        print(js(NAV[cmd]))
    elif cmd == "shot":
        shot(rest[0])
    elif cmd == "gameshot":
        game_shot()
    elif cmd == "rec":
        rec(rest[0], rest[1] if len(rest) > 1 else 10)
    elif cmd in ("theme", "model", "mode"):
        print(call(f"set_{cmd}", rest[0]))
    elif cmd == "call":
        print(json.dumps(call(rest[0], *[json.loads(a) for a in rest[1:]]))[:2000])
    elif cmd == "ui":
        arg = json.dumps(rest[1]) if len(rest) > 1 else ""
        print(js(f"return await window.__claudeDeck.ui[{json.dumps(rest[0])}]({arg}) ?? null;"))
    elif cmd == "js":
        print(js(rest[0]))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
