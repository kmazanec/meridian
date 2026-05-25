//! Oracle abstraction for settlement (ARCHITECTURE.md ADR-004).
//!
//! Settlement reads a stock's closing price from a Pyth price-update account that
//! a client has posted on-chain via the **Pyth Solana Receiver** (program
//! `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, identical on devnet + mainnet).
//! `settle_market` consumes the resulting `PriceUpdateV2` account.
//!
//! ## Why we hand-parse instead of using the Pyth SDK
//!
//! `pyth-solana-receiver-sdk` / `pyth-sdk-solana` pull a second major version of
//! the `solana-program` crate ecosystem (a Borsh-version conflict via
//! `pythnet-sdk`) that does **not** BPF-compile against this toolchain
//! (Anchor 1.0.2 / Solana 3.1.x) — the same dependency class hit by
//! `spl-token-2022-interface`. So we vendor a minimal, defensive byte-parser for
//! the `PriceUpdateV2` account here. This keeps the dependency surface tiny and
//! fully under our control; correctness is pinned by the layout tests below.
//!
//! ## `PriceUpdateV2` on-chain layout (Anchor/borsh serialization)
//!
//! ```text
//! off  size  field
//! 0    8     anchor account discriminant
//! 8    32    write_authority: Pubkey
//! 40   1|2   verification_level: enum  (Partial{u8} = tag 0 + 1 byte; Full = tag 1)
//!            --- price_message: PriceFeedMessage ---
//!      32    feed_id: [u8; 32]
//!      8     price: i64
//!      8     conf: u64
//!      4     exponent: i32
//!      8     publish_time: i64
//!      8     prev_publish_time: i64
//!      8     ema_price: i64
//!      8     ema_conf: u64
//!            --- end price_message ---
//!      8     posted_slot: u64
//! ```
//!
//! The **`verification_level` enum is variable length** (borsh encodes the variant
//! index as one byte; the `Partial` variant carries an extra `u8`), so the offset
//! of `price_message` is *not* fixed — the parser reads the tag and branches. This
//! is the one subtle correctness point; it is covered by tests for both variants.
//!
//! Source of the field order: pyth-network/pyth-crosschain
//! `pythnet/pythnet_sdk/src/messages.rs` (`PriceFeedMessage`) and
//! `pyth_solana_receiver_sdk/src/price_update.rs` (`PriceUpdateV2`).

use crate::error::MeridianError;
use anchor_lang::prelude::*;

/// The Pyth Solana Receiver program id (same on devnet and mainnet, ADR-004).
/// A valid `PriceUpdateV2` account is owned by this program.
pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// Anchor account discriminant length (every Anchor account is prefixed by 8 bytes).
const DISCRIMINATOR_LEN: usize = 8;
/// `write_authority: Pubkey` length.
const WRITE_AUTHORITY_LEN: usize = 32;
/// borsh variant tag for `VerificationLevel::Partial { num_signatures: u8 }`.
const VERIFICATION_PARTIAL_TAG: u8 = 0;
/// borsh variant tag for `VerificationLevel::Full`.
const VERIFICATION_FULL_TAG: u8 = 1;

/// The Anchor account discriminator for `PriceUpdateV2`: the first 8 bytes of
/// `sha256("account:PriceUpdateV2")`. A genuine price-update account always
/// starts with these bytes; checking them confirms the receiver-owned account is
/// actually a `PriceUpdateV2` and not some other account type the receiver owns
/// (its `Config`, a `GuardianSet`, or a future type). Computed and pinned here so
/// we don't depend on the Pyth SDK.
const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

/// A validated, oracle-implementation-agnostic price reading, normalized for the
/// settlement decision. Produced by [`parse_price_update`]; consumed by
/// `settle_market`. Keeping this type free of any SDK detail is what lets the
/// oracle source change (live Pyth, crypto stand-in, mock) without touching the
/// settlement instruction (ADR-004's oracle interface).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct OraclePrice {
    /// The 32-byte Pyth feed id this update is for (matched against `Config`).
    pub feed_id: [u8; 32],
    /// Signed price in the feed's native scale: real value = `price × 10^exponent`.
    pub price: i64,
    /// Confidence interval (one standard deviation), same scale as `price`.
    pub conf: u64,
    /// Base-10 exponent (typically negative, e.g. -8 for equities on Pyth).
    pub exponent: i32,
    /// Unix timestamp (seconds) the price was published.
    pub publish_time: i64,
    /// True iff the update was posted with `VerificationLevel::Full` (the full
    /// Wormhole guardian quorum verified the price). `Partial` updates require
    /// fewer guardians and Pyth documents them as unsafe for settlement
    /// consumers, so the settlement handler requires this to be true.
    pub fully_verified: bool,
}

impl OraclePrice {
    /// Convert the native-scale price to **USDC base units (6 dp)** — the unit of
    /// `Market::strike` and `Market::settlement_price` (constants.rs `USDC_DECIMALS`).
    ///
    /// Real value is `price × 10^exponent`; expressed in 6-dp base units that is
    /// `price × 10^(exponent + 6)`. We rescale with integer math only (no floats,
    /// see ROADMAP.md):
    /// - if `exponent + 6 >= 0`: multiply by `10^(exponent+6)`
    /// - else: divide by `10^-(exponent+6)` (truncating toward zero)
    ///
    /// Negative prices (a malformed/garbage feed) and any overflow are rejected.
    pub fn to_usdc_base_units(&self) -> Result<u64> {
        require!(self.price >= 0, MeridianError::InvalidArgument);
        let price = self.price as u128;

        // shift = exponent + USDC_DECIMALS(6)
        let shift = (self.exponent as i64)
            .checked_add(crate::constants::USDC_DECIMALS as i64)
            .ok_or(MeridianError::MathOverflow)?;

        let scaled: u128 = if shift >= 0 {
            let factor = pow10_u128(shift as u32).ok_or(MeridianError::MathOverflow)?;
            price
                .checked_mul(factor)
                .ok_or(MeridianError::MathOverflow)?
        } else {
            let divisor = pow10_u128((-shift) as u32).ok_or(MeridianError::MathOverflow)?;
            price / divisor
        };

        u64::try_from(scaled).map_err(|_| error!(MeridianError::MathOverflow))
    }

    /// The confidence band, expressed in USDC base units (6 dp), for threshold
    /// comparisons. Uses the same integer rescaling as [`Self::to_usdc_base_units`].
    pub fn conf_in_usdc_base_units(&self) -> Result<u64> {
        // Reuse the price path by treating conf as a non-negative price.
        let as_price = OraclePrice {
            price: i64::try_from(self.conf).map_err(|_| error!(MeridianError::MathOverflow))?,
            conf: 0,
            ..*self
        };
        as_price.to_usdc_base_units()
    }

    /// True if the price is older than `max_age` seconds relative to `now`.
    /// A `publish_time` in the future (clock skew / spoof) is also treated as
    /// unusable — `now - publish_time` is negative, which we reject as stale.
    pub fn is_stale(&self, now: i64, max_age: i64) -> bool {
        match now.checked_sub(self.publish_time) {
            Some(age) => !(0..=max_age).contains(&age),
            None => true,
        }
    }

    /// True if the confidence band is acceptable: `conf / |price| <= max_bps / 10_000`.
    /// Evaluated in the feed's native scale (the exponent cancels), so no rescale is
    /// needed. A non-positive price makes the ratio undefined → not OK.
    pub fn confidence_ok(&self, max_bps: u64) -> bool {
        if self.price <= 0 {
            return false;
        }
        let price = self.price as u128;
        let conf = self.conf as u128;
        // conf/price <= max_bps/10_000  <=>  conf*10_000 <= price*max_bps
        match (conf.checked_mul(10_000), price.checked_mul(max_bps as u128)) {
            (Some(lhs), Some(rhs)) => lhs <= rhs,
            _ => false,
        }
    }
}

/// `10^exp` as u128, or `None` on overflow.
fn pow10_u128(exp: u32) -> Option<u128> {
    10u128.checked_pow(exp)
}

/// Read a little-endian fixed-size integer from `data` at `offset`, bounds-checked.
macro_rules! read_le {
    ($ty:ty, $data:expr, $offset:expr) => {{
        const N: usize = core::mem::size_of::<$ty>();
        let start = $offset;
        let end = start
            .checked_add(N)
            .ok_or(error!(MeridianError::InvalidArgument))?;
        let slice = $data
            .get(start..end)
            .ok_or(error!(MeridianError::InvalidArgument))?;
        let arr: [u8; N] = slice.try_into().unwrap();
        <$ty>::from_le_bytes(arr)
    }};
}

/// Parse a `PriceUpdateV2` account's raw data into an [`OraclePrice`].
///
/// This does **not** trust the account blindly — every read is bounds-checked and
/// the variable-length `verification_level` is decoded explicitly. The caller
/// (`settle_market`) is responsible for verifying the account *owner* is
/// [`PYTH_RECEIVER_PROGRAM_ID`] and that the returned `feed_id` matches the
/// market's configured feed; this function only decodes bytes.
pub fn parse_price_update(data: &[u8]) -> Result<OraclePrice> {
    // Discriminator: confirm this is actually a `PriceUpdateV2`, not some other
    // account type the Pyth receiver owns (defense-in-depth alongside the caller's
    // owner check). A wrong/short discriminator → reject.
    let disc = data
        .get(0..DISCRIMINATOR_LEN)
        .ok_or(error!(MeridianError::InvalidPriceUpdateAccount))?;
    require!(
        disc == PRICE_UPDATE_V2_DISCRIMINATOR,
        MeridianError::InvalidPriceUpdateAccount
    );

    // discriminant (8) + write_authority (32) → start of verification_level
    let vl_off = DISCRIMINATOR_LEN + WRITE_AUTHORITY_LEN;
    let tag = *data
        .get(vl_off)
        .ok_or(error!(MeridianError::InvalidArgument))?;

    // price_message begins right after the (variable-length) verification_level.
    let (pm_off, fully_verified) = match tag {
        VERIFICATION_PARTIAL_TAG => (vl_off + 1 + 1, false), // tag + num_signatures: u8
        VERIFICATION_FULL_TAG => (vl_off + 1, true),         // tag only
        _ => return err!(MeridianError::InvalidArgument),
    };

    // PriceFeedMessage fields, in source order.
    let feed_id: [u8; 32] = data
        .get(pm_off..pm_off + 32)
        .ok_or(error!(MeridianError::InvalidArgument))?
        .try_into()
        .unwrap();
    let after_feed = pm_off + 32;
    let price = read_le!(i64, data, after_feed);
    let conf = read_le!(u64, data, after_feed + 8);
    let exponent = read_le!(i32, data, after_feed + 16);
    let publish_time = read_le!(i64, data, after_feed + 20);

    Ok(OraclePrice {
        feed_id,
        price,
        conf,
        exponent,
        publish_time,
        fully_verified,
    })
}

// ---------------------------------------------------------------------------
// Unit tests — byte layout, variable-length enum, integer rescaling.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    /// Build a `PriceUpdateV2` byte blob matching the borsh layout, for a given
    /// verification variant. Mirrors how the Pyth receiver serializes the account.
    fn make_account(
        verification_full: bool,
        feed_id: [u8; 32],
        price: i64,
        conf: u64,
        exponent: i32,
        publish_time: i64,
    ) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&PRICE_UPDATE_V2_DISCRIMINATOR); // valid discriminator
        v.extend_from_slice(&[7u8; WRITE_AUTHORITY_LEN]); // write_authority (arbitrary)
        if verification_full {
            v.push(VERIFICATION_FULL_TAG);
        } else {
            v.push(VERIFICATION_PARTIAL_TAG);
            v.push(5u8); // num_signatures
        }
        // price_message
        v.extend_from_slice(&feed_id);
        v.extend_from_slice(&price.to_le_bytes());
        v.extend_from_slice(&conf.to_le_bytes());
        v.extend_from_slice(&exponent.to_le_bytes());
        v.extend_from_slice(&publish_time.to_le_bytes());
        v.extend_from_slice(&0i64.to_le_bytes()); // prev_publish_time
        v.extend_from_slice(&0i64.to_le_bytes()); // ema_price
        v.extend_from_slice(&0u64.to_le_bytes()); // ema_conf
        v.extend_from_slice(&0u64.to_le_bytes()); // posted_slot
        v
    }

    #[test]
    fn parses_full_verification_variant() {
        let feed = [9u8; 32];
        let data = make_account(true, feed, 214_30000000, 5_000000, -8, 1_700_000_000);
        let p = parse_price_update(&data).unwrap();
        assert_eq!(p.feed_id, feed);
        assert_eq!(p.price, 214_30000000);
        assert_eq!(p.conf, 5_000000);
        assert_eq!(p.exponent, -8);
        assert_eq!(p.publish_time, 1_700_000_000);
        assert!(p.fully_verified, "Full variant → fully_verified");
    }

    #[test]
    fn parses_partial_verification_variant_with_offset_shift() {
        // The Partial variant inserts an extra byte before price_message; the
        // parser must still land on feed_id. This is the layout's trap.
        let feed = [3u8; 32];
        let data = make_account(false, feed, 100_00000000, 1, -8, 42);
        let p = parse_price_update(&data).unwrap();
        assert_eq!(p.feed_id, feed);
        assert_eq!(p.price, 100_00000000);
        assert_eq!(p.publish_time, 42);
        assert!(!p.fully_verified, "Partial variant → not fully_verified");
    }

    #[test]
    fn rejects_truncated_account() {
        let data = vec![0u8; 20]; // far too short
        assert!(parse_price_update(&data).is_err());
    }

    #[test]
    fn rejects_bad_discriminator() {
        // A receiver-owned account that is NOT a PriceUpdateV2 (wrong first 8 bytes).
        let mut data = make_account(true, [1u8; 32], 1, 1, -8, 1);
        data[0] ^= 0xFF; // corrupt the discriminator
        assert!(parse_price_update(&data).is_err());
    }

    #[test]
    fn rejects_unknown_verification_tag() {
        let mut data = make_account(true, [0u8; 32], 1, 1, -8, 1);
        data[DISCRIMINATOR_LEN + WRITE_AUTHORITY_LEN] = 99; // bogus tag
        assert!(parse_price_update(&data).is_err());
    }

    #[test]
    fn scales_equity_exponent_minus_8_to_6dp() {
        // $214.30 at exponent -8 → 214_30000000 native → 214_300000 base units (6dp).
        let p = OraclePrice {
            fully_verified: true,
            feed_id: [0; 32],
            price: 214_30000000,
            conf: 0,
            exponent: -8,
            publish_time: 0,
        };
        assert_eq!(p.to_usdc_base_units().unwrap(), 214_300000);
    }

    #[test]
    fn scales_exponent_minus_5_to_6dp() {
        // exponent -5, shift = +1 → multiply by 10. $7.00 = 700000 native → 7_000000.
        let p = OraclePrice {
            fully_verified: true,
            feed_id: [0; 32],
            price: 700_000,
            conf: 0,
            exponent: -5,
            publish_time: 0,
        };
        assert_eq!(p.to_usdc_base_units().unwrap(), 7_000_000);
    }

    #[test]
    fn scales_positive_exponent() {
        // exponent +2, shift = +8. price 3 → 3 × 10^8 = 300_000_000 base units ($300).
        let p = OraclePrice {
            fully_verified: true,
            feed_id: [0; 32],
            price: 3,
            conf: 0,
            exponent: 2,
            publish_time: 0,
        };
        assert_eq!(p.to_usdc_base_units().unwrap(), 300_000_000);
    }

    #[test]
    fn rejects_negative_price() {
        let p = OraclePrice {
            fully_verified: true,
            feed_id: [0; 32],
            price: -1,
            conf: 0,
            exponent: -8,
            publish_time: 0,
        };
        assert!(p.to_usdc_base_units().is_err());
    }

    #[test]
    fn staleness_window() {
        let p = OraclePrice {
            fully_verified: true,
            feed_id: [0; 32],
            price: 1,
            conf: 0,
            exponent: -8,
            publish_time: 1000,
        };
        assert!(!p.is_stale(1000, 60)); // fresh (age 0)
        assert!(!p.is_stale(1060, 60)); // exactly at the edge
        assert!(p.is_stale(1061, 60)); // one second too old
        assert!(p.is_stale(999, 60)); // future publish_time → unusable
    }

    #[test]
    fn confidence_threshold() {
        // price 100_00000000, conf 1_00000000 → 1% = 100 bps.
        let p = OraclePrice {
            fully_verified: true,
            feed_id: [0; 32],
            price: 100_00000000,
            conf: 1_00000000,
            exponent: -8,
            publish_time: 0,
        };
        assert!(p.confidence_ok(100)); // exactly 1% allowed at 100 bps
        assert!(p.confidence_ok(200)); // looser threshold ok
        assert!(!p.confidence_ok(50)); // tighter threshold rejects
    }

    #[test]
    fn confidence_rejects_nonpositive_price() {
        let p = OraclePrice {
            fully_verified: true,
            feed_id: [0; 32],
            price: 0,
            conf: 0,
            exponent: -8,
            publish_time: 0,
        };
        assert!(!p.confidence_ok(100));
    }
}
