/**
 * The chain boundary the jobs send through.
 *
 * Jobs build instructions with the `@meridian/sdk` builders, then hand them to a
 * {@link ChainClient} to sign (with the automation keypair) and submit. Abstracting the
 * *send* lets the jobs run against:
 *   - a real Solana `Connection` in production / on devnet ({@link RpcChainClient}), and
 *   - an in-process LiteSVM in the integration test (a tiny adapter implementing the
 *     same interface).
 * The jobs never depend on a concrete transport, so they are unit-testable with a stub.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getProgram,
  fetchMarket,
  type MeridianProgram,
  type MarketAccount,
} from "@meridian/sdk";

/**
 * The chain boundary. Sends instructions signed by the automation keypair and reads the
 * `Market` accounts the jobs need. Abstracting *both* send and read lets the jobs run
 * against a real RPC connection in production and an in-process LiteSVM in tests — the
 * read path differs (RPC `getAccountInfo` vs the LiteSVM account store), so it must be
 * part of the interface, not a direct `program.account.*` call.
 */
export interface ChainClient {
  /** The typed SDK program, for building instructions. */
  readonly program: MeridianProgram;
  /** The automation signer (admin/cranker/payer). Its public key wires builder accounts. */
  readonly payer: PublicKey;
  /** Sign (with the automation keypair + any extra signers) and submit one transaction. */
  send(
    instructions: TransactionInstruction[],
    extraSigners?: Keypair[]
  ): Promise<string>;
  /** Read and decode a `Market` by address (null if absent). */
  fetchMarket(address: PublicKey): Promise<MarketAccount | null>;
  /** List all `Market` accounts the program owns, with their addresses. */
  listMarkets(): Promise<{ address: PublicKey; account: MarketAccount }[]>;
  /** The underlying connection, for SDK helpers that take one (e.g. `postPriceUpdate`). */
  readonly connection: Connection;
  /** The automation keypair, for SDK helpers that need a `Keypair` (e.g. `settleWithPyth`). */
  readonly keypair: Keypair;
}

/** Minimal Anchor `Wallet` around a Keypair (so we can build an AnchorProvider program). */
function keypairWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async (tx: Transaction) => {
      tx.partialSign(kp);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      for (const tx of txs) tx.partialSign(kp);
      return txs;
    },
  };
}

/** A {@link ChainClient} backed by a real Solana RPC connection. */
export class RpcChainClient implements ChainClient {
  readonly program: MeridianProgram;
  readonly connection: Connection;
  readonly keypair: Keypair;

  constructor(connection: Connection, keypair: Keypair) {
    this.connection = connection;
    this.keypair = keypair;
    // A connection+wallet provider so the program can both build and (if used) send.
    this.program = getProgram({
      connection,
      publicKey: keypair.publicKey,
      // Anchor only needs these for sending via program.methods; we send ourselves below,
      // but a full provider keeps reads (program.account.*) working against the RPC.
      wallet: keypairWallet(keypair),
    } as never);
  }

  get payer(): PublicKey {
    return this.keypair.publicKey;
  }

  async send(
    instructions: TransactionInstruction[],
    extraSigners: Keypair[] = []
  ): Promise<string> {
    const tx = new Transaction();
    for (const ix of instructions) tx.add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [
      this.keypair,
      ...extraSigners,
    ]);
  }

  fetchMarket(address: PublicKey): Promise<MarketAccount | null> {
    return fetchMarket(this.program, address);
  }

  async listMarkets(): Promise<
    { address: PublicKey; account: MarketAccount }[]
  > {
    // getProgramAccounts filtered by the Market discriminator, then normalized.
    const all = await this.program.account.market.all();
    const out: { address: PublicKey; account: MarketAccount }[] = [];
    for (const entry of all) {
      const acc = await fetchMarket(this.program, entry.publicKey);
      if (acc) out.push({ address: entry.publicKey, account: acc });
    }
    return out;
  }
}
