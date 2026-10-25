// Small read-only ElevenLabs probe helper. Key comes from env only.
// Usage: node el_probe.mjs GET /v1/user/subscription
//        node el_probe.mjs POST /v1/... '{"json":1}' [outfile]
import { writeFileSync } from 'node:fs';
const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('ELEVENLABS_API_KEY missing'); process.exit(2); }
const [method, path, body, out] = process.argv.slice(2);
const res = await fetch('https://api.elevenlabs.io' + path, {
  method, headers: { 'xi-api-key': key, 'content-type': 'application/json' },
  body: body ? body : undefined,
});
const ct = res.headers.get('content-type') || '';
console.error('status', res.status, ct);
if (ct.includes('json') || ct.includes('text')) {
  const t = await res.text();
  if (out) writeFileSync(out, t); else console.log(t);
} else {
  const b = Buffer.from(await res.arrayBuffer());
  if (out) { writeFileSync(out, b); console.error('wrote', out, b.length); }
}
