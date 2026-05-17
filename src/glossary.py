"""Glossary loader and initial_prompt builder."""
from __future__ import annotations

from pathlib import Path


def load_terms(path: str | Path | None) -> list[str]:
    if path is None:
        return []
    p = Path(path)
    if not p.exists():
        return []
    terms: list[str] = []
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        terms.append(line)
    return terms


def build_initial_prompt(terms: list[str], context: str | None = None) -> str:
    """Build a single-sentence prompt that primes whisper with the glossary.

    Whisper truncates initial_prompt to ~244 tokens. Caller is responsible
    for keeping the glossary tight enough that the prompt fits.
    """
    if context is None:
        context = "这是一期中文播客，涉及以下专有名词和英文术语"
    if not terms:
        return context + "。"
    return f"{context}：{', '.join(terms)}。"
