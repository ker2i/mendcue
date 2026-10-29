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
      ambiguous: /[?\[\]]/.test(labeledModel) || /(?:unclear|unreadable|ambiguous)/i.test(text),
      basis: "labeled model field",
    };
  }
  return { modelRaw: null, serial, ambiguous: false, basis: "no explicitly labeled model" };
}
