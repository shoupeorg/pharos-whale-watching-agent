import { buildReport, nextScanRange, reportCsv, validateConfig } from "./engine.js";
import { scanRange, rpc } from "./rpc.js";
import { exampleConfig } from "./example.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const workspaceId = (request) => {
  const id = request.headers.get("x-watch-workspace") || "";
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(id)) throw new Error("A valid isolated workspace ID is required.");
  return id;
};
const now = () => new Date().toISOString();

async function ensureWorkspace(env, id) {
  let row = await env.DB.prepare("SELECT * FROM workspaces WHERE id=?").bind(id).first();
  if (!row) {
    const stamp = now();
    await env.DB.prepare("INSERT OR IGNORE INTO workspaces(id,config_json,created_at,updated_at) VALUES(?,?,?,?)").bind(id, JSON.stringify(exampleConfig), stamp, stamp).run();
    row = await env.DB.prepare("SELECT * FROM workspaces WHERE id=?").bind(id).first();
  }
  return row;
}

async function state(env, id) {
  const row = await ensureWorkspace(env, id);
  const observations = (await env.DB.prepare("SELECT event_json FROM observations WHERE workspace_id=? ORDER BY block_number DESC LIMIT 500").bind(id).all()).results.map((item) => JSON.parse(item.event_json));
  const report = await env.DB.prepare("SELECT report_json FROM reports WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1").bind(id).first();
  return { config: JSON.parse(row.config_json), cursorBlock: row.cursor_block, monitoring: Boolean(row.monitoring), lastScanAt: row.last_scan_at, lastSuccessAt: row.last_success_at, lastError: row.last_error, observations, report: report ? JSON.parse(report.report_json) : null };
}

async function saveConfig(request, env, id) {
  const body = await request.json();
  const config = validateConfig(body);
  const stamp = now();
  const row = await ensureWorkspace(env, id);
  const previous = validateConfig(JSON.parse(row.config_json));
  const tokenSet = (value) => value.tokens.map((item) => item.address).sort().join(",");
  const tokenSetChanged = tokenSet(previous) !== tokenSet(config);
  const observations = (await env.DB.prepare("SELECT event_json FROM observations WHERE workspace_id=? ORDER BY block_number DESC LIMIT 2000").bind(id).all()).results.map((item) => JSON.parse(item.event_json));
  const prior = await env.DB.prepare("SELECT report_json FROM reports WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1").bind(id).first();
  const priorReport = prior ? JSON.parse(prior.report_json) : null;
  const coverage = {
    ...(priorReport?.coverage || {}),
    status: "PARTIAL",
    derivedAt: stamp,
    note: "Configuration changed. Stored immutable observations were reevaluated; run a fresh scan for complete changed-configuration coverage."
  };
  const report = buildReport({ events: observations, config, coverage, createdAt: stamp });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO reports(id,workspace_id,report_json,created_at) VALUES(?,?,?,?)").bind(report.id, id, JSON.stringify(report), stamp),
    env.DB.prepare("UPDATE workspaces SET config_json=?,cursor_block=?,updated_at=? WHERE id=?").bind(JSON.stringify(config), tokenSetChanged ? null : row.cursor_block, stamp, id)
  ]);
  return json({ ok: true, config, report, note: "Configuration saved. Existing immutable observations were reevaluated immediately; fresh-scan coverage remains required." });
}

async function scan(env, id) {
  const row = await ensureWorkspace(env, id);
  if (row.last_scan_at && Date.now() - Date.parse(row.last_scan_at) < 4000) return json({ error: "Scan rate limit: wait four seconds." }, 429);
  const locked = await env.DB.prepare("UPDATE workspaces SET scan_lock=1 WHERE id=? AND scan_lock=0").bind(id).run();
  if (!locked.meta?.changes) return json({ error: "A scan is already running for this workspace." }, 409);
  const startedAt = now();
  try {
    const config = validateConfig(JSON.parse(row.config_json));
    const head = Number(BigInt(await rpc(env.RPC_URL, "eth_blockNumber")));
    const confirmations = Number(env.CONFIRMATIONS || 12);
    const finalizedHead = Math.max(0, head - confirmations);
    const maxBlocks = Math.min(500, Number(env.MAX_BLOCKS_PER_SCAN || 500));
    const range = nextScanRange(row.cursor_block == null ? null : Number(row.cursor_block), finalizedHead, maxBlocks);
    if (!range) {
      await env.DB.prepare("UPDATE workspaces SET last_scan_at=?,last_success_at=?,last_error=NULL,scan_lock=0 WHERE id=?").bind(startedAt, startedAt, id).run();
      return json({ ok: true, message: "No newly confirmed blocks.", ...(await state(env, id)) });
    }
    const { fromBlock, toBlock } = range;
    const scanned = await scanRange({ url: env.RPC_URL, config, fromBlock, toBlock });
    const observedAt = now();
    const statements = scanned.events.map((event) => env.DB.prepare("INSERT OR IGNORE INTO observations(workspace_id,event_id,event_json,block_number,observed_at) VALUES(?,?,?,?,?)").bind(id, event.id, JSON.stringify(event), event.blockNumber, observedAt));
    if (statements.length) await env.DB.batch(statements);
    const all = (await env.DB.prepare("SELECT event_json FROM observations WHERE workspace_id=? ORDER BY block_number DESC LIMIT 2000").bind(id).all()).results.map((item) => JSON.parse(item.event_json));
    const coverage = { status: "COMPLETE", requestedFromBlock: fromBlock, requestedToBlock: toBlock, coveredFromBlock: fromBlock, coveredToBlock: toBlock, confirmationDelayBlocks: confirmations, headAtScan: head, finalizedThrough: finalizedHead, lastSuccessfulScan: observedAt, transport: "Pharos Pacific JSON-RPC eth_getLogs", limitation: "Coverage is complete only for this bounded scan range and configured tokens." };
    const report = buildReport({ events: all, config: scanned.config, coverage });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO reports(id,workspace_id,report_json,created_at) VALUES(?,?,?,?)").bind(report.id, id, JSON.stringify(report), observedAt),
      env.DB.prepare("UPDATE workspaces SET config_json=?,cursor_block=?,last_scan_at=?,last_success_at=?,last_error=NULL,scan_lock=0,updated_at=? WHERE id=?").bind(JSON.stringify(scanned.config), toBlock, startedAt, observedAt, observedAt, id)
    ]);
    return json({ ok: true, report, insertedCandidates: scanned.events.length });
  } catch (error) {
    await env.DB.prepare("UPDATE workspaces SET last_scan_at=?,last_error=?,scan_lock=0 WHERE id=?").bind(startedAt, String(error.message).slice(0, 500), id).run();
    return json({ error: error.message, coverage: "PARTIAL", cursorAdvanced: false }, 502);
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  try {
    if (url.pathname === "/api/meta") return json({ engineVersion: env.ENGINE_VERSION, chainId: Number(env.CHAIN_ID), runtimeTransport: "Pharos Pacific JSON-RPC", transferRangeLimit: 1000, scanBatch: Number(env.MAX_BLOCKS_PER_SCAN), confirmationDelay: Number(env.CONFIRMATIONS), explorer: "https://pharosscan.xyz/tx/" });
    const id = workspaceId(request);
    if (url.pathname === "/api/state" && request.method === "GET") return json(await state(env, id));
    if (url.pathname === "/api/example" && request.method === "POST") { await ensureWorkspace(env, id); await env.DB.prepare("UPDATE workspaces SET config_json=?,cursor_block=NULL,updated_at=? WHERE id=?").bind(JSON.stringify(exampleConfig), now(), id).run(); return json({ ok: true, config: exampleConfig }); }
    if (url.pathname === "/api/config" && request.method === "PUT") return saveConfig(request, env, id);
    if (url.pathname === "/api/scan" && request.method === "POST") return scan(env, id);
    if (url.pathname === "/api/monitor/start" && request.method === "POST") { await ensureWorkspace(env, id); await env.DB.prepare("UPDATE workspaces SET monitoring=1,updated_at=? WHERE id=?").bind(now(), id).run(); return json({ ok: true, monitoring: true, intervalSeconds: 15, scheduler: "reviewer-browser polling; durable state survives refresh" }); }
    if (url.pathname === "/api/monitor/stop" && request.method === "POST") { await ensureWorkspace(env, id); await env.DB.prepare("UPDATE workspaces SET monitoring=0,updated_at=? WHERE id=?").bind(now(), id).run(); return json({ ok: true, monitoring: false }); }
    if (url.pathname === "/api/export/json" && request.method === "GET") { const s = await state(env, id); if (!s.report) return json({ error: "No report available." }, 404); return new Response(JSON.stringify(s.report, null, 2), { headers: { "content-type": "application/json", "content-disposition": "attachment; filename=whale-watch-report.json" } }); }
    if (url.pathname === "/api/export/csv" && request.method === "GET") { const s = await state(env, id); if (!s.report) return json({ error: "No report available." }, 404); return new Response(reportCsv(s.report), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=whale-watch-report.csv" } }); }
    return json({ error: "Not found." }, 404);
  } catch (error) { return json({ error: error.message }, 400); }
}

export default { fetch: route };
export { route };
