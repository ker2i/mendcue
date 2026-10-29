// Mock business-system receiver: verifies signed webhooks, fetches the handoff.
// Run: node examples/integration/receiver.mjs  (then point a webhook endpoint at it)
import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";

const SECRET = process.env.WEBHOOK_SECRET || "demo_webhook_secret";
const API = process.env.API_BASE || "http://localhost:3000/api/v1";
const SERVICE_KEY = process.env.SERVICE_KEY || "sk_demo_phoenix_001_SECRET";

function verify(ts, body, sig) {
  const expected = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  const a = Buffer.from(`sha256=${expected}`);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

const seen = new Set(); // idempotent receiver: dedupe by event_id
const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") { res.writeHead(404); res.end(); return; }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const sig = req.headers["x-intake-signature"] || "";
  const ts = req.headers["x-intake-timestamp"] || "";
  if (!verify(ts, raw, sig)) { res.writeHead(401); res.end("bad signature"); return; }
  const event = JSON.parse(raw);
  if (seen.has(event.event_id)) { res.writeHead(200); res.end("duplicate-ok"); return; }
  seen.add(event.event_id);
  console.log("event:", event.event_type, event.case_id, "seq", event.seq);
  const h = await fetch(`${API}/integration/cases/${event.case_id}/handoff`, {
    headers: { authorization: `Bearer ${SERVICE_KEY}` },
  });
  console.log("handoff fetch:", h.status);
  if (h.ok) {
    const j = await h.json();
    console.log("reference:", j.reference, "version:", j.version);
  }
  res.writeHead(200);
  res.end("ok");
});

server.listen(4100, () => console.log("Mock receiver on http://localhost:4100 — secret:", SECRET));
