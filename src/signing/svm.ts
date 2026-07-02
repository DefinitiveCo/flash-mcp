// Solana signing + on-chain sends for the Flash order flow.
//
// SVM order signing is an Ed25519 signature over the UTF-8 `orderMessage`
// string the quote returns. Optional delegate / wrap instructions are bundled
// into a transaction the funder sends; a sponsored delegate tx is a base64
// VersionedTransaction we co-sign and hand back for Definitive to broadcast.

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { getChain, resolveRpc } from "../chains.js";
import type { SvmInstruction } from "../types.js";

function keypairFromSecret(raw: string): Keypair {
  const trimmed = raw.trim();
  // Accept a JSON byte array (Phantom/solana-keygen export) or a base58 secret.
  if (trimmed.startsWith("[")) {
    const bytes = Uint8Array.from(JSON.parse(trimmed) as number[]);
    return Keypair.fromSecretKey(bytes);
  }
  const decoded = bs58.decode(trimmed);
  if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
  if (decoded.length === 32) return Keypair.fromSeed(decoded);
  throw new Error("Solana secret must be a base58 32/64-byte key or a JSON byte array.");
}

export function svmAddressFromSecret(raw: string): string {
  return keypairFromSecret(raw).publicKey.toBase58();
}

function toInstruction(ix: SvmInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(bs58.decode(ix.data)),
  });
}

export class SvmSigner {
  readonly keypair: Keypair;
  private conn: Connection;

  constructor(secret: string, rpcOverride?: string) {
    this.keypair = keypairFromSecret(secret);
    this.conn = new Connection(resolveRpc("solana", rpcOverride), "confirmed");
  }

  get address(): string {
    return this.keypair.publicKey.toBase58();
  }

  /** Ed25519 signature over the UTF-8 message, returned base58 (Flash convention). */
  signMessageBase58(message: string): string {
    const sig = nacl.sign.detached(new TextEncoder().encode(message), this.keypair.secretKey);
    return bs58.encode(sig);
  }

  /** Build a legacy tx from instructions, sign, send, and confirm. */
  async sendInstructions(instructions: SvmInstruction[], label: string): Promise<{ signature: string; label: string }> {
    const tx = new Transaction();
    for (const ix of instructions) tx.add(toInstruction(ix));
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.keypair.publicKey;
    tx.sign(this.keypair);
    const signature = await this.conn.sendRawTransaction(tx.serialize());
    const result = await this.conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (result.value.err) {
      throw new Error(`${label} transaction ${signature} failed: ${JSON.stringify(result.value.err)}`);
    }
    return { signature, label };
  }

  /** Co-sign a base64 sponsored VersionedTransaction and return it base64-encoded. */
  signSponsoredTxBase64(base64Tx: string): string {
    const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
    tx.sign([this.keypair]);
    return Buffer.from(tx.serialize()).toString("base64");
  }
}

export { Connection as SolanaConnection };
