"""SRT / JSON / Markdown writers. Pure-textual — no rewriting of segments."""
from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import srt as srtlib

from .chapters import Chapter, snap_chapters_to_segments


def _fmt_ts(seconds: float) -> str:
    s = int(round(seconds))
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def write_srt(segments: list[dict], out_path: str | Path) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    items = [
        srtlib.Subtitle(
            index=i + 1,
            start=timedelta(seconds=seg["start"]),
            end=timedelta(seconds=seg["end"]),
            content=seg["text"].strip(),
        )
        for i, seg in enumerate(segments)
    ]
    out_path.write_text(srtlib.compose(items), encoding="utf-8")
    return out_path


def write_json(
    segments: list[dict],
    info_meta: dict,
    out_path: str | Path,
    extra: dict | None = None,
) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "info": info_meta,
        "extra": extra or {},
        "segments": segments,
    }
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return out_path


def write_markdown(
    segments: list[dict],
    out_path: str | Path,
    *,
    title: str,
    chapters: list[Chapter] | None = None,
    header_lines: list[str] | None = None,
) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    chapters = chapters or []
    chapters = snap_chapters_to_segments(chapters, segments)

    lines: list[str] = [f"# {title}", ""]
    if header_lines:
        for h in header_lines:
            lines.append(f"> {h}")
        lines.append("")

    if not chapters:
        # No chapters: dump all segments as one block.
        for seg in segments:
            ts = _fmt_ts(seg["start"])
            lines.append(f"[{ts}] {seg['text'].strip()}")
        out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return out_path

    # Bucket segments into chapters by start time.
    boundaries = [ch.start for ch in chapters] + [float("inf")]
    buckets: list[list[dict]] = [[] for _ in chapters]
    for seg in segments:
        # find the rightmost chapter whose start <= seg.start
        idx = -1
        for i, b in enumerate(boundaries[:-1]):
            if seg["start"] >= b:
                idx = i
            else:
                break
        if idx == -1:
            # Segment is before the first chapter — attach to chapter 0.
            idx = 0
        buckets[idx].append(seg)

    for ch, segs in zip(chapters, buckets):
        ts = _fmt_ts(ch.start)
        lines.append(f"## [{ts}] {ch.title}")
        lines.append("")
        for seg in segs:
            seg_ts = _fmt_ts(seg["start"])
            lines.append(f"[{seg_ts}] {seg['text'].strip()}")
        lines.append("")

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_path
