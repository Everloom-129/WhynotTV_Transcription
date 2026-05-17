"""Entry point: ties download / transcribe / postprocess together."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .chapters import parse_chapters_file
from .download import (
    chapters_from_metadata,
    download_audio,
    fetch_metadata,
    to_wav_16k_mono,
    write_chapters_file,
)
from .glossary import build_initial_prompt, load_terms
from .postprocess import write_json, write_markdown, write_srt
from .transcribe import transcribe


def _data_paths(root: Path, episode: str) -> dict:
    return {
        "audio_raw": root / "data" / "audio" / f"{episode}.m4a",
        "audio_wav": root / "data" / "audio" / f"{episode}.wav",
        "srt": root / "data" / "raw" / f"{episode}.srt",
        "json": root / "data" / "raw" / f"{episode}.json",
        "md": root / "data" / "transcripts" / f"{episode}.md",
        "chapters": root / "chapters" / f"{episode}.txt",
        "glossary": root / "glossaries" / f"{episode}.txt",
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Chinese podcast transcription pipeline")
    p.add_argument("--url", help="YouTube/Bilibili URL")
    p.add_argument("--audio", help="Existing local audio file (skip download)")
    p.add_argument("--from-json", help="Re-run postprocess only, from existing JSON")
    p.add_argument("--episode", required=True, help="Short slug, e.g. 'danfei'")
    p.add_argument("--chapters", help="Chapters file. Defaults to chapters/<episode>.txt")
    p.add_argument("--glossary", help="Glossary file. Defaults to glossaries/<episode>.txt")
    p.add_argument("--title", help="Markdown title; defaults from yt-dlp / episode")
    p.add_argument("--cookies-from-browser", help="e.g. firefox / chrome (Bilibili)")
    p.add_argument("--auto-chapters", action="store_true",
                   help="Pull chapters from URL metadata if local chapters file missing")
    p.add_argument("--model", default="large-v3")
    p.add_argument("--device", default="cuda")
    p.add_argument("--compute-type", default="float16")
    p.add_argument("--language", default="zh")
    p.add_argument("--beam-size", type=int, default=5)
    p.add_argument("--start", type=float, default=None,
                   help="Start seconds (pilot a slice)")
    p.add_argument("--end", type=float, default=None, help="End seconds (pilot a slice)")
    p.add_argument("--no-vad", action="store_true")
    args = p.parse_args(argv)

    root = Path(__file__).resolve().parent.parent
    paths = _data_paths(root, args.episode)
    chapters_path = Path(args.chapters) if args.chapters else paths["chapters"]
    glossary_path = Path(args.glossary) if args.glossary else paths["glossary"]

    title = args.title or args.episode

    # --- Postprocess-only path ----------------------------------------------
    if args.from_json:
        payload = json.loads(Path(args.from_json).read_text(encoding="utf-8"))
        segments = payload["segments"]
        info_meta = payload.get("info", {})
        chapters = (
            parse_chapters_file(chapters_path) if chapters_path.exists() else []
        )
        header = [f"Episode: {args.episode}", f"Source: {payload.get('extra', {}).get('source_url', 'local')}"]
        write_srt(segments, paths["srt"])
        write_json(segments, info_meta, paths["json"], extra=payload.get("extra"))
        write_markdown(segments, paths["md"], title=title, chapters=chapters, header_lines=header)
        print(f"[done] wrote {paths['srt']}, {paths['json']}, {paths['md']}")
        return 0

    # --- Resolve audio -------------------------------------------------------
    source_url = args.url
    meta: dict | None = None
    if args.audio:
        src_audio = Path(args.audio)
        if src_audio.suffix != ".wav":
            to_wav_16k_mono(src_audio, paths["audio_wav"])
            audio_wav = paths["audio_wav"]
        else:
            audio_wav = src_audio
    elif args.url:
        if args.auto_chapters and not chapters_path.exists():
            print(f"[chapters] fetching metadata for auto-chapters", file=sys.stderr)
            meta = fetch_metadata(args.url, cookies_from_browser=args.cookies_from_browser)
            yt_chs = chapters_from_metadata(meta)
            if yt_chs:
                write_chapters_file(yt_chs, chapters_path)
                print(f"[chapters] wrote {len(yt_chs)} chapters to {chapters_path}",
                      file=sys.stderr)
            if not args.title:
                title = meta.get("title") or title

        download_audio(
            args.url,
            paths["audio_raw"],
            cookies_from_browser=args.cookies_from_browser,
        )
        # find downloaded file (extension may vary)
        downloaded = list(paths["audio_raw"].parent.glob(f"{args.episode}.*"))
        downloaded = [d for d in downloaded if d.suffix != ".wav"]
        if not downloaded:
            print("[error] no downloaded audio found", file=sys.stderr)
            return 1
        to_wav_16k_mono(downloaded[0], paths["audio_wav"])
        audio_wav = paths["audio_wav"]
    else:
        print("[error] need --url or --audio (or --from-json)", file=sys.stderr)
        return 2

    # --- Glossary -> initial_prompt -----------------------------------------
    terms = load_terms(glossary_path)
    initial_prompt = build_initial_prompt(terms) if terms else None
    if initial_prompt:
        print(f"[glossary] {len(terms)} terms; prompt len={len(initial_prompt)} chars",
              file=sys.stderr)

    # --- Transcribe ----------------------------------------------------------
    segments, info_meta = transcribe(
        audio_wav,
        model_size=args.model,
        device=args.device,
        compute_type=args.compute_type,
        language=args.language,
        initial_prompt=initial_prompt,
        beam_size=args.beam_size,
        vad_filter=not args.no_vad,
        condition_on_previous_text=False,
        start=args.start,
        end=args.end,
    )

    # --- Postprocess ---------------------------------------------------------
    chapters = parse_chapters_file(chapters_path) if chapters_path.exists() else []
    if chapters:
        print(f"[chapters] using {len(chapters)} chapters from {chapters_path}",
              file=sys.stderr)
    extra = {
        "source_url": source_url,
        "audio_path": str(audio_wav),
        "model": args.model,
        "language": args.language,
        "initial_prompt_used": bool(initial_prompt),
        "clip_start": args.start,
        "clip_end": args.end,
    }
    write_srt(segments, paths["srt"])
    write_json(segments, info_meta, paths["json"], extra=extra)
    header = [f"Episode: {args.episode}"]
    if source_url:
        header.append(f"Source: {source_url}")
    write_markdown(segments, paths["md"], title=title, chapters=chapters,
                   header_lines=header)
    print(f"[done] wrote {paths['srt']}, {paths['json']}, {paths['md']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
