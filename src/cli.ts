// Local CLI for secure, out-of-band credential entry.
//
// Run these in your OWN terminal (not through the chat/agent) so secrets are
// typed into a hidden local prompt and written straight to the Keychain — they
// never pass through the LLM or the conversation transcript.
//
//   flash-mcp setup           # interactive wizard: API key → wallets → RPCs
//   flash-mcp set-key evm     # paste EVM private key (hidden), stored in Keychain
//   flash-mcp set-key svm     # paste Solana secret (hidden)
//   flash-mcp set-key api     # paste Definitive API key (hidden)
//   flash-mcp set-rpc base https://…
//   flash-mcp set-org 5VYFCW7M
//   flash-mcp remove-key evm|svm|api
//   flash-mcp status
//
// With no command, index.ts starts the MCP server instead.

import { execFile, execSync } from "node:child_process";
import { platform } from "node:os";
import { createInterface } from "node:readline";
import { setOrganization, setRpcOverrides, getConfig, getRpcOverride, CONFIG_FILE_PATH } from "./config.js";
import { credentialSource, deleteCredential, getCredential, maskSecret, setCredential, type CredentialKind } from "./credentials.js";
import { CHAIN_IDS, getChain } from "./chains.js";
import { evmAddressFromPrivateKey } from "./signing/evm.js";
import { svmAddressFromSecret } from "./signing/svm.js";

// Routed modal in the Definitive app that walks the user through generating a
// Flash API key (one-click generate + copy). Uses the org they're logged into.
export const MCP_SETUP_URL = "https://app.definitive.fi/account/organization/mcp-setup";

const KEY_TARGETS: Record<string, { kind: CredentialKind; label: string; validate: (v: string) => string | void }> = {
  api: {
    kind: "api-key",
    label: "Definitive API key",
    validate: (v) => {
      if (!v.startsWith("dpka_")) throw new Error("Expected a Flash API key starting with dpka_");
    },
  },
  evm: {
    kind: "evm-private-key",
    label: "EVM wallet private key",
    validate: (v) => `wallet ${evmAddressFromPrivateKey(v)}`, // throws if invalid, returns address
  },
  svm: {
    kind: "svm-private-key",
    label: "Solana wallet secret",
    validate: (v) => `wallet ${svmAddressFromSecret(v)}`,
  },
};

/** Read a line from the terminal with echo suppressed.
 *  Uses `stty -echo` to disable the kernel's terminal echo, then reads a line in
 *  normal (canonical) mode — the classic, robust way to read a secret. The typed
 *  value never appears on screen and never touches the LLM/transcript.
 *  Requires an interactive terminal (run it yourself, not through the agent). */
async function promptHidden(query: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "This command needs an interactive terminal. Open your terminal app and run it there — " +
        "don't run it through the agent or pipe input into it.",
    );
  }
  process.stdout.write(query);

  let echoDisabled = false;
  const restore = () => {
    if (echoDisabled) {
      try {
        execSync("stty echo", { stdio: ["inherit", "ignore", "ignore"] });
      } catch {
        /* best effort */
      }
      echoDisabled = false;
    }
  };
  // If interrupted mid-prompt, put the terminal back before exiting.
  const onSigint = () => {
    restore();
    process.stdout.write("\n");
    process.exit(130);
  };

  try {
    execSync("stty -echo", { stdio: ["inherit", "ignore", "ignore"] });
    echoDisabled = true;
  } catch {
    // couldn't disable echo (rare) — proceed; input would be visible but still local
  }
  process.on("SIGINT", onSigint);

  try {
    // Canonical mode (only echo disabled) — the kernel handles line editing and
    // delivers the finished line on Enter. Read it directly off stdin.
    const line = await new Promise<string>((resolve) => {
      let buf = "";
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === "\n" || ch === "\r") {
            process.stdin.off("data", onData);
            process.stdin.pause();
            resolve(buf);
            return;
          }
          buf += ch;
        }
      };
      process.stdin.setEncoding("utf8");
      process.stdin.resume();
      process.stdin.on("data", onData);
    });
    return line.trim();
  } finally {
    process.off("SIGINT", onSigint);
    restore();
    process.stdout.write("\n");
  }
}

/** Read a line with normal echo, optionally pre-filling editable text into the line. */
async function promptVisible(query: string, prefill?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(query, resolve);
      if (prefill) rl.write(prefill);
    });
    return answer.trim();
  } finally {
    rl.close();
  }
}

/** Best-effort: open a URL in the default browser. Never throws. */
function openInBrowser(url: string): void {
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    execFile(opener, [url], () => {});
  } catch {
    /* the printed URL is enough */
  }
}

/** Prompt (hidden) for one secret; keep asking until valid, stored, or skipped with Enter. */
async function wizardSecretStep(target: (typeof KEY_TARGETS)[string], existingNote: string | null): Promise<void> {
  if (existingNote) console.log(`  Already configured: ${existingNote}`);
  for (;;) {
    const value = await promptHidden(
      existingNote
        ? `  Paste a new ${target.label} to replace it, or press Enter to keep the current one: `
        : `  Paste your ${target.label} (input hidden), or press Enter to skip: `,
    );
    if (!value) {
      console.log(existingNote ? "  Keeping the current one." : "  Skipped.");
      return;
    }
    try {
      const note = target.validate(value);
      await setCredential(target.kind, value);
      console.log(`  ✅ Stored in the Keychain${note ? ` — ${note}` : ""}.`);
      return;
    } catch (err) {
      console.log(`  ⚠️  ${err instanceof Error ? err.message : String(err)} — try again or press Enter to skip.`);
    }
  }
}

/** Interactive first-run wizard: API key → EVM wallet → Solana wallet → RPCs. */
async function setupWizard(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "flash-mcp setup needs an interactive terminal. Open your terminal app and run it there — " +
        "don't run it through an agent or pipe input into it.",
    );
  }

  console.log("Definitive Flash MCP — interactive setup");
  console.log(
    "Secrets are typed into hidden prompts and stored in the macOS Keychain — they never appear\n" +
      "on screen, in shell history, or in any chat transcript.\n",
  );

  // ----- Step 1: API key -----
  console.log("Step 1 of 4 — Flash API key");
  console.log(`  Opening ${MCP_SETUP_URL}`);
  console.log('  Log in if prompted, click "Generate API Key" (or copy your existing key), then "Copy & Close".');
  openInBrowser(MCP_SETUP_URL);
  const existingApi = await getCredential("api-key");
  await wizardSecretStep(
    KEY_TARGETS.api!,
    existingApi ? `${maskSecret(existingApi)} (${await credentialSource("api-key")})` : null,
  );

  // ----- Step 2: EVM wallet -----
  console.log("\nStep 2 of 4 — EVM funder wallet (needed to trade on EVM chains; skip if you only quote or trade Solana)");
  const existingEvm = await getCredential("evm-private-key");
  await wizardSecretStep(KEY_TARGETS.evm!, existingEvm ? `wallet ${evmAddressFromPrivateKey(existingEvm)}` : null);

  // ----- Step 3: Solana wallet -----
  console.log("\nStep 3 of 4 — Solana funder wallet (needed to trade on Solana; skip if you only trade EVM chains)");
  const existingSvm = await getCredential("svm-private-key");
  await wizardSecretStep(KEY_TARGETS.svm!, existingSvm ? `wallet ${svmAddressFromSecret(existingSvm)}` : null);

  // ----- Step 4: RPC endpoints -----
  console.log("\nStep 4 of 4 — RPC endpoints (optional)");
  console.log(
    "  The built-in public RPCs are rate-limited; if you trade often, a personal endpoint\n" +
      "  (Alchemy, Helius, …) is recommended. Press Enter at the chain prompt to finish.",
  );
  for (;;) {
    const chain = await promptVisible(`  Chain to configure (${CHAIN_IDS.join(", ")}) — Enter to finish: `);
    if (!chain) break;
    let info;
    try {
      info = getChain(chain);
    } catch (err) {
      console.log(`  ⚠️  ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const existingOverride = getRpcOverride(chain);
    const url = await promptVisible(
      `  RPC URL for ${chain} (shown: ${existingOverride ? "current custom RPC" : "public default, rate-limited"} — edit or press Enter to keep): `,
      existingOverride ?? info.defaultRpc,
    );
    if (!url || url === info.defaultRpc) {
      if (existingOverride) {
        setRpcOverrides({ [chain]: "" });
        console.log(`  Reverted ${chain} to the public default (rate-limited).`);
      } else {
        console.log(`  Keeping the public default for ${chain} (rate-limited).`);
      }
    } else if (url === existingOverride) {
      console.log(`  Keeping the current custom RPC for ${chain}.`);
    } else {
      setRpcOverrides({ [chain]: url });
      console.log(`  ✅ Custom RPC set for ${chain}.`);
    }
  }

  console.log("\nDone. Current configuration:\n");
  await status();
  console.log("\nIn your MCP client, run `flash_status` to confirm, then `flash_quote` to price a trade.");
}

function usage(): string {
  return [
    "flash-mcp — secure local credential setup",
    "",
    "  flash-mcp setup                     interactive wizard: API key → wallets → RPCs",
    "  flash-mcp set-key <api|evm|svm>     store one secret via a hidden prompt (Keychain)",
    "  flash-mcp remove-key <api|evm|svm>  delete a stored secret",
    "  flash-mcp set-rpc <chain> <url>     set a custom RPC for a chain",
    "  flash-mcp set-org <slug>            set your Definitive organization slug",
    "  flash-mcp status                    show what's configured",
    "",
    "Run with no arguments to start the MCP server.",
  ].join("\n");
}

async function status(): Promise<void> {
  const api = await getCredential("api-key");
  const evm = await getCredential("evm-private-key");
  const svm = await getCredential("svm-private-key");
  const cfg = getConfig();
  console.log("Definitive Flash — configured credentials:");
  console.log(`  API key:   ${api ? `${maskSecret(api)} (${await credentialSource("api-key")})` : "not set"}`);
  console.log(`  EVM wallet: ${evm ? evmAddressFromPrivateKey(evm) : "not set"}`);
  console.log(`  SVM wallet: ${svm ? svmAddressFromSecret(svm) : "not set"}`);
  console.log(`  Organization: ${cfg.organization ?? "not set"}`);
  console.log(`  Custom RPC: ${cfg.rpc && Object.keys(cfg.rpc).length ? Object.keys(cfg.rpc).join(", ") : "none"}`);
  console.log(`  Config file: ${CONFIG_FILE_PATH}`);
}

/** Handle a CLI command. Returns true if it consumed one (so the server shouldn't start). */
export async function runCli(argv: string[]): Promise<boolean> {
  const [cmd, a, b] = argv;
  if (!cmd) return false; // no command → start the server

  switch (cmd) {
    case "-h":
    case "--help":
    case "help":
      console.log(usage());
      return true;

    case "status":
      await status();
      return true;

    case "setup":
      await setupWizard();
      return true;

    case "set-key": {
      const target = KEY_TARGETS[a ?? ""];
      if (!target) throw new Error(`Usage: flash-mcp set-key <api|evm|svm>`);
      const value = await promptHidden(`Paste your ${target.label} (input hidden), then Enter: `);
      if (!value) throw new Error("Nothing entered.");
      const note = target.validate(value);
      await setCredential(target.kind, value);
      console.log(`✅ Stored ${target.label} in the Keychain${note ? ` — ${note}` : ""}.`);
      return true;
    }

    case "remove-key": {
      const target = KEY_TARGETS[a ?? ""];
      if (!target) throw new Error(`Usage: flash-mcp remove-key <api|evm|svm>`);
      await deleteCredential(target.kind);
      console.log(`🗑️  Removed ${target.label} from the Keychain.`);
      return true;
    }

    case "set-rpc": {
      if (!a || !b) throw new Error("Usage: flash-mcp set-rpc <chain> <url>");
      getChain(a); // validate chain id
      setRpcOverrides({ [a]: b });
      console.log(`✅ Set RPC for ${a}.`);
      return true;
    }

    case "set-org": {
      if (!a) throw new Error("Usage: flash-mcp set-org <slug>");
      setOrganization(a);
      console.log(`✅ Set organization to ${a}.`);
      return true;
    }

    default:
      console.error(`Unknown command: ${cmd}\n\n${usage()}`);
      process.exitCode = 1;
      return true;
  }
}
