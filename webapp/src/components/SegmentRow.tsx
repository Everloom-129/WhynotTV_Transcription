import { memo, useEffect, useRef } from "react";
import type { EditedSegment } from "../types";

function fmtTs(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function useAutoResize(
  ref: React.RefObject<HTMLTextAreaElement>,
  value: string,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    // Add 2px to avoid scrollbar flicker on some fonts.
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
}

type Props = {
  seg: EditedSegment;
  active: boolean;
  inActiveUnit: boolean;
  firstInUnit: boolean;
  lastInUnit: boolean;
  busy: boolean;
  onSeek: (t: number) => void;
  onEdit: (id: number, text: string) => void;
  onEditTranslation: (id: number, text: string) => void;
  onTranslate: (id: number) => void;
};

function SegmentRowImpl({
  seg,
  active,
  inActiveUnit,
  firstInUnit,
  lastInUnit,
  busy,
  onSeek,
  onEdit,
  onEditTranslation,
  onTranslate,
}: Props) {
  const editRef = useRef<HTMLTextAreaElement>(null);
  const transRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(editRef, seg.edited_text);
  useAutoResize(transRef, seg.translation);

  const edited = seg.edited_text !== seg.original_text;
  const className = [
    "segment",
    active && "active",
    inActiveUnit && !active && "in-unit",
    firstInUnit && "first-of-unit",
    lastInUnit && "last-of-unit",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} data-seg-id={seg.id}>
      <button
        className="ts-btn"
        onClick={() => onSeek(seg.start)}
        tabIndex={-1}
        title="Click to seek audio · j / k to navigate"
      >
        {fmtTs(seg.start)}
      </button>
      <textarea
        ref={editRef}
        className={`seg-textarea ${edited ? "edited" : ""}`}
        value={seg.edited_text}
        onChange={(e) => onEdit(seg.id, e.target.value)}
        rows={1}
        spellCheck={false}
      />
      <textarea
        ref={transRef}
        className={`seg-textarea ${seg.translation ? "" : "empty"}`}
        value={seg.translation}
        onChange={(e) => onEditTranslation(seg.id, e.target.value)}
        placeholder={firstInUnit ? "(not translated)" : ""}
        rows={1}
        spellCheck={false}
      />
      <button
        className={`translate-btn ${busy ? "busy" : ""}`}
        disabled={busy}
        onClick={() => onTranslate(seg.id)}
        tabIndex={-1}
        title="Translate this sentence-unit · key: t"
      >
        {busy ? "…" : "EN"}
      </button>
    </div>
  );
}

export default memo(SegmentRowImpl);
