# 中文播客转录 Pipeline — Design Doc

> A for-fun project to transcribe long-form Chinese podcasts (with English code-switching) into faithful, readable text.
>
> Pilot episode: WhynotTV Podcast #5 — Danfei Xu (2h 17min, bilibili)

---

## 1. Goals

把 2 小时 + 的中文播客视频转成一份**忠实口语的纯中文文字稿**，保留：

- 嗯/啊/那个/笑声 等 disfluency
- 英文 code-switching **原样保留**（不音译、不翻译）
- 时间戳，按视频描述里的章节切分输出
- 一份可读的 markdown，配合原始 SRT/JSON 作为可追溯产物

**约束**：for-fun，不追求 production-grade。优先 simplicity、modularity、可迭代。

---

## 2. Non-goals (v1 明确不做)

写清楚以防 scope creep：

- **翻译**（English / 双语） → Phase 3
- **说话人分离 (diarization)** → Phase 2
- **LLM 重写/润色** → Phase 4，保留口语优先
- 实时转录、Web UI、HTTP API
- 多用户、并发、scale

---

## 3. Base Repo

Fork & 改造 [a2nath/Video-Transcribe](https://github.com/a2nath/Video-Transcribe)。原仓库已就位的东西：

- `yt-dlp` 下载 + `faster-whisper` 转录骨架
- CLI 风格清晰（`-f` URL/file, `-d` device, `-s` model_size 等）
- GPU/CPU dual path (`whisper-gpu.py` / `whisper-og.py`)
- 输出 SRT 字幕

需要扩展 / 替换的地方（详见 §6 决策）：

| 原 repo 默认 | 改成 | 原因 |
|---|---|---|
| `language=en` | `language=zh` | 中文为主语 + 英文 code-switching |
| `model_size=small` | `large-v3` | 中英混合识别质量 |
| 无 `initial_prompt` | 加专有名词 prompt | 大幅减少术语误识别 |
| SRT only | SRT + JSON + Markdown | 章节化输出 + 后续可编程访问 |
| 通用 yt-dlp | B 站 cookie 适配 | 高码率音频需登录 |
| 无章节概念 | 章节文件输入 | 利用视频描述现成的 timestamps |

---

## 4. Inputs / Outputs

**Inputs**
- Bilibili URL（或本地 `.m4a` / `.wav`）
- `chapters/<episode>.txt`（可选）：每行 `HH:MM:SS Title` 或 `MM:SS Title`
- `glossaries/<episode>.txt`（可选）：每行一个专有名词

**Outputs**（写到 `data/`，gitignored）
- `raw/<episode>.srt` — 字幕，标准 SRT
- `raw/<episode>.json` — faster-whisper 完整 segment 列表（含 `start`, `end`, `text`, `avg_logprob`, `no_speech_prob` 等）
- `transcripts/<episode>.md` — 可读 markdown，按章节切分

---

## 5. Architecture

```
Bilibili URL
    │
    ▼
[download.py]  yt-dlp + (optional) browser cookies
    │  ⇒ data/audio/<episode>.m4a
    ▼
[ffmpeg]       -ar 16000 -ac 1
    │  ⇒ data/audio/<episode>.wav
    ▼
[transcribe.py]  faster-whisper large-v3
                 language=zh
                 initial_prompt=<glossary>
                 vad_filter=True
                 condition_on_previous_text=False
    │  ⇒ List[Segment]
    ▼
[postprocess.py]
    ├─ write_srt()       ⇒ raw/<episode>.srt
    ├─ write_json()      ⇒ raw/<episode>.json
    └─ write_markdown()  ⇒ transcripts/<episode>.md
       └─ uses chapters/<episode>.txt to split sections
```

每一步可独立调用，方便只重跑某一阶段（比如只重新生成 markdown）。

---

## 6. Key Design Decisions

### 6.1 faster-whisper, not OpenAI whisper

原 repo 已经做了选择，沿用。CTranslate2 后端比原版 whisper 快 4-5x，2hr 音频在 GPU 上一次过没问题。`whisper-og.py` 作为 fallback 保留（CPU-only 环境用）。

### 6.2 模型 = `large-v3`，强制 `language="zh"`

- `large-v3` 是开源里对中文 + 中英 code-switching 综合最好的
- **强制 `zh`** 而不是 auto-detect：目标是"中文主语 + 英文 code-switching 保留"。auto-detect 在 Danfei 这种讲到论文/术语就切英文的场景下，可能把整段切到英文模式，反而破坏 code-switching 体验
- 副作用：英文 inline 段大多保留原文。少数情况英文专有名词被音译（"transformer" → "传送门"），靠 `initial_prompt` 缓解

### 6.3 `initial_prompt` 是质量关键变量

这是 whisper 一个被低估的参数。最多 ~244 tokens 的一段文字，作为 prior context 喂给模型，**直接影响后续生成的词表分布**。

`glossaries/<episode>.txt` 维护，每集独立。Danfei 这期初版应该包含：

```
Danfei Xu, Tairan He, Stanford, DeepMind, Georgia Tech,
behavior cloning, robot learning, robotics foundation model,
EgoMimic, UMI, RoboTurk, teleoperation, SLAM, VIO,
tactile, dexterous hand, humanoid,
GPT-3, LLM, RSS 2020, ego video, first-person video,
Betty the Crow
```

合成 prompt 时拼一句话上下文：

> 这是一期关于机器人学习的中文播客，嘉宾是 Danfei Xu，主持人是 Tairan He。涉及术语：behavior cloning, EgoMimic, UMI, SLAM, VIO, teleoperation, robot learning ...

跑完一次后看 markdown 输出，把识别错的词补进 glossary，rerun。这是个迭代过程。

### 6.4 VAD filter 开启

`vad_filter=True` (Silero VAD)：跳过纯静音段，长 podcast 上节省 10-20% 时间，并且**避免 whisper 在静音段产生 hallucinated repetition**（"谢谢观看" / "请订阅本频道" 这种常见伪输出）。

### 6.5 `condition_on_previous_text=False`

默认 whisper 用前一段输出作为后一段的 prompt，但在长音频上一旦某段错了会**雪崩**（错误内容继续作为 prompt 喂给下一段）。关掉它牺牲一点连贯性、换稳定性，长 podcast 上是值得的 trade。

### 6.6 v1 不做 diarization

理由：
- 增加 `pyannote-audio` 依赖 + HuggingFace token + user agreement，setup 复杂度↑
- "忠实口语" 目标下，章节切分 + 听感已经能区分两人
- Phase 2 可加，模块解耦

代价：v1 的 markdown 里不会有 "Danfei:" / "Tairan:" 前缀，只有 timestamp。可以接受。

### 6.7 章节集成

视频描述里有 30+ 条现成的章节 timestamps，不用太亏。

格式约定 (`chapters/<episode>.txt`)：
```
02:00 Danfei 为什么一直把自己定义为 roboticist
03:27 小时候的 Danfei 是什么样的小孩
05:34 为什么高中时决定去美国读本科
...
```

`postprocess.py` 按 chapter 把 segments 切成块，markdown 输出：

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

### 6.8 "忠实口语" = postprocess 不动文字

`postprocess.py` **只**做：章节切分、时间戳格式化、写文件。

**不**做：
- 删 disfluency (嗯/啊/那个)
- 合并短句
- 标点重写
- 错词修正

如果以后想做 "readable 版本"，是 Phase 4 新模块，**不污染 v1 原始输出**。

---

## 7. Directory Structure

```
podcast-zh-transcribe/
├── README.md
├── DESIGN.md                    # this doc
├── requirements.txt
├── .gitignore                   # ignore data/, *.wav, *.m4a, cookies
├── src/
│   ├── __init__.py
│   ├── download.py              # yt-dlp wrapper, bilibili-aware
│   ├── transcribe.py            # faster-whisper wrapper
│   ├── postprocess.py           # SRT / JSON / Markdown writers
│   ├── chapters.py              # parse chapters file, split by time
│   ├── glossary.py              # load + format initial_prompt
│   └── cli.py                   # entry point
├── glossaries/
│   └── danfei.txt
├── chapters/
│   └── danfei.txt
├── data/                        # gitignored
│   ├── audio/                   # .m4a, .wav
│   ├── raw/                     # .srt, .json
│   └── transcripts/             # .md
└── tests/
    └── test_chapters.py         # 主要测 chapter parsing 这种纯逻辑
```

---

## 8. CLI

```bash
# 完整 pipeline
python -m src.cli \
  --url "https://www.bilibili.com/video/BV..." \
  --episode danfei \
  --glossary glossaries/danfei.txt \
  --chapters chapters/danfei.txt

# 跳过下载（已有本地音频）
python -m src.cli \
  --audio data/audio/danfei.wav \
  --episode danfei \
  --glossary glossaries/danfei.txt \
  --chapters chapters/danfei.txt

# 只重跑 postprocess（已有 JSON，改章节或 markdown 模板后用）
python -m src.cli \
  --from-json data/raw/danfei.json \
  --chapters chapters/danfei.txt \
  --episode danfei

# 模型/设备 override
python -m src.cli ... --model large-v3 --device cuda --compute-type float16
```

每个 stage flag 独立 → 迭代 friendly。

---

## 9. Dependencies

```
faster-whisper>=1.0.0
yt-dlp>=2024.0.0
srt
# system: ffmpeg
```

**明确不引入**（v1）：
- `pyannote.audio` (diarization, Phase 2)
- `torch` / `transformers` (除非 faster-whisper 间接需要)
- `openai`, `anthropic` (LLM 调用，Phase 3 翻译)

---

## 10. Workflow — Pilot Run (Danfei 这一期)

1. **抠章节**：从视频描述复制时间戳目录到 `chapters/danfei.txt`，简单 reformat 一下
2. **初版 glossary**：把视频描述里出现的英文术语 + 人名抄进 `glossaries/danfei.txt`
3. **B 站 cookie**：`yt-dlp --cookies-from-browser firefox ...` 第一次配好
4. **跑 10 分钟 pilot**：先 `--start 38:57 --end 49:45`（behavior cloning 那段，技术密度最高）
5. **审 markdown**：找识别错的词，补 glossary，记下来
6. **跑完整版**：`--start` / `--end` 拿掉，full pass
7. **iterate**：发现还有错就更新 glossary + rerun，或者直接手动改 markdown（毕竟 for fun）

---

## 11. Risks / Known Pitfalls

| 风险 | 缓解 |
|---|---|
| B 站高码率音频要登录 | `yt-dlp --cookies-from-browser`；cookie 文件加入 `.gitignore` |
| Whisper "循环幻觉"（重复输出） | `vad_filter=True` + `condition_on_previous_text=False` |
| 英文 code-switching 被音译 | `initial_prompt` glossary，迭代补充 |
| 2hr 音频显存压力 | large-v3 + fp16 ≈ 5-6 GB VRAM；4090/3090 OK，更老的卡降到 `large-v2` 或 `medium`，或 `compute_type=int8` |
| `initial_prompt` 超 244 tokens 被截断 | glossary 维护时关注长度，超了就把不太重要的词砍掉 |
| 章节 timestamp 和 whisper segment 边界不对齐 | postprocess 时把章节起点 snap 到最近的 segment 起点 |

---

## 12. Phase 2+ Roadmap

明确写下来，避免污染 v1：

| Phase | Scope | 新模块 |
|---|---|---|
| **Phase 2** | Speaker diarization (Danfei / Tairan) | `src/diarize.py`，pyannote-audio |
| **Phase 3** | 翻译成英文（保留双语对照） | `src/translate.py`，按章节切分喂 Claude |
| **Phase 4** | "Readable" 整理版（去 disfluency，合并短句） | `src/readable.py`，LLM rewrite，不动 v1 原始输出 |
| **Phase 5** | 多集复用：每期一个 `episodes/<name>.yaml` 配置文件 | `src/episode.py` |

每阶段都是 additive、独立 module，不动 v1 核心。

---

## 13. Open Questions (留给 Claude Code 实现时 / 后续决定)

- 多 P 视频（B 站分 part）怎么处理？目前假设是单 P。要不要支持 `--part 2`？
- Markdown 里 timestamp 要不要做成可点击的 bilibili 跳转链接（`https://www.bilibili.com/video/BVxxx?t=207`）？  
- 错词审校工具流：手工 diff？还是写个 `review.py` 对比 glossary 词频和实际识别？
- `initial_prompt` 是否需要 episode-specific？还是有一个 base + episode 覆盖的 layered 结构？
- 时间戳精度：whisper segment 默认是秒级，要不要展示到秒，还是只到分钟？