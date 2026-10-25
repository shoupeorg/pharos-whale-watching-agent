# Pharos Whale-Watching Agent

A strictly read-only shared watch desk for the Pharos Agent Arena. It tracks several configurable public addresses in one ERC-20 timeline, applies exact per-token thresholds, and separates external group flow from watched-to-watched movement.

## What it does

- Tracks 5–20 unique addresses with editable labels visibly marked `USER_SUPPLIED`.
- Supports 1–8 ERC-20 token contracts and exact decimal-string thresholds.
- Retrieves confirmed `Transfer(address,address,uint256)` logs in bounded, gap-free batches.
- Deduplicates with `chainId + transactionHash + logIndex`.
- Explains significant events and distinguishes external inflow, external outflow, internal movement, mint and burn.
- Persists isolated public workspaces, observations, cursor, monitoring state and reports in Cloudflare D1.
- Exports the same report as JSON and CSV.

It does not connect a wallet, request keys, sign, prepare or send transactions, or spend funds.

## Data sources and transport

Foundation discovery used the official [Pharos Chain MCP](https://github.com/PharosNetwork/pharos-mcp): chain ID 1672, `get_logs`, `eth_call`, and the documented maximum inclusive log range of 1,000 blocks. Saved schemas and results are in `evidence/mcp-discovery-v1.json`.

The deployed Worker uses Pharos Pacific JSON-RPC (`https://rpc.pharos.xyz`) because Cloudflare Worker requests are not an interactive agent MCP session. Runtime calls are labeled JSON-RPC and are never described as MCP usage. Each scan verifies `eth_chainId`, reads a finalized head, reads token metadata when needed, then requests at most 500 blocks per token.

## Threshold semantics

Significance is `amount >= threshold`. Amounts and thresholds are converted with `BigInt`; JavaScript floating-point arithmetic is never used. A threshold with more fractional digits than the token supports is rejected. If `decimals()` is unavailable or invalid, evaluation is `UNKNOWN` and preparation of a significance conclusion is blocked for that token.

Changing a threshold reevaluates the same stored observations. It does not edit historical chain evidence.

## Group accounting

- External inflow: external sender → watched recipient.
- External outflow: watched sender → external recipient.
- Internal movement: watched sender → watched recipient, counted once and excluded from net external flow.
- Mint/burn: the ERC-20 zero-address conventions are shown separately.

Totals remain separate per token. The app does not add unrelated token quantities or claim unique capital from gross transfer volume.

## Monitoring and coverage

**Run Fresh Scan** processes the next confirmed batch. **Start Monitoring** persists monitor state and begins an honest 15-second browser-driven poll; refreshing restores the running state and history. **Stop Monitoring** stops polling without clearing the cursor.

Each report shows requested and covered blocks, confirmation delay, last successful scan, transport and coverage status. A batch failure records `PARTIAL`, releases the scan lock and does not advance the cursor. The current 12-block confirmation delay reduces, but cannot eliminate, reorg risk. Incomplete coverage can understate totals.

## Verified real example

The versioned example watches five neutral addresses selected from participants in recent Pacific Mainnet USDC transfers. No address is described as malicious or owned by this project.

- Range: blocks `21220650–21220834`.
- Token: USDC `0xc879c018db60520f4355c26ed1a6d572cdac1815`.
- Metadata: 6 decimals and symbol `USDC`, read at block `21220834` through Chain MCP.
- Includes a real external inflow, real watched-to-watched transfers, a transfer above the 1 USDC threshold and a 0.20004 USDC transfer below it.
- Raw evidence is preserved separately from the derived report.

Use **Load verified example**, **Load verified report**, then change the threshold and select **Save configuration** to demonstrate reevaluation against durable observations. Select **Run Fresh Scan** for a new confirmed range.

## Local setup

```bash
npm ci
npm test
npm run build
npx wrangler d1 migrations apply pharos-whale-watching-agent --local
npm run dev
```

Stage-specific delivery helpers are `scripts/publish.ps1`, `scripts/deploy.ps1`, and `scripts/verify-public.ps1`. `scripts/resume-publish-deploy.ps1` composes those idempotent stages and resolves an existing D1 database by Wrangler JSON rather than human-readable output.

The public repository must exist before `publish.ps1` is run; the helper never creates or changes repository visibility implicitly.

For production, create one D1 database named `pharos-whale-watching-agent`, place its ID in `wrangler.jsonc`, apply migrations with `--remote`, and deploy.

## CLI

```bash
npm run cli -- evidence/v1-live-raw.json
```

The CLI derives the same JSON report and CSV semantics as the web engine; it performs no chain writes.

## Limitations

- ERC-20 Transfer logs only; native transfers and protocol positions are intentionally out of scope.
- Labels are user-supplied unless the zero address supplies mint/burn context.
- Public RPC availability and historical retention can cause partial coverage.
- Browser-driven monitoring runs only while the deployed page is open; its durable state and cursor survive refresh or restart.
- Explorer availability is external to this project. The complete hash and saved event evidence remain visible in-app.
