// Label-aware OCR parsing. Prefers explicit MODEL/SERIAL labeling; never lets
// a longer serial replace the model. OCR confusion (O/0, I/1) stays ambiguous.
export interface ParsedLabel {
  modelRaw: string | null;
  serial: string | null;
  ambiguous: boolean;
  basis: string;
}

const TOKEN = "[A-Z0-9][A-Z0-9.\\-/]{2,31}";

function findLabeled(text: string, labels: string[]): string | null {
  for (const lab of labels) {
    const re = new RegExp(`${lab}\\s*[:#]?\\s*(${TOKEN})`, "i");
    const m = text.match(re);
    if (m && /\d/.test(m[1])) return m[1].trim();
  }
  return null;
}

export function parseLabelText(rawText: string): ParsedLabel {
  const text = rawText.replace(/\s+/g, " ").trim();
  // 1. Explicitly labeled model.
  const labeledModel = findLabeled(text, ["MODEL(?:\\s+NO)?", "MOD", "MODEL"]);
  // 2. Explicitly labeled serial (kept separate, never a model candidate).
  const serial = findLabeled(text, ["SERIAL(?:\\s+NO)?", "SER", "S\\/N", "SN"]);
  if (labeledModel) {
    return {
      modelRaw: labeledModel,
      serial,
      ambiguous: /[O0Il1]/.test(labeledModel),
      basis: "labeled model field",
    };
  }
  // 3. Fallback: longest digit-bearing token OUTSIDE serial-labeled spans.
  const scrubbed = text
    .replace(/SERIAL(?:\s+NO)?\s*[:#]?\s*[A-Z0-9.\-/]+/gi, " ")
    .replace(/S\/N\s*[:#]?\s*[A-Z0-9.\-/]+/gi, " ")
    .replace(/\bSN\s*[:#]?\s*[A-Z0-9.\-/]+/gi, " ");
  const tokens = scrubbed.match(new RegExp(TOKEN, "g")) ?? [];
  const withDigit = tokens.filter((t) => /\d/.test(t));
  withDigit.sort((a, b) => b.length - a.length);
  const modelRaw = withDigit[0]?.trim() ?? null;
  return {
    modelRaw,
    serial,
    ambiguous: modelRaw ? /[O0Il1]/.test(modelRaw) : false,
    basis: modelRaw ? "unlabeled longest token (confirm with customer)" : "no candidate",
  };
}
