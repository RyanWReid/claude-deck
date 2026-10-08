#!/bin/bash
# Voice for the Claude plugin: Piper (speaking) and whisper.cpp (listening), all under
# ~/.local/share/claude-deck. Nothing touches SteamOS's read-only system.
# Usage: bash scripts/setup-voice.sh        (re-running skips what's already there)
set -euo pipefail
BASE=~/.local/share/claude-deck
PIPER=$BASE/piper
WHISPER=$BASE/whisper
VOICE=${VOICE:-en_US-lessac-medium}
mkdir -p "$PIPER" "$WHISPER"

if [ ! -x "$PIPER/piper" ]; then
  echo "Downloading Piper…"
  curl -fsSL https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
    | tar xz -C "$PIPER" --strip-components=1
fi
if [ ! -f "$PIPER/$VOICE.onnx" ]; then
  echo "Downloading the $VOICE voice…"
  lang=${VOICE%%-*}; name=${VOICE#*-}; quality=${name#*-}; name=${name%-*}
  url=https://huggingface.co/rhasspy/piper-voices/resolve/main/${lang%%_*}/$lang/$name/$quality/$VOICE
  curl -fsSLo "$PIPER/$VOICE.onnx" "$url.onnx"
  curl -fsSLo "$PIPER/$VOICE.onnx.json" "$url.onnx.json"
fi

if [ ! -f "$WHISPER/ggml-base.en.bin" ]; then
  echo "Downloading the Whisper base.en model…"
  curl -fsSLo "$WHISPER/ggml-base.en.bin" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
fi
if [ ! -x "$WHISPER/whisper-cli" ]; then
  command -v podman >/dev/null || { echo "Podman not found; build whisper-cli elsewhere and copy it to $WHISPER/"; exit 1; }
  echo "Building whisper-cli in a temporary container (a few minutes)…"
  podman run --rm -v "$WHISPER:/out:Z" docker.io/library/debian:bookworm bash -euc '
    apt-get update -qq && apt-get install -y -qq build-essential cmake git >/dev/null
    git clone -q --depth 1 https://github.com/ggml-org/whisper.cpp /src && cd /src
    cmake -B build -DBUILD_SHARED_LIBS=OFF -DGGML_OPENMP=OFF -DCMAKE_EXE_LINKER_FLAGS=-static >/dev/null
    cmake --build build -j"$(nproc)" --target whisper-cli >/dev/null
    cp build/bin/whisper-cli /out/'
fi

echo "Testing…"
echo "Voice is ready." | "$PIPER/piper" --model "$PIPER/$VOICE.onnx" --output_file /tmp/claude-voice-test.wav 2>/dev/null
"$WHISPER/whisper-cli" -m "$WHISPER/ggml-base.en.bin" -f /tmp/claude-voice-test.wav -nt -np 2>/dev/null || true
echo "Done. Reopen the Claude panel to see the mic and Spoken replies settings."
