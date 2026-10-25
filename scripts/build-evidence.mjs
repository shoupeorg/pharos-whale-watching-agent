import { readFile, writeFile, mkdir } from "node:fs/promises";
import { normalizeTransfer, buildReport, reportCsv } from "../src/engine.js";

const raw = JSON.parse(await readFile(new URL("../evidence/v1-live-raw.json", import.meta.url), "utf8"));
const token = raw.config.tokens[0];
const events = raw.logs.map((log) => normalizeTransfer(log, token));
const report = buildReport({
  events,
  config: raw.config,
  reportId: "v1-live-usdc-watch-desk",
  createdAt: raw.capturedAt,
  coverage: { status: raw.provenance.coverage, requestedFromBlock: raw.provenance.requestedRange.fromBlock, requestedToBlock: raw.provenance.requestedRange.toBlock, coveredFromBlock: raw.provenance.requestedRange.fromBlock, coveredToBlock: raw.provenance.requestedRange.toBlock, transport: raw.provenance.source, confirmationDelayBlocks: 0, historicalSavedEvidence: true }
});
const evidenceDir = new URL("../evidence/", import.meta.url);
const publicDir = new URL("../public/evidence/", import.meta.url);
await mkdir(publicDir, { recursive: true });
await writeFile(new URL("v1-live-report.json", evidenceDir), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL("v1-live-report.csv", evidenceDir), `${reportCsv(report)}\n`);
await writeFile(new URL("v1-live-report.json", publicDir), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL("v1-live-raw.json", publicDir), `${JSON.stringify(raw, null, 2)}\n`);
await writeFile(new URL("mcp-discovery-v1.json", publicDir), `${JSON.stringify(JSON.parse(await readFile(new URL("../evidence/mcp-discovery-v1.json", import.meta.url), "utf8")), null, 2)}\n`);
console.log(JSON.stringify({ reportId: report.id, uniqueEvents: report.summary.uniqueEvents, significant: report.summary.significantEvents, belowThreshold: report.summary.belowThresholdEvents, internalRaw: report.summary.tokens[token.address].internalRaw }));
