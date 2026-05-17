"""faster-whisper wrapper tuned for long-form Chinese podcasts."""
from __future__ import annotations

import sys
import time
from pathlib import Path


def transcribe(
    audio_path: str | Path,
    *,
    model_size: str = "large-v3",
    device: str = "cuda",
    compute_type: str = "float16",
    language: str = "zh",
    initial_prompt: str | None = None,
    beam_size: int = 5,
    vad_filter: bool = True,
    condition_on_previous_text: bool = False,
    start: float | None = None,
    end: float | None = None,
) -> tuple[list[dict], dict]:
    """Run faster-whisper and return (segments, info_meta).

    Segments are plain dicts so they survive json.dump. `info_meta` carries
    a few useful fields from the TranscriptionInfo for the audit trail.
    """
    # Import here so the CLI can import this module without GPU libs loaded
    from faster_whisper import WhisperModel

    print(
        f"[transcribe] model={model_size} device={device} compute_type={compute_type} "
        f"language={language} vad={vad_filter} cond_prev={condition_on_previous_text}",
        file=sys.stderr,
    )
    t0 = time.time()
    model = WhisperModel(model_size, device=device, compute_type=compute_type)
    print(f"[transcribe] model loaded in {time.time() - t0:.1f}s", file=sys.stderr)

    clip_kwargs: dict = {}
    if start is not None:
        clip_kwargs["clip_timestamps"] = (
            [start, end] if end is not None else [start]
        )

    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        initial_prompt=initial_prompt,
        beam_size=beam_size,
        vad_filter=vad_filter,
        condition_on_previous_text=condition_on_previous_text,
        word_timestamps=False,
        **clip_kwargs,
    )

    info_meta = {
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "duration_after_vad": getattr(info, "duration_after_vad", None),
    }
    print(
        f"[transcribe] detected language={info.language} "
        f"(p={info.language_probability:.2f}) duration={info.duration:.1f}s",
        file=sys.stderr,
    )

    out: list[dict] = []
    t_start = time.time()
    for seg in segments_iter:
        out.append(
            {
                "id": seg.id,
                "start": seg.start,
                "end": seg.end,
                "text": seg.text,
                "avg_logprob": seg.avg_logprob,
                "no_speech_prob": seg.no_speech_prob,
                "compression_ratio": seg.compression_ratio,
                "temperature": seg.temperature,
            }
        )
        if seg.id % 25 == 0:
            elapsed = time.time() - t_start
            ratio = seg.end / elapsed if elapsed > 0 else 0
            print(
                f"[transcribe] seg#{seg.id} t={seg.end:.0f}s "
                f"({ratio:.1f}x realtime) {seg.text[:60]}",
                file=sys.stderr,
            )

    print(
        f"[transcribe] done: {len(out)} segments in {time.time() - t_start:.1f}s",
        file=sys.stderr,
    )
    return out, info_meta
