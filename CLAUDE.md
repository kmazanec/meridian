# CLAUDE.md

Guidance for working in the Meridian monorepo. CI is the source of truth — this
file mirrors what the pipeline (`.gitlab-ci.yml`) enforces so local work doesn't
fail in CI.

## Layout

Yarn 4 workspaces under `packages/*`, invoked via `corepack yarn@4.10.2`:

- `@meridian/sdk` — on-chain client + types (built `dist/` consumed by others)
- `@meridian/automation` — morning + settlement jobs
- `@meridian/traders` — trading bots
- `@meridian/web` — Next.js frontend (Vitest)
- `@meridian/e2e` — convergence suite (validator-gated)
- `@meridian/ops` — deploy/lifecycle CLIs

The Rust/Anchor program lives at the repo root (`Anchor.toml`, `Cargo.toml`,
`programs/`). Several SDK/automation tests load the compiled `meridian.so`.

## Before committing — ALWAYS

CI's `lint-ts` job runs `yarn install --immutable` then `yarn lint` then each
package's typecheck/build/test, and fails the whole pipeline on the first error.
Run the relevant checks locally first. At minimum, for any change:

1. **Format** — `yarn lint:fix`, then `yarn lint` must pass.
   `yarn lint` is `prettier --check`; CI fails if any file is unformatted.
2. **Lockfile** — if you changed any `package.json` (deps, `bin`, scripts that
   add a bin), run `yarn install` so `yarn.lock` regenerates, and commit it.
   CI runs `yarn install --immutable` and fails (`YN0028`) if the lockfile is
   stale.
3. **Typecheck** the package(s) you touched, e.g.
   `yarn workspace @meridian/web typecheck`.
4. **Test** the package(s) you touched, e.g.
   `yarn workspace @meridian/web test`.

For Rust/program changes, also run `cargo fmt --all`, `cargo clippy --workspace
--all-targets -- -D warnings`, and `cargo test --workspace` (CI's `fmt` +
`verify` jobs; the latter `include_bytes!`s a built `meridian.so`).

Don't commit unrelated work-in-progress alongside a fix — keep commits scoped to
one concern, and check `git status` before staging.

## Commands

```sh
yarn lint            # prettier --check  (CI gate)
yarn lint:fix        # prettier -w       (run this before committing)
yarn install         # regenerate yarn.lock after a package.json change

yarn workspace @meridian/<pkg> typecheck
yarn workspace @meridian/<pkg> test
yarn workspace @meridian/<pkg> build
```

The full off-chain test sweep CI runs (mirrors the `lint-ts` job): lint, then for
each package its typecheck → build → test. The `@meridian/e2e` and
`@meridian/ops` validator-gated tests run locally only (CI runs their
`test:contract` subset). See `docs/local-development.md`.

## Notes

- `SDK_SKIP_LITESVM=1` skips the on-chain LiteSVM tests (native litesvm leaks
  memory and OOMs the small CI runner); CI sets it. Locally the full suite runs.
- Never read `.env` / `.env.local`.
