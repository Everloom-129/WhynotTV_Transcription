"""Chapter file parsing and segment-aligned slicing."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Chapter:
    start: float  # seconds
    title: str


_TS_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.*\S)\s*$")


def parse_chapters_file(path: str | Path) -> list[Chapter]:
    """Parse a chapters file. Each line is `HH:MM:SS Title` or `MM:SS Title`.

    Blank lines and `#` comments are ignored.
    """
    chapters: list[Chapter] = []
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _TS_RE.match(line)
        if not m:
            continue
        g1, g2, g3, title = m.groups()
        if g3 is None:
            # MM:SS format -> g1=MM, g2=SS
            seconds = int(g1) * 60 + int(g2)
        else:
            seconds = int(g1) * 3600 + int(g2) * 60 + int(g3)
        chapters.append(Chapter(start=float(seconds), title=title))
    chapters.sort(key=lambda c: c.start)
    return chapters


def snap_chapters_to_segments(
    chapters: list[Chapter], segments: list[dict]
) -> list[Chapter]:
    """Snap each chapter start to the nearest segment start.

    Prevents the markdown from cutting mid-utterance when chapter timestamps
    fall inside a whisper segment.
    """
    if not segments:
        return chapters
    seg_starts = [s["start"] for s in segments]
    out: list[Chapter] = []
    for ch in chapters:
        # find segment whose start is closest to chapter start
        idx = min(range(len(seg_starts)), key=lambda i: abs(seg_starts[i] - ch.start))
        out.append(Chapter(start=seg_starts[idx], title=ch.title))
    return out
