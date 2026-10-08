#!/usr/bin/env python3
"""Reload the installed plugin (backend and frontend) by disabling and re-enabling it in Decky.

Decky only live-reloads plugins flagged "debug", and plugin.json is root-owned, so this is the
no-sudo way to pick up new files. Stops any Claude reply in progress.
"""
import asyncio

from steam_mcp import cdp_eval

JS = """
await DeckyBackend.call("utilities/disable_plugin", "Claude");
await sleep(6500);
await DeckyBackend.call("utilities/enable_plugin", "Claude");
return "reloaded";
"""

if __name__ == "__main__":
    print(asyncio.run(cdp_eval(JS, {})))
