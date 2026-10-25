export const ZERO = "0x0000000000000000000000000000000000000000";
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export function normalizeAddress(value) {
  if (!ADDRESS.test(String(value || ""))) throw new Error(`Invalid address: ${String(value || "(empty)")}`);
  return String(value).toLowerCase();
}

export function parseAmount(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Token decimals are unavailable or unsupported.");
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Amount must be a non-negative decimal string.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`Amount exceeds token precision (${decimals} decimals).`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function formatAmount(raw, decimals) {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function validateConfig(input) {
  const addresses = Array.isArray(input?.addresses) ? input.addresses.map((item, index) => ({
    address: normalizeAddress(item.address),
    label: String(item.label || `Watched ${index + 1}`).trim().slice(0, 80),
    labelSource: "USER_SUPPLIED"
  })) : [];
  if (addresses.length < 5 || addresses.length > 20) throw new Error("Track between 5 and 20 watched addresses.");
  if (new Set(addresses.map((item) => item.address)).size !== addresses.length) throw new Error("Duplicate watched addresses are not allowed.");
  const tokens = Array.isArray(input?.tokens) ? input.tokens.map((item) => {
    const address = normalizeAddress(item.address);
    const decimals = item.decimals == null ? null : Number(item.decimals);
    if (decimals != null && (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)) throw new Error("Invalid token decimals.");
    const threshold = String(item.threshold ?? "");
    const thresholdRaw = decimals == null ? null : parseAmount(threshold, decimals).toString();
    return { address, symbol: String(item.symbol || "UNKNOWN").slice(0, 24), decimals, threshold, thresholdRaw };
  }) : [];
  if (!tokens.length || tokens.length > 8) throw new Error("Configure between 1 and 8 token contracts.");
  if (new Set(tokens.map((item) => item.address)).size !== tokens.length) throw new Error("Duplicate token contracts are not allowed.");
  return { addresses, tokens };
}

export function normalizeTransfer(log, token, chainId = 1672) {
  if (!Array.isArray(log?.topics) || log.topics.length < 3 || String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC) throw new Error("Not an ERC-20 Transfer log.");
  if (!HASH.test(log.transactionHash)) throw new Error("Transfer log is missing a valid transaction hash.");
  const from = normalizeAddress(`0x${log.topics[1].slice(-40)}`);
  const to = normalizeAddress(`0x${log.topics[2].slice(-40)}`);
  const blockNumber = Number(BigInt(log.blockNumber));
  const logIndex = Number(BigInt(log.logIndex));
  const timestamp = log.blockTimestamp == null ? null : new Date(Number(BigInt(log.blockTimestamp)) * 1000).toISOString();
  const amountRaw = BigInt(log.data).toString();
  return {
    id: `${chainId}:${log.transactionHash.toLowerCase()}:${logIndex}`,
    chainId,
    transactionHash: log.transactionHash.toLowerCase(),
    logIndex,
    blockNumber,
    timestamp,
    token: token.address,
    symbol: token.symbol,
    decimals: token.decimals,
    amountRaw,
    amount: token.decimals == null ? null : formatAmount(amountRaw, token.decimals),
    from,
    to,
    removed: Boolean(log.removed)
  };
}

export function evaluateTransfers(events, config) {
  const normalized = validateConfig(config);
  const watched = new Map(normalized.addresses.map((item) => [item.address, item]));
  const tokens = new Map(normalized.tokens.map((item) => [item.address, item]));
  const unique = new Map();
  for (const event of events) if (!event.removed && !unique.has(event.id)) unique.set(event.id, event);
  const evaluated = [];
  for (const event of unique.values()) {
    const fromWatched = watched.get(event.from);
    const toWatched = watched.get(event.to);
    if (!fromWatched && !toWatched) continue;
    const token = tokens.get(event.token);
    const evaluation = token?.thresholdRaw == null ? "UNKNOWN" : BigInt(event.amountRaw) >= BigInt(token.thresholdRaw) ? "SIGNIFICANT" : "BELOW_THRESHOLD";
    let direction = "INTERNAL";
    if (event.from === ZERO) direction = "MINT";
    else if (event.to === ZERO) direction = "BURN";
    else if (fromWatched && !toWatched) direction = "EXTERNAL_OUTFLOW";
    else if (!fromWatched && toWatched) direction = "EXTERNAL_INFLOW";
    const threshold = token?.threshold ?? null;
    evaluated.push({
      ...event,
      direction,
      evaluation,
      threshold,
      watchedFrom: fromWatched ? { address: event.from, label: fromWatched.label, labelSource: "USER_SUPPLIED" } : null,
      watchedTo: toWatched ? { address: event.to, label: toWatched.label, labelSource: "USER_SUPPLIED" } : null,
      destinationLabel: toWatched ? toWatched.label : event.to === ZERO ? "Burn address" : "UNKNOWN / unlabeled",
      destinationLabelSource: toWatched ? "USER_SUPPLIED" : event.to === ZERO ? "PROTOCOL_CONSTANT" : "UNKNOWN",
      why: evaluation === "UNKNOWN" ? "Token decimals are unknown, so significance is not evaluated." : `${event.amount} ${event.symbol} is ${evaluation === "SIGNIFICANT" ? "at or above" : "below"} the configured ${threshold} ${event.symbol} threshold (amount >= threshold).`,
      explanation: explain(direction, event, fromWatched, toWatched)
    });
  }
  return evaluated.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
}

function explain(direction, event, fromWatched, toWatched) {
  const amount = event.amount == null ? `${event.amountRaw} raw units` : `${event.amount} ${event.symbol}`;
  if (direction === "INTERNAL") return `${amount} moved between two watched addresses; it counts once as internal movement and does not change net external group flow.`;
  if (direction === "EXTERNAL_INFLOW") return `${amount} entered the watched group from an external address.`;
  if (direction === "EXTERNAL_OUTFLOW") return `${amount} left the watched group for an external, unlabeled address.`;
  if (direction === "MINT") return `${amount} was emitted by the ERC-20 zero-address mint convention to ${toWatched?.label || "a watched address"}.`;
  if (direction === "BURN") return `${amount} moved from ${fromWatched?.label || "a watched address"} to the ERC-20 zero-address burn convention.`;
  return `${amount} involved the watched group.`;
}

export function summarize(events, config) {
  const significant = events.filter((item) => item.evaluation === "SIGNIFICANT");
  const tokens = {};
  const perAddress = Object.fromEntries(validateConfig(config).addresses.map((item) => [item.address, { label: item.label, inflowRaw: {}, outflowRaw: {}, internalRaw: {}, events: 0 }]));
  const add = (object, token, value) => object[token] = (BigInt(object[token] || 0) + BigInt(value)).toString();
  for (const event of significant) {
    const row = tokens[event.token] ||= { symbol: event.symbol, externalInflowRaw: "0", externalOutflowRaw: "0", internalRaw: "0", largestRaw: "0", largestEventId: null };
    if (event.direction === "EXTERNAL_INFLOW" || event.direction === "MINT") add(row, "externalInflowRaw", event.amountRaw);
    if (event.direction === "EXTERNAL_OUTFLOW" || event.direction === "BURN") add(row, "externalOutflowRaw", event.amountRaw);
    if (event.direction === "INTERNAL") add(row, "internalRaw", event.amountRaw);
    if (BigInt(event.amountRaw) > BigInt(row.largestRaw)) { row.largestRaw = event.amountRaw; row.largestEventId = event.id; }
    for (const side of [event.watchedFrom, event.watchedTo].filter(Boolean)) {
      const wallet = perAddress[side.address]; wallet.events++;
      if (event.direction === "INTERNAL") add(wallet.internalRaw, event.token, event.amountRaw);
      else if (side.address === event.from) add(wallet.outflowRaw, event.token, event.amountRaw);
      else add(wallet.inflowRaw, event.token, event.amountRaw);
    }
  }
  for (const row of Object.values(tokens)) row.netExternalRaw = (BigInt(row.externalInflowRaw) - BigInt(row.externalOutflowRaw)).toString();
  return { uniqueEvents: events.length, significantEvents: significant.length, belowThresholdEvents: events.filter((item) => item.evaluation === "BELOW_THRESHOLD").length, unknownEvaluations: events.filter((item) => item.evaluation === "UNKNOWN").length, tokens, perAddress };
}

export function buildReport({ events, config, coverage, reportId = crypto.randomUUID(), createdAt = new Date().toISOString() }) {
  const evaluated = evaluateTransfers(events, config);
  return { id: reportId, engineVersion: "whale-watch/1.0.0", createdAt, thresholdRule: "amount >= per-token threshold", coverage, config: validateConfig(config), events: evaluated, summary: summarize(evaluated, config), limitations: ["ERC-20 Transfer logs only.", "User labels are not protocol verification.", "Incomplete coverage can understate totals.", "Unfinalized head blocks are excluded by the confirmation delay."] };
}

export function reportCsv(report) {
  const rows = [["event_id","timestamp","block","token","symbol","amount","amount_raw","from","to","direction","evaluation","threshold","transaction_hash","log_index","destination_label"]];
  for (const e of report.events) rows.push([e.id,e.timestamp||"",e.blockNumber,e.token,e.symbol,e.amount??"UNKNOWN",e.amountRaw,e.from,e.to,e.direction,e.evaluation,e.threshold??"UNKNOWN",e.transactionHash,e.logIndex,e.destinationLabel]);
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"','""')}"`).join(",")).join("\n");
}

export function nextScanRange(cursorBlock, finalizedHead, maxBlocks = 500) {
  if (!Number.isInteger(finalizedHead) || finalizedHead < 0) throw new Error("Invalid finalized head.");
  if (!Number.isInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 1000) throw new Error("Scan batch must contain 1 to 1000 blocks.");
  const fromBlock = cursorBlock == null ? Math.max(0, finalizedHead - maxBlocks + 1) : Number(cursorBlock) + 1;
  if (fromBlock > finalizedHead) return null;
  return { fromBlock, toBlock: Math.min(finalizedHead, fromBlock + maxBlocks - 1) };
}
