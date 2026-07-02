// Resolves the credentials/clients a tool call needs, with clear errors that
// tell the trader exactly which setup step is missing.

import { getChain } from "./chains.js";
import { getCredential } from "./credentials.js";
import { FlashClient, PUBLIC_DEV_KEY } from "./flashClient.js";
import { evmAddressFromPrivateKey } from "./signing/evm.js";
import { svmAddressFromSecret } from "./signing/svm.js";

export class SetupError extends Error {}

/** A Flash client. Uses the trader's key if set, else the public dev key (read-only-ish). */
export async function resolveClient(): Promise<{ client: FlashClient; usingDevKey: boolean }> {
  const key = await getCredential("api-key");
  if (key) return { client: new FlashClient(key), usingDevKey: false };
  return { client: new FlashClient(PUBLIC_DEV_KEY), usingDevKey: true };
}

/** A Flash client that requires the trader's own API key (for placing orders). */
export async function requireClient(): Promise<FlashClient> {
  const key = await getCredential("api-key");
  if (!key) {
    throw new SetupError(
      "No Definitive API key configured. Run the `flash_setup` tool to connect your account and generate a Flash key.",
    );
  }
  return new FlashClient(key);
}

/** The funder wallet private key for the given chain's signer family. */
export async function requirePrivateKey(chainName: string): Promise<string> {
  const kind = getChain(chainName).kind === "svm" ? "svm-private-key" : "evm-private-key";
  const pk = await getCredential(kind);
  if (!pk) {
    const which = kind === "svm-private-key" ? "Solana" : "EVM";
    throw new SetupError(
      `No ${which} wallet private key configured. Run \`flash_setup\` with your ${which} private key to enable trading on ${chainName}.`,
    );
  }
  return pk;
}

/** Resolve the funder address for a chain from the stored key, if any. */
export async function funderAddressFor(chainName: string): Promise<string | null> {
  const kind = getChain(chainName).kind === "svm" ? "svm-private-key" : "evm-private-key";
  const pk = await getCredential(kind);
  if (!pk) return null;
  try {
    return kind === "svm-private-key" ? svmAddressFromSecret(pk) : evmAddressFromPrivateKey(pk);
  } catch {
    return null;
  }
}
