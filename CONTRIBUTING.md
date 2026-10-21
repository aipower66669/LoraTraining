# Contributing

Thanks for helping improve LoraTraining.

## Licence of contributions

This repository is licensed **GPL-3.0-only** (see [LICENSING.md](LICENSING.md)
and [LICENSE](LICENSE)).

By opening a pull request or otherwise submitting code, documentation, or other
material to this repository, you agree that your contribution is licensed under
the **GNU General Public License version 3 only**, and that you have the right
to offer it under those terms.

If you cannot agree to that, do not submit the contribution.

## Branding

Do not use official LoraTraining branding in forks or modified distributions
except as allowed in [TRADEMARK.md](TRADEMARK.md).

## Development

```bash
npm install
npm run check    # typecheck + lint + tests (same as CI)
npm run dev
```

Specs and locked decisions live under `docs/` (especially `docs/DECISIONS.md`).

Library schema changes require an idempotent migration script — see
[`scripts/README-migrations.md`](scripts/README-migrations.md) and
[`.cursor/rules/library-access-and-migrations.mdc`](.cursor/rules/library-access-and-migrations.mdc).

## Pull requests

- Keep PRs focused — one logical change when possible.
- Run `npm run check` before opening.
- Update docs when behaviour or on-disk layout changes.
- Do not commit secrets, library paths, or personal training data.

## Issues

Bug reports and feature requests are welcome on
[GitHub Issues](https://github.com/aipower66669/LoraTraining/issues).
Include LoraTraining version, Windows version, and steps to reproduce when
reporting bugs.
