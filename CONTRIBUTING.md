# Contributing to ThoughtTracker

Thanks for the interest. This project is primarily a personal portfolio
showcase, but PRs and issues are welcome.

## Quick dev loop

```bash
docker compose up -d # start Postgres
npm install # install workspaces
npm run db:push # apply Prisma schema
npm run db:seed # optional: seed deterministic test fixtures into a *_test DB
npm run dev # start backend + frontend
```

Open <http://localhost:5173>.

## Project layout

- `backend/` — Express + TypeScript + Prisma API
- `frontend/` — React + Vite + Tailwind UI
- `../thoughttracker-ml/` — optional Python ML classifier (sibling repo)

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the data-flow diagram and the
[`docs/adr/`](./docs/adr/) directory for design decisions.

## Before opening a PR

```bash
npm run typecheck # both packages
npm run lint # both packages
npm run test # backend supertest + frontend RTL
npm run test:e2e # Playwright end-to-end (needs Postgres running)
```

CI (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs typecheck +
lint, the backend and frontend Vitest suites with **100% line coverage**
enforced, a frontend build, a secret scan, and a Playwright end-to-end job
against a pgvector Postgres service. The sibling `thoughttracker-ml` repo runs
`pytest` with `--cov-fail-under=100`. Keep line coverage at 100% before opening
a PR.

## What goes in a good PR

- One self-contained change
- A short description of *what* and *why* (the *what* is in the diff)
- For UI changes: a before/after screenshot or short clip
- For API changes: an updated OpenAPI block in `backend/src/openapi/`
- Tests for non-trivial logic

## Code style

- TypeScript strict mode everywhere
- No emoji in code or commits unless explicitly requested
- Default to no comments. Only add a comment when the *why* is non-obvious
- One source of truth for user-facing strings: `frontend/src/i18n/en.ts` (i18n = internationalization). Import via `import { strings } from "../i18n/en"` and reference `{strings.section.key}` instead of hardcoded JSX text.

## Tone for AI outputs

ThoughtTracker's prompts and reports are **evidence-first** and
**non-judgmental**. New prompts and new analysis features should:

- Use neutral, analytical language
- Never claim to know a speaker's private beliefs
- Carry an evidence quote with every classification
- Use `insufficient_evidence` (or the ML 5-label `unclear`) when the text
  doesn't say enough

If a change tilts the project away from that posture, expect pushback.

## Security

Please don't open public issues for security findings. Email the maintainer
listed in the repo metadata instead.

## License

By contributing, you agree that your contributions will be licensed under
the MIT License (see [`LICENSE`](./LICENSE)).
