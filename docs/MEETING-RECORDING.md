# Meeting recording → transcript

Record a meeting from any page; when you stop, the raw transcript is appended to
that page with `You:` / `Them:` labels and timestamps. Everything runs locally —
no audio and no text ever leaves the machine.

## One-time setup you still need to do

Recording **your microphone** works right now with no setup. Capturing **the
other side** (computer audio) needs a virtual loopback device, because macOS
gives no browser direct access to system audio.

```bash
brew install --cask blackhole-2ch
```

BlackHole is an audio driver, so macOS may require an approval under
**System Settings → Privacy & Security** and a reboot. Then:

1. Open **Audio MIDI Setup** (`/Applications/Utilities`).
2. Click **+** (bottom-left) → **Create Multi-Output Device**.
3. Tick **both** your headphones/speakers **and** *BlackHole 2ch*.
   Put your real output **first** — the top device is the master clock.
4. During a meeting, set that Multi-Output Device as your system output
   (Sound settings, or ⌥-click the volume icon in the menu bar).

You then still hear the call normally, and BlackHole receives a copy that the
recorder can read. This works with **any** app — native Zoom, Teams, Chrome,
QuickTime — which is why it beats browser tab-sharing.

> Without BlackHole you can still pick **"Share a browser tab…"** as the system
> source, but that only captures audio playing inside a browser tab (tick
> *"Share tab audio"* in Chrome's picker), never a native app.

## Recording

Three entry points, all doing the same thing:

- the **microphone icon** in the page's top bar (primary),
- the page **⋯ menu → Record meeting**,
- the slash command **`/record`**.

Pick your microphone and the computer-audio source, then **Start recording**.

**Watch the two level meters before the meeting starts.** They are the only way
to confirm BlackHole is actually routed. A flat "Them" meter means the other side
is not being captured — and you cannot discover that after the interview.

Press **Stop** when done. Transcription runs in the background; you can keep
working, and even navigate to other pages — the transcript still lands on the
page you started from.

## Where things live

```
~/NotionCloneRecordings/<uuid>/
  raw.webm         stereo capture — mic on the left channel, system on the right
  meta.json        status, sources, duration (the source of truth for a recording)
  transcript.json  the merged, speaker-labeled turns
  transcript.md    the same thing as readable Markdown
```

Audio is **kept** after transcription, so a meeting can be re-transcribed later
with a better model. The intermediate 16 kHz WAVs are deleted automatically (they
are ~4x the size of the source and fully reproducible). Override the location
with `RECORDINGS_DIR`.

## How it works

1. **Capture** — one `MediaRecorder` over a WebAudio graph that merges the mic
   into the **left** channel and system audio into the **right**. One recorder,
   not two, so both speakers share a single clock and cannot drift apart.
2. **Chunked upload** — a blob every 5 s is appended to `raw.webm` server-side,
   so a 90-minute call is never held in browser memory and a crash costs ≤5 s.
3. **Split** — ffmpeg splits the stereo file back into two mono 16 kHz WAVs.
   A near-silent track is skipped rather than transcribed, because Whisper
   reliably hallucinates dialogue ("Thank you.") out of silence.
4. **Transcribe** — each channel separately, so there is no crosstalk to confuse
   the decoder. Channel provenance *is* the speaker label — no diarization
   guesswork involved, so `You`/`Them` is always right.
5. **Merge** — segments are interleaved by timestamp and consecutive same-speaker
   segments are coalesced into readable turns.
6. **Insert** — one editor transaction, so the normal autosave persists it, RAG
   re-indexes it, and **Cmd-Z undoes it** like any other edit.

## Transcription engines

Auto-detected, preferring the faster one. Detection requires **both** a binary
and its model file, so a half-finished install can't win and then fail mid-meeting.

| Engine | Setup | Speed |
|---|---|---|
| **whisper.cpp** (default) | `brew install whisper-cpp` + model below | GPU via Metal — a 60-min meeting in a few minutes |
| python `whisper` (fallback) | already installed, `base` model | CPU only, roughly realtime |

```bash
mkdir -p ~/.cache/whisper-cpp
curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin \
  -o ~/.cache/whisper-cpp/ggml-large-v3-turbo.bin   # ~1.6 GB
```

Force one with `TRANSCRIBER=whisper-cpp` or `TRANSCRIBER=whisper-python`. All
paths are overridable — see `.env.example`.

## Browser vs desktop app

Prefer **Chrome at `http://127.0.0.1:3000`**. The Electron app is unsigned
(`identity: null`), and macOS keys microphone permission to code identity, so a
rebuild can silently drop the grant. If recording stops seeing the mic in the
desktop app, remove it under **System Settings → Privacy & Security → Microphone**
and relaunch.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Them" meter never moves | System output isn't set to the Multi-Output Device, or the wrong source is selected |
| "Both audio channels were silent" | Nothing reached either input — check the device pickers |
| Transcript has only your side | The system source was "None", or its track was silent and got skipped |
| "No transcription engine found" | Neither whisper.cpp+model nor python whisper is installed |
| Transcript never appears | Check the bar for an error; the audio is still on disk and **Retry transcription** re-runs it |

## Deliberate limitations (v1)

- No pause/resume mid-recording.
- No live/partial transcript — transcription happens after you stop.
- Recording state is files on disk, not a database table.
- A page open in a *second* browser tab won't show a server-side append until reload.
