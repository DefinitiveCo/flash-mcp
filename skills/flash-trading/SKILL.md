---
name: flash-trading
description: Workflow and safety rails for trading on the Definitive Flash API via the definitive-flash MCP tools. Use whenever the user wants to quote, buy, sell, swap, or manage orders (market, limit, TWAP, stop, take-profit, bracket) on EVM chains or Solana through Flash.
---

# Trading on Definitive Flash

The `definitive-flash` MCP server exposes: `flash_setup`, `flash_status`, `flash_quote`,
`flash_balances`, `flash_submit_order`, `flash_submit_signed_order`, `flash_get_order`,
`flash_list_orders`, `flash_cancel_order`.

## Safety rails (non-negotiable)

1. **Both submit tools spend real funds.** Before calling `flash_submit_order` or
   `flash_submit_signed_order`, show the user a fresh `flash_quote` result (price, expected
   output, price impact, fees) and get their explicit confirmation in this conversation. Never
   submit an order the user hasn't confirmed. Treat signed submission as destructive and
   non-idempotent: repeating it can create another order.
2. **Never ask the user to paste a private key into chat**, and if they try, stop them —
   it would flow through the model and the transcript. `flash_setup` does not accept private
   keys. Route them to the interactive wizard in their own terminal:
   ```bash
   npx -y @definitive-fi/flash-mcp setup         # wizard: API key → wallets → RPCs
   npx -y @definitive-fi/flash-mcp set-key evm   # or: svm, api (single hidden prompt → Keychain)
   ```
   or environment variables (`DEFINITIVE_PRIVATE_KEY`, `DEFINITIVE_SVM_PRIVATE_KEY`,
   `DEFINITIVE_API_KEY`).
3. **Don't retry a failed submit blindly.** A timeout or ambiguous response does not mean the
   order failed. Inspect any reported order id with `flash_get_order` and check
   `flash_list_orders`. Re-quote only if inputs change or the prior quote is stale/invalid;
   preparation returned by a still-valid quote does not itself require re-quoting. Re-confirm
   before any new submission.
4. **One order at a time.** Never issue parallel `flash_submit_order` or
   `flash_submit_signed_order` calls — wait for each to reach a terminal status before submitting
   the next. For multi-token requests (e.g.
   "sweep everything to USDC"): fetch balances, quote each token, present the full plan for
   one confirmation, then execute sequentially, reporting progress as you go. Skip tokens
   that fail to quote (dust often has no route) and summarize successes and failures at the
   end. (The server also serializes same-wallet orders per chain as a backstop.)

## First-run setup

1. Call `flash_setup` with no arguments to see what's configured, then relay its instructions.
   The optional local-signing path is the interactive wizard the user runs **in their own terminal** —
   `npx -y @definitive-fi/flash-mcp setup`. It opens the Definitive API-key page and walks
   through the API key, funder wallets, and custom RPCs (hidden prompts → Keychain).
2. A configured API key takes precedence; otherwise quote and submission calls use the server's
   embedded/default credential. A user API key is optional for integrator attribution or
   account-specific configuration. If the user wants to provide one in chat, an API key alone is
   safe to accept (`dpka_…` cannot move funds): store it with
   `flash_setup { "apiKey": "dpka_…" }`. Treat this as client credential-selection behavior;
   do not claim the embedded/default credential's production trading permission was independently tested.
3. No configured wallet is required for external signing. Use `flash_quote.funderAddress` and
   `flash_submit_signed_order`; keep all wallet secrets outside chat. Configure a wallet through
   the wizard/CLI only when the user wants the convenience of local `flash_submit_order`.
4. After the wizard finishes, call `flash_status` to confirm what's configured.
5. A custom RPC is recommended for heavy traders (public defaults are rate-limited) — the
   wizard covers it, or `flash_setup { "rpc": { "base": "https://…" } }` from chat.

`flash_status` shows what's configured and the supported chains at any time.

## Quoting and ordering

- `flash_quote` needs no wallet — use it freely to price trades and answer "what would I get" questions.
- `flash_balances` answers "what do I hold" — never look up RPC endpoints yourself or curl a
  node; it uses the built-in per-chain RPCs. Defaults to the funder wallet. On EVM chains pass
  the ERC-20 addresses you care about; on Solana it lists all SPL holdings by default.
- Check `flash_balances` before submitting an order when there's any doubt the wallet can
  cover the spend plus gas.
- Assets are **addresses**, not symbols. If the user gives a symbol, resolve the address on the
  target chain and confirm it with them before quoting — a wrong address trades the wrong token.
- **Native gas assets (ETH, BNB, POL, AVAX, HYPE, XPL, SOL) are normalized automatically.** For
  an EVM spend, the server maps a native symbol/`native`/zero-address/0xEeee alias to the canonical
  sentinel for `/quote`, which returns normalized asset addresses and `wrap.evmTx` when needed.
  Received EVM native is mapped to the configured wrapped token. Solana uses wSOL and
  `svmUseNativeSOL`. `flash_submit_order` executes returned preparation locally; for external
  signing, execute it yourself and submit `quote.targetAsset` and `quote.contraAsset`, never the
  original native aliases. Relay every substitution. (Received native on a chain without a
  configured wrapped token errors rather than guessing an address.)
- `qty` is the amount being **spent**: `contraAsset` units for buys, `targetAsset` units for sells.
- Order types: `market`, `limit` (requires `limitNotionalPrice`), `twap` (requires
  `durationSeconds` ≥ 300, optional `twapBucketCount`), `stop` / `stop-loss`, `take-profit`,
  `bracket` (each trigger requires exactly one of USD `notionalPrice` or pair-rate `crossPrice`,
  plus `upper`/`lower`). Shared controls also include `limitCrossPrice`, `recipientAddress`,
  `startTime`, `flashIntegratorFeeBps`, and the applicable TWAP/trigger fields.
- Quote-only controls: `evmUsePermit2`, `svmUseNativeSOL`, `expireTime`, `durationSeconds`.
  Submit-only metadata: `bridgeQuoteId`, `erc8021AttributionCode`, and signed chain fields.
- Market orders poll until terminal status by default (`waitForFill`, `pollTimeoutSec`).
- EVM trades may send a one-time ERC-20 approve (plus a wrap tx for native-asset trades) before
  signing — the wallet needs a little native gas. On Solana, `svmUseNativeSOL: true` wraps SOL.
- Chains: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche, hyperevm, robinhood,
  plasma, monad, solana.

## External signing

Use `flash_submit_order` for the convenience path when the matching local wallet is configured.
Otherwise keep preparation and signing in the external wallet:

1. Call `flash_quote` with `funderAddress`, native intent when applicable, and a fresh set of
   trade fields. Use `structuredContent.quote` (or the raw quote retained in text) to read all
   preparation and signing artifacts.
2. Complete preparation externally in the returned order:
   - EVM: broadcast `quote.wrap.evmTx` when present, then `quote.evm.approveTx` when present;
     sign the exact `quote.evm.orderTypedData` and optional `quote.evm.permitTypedData`.
   - SVM: execute `quote.svm.ataSetupIxs` first when present, then
     `quote.wrap.svmInstructions` when present; co-sign `quote.svm.sponsoredDelegateTx` when
     present, otherwise execute `quote.svm.delegateIx` when present; then sign
     `quote.svm.orderMessage`.
3. After explicit user confirmation, call `flash_submit_signed_order` once while the same quote
   remains valid. Use `quote.targetAsset` and `quote.contraAsset`, preserve cross-chain
   `recipientAddress` and the applicable `bridgeQuoteId`, and pass:
   - Common: `funderAddress`, `quoteId`, `userSignature`.
   - EVM: required `evmOrderTypedData`; optional `evmPermitTypedData` and
     `evmPermitSignature` must be supplied together.
   - SVM: optional `svmNonce`, `svmDeadline`, `svmSponsoredDelegateTx`.

Do not pass preparation transactions or instructions as order fields: EVM wrap/approval and SVM
ATA/wrap/delegate actions must already have been executed externally. The co-signed sponsored
transaction is the exception explicitly passed as `svmSponsoredDelegateTx`. Do not pass
quote-only controls to submit. Preserve the same still-valid quote after preparation; re-quote
only when inputs change or it becomes stale/invalid. Preserve explicit confirmation,
serialized-submit, ambiguous reconciliation, and no-blind-retry safety rails.

## Managing orders

- `flash_get_order { orderId }` — status, fills, detail (use after any ambiguous submit).
- `flash_list_orders` — recent orders for the funder wallet; filter with `statuses`, page with `pageSize`.
- `flash_cancel_order { orderId }` — cancel a resting limit/trigger/TWAP order. Confirm with the
  user which order before cancelling if there is any ambiguity.
