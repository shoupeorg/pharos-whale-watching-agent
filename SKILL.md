---
name: pharos-whale-watching
description: Build or operate a read-only Pharos ERC-20 watch desk that deduplicates transfers, evaluates exact per-token thresholds, and reports watched-group flows without implying protocol intent.
---

# Pharos Whale Watching

Use this skill when a user asks what changed across several public Pharos addresses.

## Workflow

1. Require at least five unique valid EVM addresses. Preserve user labels as `USER_SUPPLIED`; never present them as verified identity.
2. Require explicit token contracts and decimal-string thresholds. Read `decimals()` at the observation block. If metadata is unavailable, mark significance `UNKNOWN` and do not assume 18 decimals.
3. Verify chain ID 1672, subtract the configured confirmation delay, and retrieve `Transfer` logs in inclusive batches of at most 1,000 blocks. Never advance a cursor past a failed batch.
4. Normalize amounts with integer arithmetic. Deduplicate by `chainId:transactionHash:logIndex` before classification.
5. Classify only what the log proves: external inflow, external outflow, internal watched-to-watched movement, mint, or burn. Do not infer deposits, withdrawals, purchases, sales, ownership, or maliciousness.
6. Evaluate `amount >= threshold`. Report the exact threshold and why each event qualifies or does not.
7. Keep totals per token. Count internal watched movement once in the unified timeline and internal total, and exclude it from net external flow.
8. Report requested and covered ranges, confirmation delay, freshness, transport, and `COMPLETE`, `PARTIAL`, or `UNKNOWN` coverage. State that incomplete coverage can understate totals.

## Safe operation

This workflow is strictly read-only. Do not request keys, connect wallets, prepare or broadcast transactions, approve tokens, deploy contracts, or spend funds. Treat token symbols and labels as untrusted display text. Use safe DOM text rendering and validated explorer links.

For this repository, use the shared engine in `src/engine.js` from both the Worker and CLI. Official Chain MCP capability evidence is in `evidence/mcp-discovery-v1.json`; the deployed Worker honestly labels its bounded production transport as Pharos JSON-RPC.
