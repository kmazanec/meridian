/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/meridian.json`.
 */
export type Meridian = {
  "address": "9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen",
  "metadata": {
    "name": "meridian",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Meridian — binary stock-outcome markets on Solana"
  },
  "instructions": [
    {
      "name": "addStrike",
      "docs": [
        "Provision an additional strike market intraday for an existing",
        "ticker/day. Admin-gated; same provisioning as the initial create. (F-05)"
      ],
      "discriminator": [
        226,
        190,
        94,
        4,
        5,
        106,
        15,
        120
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "docs": [
            "The USDC collateral mint (must match Config.usdc_mint)."
          ]
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "mintAuthority",
          "docs": [
            "Per-market PDA: mint+freeze authority for both mints and the vault owner.",
            "No external signer exists for it."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "noMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "createStrikeMarketArgs"
            }
          }
        }
      ]
    },
    {
      "name": "adminSettle",
      "docs": [
        "Admin-only, time-delayed settlement fallback when the oracle path can't",
        "run. Admin supplies the closing price (USDC base units). Idempotent. (F-04)"
      ],
      "discriminator": [
        138,
        218,
        221,
        118,
        96,
        220,
        75,
        11
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "settlementPrice",
          "type": "u64"
        }
      ]
    },
    {
      "name": "cancelOrder",
      "docs": [
        "Cancel a caller's own resting order and return its escrow. (F-03)"
      ],
      "discriminator": [
        95,
        129,
        237,
        240,
        8,
        49,
        223,
        132
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market"
        },
        {
          "name": "orderBook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114,
                  95,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "mintAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "usdcEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "refundTo",
          "docs": [
            "The caller's account that receives the refund: USDC for a bid, Yes for an ask.",
            "Ownership is checked in the handler against the chosen side's mint."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "cancelOrderArgs"
            }
          }
        }
      ]
    },
    {
      "name": "createStrikeMarket",
      "docs": [
        "Provision one stock-strike-day market: Market PDA, Yes/No mints, and the",
        "USDC vault. Admin-gated. (F-02)"
      ],
      "discriminator": [
        21,
        162,
        50,
        119,
        68,
        218,
        221,
        35
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "docs": [
            "The USDC collateral mint (must match Config.usdc_mint)."
          ]
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "mintAuthority",
          "docs": [
            "Per-market PDA that is the mint+freeze authority for both mints and the",
            "owner of the vault. No external signer exists for it."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "noMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "createStrikeMarketArgs"
            }
          }
        }
      ]
    },
    {
      "name": "growOrderBook",
      "docs": [
        "Realloc the order book to full size and wire it into the market (enables",
        "trading). Second half of two-step creation. Permissionless. (F-03)"
      ],
      "discriminator": [
        233,
        31,
        8,
        169,
        183,
        56,
        77,
        99
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "orderBook",
          "docs": [
            "The order book PDA, reallocated up to its full `8 + INIT_SPACE` size. `realloc`",
            "(vs `init`) keeps the existing data. `realloc::zero = false` is safe here NOT",
            "because the runtime zeroes the appended bytes (it does not on realloc) but because",
            "those bytes extend past the borsh `Vec` length prefixes (still 0 from init): borsh",
            "reads only the declared element count, so the uninitialized tail is never accessed",
            "and the book still deserializes as empty. This reasoning is borsh-encoding-specific."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114,
                  95,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initOrderBook",
      "docs": [
        "Create the bounded order book (at initial size) + escrow accounts.",
        "Permissionless; first half of two-step creation (see `grow_order_book`). (F-03)"
      ],
      "discriminator": [
        225,
        19,
        88,
        90,
        233,
        246,
        140,
        84
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "orderBook",
          "docs": [
            "The bounded on-chain order book for this market. Allocated at `INIT_ALLOC`",
            "here (under the 10 KB realloc cap) and grown to full size by `grow_order_book`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114,
                  95,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "mintAuthority",
          "docs": [
            "Per-market PDA: owner/authority of both escrow accounts (and, elsewhere,",
            "the vault + mints). No external signer exists for it."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesMint",
          "docs": [
            "The market's Yes mint (escrow holds Yes tokens for resting asks)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "usdcMint",
          "docs": [
            "USDC mint, taken from the vault's mint (the vault is bound by `has_one`)."
          ]
        },
        {
          "name": "vault",
          "docs": [
            "The collateralization vault — bound only to read its mint and prove the",
            "`usdc_mint` passed is the right one. Not modified here."
          ],
          "relations": [
            "market"
          ]
        },
        {
          "name": "usdcEscrow",
          "docs": [
            "Order-book USDC escrow (resting bids). Authority = mint_authority PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesEscrow",
          "docs": [
            "Order-book Yes escrow (resting asks). Authority = mint_authority PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeConfig",
      "docs": [
        "One-time global setup. Creates the singleton `Config` PDA."
      ],
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "The signer initializing config; becomes the admin authority. Must be the",
            "program's upgrade authority (enforced via `program_data` below)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "usdcMint",
          "docs": [
            "The USDC mint used as collateral across all markets.",
            "",
            "At F-01 we only store the key, but we sanity-check it is a real,",
            "token-program-owned account (not a zero/garbage key) so a poison value",
            "can't be frozen into the singleton. We deliberately avoid pulling in the",
            "full `anchor-spl` token stack here (dependency hygiene — see brief:",
            "\"justify all major dependencies\"); F-02 performs full `Mint` typing and",
            "the actual token CPIs."
          ]
        },
        {
          "name": "config",
          "docs": [
            "The singleton config PDA. `init` makes this idempotent — a second call",
            "fails with the account-already-in-use error."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "docs": [
            "This program's account (executable). Used to locate its program-data."
          ],
          "address": "9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen"
        },
        {
          "name": "programData",
          "docs": [
            "The program's ProgramData account, which holds the upgrade authority.",
            "Anchor verifies the link program -> program_data and that `admin` is the",
            "recorded upgrade authority."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "initializeConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "matchOrders",
      "docs": [
        "Permissionless crank: settle any crossed resting bid/ask pairs. (F-03)"
      ],
      "discriminator": [
        17,
        1,
        201,
        93,
        7,
        51,
        251,
        134
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Anyone may crank. Pays no funds; only triggers settlement."
          ],
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market"
        },
        {
          "name": "orderBook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114,
                  95,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "mintAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesMint",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "usdcEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "matchOrdersArgs"
            }
          }
        }
      ]
    },
    {
      "name": "mintPair",
      "docs": [
        "Deposit $1.00 USDC, receive 1 Yes + 1 No token. (F-02)"
      ],
      "discriminator": [
        19,
        149,
        94,
        110,
        181,
        186,
        33,
        107
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "mintAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "noMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "usdcMint",
          "docs": [
            "The USDC mint (must match the vault's mint)."
          ]
        },
        {
          "name": "userUsdc",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userYes",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "yesMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userNo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "noMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "pause",
      "docs": [
        "Admin emergency stop: halt new minting and all trading program-wide. (F-05)"
      ],
      "discriminator": [
        211,
        22,
        221,
        251,
        74,
        121,
        193,
        47
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "placeOrder",
      "docs": [
        "Post a limit or market order: cross the resting opposite side at price-time",
        "priority (settling atomically), then rest the limit remainder. (F-03)"
      ],
      "discriminator": [
        51,
        194,
        155,
        175,
        109,
        130,
        96,
        106
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market"
        },
        {
          "name": "orderBook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114,
                  95,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "mintAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesMint",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "usdcEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "userUsdc",
          "docs": [
            "Taker's USDC account (pays for buys, receives proceeds of sells)."
          ],
          "writable": true
        },
        {
          "name": "userYes",
          "docs": [
            "Taker's Yes account (delivers Yes on sells, receives Yes on buys)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "placeOrderArgs"
            }
          }
        }
      ]
    },
    {
      "name": "redeem",
      "docs": [
        "Burn settled tokens for their payout (winning side pays $1.00 each). (F-02)"
      ],
      "discriminator": [
        184,
        12,
        86,
        149,
        70,
        196,
        97,
        225
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "mintAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "noMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "userTokens",
          "docs": [
            "The user's token account for the side being redeemed (Yes or No).",
            "Its mint is checked against the chosen side in the handler."
          ],
          "writable": true
        },
        {
          "name": "userUsdc",
          "docs": [
            "The user's USDC account that receives the payout. Bound to the vault's",
            "mint and owned by the caller (defense-in-depth: payouts can't be",
            "redirected to a third party)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": {
            "defined": {
              "name": "redeemSide"
            }
          }
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleMarket",
      "docs": [
        "After 4:00 PM ET: read the Pyth oracle, validate it, and write the",
        "immutable Yes/No outcome. Permissionless and idempotent. (F-04)"
      ],
      "discriminator": [
        193,
        153,
        95,
        216,
        166,
        6,
        144,
        217
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Whoever cranks settlement (pays the tx fee). Not privileged."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "priceUpdate",
          "docs": [
            "The Pyth `PriceUpdateV2` account posted via the Pyth Solana Receiver.",
            "parsed `feed_id` must match the market's configured feed. Parsed by bytes",
            "(no Pyth SDK dependency; see `oracle.rs`)."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "unpause",
      "docs": [
        "Admin: lift the emergency stop, restoring minting and trading. (F-05)"
      ],
      "discriminator": [
        169,
        144,
        4,
        38,
        10,
        141,
        188,
        255
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "orderBook",
      "discriminator": [
        55,
        230,
        125,
        218,
        149,
        39,
        65,
        248
      ]
    }
  ],
  "events": [
    {
      "name": "configInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "marketSettled",
      "discriminator": [
        237,
        212,
        22,
        175,
        201,
        117,
        215,
        99
      ]
    },
    {
      "name": "orderBookInitialized",
      "discriminator": [
        25,
        152,
        242,
        238,
        21,
        34,
        210,
        174
      ]
    },
    {
      "name": "orderCancelled",
      "discriminator": [
        108,
        56,
        128,
        68,
        168,
        113,
        168,
        239
      ]
    },
    {
      "name": "orderMatched",
      "discriminator": [
        211,
        0,
        178,
        174,
        61,
        245,
        45,
        250
      ]
    },
    {
      "name": "orderPlaced",
      "discriminator": [
        96,
        130,
        204,
        234,
        169,
        219,
        216,
        227
      ]
    },
    {
      "name": "pairMinted",
      "discriminator": [
        24,
        66,
        202,
        249,
        156,
        196,
        33,
        51
      ]
    },
    {
      "name": "pauseSet",
      "discriminator": [
        175,
        57,
        198,
        136,
        192,
        66,
        204,
        73
      ]
    },
    {
      "name": "redeemed",
      "discriminator": [
        14,
        29,
        183,
        71,
        31,
        165,
        107,
        38
      ]
    },
    {
      "name": "strikeAdded",
      "discriminator": [
        221,
        90,
        199,
        207,
        85,
        235,
        219,
        228
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "alreadyInitialized",
      "msg": "Config has already been initialized"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "Signer is not the configured admin"
    },
    {
      "code": 6002,
      "name": "marketPaused",
      "msg": "Program is paused"
    },
    {
      "code": 6003,
      "name": "marketSettled",
      "msg": "Market is already settled"
    },
    {
      "code": 6004,
      "name": "marketNotSettled",
      "msg": "Market is not settled yet"
    },
    {
      "code": 6005,
      "name": "marketAlreadyExists",
      "msg": "Market with these parameters already exists"
    },
    {
      "code": 6006,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6007,
      "name": "insufficientBalance",
      "msg": "Insufficient token balance for this operation"
    },
    {
      "code": 6008,
      "name": "invariantViolated",
      "msg": "Vault collateralization invariant violated"
    },
    {
      "code": 6009,
      "name": "bookFull",
      "msg": "Order book is full"
    },
    {
      "code": 6010,
      "name": "orderNotFound",
      "msg": "Order not found"
    },
    {
      "code": 6011,
      "name": "priceOutOfRange",
      "msg": "Order price out of range [0, PRICE_SCALE]"
    },
    {
      "code": 6012,
      "name": "invalidOrderSize",
      "msg": "Order size must be greater than zero"
    },
    {
      "code": 6013,
      "name": "notOrderOwner",
      "msg": "Caller does not own this order"
    },
    {
      "code": 6014,
      "name": "tooEarlyToSettle",
      "msg": "Too early to settle: before market close"
    },
    {
      "code": 6015,
      "name": "overrideDelayNotElapsed",
      "msg": "Too early for admin override: enforced delay not elapsed"
    },
    {
      "code": 6016,
      "name": "stalePrice",
      "msg": "Oracle price is stale"
    },
    {
      "code": 6017,
      "name": "wideConfidence",
      "msg": "Oracle confidence band is too wide"
    },
    {
      "code": 6018,
      "name": "wrongFeed",
      "msg": "Oracle feed id does not match the configured feed for this ticker"
    },
    {
      "code": 6019,
      "name": "invalidArgument",
      "msg": "Invalid argument"
    },
    {
      "code": 6020,
      "name": "invalidPriceUpdateAccount",
      "msg": "Oracle price update is not the expected PriceUpdateV2 account"
    },
    {
      "code": 6021,
      "name": "insufficientVerification",
      "msg": "Oracle price update is not fully verified (Full verification required)"
    }
  ],
  "types": [
    {
      "name": "cancelOrderArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "side",
            "type": {
              "defined": {
                "name": "orderSide"
              }
            }
          },
          {
            "name": "seq",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Global configuration singleton. PDA: `[CONFIG_SEED]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "Authority allowed to create/settle/pause/override."
            ],
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "docs": [
              "The USDC mint used as collateral for every market."
            ],
            "type": "pubkey"
          },
          {
            "name": "tickers",
            "docs": [
              "Supported tickers and their oracle feed ids."
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "tickerConfig"
                  }
                },
                7
              ]
            }
          },
          {
            "name": "paused",
            "docs": [
              "Emergency switch: when true, minting and trading are blocked."
            ],
            "type": "bool"
          },
          {
            "name": "feeAccount",
            "docs": [
              "Optional account that receives fees (if any are ever charged).",
              "Fees must never be taken from a market vault — that would break the",
              "collateralization invariant (ARCHITECTURE.md §7.1)."
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump for the config account."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configInitialized",
      "docs": [
        "Emitted once when the global config is created."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "feeAccount",
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "createStrikeMarketArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ticker",
            "type": {
              "defined": {
                "name": "ticker"
              }
            }
          },
          {
            "name": "strike",
            "type": "u64"
          },
          {
            "name": "tradingDay",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "initializeConfigArgs",
      "docs": [
        "Arguments for `initialize_config`.",
        "",
        "`tickers` provides the per-ticker oracle feed ids. The full set of MAG7",
        "tickers must be supplied (exactly `NUM_TICKERS`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tickers",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "tickerConfig"
                  }
                },
                7
              ]
            }
          },
          {
            "name": "feeAccount",
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "market",
      "docs": [
        "A single binary market: one stock, one strike, one trading day.",
        "PDA: `[MARKET_SEED, ticker_index, strike_le, trading_day_le]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ticker",
            "docs": [
              "Underlying ticker."
            ],
            "type": {
              "defined": {
                "name": "ticker"
              }
            }
          },
          {
            "name": "strike",
            "docs": [
              "Strike price in USDC base units (6 dp). E.g. $680.00 -> 680_000_000."
            ],
            "type": "u64"
          },
          {
            "name": "tradingDay",
            "docs": [
              "The session date this market settles for (unix timestamp, seconds)."
            ],
            "type": "i64"
          },
          {
            "name": "yesMint",
            "docs": [
              "SPL mint for Yes tokens (mint authority is the per-market PDA)."
            ],
            "type": "pubkey"
          },
          {
            "name": "noMint",
            "docs": [
              "SPL mint for No tokens."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "PDA-owned USDC collateral vault (token account)."
            ],
            "type": "pubkey"
          },
          {
            "name": "orderBook",
            "docs": [
              "The order book account for this market."
            ],
            "type": "pubkey"
          },
          {
            "name": "pairsMinted",
            "docs": [
              "Count of Yes/No pairs ever minted (monotonic). With `winning_redeemed`,",
              "drives the on-chain collateralization invariant",
              "(`vault_balance == PAYOFF_UNIT * pairs_minted - winning_redeemed`)."
            ],
            "type": "u64"
          },
          {
            "name": "winningRedeemed",
            "docs": [
              "Total winning-token base units paid out of the vault via `redeem`.",
              "Equals the USDC base units that have left the vault as payouts."
            ],
            "type": "u64"
          },
          {
            "name": "state",
            "docs": [
              "Lifecycle state."
            ],
            "type": {
              "defined": {
                "name": "marketState"
              }
            }
          },
          {
            "name": "outcome",
            "docs": [
              "Settlement outcome (immutable once written)."
            ],
            "type": {
              "defined": {
                "name": "outcome"
              }
            }
          },
          {
            "name": "settlementPrice",
            "docs": [
              "The closing price written at settlement (USDC base units, 6 dp)."
            ],
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "settledAt",
            "docs": [
              "Timestamp settlement occurred."
            ],
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump for the market account."
            ],
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "docs": [
              "PDA bump for the vault."
            ],
            "type": "u8"
          },
          {
            "name": "mintAuthorityBump",
            "docs": [
              "PDA bump for the mint authority."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "docs": [
        "Emitted when a stock-strike-day market is provisioned (F-02)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "ticker",
            "type": {
              "defined": {
                "name": "ticker"
              }
            }
          },
          {
            "name": "strike",
            "type": "u64"
          },
          {
            "name": "tradingDay",
            "type": "i64"
          },
          {
            "name": "yesMint",
            "type": "pubkey"
          },
          {
            "name": "noMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "marketSettled",
      "docs": [
        "Emitted once when a market is settled, via either path (F-04)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "type": {
              "defined": {
                "name": "outcome"
              }
            }
          },
          {
            "name": "settlementPrice",
            "docs": [
              "Closing price written, in USDC base units (6 dp)."
            ],
            "type": "u64"
          },
          {
            "name": "settledAt",
            "type": "i64"
          },
          {
            "name": "byAdmin",
            "docs": [
              "True if settled via the admin override (`admin_settle`), false if via the",
              "permissionless oracle path (`settle_market`)."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "marketState",
      "docs": [
        "Lifecycle state of a market."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "settled"
          }
        ]
      }
    },
    {
      "name": "matchOrdersArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxFills",
            "docs": [
              "Maximum number of fills to perform this call (compute-budget bound)."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "order",
      "docs": [
        "A single resting order on the Yes-vs-USDC book."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "Owner of the order (and of any escrowed funds/tokens)."
            ],
            "type": "pubkey"
          },
          {
            "name": "price",
            "docs": [
              "Limit price in USDC-per-Yes, 6 dp, in `[0, PRICE_SCALE]`."
            ],
            "type": "u64"
          },
          {
            "name": "size",
            "docs": [
              "Remaining size in Yes-token base units."
            ],
            "type": "u64"
          },
          {
            "name": "seq",
            "docs": [
              "Monotonic sequence number for time priority (lower = earlier)."
            ],
            "type": "u64"
          },
          {
            "name": "side",
            "docs": [
              "Which side this order is on."
            ],
            "type": {
              "defined": {
                "name": "orderSide"
              }
            }
          },
          {
            "name": "active",
            "docs": [
              "Whether this slot is occupied (false = empty slot)."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "orderBook",
      "docs": [
        "The bounded, on-chain order book for one market.",
        "PDA: `[ORDER_BOOK_SEED, market.key()]`.",
        "",
        "Bids and asks are fixed-capacity arrays (`ORDERBOOK_N` each). Matching logic",
        "is implemented in F-03; F-01 only freezes this shape and size. Default-derive",
        "is intentionally NOT used (the arrays exceed the std `Default` impl bound of",
        "32); the account is zero-initialized by Anchor `init`, which leaves all",
        "orders with `active = false`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "docs": [
              "Back-reference to the owning market."
            ],
            "type": "pubkey"
          },
          {
            "name": "nextSeq",
            "docs": [
              "Monotonic counter handing out `Order::seq` values."
            ],
            "type": "u64"
          },
          {
            "name": "bids",
            "docs": [
              "Buy-Yes orders."
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "order"
                }
              }
            }
          },
          {
            "name": "asks",
            "docs": [
              "Sell-Yes orders."
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "order"
                }
              }
            }
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump for the order book account."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "orderBookInitialized",
      "docs": [
        "Emitted when the order book + escrow accounts are created for a market."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "orderBook",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "orderCancelled",
      "docs": [
        "Emitted when a resting order is cancelled and its escrow returned."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "refunded",
            "docs": [
              "Escrow returned to the owner (USDC for a bid, Yes tokens for an ask)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderMatched",
      "docs": [
        "Emitted for each maker order touched by a fill (taker placement or crank)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "makerSeq",
            "docs": [
              "The resting (maker) order's sequence number."
            ],
            "type": "u64"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "price",
            "docs": [
              "Trade price (the maker's resting price), USDC-per-Yes at PRICE_SCALE."
            ],
            "type": "u64"
          },
          {
            "name": "fillSize",
            "docs": [
              "Yes-token base units exchanged in this fill."
            ],
            "type": "u64"
          },
          {
            "name": "usdcAmount",
            "docs": [
              "USDC base units exchanged in this fill."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderPlaced",
      "docs": [
        "Emitted when an order (or the unfilled remainder of one) comes to rest."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "side",
            "docs": [
              "0 = Bid (buy Yes), 1 = Ask (sell Yes) — mirrors `OrderSide`'s ordinal."
            ],
            "type": "u8"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "size",
            "docs": [
              "Remaining size that came to rest (post any immediate fills)."
            ],
            "type": "u64"
          },
          {
            "name": "seq",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderSide",
      "docs": [
        "Which side of the (Yes-vs-USDC) order book an order rests on."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "bid"
          },
          {
            "name": "ask"
          }
        ]
      }
    },
    {
      "name": "outcome",
      "docs": [
        "Settlement outcome of a market."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "unsettled"
          },
          {
            "name": "yesWins"
          },
          {
            "name": "noWins"
          }
        ]
      }
    },
    {
      "name": "pairMinted",
      "docs": [
        "Emitted when a user mints a Yes/No pair (F-02)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "docs": [
              "Token base units of each side minted (== USDC base units deposited)."
            ],
            "type": "u64"
          },
          {
            "name": "pairsMinted",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pauseSet",
      "docs": [
        "Emitted when the admin sets the global pause flag (true = paused)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "admin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "placeOrderArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "side",
            "type": {
              "defined": {
                "name": "orderSide"
              }
            }
          },
          {
            "name": "price",
            "docs": [
              "Limit price in USDC-per-Yes at PRICE_SCALE. Ignored when `is_market`."
            ],
            "type": "u64"
          },
          {
            "name": "size",
            "docs": [
              "Order size in Yes-token base units."
            ],
            "type": "u64"
          },
          {
            "name": "isMarket",
            "docs": [
              "Market order: cross at any price, fill-or-cancel the remainder (no rest)."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "redeemSide",
      "docs": [
        "Which outcome token the caller is redeeming."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "yes"
          },
          {
            "name": "no"
          }
        ]
      }
    },
    {
      "name": "redeemed",
      "docs": [
        "Emitted when a user redeems settled tokens (F-02)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "won",
            "type": "bool"
          },
          {
            "name": "tokensBurned",
            "type": "u64"
          },
          {
            "name": "usdcPaid",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "strikeAdded",
      "docs": [
        "Emitted when an additional strike market is provisioned intraday for an",
        "already-trading ticker/day. Distinguishes an intraday add from the day's",
        "initial provisioning for indexers and the automation service."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "ticker",
            "type": {
              "defined": {
                "name": "ticker"
              }
            }
          },
          {
            "name": "strike",
            "type": "u64"
          },
          {
            "name": "tradingDay",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ticker",
      "docs": [
        "The supported MAG7 underlyings. Encoded as a `u8` discriminant on-chain.",
        "",
        "Note: no explicit discriminants — borsh 1.x (Anchor v1) derives ordinal",
        "encoding, and adding explicit `= N` values conflicts with the Anchor derive",
        "macros. The ordinal order below *is* the on-chain encoding; do not reorder."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "aapl"
          },
          {
            "name": "msft"
          },
          {
            "name": "googl"
          },
          {
            "name": "amzn"
          },
          {
            "name": "nvda"
          },
          {
            "name": "meta"
          },
          {
            "name": "tsla"
          }
        ]
      }
    },
    {
      "name": "tickerConfig",
      "docs": [
        "Per-ticker configuration: which underlying and its oracle feed id.",
        "",
        "The `feed_id` is a 32-byte Pyth feed identifier (the on-chain settlement",
        "feature, F-04, uses it to validate the price update account). Stored as raw",
        "bytes so it is oracle-implementation-agnostic at this layer."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ticker",
            "type": {
              "defined": {
                "name": "ticker"
              }
            }
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "payoffUnit",
      "docs": [
        "The number of base units that represent **$1.00**.",
        "`1.00 USDC = 1_000_000` base units (because `10^6`).",
        "A winning token redeems for exactly `PAYOFF_UNIT` USDC base units."
      ],
      "type": "u64",
      "value": "1000000"
    },
    {
      "name": "priceScale",
      "docs": [
        "Order prices are integers in USDC-per-Yes at 6-decimal scale.",
        "The price domain is `[0, PRICE_SCALE]` i.e. `[$0.00, $1.00]`.",
        "Example: a Yes price of $0.65 is `650_000`."
      ],
      "type": "u64",
      "value": "1000000"
    },
    {
      "name": "tokenDecimals",
      "docs": [
        "Decimals for the Yes/No outcome tokens. We mirror USDC (6) so that token",
        "base units map 1:1 to collateral base units: minting 1 pair deposits",
        "`PAYOFF_UNIT` USDC base units and issues `PAYOFF_UNIT` of each token."
      ],
      "type": "u8",
      "value": "6"
    },
    {
      "name": "usdcDecimals",
      "docs": [
        "Decimals for the collateral token (USDC). USDC on Solana has 6 decimals,",
        "so all monetary amounts are expressed in USDC base units."
      ],
      "type": "u8",
      "value": "6"
    }
  ]
};
