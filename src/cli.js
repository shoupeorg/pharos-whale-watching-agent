import { readFile } from "node:fs/promises";
import { buildReport, normalizeTransfer, reportCsv } from "./engine.js";

const path = process.argv[2];
if (!path) throw new Error("Usage: npm run cli -- evidence/v1-live-raw.json [--csv]");
const raw = JSON.parse(await readFile(path,"utf8"));
const tokens = new Map(raw.config.tokens.map((item)=>[item.address.toLowerCase(),item]));
const events = raw.logs.map((log)=>normalizeTransfer(log,tokens.get(log.address.toLowerCase())));
const report = buildReport({events,config:raw.config,coverage:{status:raw.provenance.coverage,requestedFromBlock:raw.provenance.requestedRange.fromBlock,requestedToBlock:raw.provenance.requestedRange.toBlock,coveredFromBlock:raw.provenance.requestedRange.fromBlock,coveredToBlock:raw.provenance.requestedRange.toBlock,transport:raw.provenance.source}});
process.stdout.write(process.argv.includes("--csv")?reportCsv(report):JSON.stringify(report,null,2));
