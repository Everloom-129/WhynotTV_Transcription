import type { EditsPayload, TranscriptResponse } from "../types";

export async function loadTranscript(episode: string): Promise<TranscriptResponse> {
  const r = await fetch(`/api/transcript?episode=${encodeURIComponent(episode)}`);
  if (!r.ok) throw new Error(`load failed: ${r.status}`);
  return r.json();
}

export async function saveEdits(
  episode: string,
  payload: EditsPayload,
): Promise<void> {
  const r = await fetch("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ episode, payload }),
  });
  if (!r.ok) throw new Error(`save failed: ${r.status}`);
}
