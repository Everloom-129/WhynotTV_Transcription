import Anthropic from "@anthropic-ai/sdk";

const KEY_STORAGE = "anthropic_api_key";
const MODEL = "claude-opus-4-7";

export function getApiKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}
export function setApiKey(k: string) {
  localStorage.setItem(KEY_STORAGE, k);
}
export function clearApiKey() {
  localStorage.removeItem(KEY_STORAGE);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const key = getApiKey();
  if (!key) throw new Error("No Anthropic API key set");
  if (!client || (client as unknown as { apiKey: string }).apiKey !== key) {
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  }
  return client;
}

const SYSTEM_PROMPT = `You translate Chinese podcast transcripts to natural English.

Rules:
- The source is faithful spoken Chinese with English code-switching preserved verbatim.
- You will receive 1+ fragments that ASR (Whisper + VAD) split at ACOUSTIC boundaries — pauses, breaths — not at sentence boundaries. They form ONE continuous thought. Translate them so that joining the English fragments with single spaces produces ONE natural English sentence/thought.
- Output EXACTLY the same number of fragments as the input, aligned 1:1 with the Chinese. Each English fragment corresponds to its Chinese fragment.
- Keep English fragments from the source verbatim (e.g., "behavior cloning", "robot learning", "exactly", proper nouns).
- Preserve speaker register: casual technical conversation, not formal writing.
- Do NOT add information that isn't in the source. Do NOT explain terms.
- For filler ("对" / "嗯" / "对对对"), translate naturally ("Right." / "Yeah." / "Right, right.").
- If a fragment is genuinely standalone (full sentence on its own), translate it as a standalone sentence.`;

const TRANSLATION_TOOL: Anthropic.Tool = {
  name: "emit_translation",
  description:
    "Emit the English translation aligned 1:1 to input fragments. lines.length MUST equal the number of input fragments.",
  input_schema: {
    type: "object" as const,
    properties: {
      lines: {
        type: "array",
        items: { type: "string" },
        description:
          "English translation of each input fragment, in the same order.",
      },
    },
    required: ["lines"],
  },
};

export type TranslateContext = { text: string; translation?: string };

export type TranslateOptions = {
  /** Preceding sentence-unit(s), if any, for pronoun/topic resolution. */
  context?: TranslateContext[];
};

export async function translateUnit(
  fragments: string[],
  opts: TranslateOptions = {},
): Promise<string[]> {
  if (fragments.length === 0) return [];

  const ctxBlock =
    opts.context && opts.context.length > 0
      ? `Preceding context (already translated, do NOT re-translate, only use for pronoun / topic resolution):\n${opts.context
          .map(
            (c, i) =>
              `[ctx${i + 1}] zh: ${c.text}${
                c.translation ? `\n[ctx${i + 1}] en: ${c.translation}` : ""
              }`,
          )
          .join("\n")}\n\n`
      : "";

  const numbered = fragments.map((f, i) => `[${i + 1}] ${f}`).join("\n");
  const userMessage = `${ctxBlock}Translate the following ${fragments.length} fragment(s). They form one continuous thought split by ASR. Return EXACTLY ${fragments.length} English fragments via the emit_translation tool, aligned 1:1 with the input.

Fragments:
${numbered}`;

  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [TRANSLATION_TOOL],
    tool_choice: { type: "tool", name: "emit_translation" },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = resp.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not call the emit_translation tool");
  }
  const input = toolUse.input as { lines?: unknown };
  if (!Array.isArray(input.lines)) {
    throw new Error("emit_translation: lines is not an array");
  }
  const lines = input.lines.map((l) => String(l ?? "").trim());
  if (lines.length !== fragments.length) {
    throw new Error(
      `emit_translation: got ${lines.length} lines, expected ${fragments.length}`,
    );
  }
  return lines;
}
