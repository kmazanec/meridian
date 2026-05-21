import {
  AnchorProvider,
  Program,
  type Idl,
  type Provider,
  type Wallet,
} from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import { MERIDIAN_IDL, type Meridian } from "./idl";

/** The on-chain program id, taken from the vendored IDL (single source of truth). */
export const PROGRAM_ID = new PublicKey(MERIDIAN_IDL.address);

/** A typed Meridian program client. */
export type MeridianProgram = Program<Meridian>;

/**
 * Build a typed {@link Program} for Meridian.
 *
 * The Anchor client only needs a {@link Provider} to encode instructions and to
 * read accounts; it never holds keys itself (the wallet signs). Pass:
 *  - an {@link AnchorProvider} (connection + wallet) for full read/write use, or
 *  - any object structurally satisfying {@link Provider} — e.g. a connection-only
 *    provider for read/derivation paths, or a test harness adapter.
 *
 * Instruction *building* (`program.methods.*.instruction()`) works with any
 * provider; only sending requires a wallet that can sign.
 */
export function getProgram(provider: Provider): MeridianProgram {
  return new Program(
    MERIDIAN_IDL as Idl,
    provider
  ) as unknown as MeridianProgram;
}

/**
 * Convenience: build a program from a {@link Connection} and a {@link Wallet}.
 * The wallet is whatever can sign (browser wallet adapter, Node keypair wallet).
 */
export function getProgramFromConnection(
  connection: Connection,
  wallet: Wallet,
  opts: ConstructorParameters<
    typeof AnchorProvider
  >[2] = AnchorProvider.defaultOptions()
): MeridianProgram {
  const provider = new AnchorProvider(connection, wallet, opts);
  return getProgram(provider);
}
