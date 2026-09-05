#!/usr/bin/env node
// spec-77/spec-79 Fase 5 — a standalone DispatchTrack API mock, QA-only.
//
// QA's frontend was pointed, until this file existed, at
// `DEFAULT_DT_BASE_URL` (`https://transportesmusan.dispatchtrack.com`) with
// a genuine `DISPATCHTRACK_API_KEY` for the real Musan tenant and NO
// `DISPATCHTRACK_BASE_URL` override — meaning any dispatch actually
// triggered in QA (manual or automated) hit production DispatchTrack. This
// server exists so `/home/aureon/.env.qa` can set `DISPATCHTRACK_BASE_URL`
// to `http://127.0.0.1:<port>` instead, and QA never talks to the real
// tenant again — not just during this spec's own E2E run.
//
// Bound to 127.0.0.1 only (see the systemd unit next to this file) — never
// proxied through nginx, never reachable off the VPS. No external
// dependencies: plain Node `http`, so `node server.mjs` is the entire
// install step.
//
// Implements exactly the two DT endpoints `dispatchtrack-api.ts`/
// `dt-list-routes.ts` call, plus a `/__test__/*` control surface the E2E
// harness (same machine, same localhost) uses to assert how many times a
// route was actually created — the whole point of the "does a retry create
// a SECOND route" assertion (spec-77 item 22).
import http from 'node:http';

const PORT = Number(process.env.DT_MOCK_PORT || 4477);

/** @type {Array<{ id: number, isoDate: string, truckIdentifier: string, identifiers: string[], createdAt: string }>} */
const createdRoutes = [];
let nextRouteId = 90000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

/** `dd-mm-yyyy` (Create Route) -> `yyyy-mm-dd` (List Routes) — same trap
 *  Fase 0 documents on the real API; this mock normalises so `date=`
 *  matching works regardless of which format a caller used. */
function toIso(dmyOrIso) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dmyOrIso)) return dmyOrIso;
  const [dd, mm, yyyy] = dmyOrIso.split('-');
  return `${yyyy}-${mm}-${dd}`;
}

/** Any truck_identifier containing this marker is a deliberate rejection —
 *  spec-77 item 22's first path (DT rejects). Never a hidden default: a
 *  request must opt in explicitly, same double-gate spirit as the app-side
 *  `dispatch-test-hooks.ts`. */
const REJECT_MARKER = 'DT-REJECT';

async function handleCreateRoute(req, res) {
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { status: 'error', response: 'invalid JSON body' });
    return;
  }

  const truckIdentifier = String(parsed.truck_identifier ?? '');
  const identifiers = Array.isArray(parsed.dispatches)
    ? parsed.dispatches.map((d) => String(d.identifier))
    : [];

  if (truckIdentifier.includes(REJECT_MARKER)) {
    sendJson(res, 422, { status: 'error', response: 'Simulated rejection (E2E REJECT marker)' });
    return;
  }

  const id = nextRouteId;
  nextRouteId += 1;
  createdRoutes.push({
    id,
    isoDate: toIso(String(parsed.date ?? '')),
    truckIdentifier,
    identifiers,
    createdAt: new Date().toISOString(),
  });
  sendJson(res, 200, { status: 'ok', response: { route_id: id } });
}

function handleListRoutes(req, res, url) {
  const date = url.searchParams.get('date');
  const page = Number(url.searchParams.get('page') || '1');
  const limit = Number(url.searchParams.get('limit') || '10');
  const matches = createdRoutes.filter((r) => r.isoDate === date);
  const start = (page - 1) * limit;
  const pageRoutes = matches.slice(start, start + limit).map((r) => ({
    id: r.id,
    dispatches: r.identifiers.map((identifier) => ({ identifier })),
  }));
  sendJson(res, 200, { status: 'ok', response: { routes: pageRoutes } });
}

/** How many CREATE calls (never rejections) produced a route that carries
 *  this guide identifier — spec-77 item 22's "does not create a second
 *  route" assertion reads this directly. */
function handleCreateCallCount(res, url) {
  const identifier = url.searchParams.get('identifier');
  const count = createdRoutes.filter((r) => r.identifiers.includes(identifier ?? '')).length;
  sendJson(res, 200, { count });
}

function handleReset(res) {
  createdRoutes.length = 0;
  nextRouteId = 90000;
  sendJson(res, 200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'POST' && url.pathname === '/api/external/v1/routes') {
      await handleCreateRoute(req, res);
    } else if (req.method === 'GET' && url.pathname === '/api/external/v1/routes') {
      handleListRoutes(req, res, url);
    } else if (req.method === 'GET' && url.pathname === '/__test__/create-calls') {
      handleCreateCallCount(res, url);
    } else if (req.method === 'POST' && url.pathname === '/__test__/reset') {
      handleReset(res);
    } else if (req.method === 'GET' && url.pathname === '/__test__/health') {
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 404, { status: 'error', response: 'not found (dispatchtrack-mock)' });
    }
  } catch (err) {
    sendJson(res, 500, { status: 'error', response: String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[dispatchtrack-mock] listening on 127.0.0.1:${PORT}`);
});
