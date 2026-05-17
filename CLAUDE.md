# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A staged pipeline for transcribing long-form Chinese podcasts (with English code-switching preserved verbatim) into faithful spoken-language text, plus a localhost-only web editor for line-by-line transcription fixes and Claude-driven English translation. See `design.md` for full design rationale on the pipeline — it is the source of truth for non-obvious choices.

Two surfaces:
- **`src/`** — CLI pipeline (download → wav → transcribe → postprocess).
- **`webapp/`** — Vite + React editor that consumes the pipeline's JSON, lets you fix ASR errors and translate to English via the Anthropic API.

## Commands

```bash
# Full pipeline from URL (Bilibili needs --cookies-from-browser)
python -m src.cli --url <URL> --episode <slug> --cookies-from-browser firefox

# Skip download (local audio already on disk)
python -m src.cli --audio data/audio/<slug>.wav --episode <slug>

# Re-run postprocess only (after editing chapters/<slug>.txt or markdown layout)
python -m src.cli --from-json data/raw/<slug>.json --episode <slug>

# Pilot a slice while iterating on the glossary
python -m src.cli --url <URL> --episode <slug> --start 38:57 --end 49:45  # (--start/--end take seconds, not mm:ss — convert first)

# Override model / device
python -m src.cli ... --model large-v3 --device cuda --compute-type float16

# Tests
pytest                                  # all
pytest tests/test_chapters.py::test_snap_to_nearest_segment   # single

# Webapp (transcription editor + Claude translation)
cd webapp && npm install                # one-time
cd webapp && npm run dev                # → http://localhost:5173
# URL param ?episode=<slug> picks which transcript to load (defaults to "danfei").
```

`src.cli` is the only entry point for the pipeline; each stage (`download`, `transcribe`, `postprocess`) is independently callable from Python so you can re-run one stage without redoing earlier ones.

## Architecture

The pipeline is **four stages with explicit handoff artifacts on disk**, so any stage can be re-run alone. The webapp is a separate, additive layer that reads the pipeline's JSON and writes a sibling edits file — it never mutates the pipeline outputs.

```
URL ──[download.py]──► data/audio/<ep>.{m4a,webm,...}
                  └──[to_wav_16k_mono]──► data/audio/<ep>.wav
                                       └──[transcribe.py]──► list[Segment]
                                                          └──[postprocess.py]──► data/raw/<ep>.srt
                                                                                  data/raw/<ep>.json   ◄── re-entry point for --from-json
                                                                                  data/transcripts/<ep>.md
                                                                                          │
                                                                                          ▼
                                                                              [webapp] ──► data/edits/<ep>.json
```

Three external inputs gate quality and live outside `data/` (which is gitignored):

- `glossaries/<ep>.txt` — proper nouns / English terms, one per line. Loaded by `glossary.py` into Whisper's `initial_prompt`. This is the **primary quality lever**; iterate it by re-running and adding misrecognized terms. Whisper truncates `initial_prompt` to ~244 tokens, so keep the glossary tight.
- `chapters/<ep>.txt` — `HH:MM:SS Title` or `MM:SS Title` per line, `#` for comments. Used by `postprocess.py` to bucket segments into markdown sections. Auto-populated from yt-dlp metadata with `--auto-chapters` if missing.
- The bilibili cookie (`--cookies-from-browser firefox`) is required for high-bitrate audio.

`cli._data_paths()` is the single source of truth for where each artifact lives — change it there if layout shifts.

### Webapp

`webapp/` is a Vite + React single-page editor. Two libraries do the heavy lifting:

- **wavesurfer.js** — audio waveform with seekable cursor (top bar).
- **@anthropic-ai/sdk** — direct browser calls via `dangerouslyAllowBrowser: true`; API key lives in `localStorage`. Localhost-only by design.

`vite.config.ts` carries a tiny dev plugin that is the entire "backend":
- `GET /api/transcript?episode=<slug>` — reads `data/raw/<slug>.json` + (if present) `data/edits/<slug>.json`.
- `POST /api/save` — writes `data/edits/<slug>.json` (debounced from the client).
- `GET /audio/<slug>.wav` — serves audio from `data/audio/`.

The editor groups consecutive ASR segments into **sentence units** (`webapp/src/lib/units.ts`) before sending to Claude — one API call per unit, with strict 1:1 alignment back to source segments via the `emit_translation` tool schema. Unit boundaries are computed in-memory and **not persisted**; the heuristic can be swapped without invalidating saved edits.

## Non-obvious invariants

These reflect deliberate decisions from `design.md`. Preserve them unless the user is explicitly changing the design:

- **Faithful spoken text is the goal.** `postprocess.py` must NOT alter segment text: no removing disfluencies (嗯/啊/那个), no merging short sentences, no rewriting punctuation, no error correction. It only formats timestamps, buckets by chapter, and writes files. A "readable" pass is Phase 4 and belongs in a new module, not in `postprocess.py`.
- **`language="zh"` is forced**, not auto-detected. Code-switching into English is intentionally kept in Chinese-mode transcription so English inline fragments stay verbatim instead of getting routed to English mode mid-segment.
- **`condition_on_previous_text=False`** in `transcribe.py`. This sacrifices some coherence to avoid cascading hallucinations on long audio — do not flip without understanding the trade.
- **`vad_filter=True`** suppresses Whisper's silence-region repetition hallucinations ("谢谢观看" / "请订阅本频道"). The `--no-vad` flag exists for debugging only.
- **Chapter starts snap to the nearest segment start** (`chapters.snap_chapters_to_segments`) so markdown sections never cut mid-utterance. If you add new chapter-aware output formats, route through this helper.
- **Segments are stored as plain dicts**, not faster-whisper objects, so they round-trip through JSON for the `--from-json` re-entry path. Keep them dict-shaped.
- **`faster_whisper` is imported inside `transcribe()`**, not at module top — this lets `src.cli` and tests import the package without GPU libraries loaded.
- **`data/raw/<ep>.json` is immutable from the webapp's perspective.** All edits + translations write to `data/edits/<ep>.json` (same per-segment id keying). This means re-running `--from-json` will not clobber edits, and conversely the webapp can be reset by deleting only `data/edits/`.
- **Sentence units are derived, not persisted.** `webapp/src/lib/units.ts` recomputes unit boundaries from segment text every render. Editing punctuation in a segment shifts unit boundaries; that's intentional. Don't write unit IDs into `data/edits/<ep>.json`.
- **Translation calls Claude with structured output (`emit_translation` tool).** If returned `lines.length !== fragments.length`, the call throws rather than silently misaligning. Keep this contract if you swap models or prompts.

## Phase boundaries

`design.md` §12 reserves these for additive new modules — do NOT bolt them into existing files:

- **Phase 2 (next)** — speaker diarization via pyannote-audio → new `src/diarize.py`. Goal: emit `Danfei:` / `Tairan:` speaker labels per segment so the markdown and editor can attribute lines. Output should be a sidecar (e.g. `data/raw/<ep>.diarize.json`) so `data/raw/<ep>.json` stays speaker-agnostic. The webapp will consume the sidecar and prefix each row with the speaker label.
- **Phase 3 (interactive done; batch TODO)** — interactive per-unit translation is implemented in `webapp/` (Claude API, `webapp/src/lib/claude.ts`). A future batch / offline CLI translation can still go in a new `src/translate.py` if needed; do NOT add translation logic to `postprocess.py`.
- **Phase 4** — readable rewrite → new `src/readable.py`. Still untouched.

System dependency: `ffmpeg` must be on PATH (used by `download.to_wav_16k_mono`).
