# Security Policy

Meridian is a Solana program for binary stock-outcome markets, deployed to
**devnet** at program ID
[`9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen`](https://explorer.solana.com/address/9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen?cluster=devnet).

The on-chain program embeds a
[`security.txt`](https://github.com/neodyme-labs/solana-security-txt) record that
points back to this file as its disclosure policy.

## Reporting a Vulnerability

If you discover a security issue, please report it privately rather than opening
a public issue:

- **Email:** keith@devforward.com

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a proof-of-concept transaction or test is ideal).
- The program ID and cluster (this deployment is devnet).

We aim to acknowledge reports within a few business days. Because this is a
devnet deployment intended for demonstration, there is no formal bug-bounty
program, but credit will be given for valid disclosures.

## Scope

In scope:

- The on-chain program in [`programs/meridian`](programs/meridian).
- Off-chain packages under [`packages/`](packages) that interact with the
  program (SDK, automation, traders, ops).

Out of scope:

- Issues that require control of the program's upgrade authority.
- Third-party dependencies (please report those upstream).
- Denial-of-service against public RPC endpoints.

## Disclosure

Please give us a reasonable opportunity to remediate before any public
disclosure.
