export type RawSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
  compression_ratio?: number;
  temperature?: number;
};

export type EditedSegment = {
  id: number;
  start: number;
  end: number;
  original_text: string;
  edited_text: string;
  translation: string;
};

export type EditsPayload = {
  episode: string;
  updated_at: string;
  segments: EditedSegment[];
};

export type TranscriptResponse = {
  episode: string;
  raw: {
    info?: Record<string, unknown>;
    extra?: Record<string, unknown>;
    segments: RawSegment[];
  };
  edits: EditsPayload | null;
};
