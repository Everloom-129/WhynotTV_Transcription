import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Waveform, { type WaveformHandle } from "./components/Waveform";
import SegmentRow from "./components/SegmentRow";
import {
  getApiKey,
  setApiKey as storeApiKey,
  clearApiKey,
  translateUnit,
  type TranslateContext,
} from "./lib/claude";
import { loadTranscript, saveEdits } from "./lib/persistence";
import { buildUnits, unitIndexBySegmentId } from "./lib/units";
import type { EditedSegment, EditsPayload, RawSegment } from "./types";

const EPISODE = new URLSearchParams(location.search).get("episode") ?? "danfei";
const AUDIO_URL = `/audio/${EPISODE}.wav`;
const SAVE_DEBOUNCE_MS = 800;

type Filter = "all" | "untranslated" | "edited";

function rawToEdited(r: RawSegment): EditedSegment {
  const t = r.text.trim();
  return {
    id: r.id,
    start: r.start,
    end: r.end,
    original_text: t,
    edited_text: t,
    translation: "",
  };
}

function mergeEdits(
  raw: RawSegment[],
  edits: EditsPayload | null,
): EditedSegment[] {
  if (!edits) return raw.map(rawToEdited);
  const byId = new Map(edits.segments.map((s) => [s.id, s]));
  return raw.map((r) => {
    const e = byId.get(r.id);
    if (!e) return rawToEdited(r);
    return {
      id: r.id,
      start: r.start,
      end: r.end,
      original_text: r.text.trim(),
      edited_text: e.edited_text ?? r.text.trim(),
      translation: e.translation ?? "",
    };
  });
}

export default function App() {
  const [segments, setSegments] = useState<EditedSegment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [busyUnitIds, setBusyUnitIds] = useState<Set<number>>(new Set());
  const [saveState, setSaveState] = useState<
    "clean" | "dirty" | "saving" | "error"
  >("clean");
  const [apiKeyPresent, setApiKeyPresent] = useState<boolean>(!!getApiKey());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const bulkCancelRef = useRef(false);

  const waveRef = useRef<WaveformHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<number | null>(null);

  const segmentsRef = useRef<EditedSegment[]>([]);
  segmentsRef.current = segments;
  const currentIdRef = useRef<number | null>(null);
  currentIdRef.current = currentId;

  // Units derived from segments. Recomputed when segment text changes (because
  // sentence boundaries depend on punctuation, which the user can edit).
  const units = useMemo(() => buildUnits(segments), [segments]);
  const segIdToUnitIdx = useMemo(() => unitIndexBySegmentId(units), [units]);
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const segIdToUnitIdxRef = useRef(segIdToUnitIdx);
  segIdToUnitIdxRef.current = segIdToUnitIdx;

  // --- Load on mount -----------------------------------------------------
  useEffect(() => {
    (async () => {
      const t = await loadTranscript(EPISODE);
      setSegments(mergeEdits(t.raw.segments, t.edits));
      setLoaded(true);
    })().catch((e) => {
      console.error(e);
      alert(`Failed to load transcript: ${e.message}`);
    });
  }, []);

  // --- Debounced save ----------------------------------------------------
  const scheduleSave = useCallback(() => {
    setSaveState("dirty");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const payload: EditsPayload = {
          episode: EPISODE,
          updated_at: new Date().toISOString(),
          segments: segmentsRef.current,
        };
        await saveEdits(EPISODE, payload);
        setSaveState("clean");
      } catch (e) {
        console.error(e);
        setSaveState("error");
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // --- Edit handlers -----------------------------------------------------
  const onEdit = useCallback(
    (id: number, text: string) => {
      setSegments((prev) =>
        prev.map((s) => (s.id === id ? { ...s, edited_text: text } : s)),
      );
      scheduleSave();
    },
    [scheduleSave],
  );

  const onEditTranslation = useCallback(
    (id: number, text: string) => {
      setSegments((prev) =>
        prev.map((s) => (s.id === id ? { ...s, translation: text } : s)),
      );
      scheduleSave();
    },
    [scheduleSave],
  );

  // --- Translate a sentence unit ----------------------------------------
  // Argument is any segment in the unit; we resolve the unit and translate
  // every fragment in it, then write all returned lines back at once.
  const onTranslate = useCallback(
    async (segId: number) => {
      if (!getApiKey()) {
        alert("Set your Anthropic API key first (button in the top bar).");
        return;
      }
      const segs = segmentsRef.current;
      const unitIdx = segIdToUnitIdxRef.current.get(segId);
      if (unitIdx == null) return;
      const u = unitsRef.current[unitIdx];
      const unitSegs = u.segmentIds
        .map((id) => segs.find((s) => s.id === id))
        .filter((s): s is EditedSegment => !!s);

      // Preceding unit as context (zh + en if available).
      const ctx: TranslateContext[] = [];
      if (unitIdx > 0) {
        const prevU = unitsRef.current[unitIdx - 1];
        const prevSegs = prevU.segmentIds
          .map((id) => segs.find((s) => s.id === id))
          .filter((s): s is EditedSegment => !!s);
        const zh = prevSegs.map((s) => s.edited_text).join(" ");
        const en = prevSegs
          .map((s) => s.translation)
          .filter(Boolean)
          .join(" ");
        ctx.push({ text: zh, translation: en || undefined });
      }

      setBusyUnitIds((prev) => new Set(prev).add(u.id));
      try {
        const fragments = unitSegs.map((s) => s.edited_text);
        const out = await translateUnit(fragments, { context: ctx });
        setSegments((prev) => {
          const next = [...prev];
          unitSegs.forEach((s, i) => {
            const idx = next.findIndex((x) => x.id === s.id);
            if (idx >= 0) next[idx] = { ...next[idx], translation: out[i] ?? "" };
          });
          return next;
        });
        scheduleSave();
      } catch (e) {
        console.error(e);
        alert(`Translation failed: ${(e as Error).message}`);
      } finally {
        setBusyUnitIds((prev) => {
          const n = new Set(prev);
          n.delete(u.id);
          return n;
        });
      }
    },
    [scheduleSave],
  );

  // --- Seek + audio-driven current segment ------------------------------
  const onSeek = useCallback((t: number) => {
    waveRef.current?.seek(t);
    waveRef.current?.play();
  }, []);

  const handleTime = useCallback((t: number) => {
    const segs = segmentsRef.current;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].start <= t && t < segs[i].end) {
        setCurrentId((prev) => (prev === segs[i].id ? prev : segs[i].id));
        return;
      }
    }
  }, []);

  // Scroll current segment into view.
  useEffect(() => {
    if (currentId == null) return;
    const el = document.querySelector(`[data-seg-id="${currentId}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < 160 || rect.bottom > window.innerHeight - 40) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentId]);

  // --- Keyboard shortcuts ------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inText = tag === "TEXTAREA" || tag === "INPUT";

      // Esc: blur whatever is focused.
      if (e.key === "Escape" && inText) {
        (e.target as HTMLElement).blur();
        return;
      }

      if (!inText) {
        if (e.key === "/") {
          e.preventDefault();
          searchRef.current?.focus();
          return;
        }
        if (e.code === "Space") {
          e.preventDefault();
          waveRef.current?.toggle();
          return;
        }
        if (
          e.key === "j" ||
          e.key === "ArrowDown" ||
          e.key === "k" ||
          e.key === "ArrowUp"
        ) {
          e.preventDefault();
          const dir = e.key === "j" || e.key === "ArrowDown" ? 1 : -1;
          const segs = segmentsRef.current;
          if (segs.length === 0) return;
          const i = segs.findIndex((s) => s.id === currentIdRef.current);
          const ni = i < 0 ? 0 : Math.max(0, Math.min(segs.length - 1, i + dir));
          const next = segs[ni];
          setCurrentId(next.id);
          waveRef.current?.seek(next.start);
          return;
        }
        if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          const id = currentIdRef.current;
          if (id != null) onTranslate(id);
          return;
        }
      } else {
        // In a textarea/input
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          const segs = segmentsRef.current;
          const i = segs.findIndex((s) => s.id === currentIdRef.current);
          const ni = i >= 0 ? Math.min(segs.length - 1, i + 1) : 0;
          const next = segs[ni];
          if (next) {
            setCurrentId(next.id);
            waveRef.current?.seek(next.start);
            (e.target as HTMLElement).blur();
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTranslate]);

  // --- Bulk translate (unit by unit) ------------------------------------
  const onTranslateAll = async () => {
    if (!getApiKey()) {
      alert("Set your Anthropic API key first.");
      return;
    }
    const segs = segmentsRef.current;
    const remaining = unitsRef.current.filter((u) =>
      u.segmentIds.some((id) => {
        const s = segs.find((x) => x.id === id);
        return s && !s.translation;
      }),
    );
    if (remaining.length === 0) {
      alert("Nothing to translate.");
      return;
    }
    if (
      !window.confirm(
        `Translate ${remaining.length} sentence units sequentially? (≈${remaining.length} API calls)`,
      )
    )
      return;
    bulkCancelRef.current = false;
    setBulkProgress({ done: 0, total: remaining.length });
    try {
      for (let i = 0; i < remaining.length; i++) {
        if (bulkCancelRef.current) break;
        await onTranslate(remaining[i].segmentIds[0]);
        setBulkProgress({ done: i + 1, total: remaining.length });
      }
    } finally {
      setBulkProgress(null);
    }
  };

  const onCancelBulk = () => {
    bulkCancelRef.current = true;
  };

  // --- API key controls --------------------------------------------------
  const onSetKey = () => {
    const cur = getApiKey() ?? "";
    const k = window.prompt("Paste Anthropic API key (sk-ant-...)", cur);
    if (k && k.trim()) {
      storeApiKey(k.trim());
      setApiKeyPresent(true);
    }
  };
  const onClearKey = () => {
    clearApiKey();
    setApiKeyPresent(false);
  };

  // --- Filtered list ----------------------------------------------------
  const visibleSegments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return segments.filter((s) => {
      if (filter === "untranslated" && s.translation) return false;
      if (filter === "edited" && s.edited_text === s.original_text) return false;
      if (
        q &&
        !s.edited_text.toLowerCase().includes(q) &&
        !s.translation.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [segments, search, filter]);

  const editedCount = useMemo(
    () => segments.filter((s) => s.edited_text !== s.original_text).length,
    [segments],
  );
  const translatedCount = useMemo(
    () => segments.filter((s) => s.translation).length,
    [segments],
  );

  const activeUnitIdx =
    currentId != null ? segIdToUnitIdx.get(currentId) ?? -1 : -1;

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-row">
          <h1>{EPISODE}</h1>
          <span className="muted">
            {segments.length} segs · {units.length} units · {editedCount}{" "}
            edited · {translatedCount} translated
          </span>
          <span className={`save-state ${saveState}`}>
            {saveState === "clean" && "saved"}
            {saveState === "dirty" && "editing…"}
            {saveState === "saving" && "saving…"}
            {saveState === "error" && "save failed"}
          </span>
          <div style={{ flex: 1 }} />
          {apiKeyPresent ? (
            <>
              <button className="btn" onClick={onSetKey} title="Replace API key">
                API key ✓
              </button>
              <button className="btn" onClick={onClearKey}>
                Clear
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={onSetKey}>
              Set API key
            </button>
          )}
          {bulkProgress ? (
            <>
              <span className="muted">
                Translating {bulkProgress.done}/{bulkProgress.total}…
              </span>
              <button className="btn" onClick={onCancelBulk}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn"
              onClick={onTranslateAll}
              disabled={!apiKeyPresent}
            >
              Translate all
            </button>
          )}
        </div>
        <div className="topbar-row">
          <input
            ref={searchRef}
            className="search"
            placeholder="Search zh + en …  (press /)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="btn select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">All rows</option>
            <option value="untranslated">Untranslated only</option>
            <option value="edited">Edited only</option>
          </select>
          {visibleSegments.length !== segments.length && (
            <span className="muted">
              {visibleSegments.length} / {segments.length} visible
            </span>
          )}
          <div style={{ flex: 1 }} />
          <span className="muted hotkeys">
            j/k · space · t · / · ⌘↵
          </span>
        </div>
        <Waveform ref={waveRef} audioUrl={AUDIO_URL} onTimeUpdate={handleTime} />
      </div>

      <div className="segments">
        {!loaded && <div className="muted">Loading transcript…</div>}
        {visibleSegments.map((s) => {
          const uIdx = segIdToUnitIdx.get(s.id)!;
          const u = units[uIdx];
          const firstInUnit = u.segmentIds[0] === s.id;
          const lastInUnit = u.segmentIds[u.segmentIds.length - 1] === s.id;
          return (
            <SegmentRow
              key={s.id}
              seg={s}
              active={currentId === s.id}
              inActiveUnit={uIdx === activeUnitIdx}
              firstInUnit={firstInUnit}
              lastInUnit={lastInUnit}
              busy={busyUnitIds.has(u.id)}
              onSeek={onSeek}
              onEdit={onEdit}
              onEditTranslation={onEditTranslation}
              onTranslate={onTranslate}
            />
          );
        })}
      </div>
    </div>
  );
}
