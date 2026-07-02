// Secure credential storage for the Flash MCP server.
//
// Three things may be stored, all sensitive:
//   - the Definitive Flash API key       (key: "api-key")
//   - an EVM wallet private key (0x hex)  (key: "evm-private-key")
//   - a Solana wallet secret (base58)     (key: "svm-private-key")
//
// Primary store is the macOS Keychain via the `security` CLI: values are
// encrypted at rest by the OS and never written to a dotfile in plaintext.
// For headless / non-macOS use we fall back to environment variables, which
// is also how an operator can inject credentials without ever calling setup:
//   DEFINITIVE_API_KEY, DEFINITIVE_PRIVATE_KEY, DEFINITIVE_SVM_PRIVATE_KEY
//
// Nothing here logs secret values. Callers mask before display.

import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SERVICE = "definitive-flash-mcp";

export type CredentialKind = "api-key" | "evm-private-key" | "svm-private-key";

const ENV_FALLBACK: Record<CredentialKind, string> = {
  "api-key": "DEFINITIVE_API_KEY",
  "evm-private-key": "DEFINITIVE_PRIVATE_KEY",
  "svm-private-key": "DEFINITIVE_SVM_PRIVATE_KEY",
};

const isMac = platform() === "darwin";

async function keychainGet(account: CredentialKind): Promise<string | null> {
  if (!isMac) return null;
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      SERVICE,
      "-a",
      account,
      "-w",
    ]);
    const value = stdout.replace(/\n$/, "");
    return value.length > 0 ? value : null;
  } catch {
    // Non-zero exit means "item not found" — treat as absent.
    return null;
  }
}

async function keychainSet(account: CredentialKind, value: string): Promise<void> {
  if (!isMac) {
    throw new Error(
      "Keychain storage is only available on macOS. Set the credential via the " +
        `${ENV_FALLBACK[account]} environment variable instead.`,
    );
  }
  // -U updates the entry if it already exists. The value is passed as an arg to
  // `security`; it is not echoed anywhere by this process.
  await execFileAsync("security", [
    "add-generic-password",
    "-s",
    SERVICE,
    "-a",
    account,
    "-w",
    value,
    "-U",
    "-T",
    "", // restrict ACL — only the security tool / explicit prompts can read it
    "-D",
    "Definitive Flash MCP credential",
  ]);
}

async function keychainDelete(account: CredentialKind): Promise<void> {
  if (!isMac) return;
  try {
    await execFileAsync("security", ["delete-generic-password", "-s", SERVICE, "-a", account]);
  } catch {
    // not found — nothing to delete
  }
}

/** Read a credential: env var wins (explicit operator intent), then Keychain. */
export async function getCredential(kind: CredentialKind): Promise<string | null> {
  const fromEnv = process.env[ENV_FALLBACK[kind]];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return keychainGet(kind);
}

/** Persist a credential to the Keychain (macOS) for use across restarts. */
export async function setCredential(kind: CredentialKind, value: string): Promise<void> {
  await keychainSet(kind, value.trim());
}

export async function deleteCredential(kind: CredentialKind): Promise<void> {
  await keychainDelete(kind);
}

/** Where a credential currently lives, for status display. */
export async function credentialSource(kind: CredentialKind): Promise<"env" | "keychain" | "none"> {
  const fromEnv = process.env[ENV_FALLBACK[kind]];
  if (fromEnv && fromEnv.trim().length > 0) return "env";
  const fromKeychain = await keychainGet(kind);
  return fromKeychain ? "keychain" : "none";
}

export function maskSecret(value: string): string {
  if (value.length <= 10) return "****";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
