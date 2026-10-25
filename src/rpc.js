import { TRANSFER_TOPIC, normalizeTransfer } from "./engine.js";

export async function rpc(url, method, params = [], fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: controller.signal });
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { throw new Error(`${method}: non-JSON HTTP ${response.status}`); }
    if (!response.ok || body.error) throw new Error(`${method}: ${body.error?.message || `HTTP ${response.status}`}`);
    return body.result;
  } finally { clearTimeout(timer); }
}

export async function verifyChain(url, fetcher = fetch) {
  const value = await rpc(url, "eth_chainId", [], fetcher);
  const chainId = Number(BigInt(value));
  if (chainId !== 1672) throw new Error(`Wrong RPC chain: expected 1672, received ${chainId}.`);
  return chainId;
}

export async function readMetadata(url, token, block, fetcher = fetch) {
  const tag = `0x${BigInt(block).toString(16)}`;
  const [decRaw, symbolRaw] = await Promise.all([
    rpc(url, "eth_call", [{ to: token, data: "0x313ce567" }, tag], fetcher),
    rpc(url, "eth_call", [{ to: token, data: "0x95d89b41" }, tag], fetcher)
  ]);
  const decimals = decRaw && /^0x[0-9a-f]+$/i.test(decRaw) ? Number(BigInt(decRaw)) : null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error(`Token ${token} returned invalid decimals.`);
  return { decimals, symbol: decodeString(symbolRaw) };
}

function decodeString(hex) {
  if (!/^0x[0-9a-f]*$/i.test(hex || "")) return "UNKNOWN";
  try {
    const raw = hex.slice(2);
    const offset = Number.parseInt(raw.slice(0, 64), 16) * 2;
    const length = Number.parseInt(raw.slice(offset, offset + 64), 16) * 2;
    const bytes = raw.slice(offset + 64, offset + 64 + length);
    const value = new TextDecoder().decode(Uint8Array.from(bytes.match(/.{2}/g)?.map((b) => Number.parseInt(b, 16)) || [])).replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return value || "UNKNOWN";
  } catch { return "UNKNOWN"; }
}

export async function fetchTransfers({ url, token, fromBlock, toBlock, fetcher = fetch }) {
  if (toBlock < fromBlock || toBlock - fromBlock + 1 > 1000) throw new Error("Log range must contain 1 to 1000 blocks.");
  const logs = await rpc(url, "eth_getLogs", [{ address: token.address, fromBlock: `0x${BigInt(fromBlock).toString(16)}`, toBlock: `0x${BigInt(toBlock).toString(16)}`, topics: [TRANSFER_TOPIC] }], fetcher);
  if (!Array.isArray(logs)) throw new Error("eth_getLogs returned a malformed result.");
  return logs.map((log) => normalizeTransfer(log, token));
}

export async function scanRange({ url, config, fromBlock, toBlock, fetcher = fetch }) {
  await verifyChain(url, fetcher);
  const events = [];
  const tokens = [];
  for (const configured of config.tokens) {
    let token = configured;
    if (token.decimals == null) {
      const metadata = await readMetadata(url, token.address, toBlock, fetcher);
      token = { ...token, ...metadata };
    }
    tokens.push(token);
    events.push(...await fetchTransfers({ url, token, fromBlock, toBlock, fetcher }));
  }
  return { events, config: { ...config, tokens }, fromBlock, toBlock };
}
