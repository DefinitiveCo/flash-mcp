# Definitive Flash MCP

An [MCP](https://modelcontextprotocol.io) server that lets traders quote, execute, and manage
trades on the [Definitive Flash API](https://flash.definitive.fi/docs) directly from any MCP
client (Claude Code, Claude Desktop, Cursor, etc.).

Flash routes across 200+ liquidity sources on 12 chains and returns a signable payload. Use a
locally configured wallet for the full **quote → wrap/approve → sign → submit → poll for fill**
flow, or prepare and sign with an external wallet and submit only the signed fields.

## What it does

| Tool | Purpose |
|------|---------|
| `flash_setup` | Connect your account: get a link to generate a Flash API key, then store the key and your funder wallet(s). |
| `flash_status` | Show what's configured (API key, wallets) and the supported chains. |
| `flash_quote` | Price a trade without executing. No wallet required. |
| `flash_balances` | Native + token balances for any wallet, via the built-in per-chain RPCs. Read-only. |
| `flash_submit_order` | Execute a trade end to end (market, limit, twap, stop, take-profit, bracket). Spends real funds. |
| `flash_submit_signed_order` | Submit an externally prepared and signed order. Destructive and non-idempotent: it spends real funds and a repeated call can create another order. |
| `flash_get_order` | Status, fills, and detail for one order. |
| `flash_list_orders` | Recent orders for a funder wallet. |
| `flash_cancel_order` | Cancel a resting order. |

## Install

The server is published to npm as
[`@definitive-fi/flash-mcp`](https://www.npmjs.com/package/@definitive-fi/flash-mcp) — no clone
or build needed. Pick your client:

### Claude Code

```bash
claude mcp add definitive-flash -- npx -y @definitive-fi/flash-mcp
```

Or install the plugin, which bundles the server plus a trading-workflow skill:

```
/plugin marketplace add DefinitiveCo/flash-mcp
/plugin install definitive-flash@flash-mcp
```

### Cursor

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=definitive-flash&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBkZWZpbml0aXZlLWZpL2ZsYXNoLW1jcCJdfQ%3D%3D)

Or add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project):

```json
{
  "mcpServers": {
    "definitive-flash": {
      "command": "npx",
      "args": ["-y", "@definitive-fi/flash-mcp"]
    }
  }
}
```

### Codex

```bash
codex mcp add definitive-flash -- npx -y @definitive-fi/flash-mcp
```

Or add to `~/.codex/config.toml`:

```toml
[mcp_servers.definitive-flash]
command = "npx"
args = ["-y", "@definitive-fi/flash-mcp"]
```

### Claude Desktop / other clients

Add the same stdio server to the client's config JSON:

```json
{
  "mcpServers": {
    "definitive-flash": {
      "command": "npx",
      "args": ["-y", "@definitive-fi/flash-mcp"]
    }
  }
}
```

### From source (development)

```bash
cd flash-mcp
bun install      # or: npm install
bun run build    # compiles to dist/
claude mcp add definitive-flash -- node "$PWD/dist/index.js"
```

## First-run setup

The interactive wizard is an optional convenience for configuring a personal API key, a local
signing wallet, and custom RPCs. Run it in your own terminal:

```bash
npx -y @definitive-fi/flash-mcp setup
```

It walks through everything in one pass:

1. Opens the Definitive MCP setup page (`app.definitive.fi/account/organization/mcp-setup`) —
   log in, click **Generate API Key**, **Copy & Close** — and prompts you to paste the key.
2. Prompts for your EVM funder wallet private key (press Enter to skip).
3. Prompts for your Solana funder wallet secret (press Enter to skip — you can add either later).
4. Prompts for custom RPC endpoints per chain, pre-filled with the public defaults
   (which are rate-limited — a personal endpoint is recommended if you trade often).

Secrets are typed into **hidden prompts** and written straight to the macOS Keychain — they
never appear on screen, in shell history, or in any chat transcript. Every step can be skipped
and the wizard re-run at any time.

That's it — in your MCP client, `flash_status` to confirm, `flash_quote` to price, and either
`flash_submit_order` for local signing or `flash_submit_signed_order` for external signing.

**Never paste a wallet private key into the chat** — it would pass through the model and the
conversation transcript. The `flash_setup` tool does not accept private keys; wallets are added
only via the wizard or CLI below. (A personal API key alone is safe to paste in chat if you
prefer — it can't move funds — via `flash_setup { "apiKey": "dpka_…" }`.)

For quotes and submissions, the server uses the configured API key when present and otherwise
sends its embedded/default credential. A user API key is optional and remains useful for
integrator attribution and account-specific configuration. A locally stored wallet is also
optional: external signing works without giving this server a wallet secret. This describes the
server's credential-selection behavior; it does not claim that production trading permission for
the embedded/default credential was independently tested here.

### Individual CLI commands

Each wizard step is also available as a one-shot command:

```bash
flash-mcp set-key evm     # or: svm, api   (prompts hidden, stores in Keychain)
flash-mcp set-key api
flash-mcp set-rpc base https://your-rpc
flash-mcp set-org 5VYFCW7M
flash-mcp status          # show what's configured
flash-mcp remove-key evm
```

If it isn't on your PATH, run it via npx: `npx -y @definitive-fi/flash-mcp set-key evm`.

## Credential storage

Secrets are stored in the **macOS Keychain** (service `definitive-flash-mcp`), encrypted at rest
by the OS — never written to a dotfile in plaintext. On non-macOS hosts, or to inject credentials
without calling `flash_setup`, set environment variables (these take precedence over the Keychain):

```
DEFINITIVE_API_KEY            your Flash API key
DEFINITIVE_PRIVATE_KEY        EVM funder wallet private key (0x hex)
DEFINITIVE_SVM_PRIVATE_KEY    Solana funder wallet secret (base58 or JSON byte array)
```

RPC endpoints default to public nodes per chain (rate-limited). Set your own the easy way via
`flash_setup` with `{ "rpc": { "base": "https://…" } }` — persisted to
`~/.config/definitive-flash-mcp/config.json` (non-secret, hand-editable). Precedence, highest
first: per-call `rpcUrl` argument → `DEFINITIVE_RPC_<CHAIN>` env var → `flash_setup` config →
public default.

## External-wallet signing

Use this path when the wallet signs and sends preparation actions outside this MCP server:

1. Call `flash_quote` with the trade fields and `funderAddress` (`flash_quote.funderAddress`).
   Native EVM intent may be expressed with the supported symbol/`native`/zero-address/0xEeee
   aliases; the server sends the canonical native sentinel to `/quote`. Supplying
   `funderAddress` prevents the server from deriving or reading a local wallet address. Read the
   complete response from `structuredContent.quote` (the same raw quote is retained in the text
   output).
2. Complete the returned preparation actions externally, in order:
   - EVM: broadcast `quote.wrap.evmTx` when present, then `quote.evm.approveTx` when present.
     Sign the exact `quote.evm.orderTypedData`; if `quote.evm.permitTypedData` is present, sign
     that exact payload too.
   - SVM: execute `quote.svm.ataSetupIxs` first when present, then
     `quote.wrap.svmInstructions`. Next, co-sign `quote.svm.sponsoredDelegateTx` when present,
     otherwise execute `quote.svm.delegateIx`; finally sign `quote.svm.orderMessage`.
3. Call `flash_submit_signed_order` while that same quote remains valid. Use
   `quote.targetAsset` and `quote.contraAsset`, not the original native aliases, plus the common
   fields `funderAddress`, `quoteId`, and `userSignature`. Preserve `recipientAddress` for a
   cross-chain request and pass the applicable `bridgeQuoteId` from the quote.
   - EVM: pass `evmOrderTypedData`; when Permit2 is used, pass `evmPermitTypedData` and
     `evmPermitSignature` together.
   - SVM: pass `svmNonce`, `svmDeadline`, and the co-signed
     `svmSponsoredDelegateTx` when applicable.

Trade fields shared by quote and submit include `limitCrossPrice`, `recipientAddress`,
`startTime`, `twapBucketCount`, `triggers`, and `flashIntegratorFeeBps`. Quote-only controls are
`evmUsePermit2`, `svmUseNativeSOL`, `expireTime`, and `durationSeconds`; do not include them in
`flash_submit_signed_order`. Submit-only metadata includes `bridgeQuoteId` and
`erc8021AttributionCode`, in addition to the chain-specific signed fields above.

The wrap/approval transactions and SVM wrap/delegate instructions are preparation actions; they
are executed externally and are not fields for `POST /v1/order`. `flash_submit_signed_order`
does not accept a private key. It is destructive and non-idempotent. Although the server attempts
to reconcile an ambiguous response with the order list, never blindly retry a failed or timed-out
submit: first inspect the reported order id, `flash_get_order`, and `flash_list_orders`. Re-quote
only when trade inputs change or the quote is stale or invalid; quote-returned preparation alone
does not require a re-quote. Get explicit confirmation before any new submission.

## Notes

- **`flash_submit_order` spends real funds.** It quotes fresh, signs with your stored key, and
  submits. For market orders it polls until the order reaches a terminal status.
- **`flash_submit_signed_order` also spends real funds.** It submits already-signed fields and
  can create another order if repeated; use the same fresh-quote, confirmation, serialization,
  and no-blind-retry precautions.
- EVM trades may require a one-time ERC-20 approve (and a wrap tx for native-asset trades) before
  signing — your wallet needs a little gas. `flash_submit_order` sends these locally;
  external-wallet users execute them before `flash_submit_signed_order`.
- **Native gas assets are normalized for you.** For an EVM spend, a native alias is quoted via the
  canonical native sentinel so the response can provide `wrap.evmTx`; the quote's asset fields
  contain the normalized addresses used for signing and submit. Received native assets are routed
  to their configured wrapped token. Solana native intent uses wSOL plus `svmUseNativeSOL`.
  The local signing flow executes preparation itself; external-wallet users execute the returned
  actions and submit the quote-normalized assets. Unwrap received wrapped assets separately if needed.
- `qty` is the amount being **spent**: in `contraAsset` units for buys, `targetAsset` units for sells.
- Supported chains: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche, hyperevm,
  robinhood, plasma, monad, solana.
