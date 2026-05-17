import type { EditedSegment } from "../types";

export type Unit = {
  /** Stable id == first segment id in the unit. */
  id: number;
  segmentIds: number[];
  start: number;
  end: number;
};

const TERMINAL_PUNCT = /[。！？!?.]\s*$/;
const MAX_UNIT_SEGMENTS = 8;
const MAX_UNIT_CHARS = 300;
const MAX_GAP_S = 1.0;

/**
 * Group consecutive segments into "sentence units" using a heuristic:
 *  - boundary if previous segment ends with terminal punctuation
 *  - boundary if the silence gap between segments is >= MAX_GAP_S
 *  - boundary if accumulating would exceed size limits
 *
 * ASR (Silero VAD) splits on acoustic boundaries, not sentence boundaries, so
 * a single thought is often spread across 3–6 segments. Translation reads
 * better when the whole unit is sent to Claude at once.
 */
export function buildUnits(segments: EditedSegment[]): Unit[] {
  const units: Unit[] = [];
  if (segments.length === 0) return units;

  let curIds: number[] = [segments[0].id];
  let curStart = segments[0].start;
  let curEnd = segments[0].end;
  let curChars = segments[0].edited_text.length;

  const flush = () => {
    units.push({
      id: curIds[0],
      segmentIds: curIds,
      start: curStart,
      end: curEnd,
    });
  };

  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const seg = segments[i];
    const gap = seg.start - prev.end;
    const prevEndsSentence = TERMINAL_PUNCT.test(prev.edited_text);
    const tooBig =
      curIds.length >= MAX_UNIT_SEGMENTS ||
      curChars + seg.edited_text.length > MAX_UNIT_CHARS;
    if (prevEndsSentence || gap >= MAX_GAP_S || tooBig) {
      flush();
      curIds = [seg.id];
      curStart = seg.start;
      curEnd = seg.end;
      curChars = seg.edited_text.length;
    } else {
      curIds.push(seg.id);
      curEnd = seg.end;
      curChars += seg.edited_text.length;
    }
  }
  flush();
  return units;
}

/** Map segment id -> index in units[] for O(1) lookup. */
export function unitIndexBySegmentId(units: Unit[]): Map<number, number> {
  const m = new Map<number, number>();
  units.forEach((u, idx) => u.segmentIds.forEach((id) => m.set(id, idx)));
  return m;
}
