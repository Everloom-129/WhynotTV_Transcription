from pathlib import Path
import tempfile

from src.chapters import parse_chapters_file, snap_chapters_to_segments


def test_parses_hh_mm_ss_and_mm_ss():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "ch.txt"
        p.write_text("00:01:30 Intro\n03:27 小时候的 Danfei\n# comment\n\n", encoding="utf-8")
        chs = parse_chapters_file(p)
    assert [c.start for c in chs] == [90.0, 207.0]
    assert chs[1].title == "小时候的 Danfei"


def test_snap_to_nearest_segment():
    from src.chapters import Chapter
    segs = [{"start": 88.0}, {"start": 95.0}, {"start": 200.0}, {"start": 210.0}]
    chs = [Chapter(start=90.0, title="a"), Chapter(start=207.0, title="b")]
    snapped = snap_chapters_to_segments(chs, segs)
    assert [c.start for c in snapped] == [88.0, 210.0]
