# WhynotTV Podcast Transcription

[Jie Wang](https://everloom-129.github.io/)

> Faithful long-form transcription of Chinese podcasts (with English code-switching), built for 2hr+ bilibili episodes.

A for-fun fork of [a2nath/Video-Transcribe](https://github.com/a2nath/Video-Transcribe), tailored for WhynotTV, a Chinese-primary tech podcasts where the speakers casually drop into English for technical terms.

<img src="asset/whynottv_logo.png" alt="whynottv" width="240"/>

**Example episode**: [WhynotTV Podcast #5 · Danfei Xu](https://www.youtube.com/watch?v=__P5yygfRRQ) (2h 17min)

<img src="https://img.youtube.com/vi/__P5yygfRRQ/maxresdefault.jpg" alt="danfei" width="420"/>

Can be extracted as: 
```bash
data/
├── audio
│   ├── danfei.wav
│   ├── danfei.webm
│   └── readme.md
├── raw
│   ├── danfei.json
│   └── danfei.srt
├── run.log
└── transcripts
    └── danfei.md

3 directories, 7 files
```

### TODO: 
- [ ] Add web-based app to edit the trasncription error 
- [ ] Add Claude-based auto translator
- [ ] Add auto summary + blog draft


### Next 
- [ ] [WhynotTV Podcast #4 · 翁家翌 (Jiayi Weng):]https://www.bilibili.com/video/BV1darmBcE4A) (2h 17min)

<img src="https://img.youtube.com/vi/I0DrcsDf3Os/maxresdefault.jpg" alt="jiayi" width="420"/>

---

## What it does

Takes a bilibili URL → spits out a chapter-segmented markdown transcript that preserves spoken-language faithfully (disfluency, code-switching, all of it).

```
bilibili URL ──► .m4a ──► .wav (16kHz mono) ──► whisper ──► .srt + .json + .md
```

Stack:
- **[faster-whisper](https://github.com/SYSTRAN/faster-whisper)** (`large-v3`) — best open-source model for zh/en code-switching
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — bilibili-aware downloader
- **ffmpeg** — audio normalization

What it intentionally does **not** do (v1): translation, speaker diarization, LLM rewriting. See [`DESIGN.md`](./DESIGN.md) §2 for scope rationale and §12 for the roadmap.

---

## Quickstart

```bash
# 1. Install
pip install -r requirements.txt
# requires ffmpeg on PATH

# 2. Set up bilibili cookies (one-time, for high-bitrate audio)
yt-dlp --cookies-from-browser firefox --cookies cookies.txt \
  "https://www.bilibili.com/video/BV1xx"

# 3. Prepare episode inputs (see § Inputs below)
# - chapters/danfei.txt
# - glossaries/danfei.txt

# 4. Pilot run (10 minutes, behavior cloning section)
python -m src.cli \
  --url "https://www.bilibili.com/video/BV1xx" \
  --episode danfei \
  --glossary glossaries/danfei.txt \
  --chapters chapters/danfei.txt \
  --start 38:57 --end 49:45

# 5. Review data/transcripts/danfei.md
#    Find mis-transcribed terms → add to glossary → rerun

# 6. Full pass
python -m src.cli \
  --url "https://www.bilibili.com/video/BV1xx" \
  --episode danfei \
  --glossary glossaries/danfei.txt \
  --chapters chapters/danfei.txt
```

Expect ~15-30 min on a 4090 for a 2hr episode.

---

## Install

```bash
git clone <this-repo>
cd podcast-zh-transcribe
pip install -r requirements.txt
```

System deps:
- `ffmpeg` (`brew install ffmpeg` / `apt install ffmpeg`)
- CUDA + cuDNN for GPU path (optional; CPU works via `--device cpu`)

Tested on:
- Ubuntu 22.04 + CUDA 12.x + RTX 4090
- macOS 14 + M-series (CPU/MPS via `--compute-type int8`)

---

## Usage

### Full pipeline from URL

```bash
python -m src.cli \
  --url "https://www.bilibili.com/video/BV..." \
  --episode <name> \
  --glossary glossaries/<name>.txt \
  --chapters chapters/<name>.txt
```

### From a local audio file (skip download)

```bash
python -m src.cli \
  --audio data/audio/<name>.wav \
  --episode <name> \
  --glossary glossaries/<name>.txt \
  --chapters chapters/<name>.txt
```

### Re-run postprocess only (already have JSON)

Useful after tweaking chapters or markdown template:

```bash
python -m src.cli \
  --from-json data/raw/<name>.json \
  --chapters chapters/<name>.txt \
  --episode <name>
```

### Common overrides

```bash
--model large-v3          # or large-v2, medium, small
--device cuda             # or cpu
--compute-type float16    # or int8 (CPU/low-VRAM), float32
--start 38:57 --end 49:45 # transcribe a time range only
--language zh             # default; don't change unless you know why
```

---

## Inputs

### `chapters/<episode>.txt`

One chapter per line, `MM:SS Title` or `HH:MM:SS Title`. Paste straight from the video description.

```
02:00 Danfei 为什么一直把自己定义为 roboticist
03:27 小时候的 Danfei 是什么样的小孩
05:34 为什么高中时决定去美国读本科
38:57 什么是机器人里的 behavior cloning
...
```

### `glossaries/<episode>.txt`

Comma-separated or newline-separated proper nouns. Gets injected as whisper's `initial_prompt` to bias decoding toward correct spellings.

```
Danfei Xu, Tairan He, Stanford, DeepMind, Georgia Tech
behavior cloning, robot learning, EgoMimic, UMI, RoboTurk
teleoperation, SLAM, VIO, tactile, dexterous hand, humanoid
RSS 2020, GPT-3, LLM
Betty the Crow
```

**This is the single highest-leverage knob for quality.** See [`DESIGN.md`](./DESIGN.md) §6.3.

Whisper's `initial_prompt` caps at ~244 tokens — if your glossary overflows, trim the less-critical entries.

---

## Outputs

All written under `data/` (gitignored):

```
data/
├── audio/
│   ├── <episode>.m4a        # raw download
│   └── <episode>.wav        # 16kHz mono, fed to whisper
├── raw/
│   ├── <episode>.srt        # standard SRT subtitles
│   └── <episode>.json       # full faster-whisper segment list
└── transcripts/
    └── <episode>.md         # chapter-segmented markdown
```

Markdown output structure:

```markdown
# Danfei Xu Podcast Transcript

> WhynotTV Podcast #5 · 2026-05-01 · 2h 17min
> Source: https://www.bilibili.com/video/...

## [03:27] 小时候的 Danfei 是什么样的小孩

[03:27] 嗯，那个，我小时候是个挺...
[03:35] 对，就是 always curious 那种吧...

## [05:34] 为什么高中时决定去美国读本科
...
```

Faithful-to-spoken-language by design: disfluency (嗯/啊/那个) and English code-switching are preserved, not cleaned up. See [`DESIGN.md`](./design.md) §6.8.

---

## Design choices worth knowing

A few non-obvious settings that aren't in `a2nath/Video-Transcribe`'s defaults but matter a lot for long Chinese audio:

| Setting | Value | Why |
|---|---|---|
| `language` | `"zh"` (forced) | Auto-detect breaks code-switching on long files |
| `vad_filter` | `True` | Prevents whisper looping on silence ("谢谢观看请订阅") |
| `condition_on_previous_text` | `False` | Stops error cascades on long audio |
| `initial_prompt` | glossary | Massive quality win for technical terms |
| `model_size` | `large-v3` | Only model that handles zh+en mixing reliably |

Full rationale in [`DESIGN.md`](./DESIGN.md) §6.

---

## Roadmap

v1 (current) is intentionally minimal. Each phase is an additive module that doesn't touch v1 core:

- **Phase 2** — speaker diarization via pyannote (`Danfei:` / `Tairan:` labels)
- **Phase 3** — English translation (chapter-by-chapter via LLM)
- **Phase 4** — "readable" rewrite (de-disfluency, sentence merging) ·  separate output, never modifies the faithful v1 transcript
- **Phase 5** — multi-episode YAML config

See [`DESIGN.md`](./DESIGN.md) §12.

---

## Credits

- Built on top of [a2nath/Video-Transcribe](https://github.com/a2nath/Video-Transcribe) ·  the yt-dlp + faster-whisper scaffold and CLI shape are theirs.
- [Whisper by OpenAI](https://openai.com/index/whisper/) · faster-whisper by SYSTRAN · pyannote by CNRS
- Pilot content: [WhynotTV Podcast](https://www.bilibili.com/) ·  used with permission of the host.

## License

MIT (same as upstream).
