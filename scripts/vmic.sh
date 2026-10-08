#!/bin/bash
# Virtual microphone for demos: play a WAV into it as if someone were talking.
# scripts/vmic.sh on | say "text" [voice] | off   (restore your real mic with `off`!)
P=~/.local/share/claude-deck/piper
case "$1" in
  on)
    pactl list short modules | grep -q cdvoice && exit 0
    pactl get-default-source > /tmp/cdmic.prev
    pactl load-module module-null-sink sink_name=cdvoice sink_properties=device.description=ClaudeDemoVoice >/dev/null
    pactl load-module module-remap-source master=cdvoice.monitor source_name=cdmic source_properties=device.description=ClaudeDemoMic >/dev/null
    pactl set-default-source cdmic ;;
  say)
    echo "$2" | "$P/piper" --model "$P/${3:-en_US-lessac-medium}.onnx" --output_file /tmp/cdsay.wav 2>/dev/null
    pw-play --target cdvoice /tmp/cdsay.wav ;;
  off)
    [ -f /tmp/cdmic.prev ] && pactl set-default-source "$(cat /tmp/cdmic.prev)"
    for m in $(pactl list short modules | grep -E "cdvoice|cdmic" | cut -f1); do pactl unload-module $m; done ;;
esac
