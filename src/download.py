"""yt-dlp wrapper. Works for YouTube out of the box and Bilibili with cookies."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path


def download_audio(
    url: str,
    out_path: str | Path,
    cookies_from_browser: str | None = None,
    extractor_args: str | None = None,
) -> Path:
    """Download best audio. Caller can re-encode after.

    YouTube has been gating the default web client behind PO tokens / SABR
    streaming since 2025. The `android_vr` player_client is currently the
    most reliable unauthenticated path and yields opus audio-only (format 251).
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    raw_template = str(out_path.with_suffix(".%(ext)s"))

    cmd = [
        "yt-dlp",
        "-f",
        "bestaudio/best",
        "--no-playlist",
        "-o",
        raw_template,
        url,
    ]
    if "youtube.com" in url or "youtu.be" in url:
        cmd.extend(["--extractor-args", extractor_args or "youtube:player_client=android_vr"])
    elif extractor_args:
        cmd.extend(["--extractor-args", extractor_args])
    if cookies_from_browser:
        cmd.extend(["--cookies-from-browser", cookies_from_browser])

    subprocess.run(cmd, check=True)

    # Find the actual downloaded file (yt-dlp picks the extension).
    parent = out_path.parent
    stem = out_path.stem
    candidates = [p for p in parent.glob(f"{stem}.*") if p.suffix != ".wav"]
    if not candidates:
        raise FileNotFoundError(f"yt-dlp output not found for stem {stem}")
    # Prefer non-info-json files
    candidates = [c for c in candidates if c.suffix not in (".json", ".info.json")]
    src = candidates[0]

    if out_path.suffix == ".wav":
        to_wav_16k_mono(src, out_path)
        return out_path
    return src


def to_wav_16k_mono(src: str | Path, dst: str | Path) -> Path:
    """ffmpeg: downmix to mono 16 kHz wav (whisper's native rate)."""
    src = Path(src)
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-vn",
        str(dst),
    ]
    subprocess.run(cmd, check=True)
    return dst


def fetch_metadata(url: str, cookies_from_browser: str | None = None) -> dict:
    cmd = ["yt-dlp", "--dump-json", "--skip-download", "--no-playlist", url]
    if cookies_from_browser:
        cmd.extend(["--cookies-from-browser", cookies_from_browser])
    out = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def chapters_from_metadata(meta: dict) -> list[tuple[float, str]]:
    """Extract (start_seconds, title) tuples from yt-dlp metadata."""
    out: list[tuple[float, str]] = []
    for c in meta.get("chapters") or []:
        start = float(c.get("start_time") or 0.0)
        title = (c.get("title") or "").strip() or f"chapter@{int(start)}"
        out.append((start, title))
    return out


def write_chapters_file(chapters: list[tuple[float, str]], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    for start, title in chapters:
        h = int(start) // 3600
        m = (int(start) % 3600) // 60
        s = int(start) % 60
        lines.append(f"{h:02d}:{m:02d}:{s:02d} {title}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path
