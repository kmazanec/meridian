"use client";

import { useMemo } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, type Connection } from "@solana/web3.js";
import { getProgram, type MeridianProgram } from "@meridian/sdk";

/**
 * A read-only Anchor provider: enough for the client to *encode* instructions and
 * *decode/read* accounts, but it never signs. Signing is the wallet adapter's job at
 * `sendTransaction` time — the frontend holds no keys, so the program object is built
 * with no signer. (`program.methods.*.instruction()` and `program.account.*` only need
 * the connection.)
 */
function readOnlyProvider(connection: Connection) {
  // A placeholder public key satisfies the provider shape; it is never used to sign.
  const publicKey = PublicKey.default;
  return {
    connection,
    publicKey,
    // Anchor's Provider type wants these, but read/encode paths never call them.
    sendAndConfirm: async () => {
      throw new Error(
        "read-only provider cannot send; sign via the wallet adapter"
      );
    },
  };
}

/**
 * The typed Meridian program, bound to the active RPC connection. Memoized on the
 * connection so reads/derivations reuse one client. Use the returned program for
 * reads and instruction building; send the built instructions through the wallet
 * adapter's `sendTransaction`.
 */
export function useProgram(): MeridianProgram {
  const { connection } = useConnection();
  return useMemo(
    // The provider only needs to read + encode here; cast to the Provider shape.
    () => getProgram(readOnlyProvider(connection) as never),
    [connection]
  );
}
