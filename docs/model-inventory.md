# Runtime model inventory — 2026-10-29

Only the server-side Meta adapter calls a model: Standard `muse-spark-1.3`
at `https://api.meta.ai/v1/chat/completions`. It handles fact extraction,
label-image transcription (when billing has been reviewed), and draft assessment.
The adapter rejects other model IDs and endpoints until explicitly reviewed.
No model-based embeddings, reranker, speech, OCR fallback or other provider is used.
Development fixtures and deterministic rules are labeled and are not live inference.
Poppler PDF text extraction is a local program, not model inference.

Live access was not exercised: no local `MODEL_API_KEY` is configured.
Configured live mode is not proof of successful inference. The ledger tracks HTTP
request completion and usage; runtime schemas separately reject malformed/refused
outputs. A successful HTTP response does not establish a valid or accurate brief.
Model-specific diagnosis prose is reduced to general issue areas pending a reviewed
semantic claim catalog. No exact failed parts, costs or probabilities are shown.

Pricing checked against [Meta pricing](https://dev.meta.ai/docs/pricing-rate-limits).
The [official event page](https://dev.meta.ai/events/global-hackathon) still lists
November 4, 2026 at 9 p.m. Eastern as the submission deadline. Portal-specific
video length and required submission fields remain unverified.
