# Codex Plugin Directory — Submission Materials

Everything the OpenAI Platform plugin portal (<https://platform.openai.com/plugins>)
asks for, pre-drafted. Copy-paste from here into the form. See the checklist at the
bottom for the org-level prerequisites that must be done first.

## Listing

| Field | Value |
| --- | --- |
| Plugin name | `definitive-flash` |
| Display name | Definitive Flash |
| Category | Developer Tools (or Finance if offered) |
| Website | <https://flash.definitive.fi> |
| Docs | <https://flash.definitive.fi/docs> |
| Support URL | <https://flash.definitive.fi/docs> (update if a dedicated support page exists) |
| Privacy policy | <https://definitive.fi/privacy> (verify URL before submitting) |
| Terms | <https://definitive.fi/terms> (verify URL before submitting) |
| Repository | <https://github.com/DefinitiveCo/flash-mcp> |
| Logo | TODO — square PNG/SVG of the Definitive mark |

**Short description**

> Trade on the Definitive Flash API: quote, execute, and manage orders across 12 chains (EVM + Solana) directly from Codex.

**Long description**

> Definitive Flash brings institutional-grade DeFi execution into your coding agent.
> Quote any token pair across 200+ liquidity sources, place market/limit/TWAP/stop
> orders, track fills, and check wallet balances on 11 EVM chains and Solana — all
> through natural conversation. Quotes and balances work with just an API key;
> trading uses a local funder wallet whose private key never leaves your machine
> (macOS Keychain / env var, with a hidden-prompt CLI for key entry so secrets never
> pass through the model). Every tool carries accurate MCP safety annotations:
> order submission and cancellation are marked destructive so clients can gate them
> behind user confirmation.

## Components

- **MCP server** (local stdio, bundled via `.codex-plugin/mcp.json`): `npx -y @definitive-fi/flash-mcp`.
  No hosted endpoint — no production URL, CSP, or domain verification section applies.
- **Skills**: `skills/flash-trading/SKILL.md` (trading workflow guidance).
- **No app/connector component** (`.app.json` intentionally absent).

## Tool annotations (review will check these)

| Tool | readOnly | destructive | idempotent | openWorld |
| --- | --- | --- | --- | --- |
| flash_setup | no | no | yes | no |
| flash_status | yes | — | — | no |
| flash_quote | yes | — | — | yes |
| flash_balances | yes | — | — | yes |
| flash_submit_order | no | **yes** | no | yes |
| flash_get_order | yes | — | — | yes |
| flash_list_orders | yes | — | — | yes |
| flash_cancel_order | no | **yes** | yes | yes |

## Test credentials for reviewers

Provide a dedicated demo setup — do NOT hand over production keys:

- A fresh Flash API key (`dpka_…`) generated from a demo Definitive organization.
- A throwaway EVM wallet funded with a small amount (~$20 USDC + gas on Base) so
  reviewers can exercise `flash_submit_order` end to end.
- Note for reviewers: credentials are entered via the `flash_setup` tool (API key)
  and the `flash-mcp set-key evm` CLI (private key).

## Test cases — 5 positive

1. **First-run setup guidance.** Prompt: "Set up Flash trading." → Agent calls
   `flash_setup` with no arguments. Expected: response lists what is configured and
   returns the API-key generation link (`app.definitive.fi/account/organization/mcp-setup`);
   no error, no crash.
2. **Store API key and confirm status.** Prompt: "Here's my Flash API key: dpka_<demo>."
   → `flash_setup { apiKey }` then `flash_status`. Expected: key accepted, stored in
   Keychain (or env), status shows the masked key (`dpka_a…xyz` form) — never the
   full secret.
3. **Read-only quote without a wallet.** Prompt: "Quote swapping 100 USDC to WETH on
   Base." → `flash_quote`. Expected: spend/receive amounts and estimated fees
   returned; no funds move; works with API key only.
4. **Wallet balances.** Prompt: "What does wallet <demo-address> hold on Base?
   Include USDC." → `flash_balances { chain: "base", address, tokens: [USDC] }`.
   Expected: native ETH balance plus USDC balance with correct decimals.
5. **Small market order end to end.** Prompt: "Buy $5 of WETH with USDC on Base and
   wait for the fill." → `flash_submit_order` (destructive — client should surface a
   confirmation). Expected: order id returned, wrap/approve steps listed if needed,
   poll completes with a filled order summary; `flash_get_order` on the id shows the
   fill.

## Test cases — 3 negative

1. **Malformed API key rejected.** Prompt: "My Flash API key is sk-abc123." →
   `flash_setup { apiKey: "sk-abc123" }`. Expected: key is NOT stored; friendly
   warning that Flash keys start with `dpka_`.
2. **Trade without a funder wallet.** With only an API key configured, prompt: "Buy
   $5 of WETH with USDC on Base." → `flash_submit_order`. Expected: no crash; clear
   setup error explaining a funder wallet is required, pointing at
   `flash-mcp set-key evm` — and explicitly discouraging pasting a private key into chat.
3. **Unsupported chain / bad address.** Prompt: "Check balances for wallet 0x123 on
   dogechain." → `flash_balances`. Expected: schema validation rejects the chain
   (enum of 12 supported chains); with a valid chain but malformed address, a
   friendly "not a valid EVM address" error is returned instead of a stack trace.

## Starter prompts (3–5)

1. "Set up Flash trading and show me what's configured."
2. "Quote swapping 100 USDC to ETH on Base."
3. "What tokens does my wallet hold on Solana?"
4. "Buy $50 of ETH with USDC on Base and wait for the fill."
5. "Show my recent Flash orders and cancel any resting limit orders."

## Submission checklist

- [ ] Repo public (org owner must flip `DefinitiveCo/flash-mcp`)
- [ ] npm package published with annotated tools (≥ 0.1.4)
- [ ] Business identity verification completed for the Definitive OpenAI Platform org
- [ ] Submitter has "Apps Management" write access in the org
- [ ] Logo asset ready; privacy/terms/support URLs verified live
- [ ] Demo API key + funded throwaway wallet created for reviewers
- [ ] Form filled at <https://platform.openai.com/plugins> (auto-saves drafts)
- [ ] After approval: choose publish timing — plugin then installs by bare name
      (`codex plugin add definitive-flash`, `/plugins definitive-flash`)
