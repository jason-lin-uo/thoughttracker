# \_LEARN.md — Project Root

> **For:** future-me who needs to remember why every file at the top of this
> project exists. Written in plain language with analogies. Delete all
> `_LEARN.md` files in the repo when you no longer need them
> (`find . -name "_LEARN.md" -delete`).

---

## The story of this folder

Imagine you're opening a Lego box. The top of the box has the picture on
the front, the instructions, the warranty card, the safety leaflet, and a
list of what's inside. **You haven't touched a single Lego brick yet** —
all of that lives in the smaller bags inside the box. This folder is the
top of the box. The actual code lives one level deeper, inside `backend/`
(the brain), `frontend/` (the face), and a separate sibling repo called
`thoughttracker-ml` (the smart guesser).

Everything at this level is either **"how to read this project"**, **"how
to build this project"**, or **"how to deploy this project"**. No actual
app logic lives here. If you delete any file at this level, the running
app would still work; you'd just lose context, tooling, or the deployment
recipe.

---

## File-by-file

### `README.md`

**What it is:** the front of the Lego box. The first thing anyone (you, a
recruiter, an AI reviewer) sees when they land on the repo's GitHub page.

**Why it exists:** a project without a README is like a restaurant with no
menu — even if the food is amazing, nobody knows what's served. This file
tells the world: what ThoughtTracker is, what it does, how to run it,
how the real transcript corpus is wired in, what's on the roadmap, and that
all conclusions are evidence-backed and not character judgments.

**Used by:** humans reading the GitHub page. Also referenced by
`REVERSE_ENGINEERED_PROMPT.md` and several ADRs that say "see README for
the user-facing story."

---

### `ARCHITECTURE.md`

**What it is:** a deeper technical tour. If `README.md` is the menu,
`ARCHITECTURE.md` is the chef explaining the kitchen.

**Why it exists:** the README is for a recruiter who wants to know "what is
this" in 30 seconds. `ARCHITECTURE.md` is for an engineer who wants to
know "how does this *work*" in 30 minutes — the data flow from import to
report, the layering of controllers/services/jobs, the LLM budget +
cache + retry layer, etc.

**Used by:** engineers doing a deeper review of the project. Also cited
by some ADRs.

---

### `CONTRIBUTING.md`

**What it is:** the rulebook for outsiders who want to add code to this
project. "Here's how to run the tests. Here's the lint setup. Here's the
PR template."

**Why it exists:** if anyone ever opens a pull request, this is the page
they're pointed at. Even for a portfolio project where nobody's expected
to contribute, having this file signals "I take this seriously enough to
treat it like a real open-source project."

**Used by:** would-be contributors and your own future self if you forget
how to run the lint command.

---

### `LICENSE`

**What it is:** the legal sticker that says "this code is free for others
to copy under these conditions." The project uses the MIT license — short,
permissive, very common in open source.

**Why it exists:** GitHub repos without a LICENSE file are technically
"all rights reserved," meaning nobody can legally copy or learn from them.
Adding MIT makes the project genuinely open-source.

**Used by:** GitHub's license detector (which puts a badge on the repo
page), legal-cautious users who want to verify they can use the code.

---

### `PERSONAL_MACHINE_SETUP.md`

**What it is:** a separate runbook for when you (or anyone) wants to run
the product end-to-end on a personal machine — including restoring the real
data dump, refreshing YouTube transcripts, and running the local ML-backed
analysis/reporting path.

**Why it exists:** the README is optimized for a quick first run; this file is
the deeper owner/operator runbook for keeping the real corpus current.

**Used by:** you, when you want to refresh the real corpus or verify a local
machine before showing the project.

---

### `REVERSE_ENGINEERED_PROMPT.md`

**What it is:** a single self-contained prompt that, when handed to a
capable AI coding agent like Claude or Cursor, would let it **reproduce
this entire project from scratch** in the current state.

**Why it exists:** it's both a teaching artifact ("here's what I built and
why") and an insurance policy. If the codebase were deleted tomorrow,
this prompt + the README + the ADRs would be enough to rebuild it. It
also serves as a portfolio piece — recruiters can see the depth of
architectural thinking that went into the project, decision by decision,
gotcha by gotcha (44 gotchas listed in section 7).

**Used by:** anyone re-reading the project years later (including
future-you); recruiters evaluating engineering depth; AI agents that
might be asked to extend or modify the project.

---

### `package.json` (the root one)

**What it is:** the manifest for the whole monorepo — in plain terms, one
big Lego box that holds several smaller, related Lego sets inside it. It
says "this project has two workspaces (think of them as the smaller bags
inside the box): `backend/` and `frontend/`. Here are the project-wide
commands like `npm run dev` (which boots both at once) and `npm run lint`
(which lints both)."

**Why it exists:** **npm workspaces** (npm is the tool that installs Node
code libraries; workspaces are its way of grouping related sub-projects)
let you have multiple related Node projects in one repo and install their
dependencies once. Without this top-level `package.json`, you'd have to
`cd backend && npm install` and `cd frontend && npm install` separately.
With workspaces, a single `npm install` at the root sets up both.

**Used by:** every script that operates across both workspaces (`npm run
test`, `npm run lint`, etc.); Husky (the pre-commit hook system).

---

### `package-lock.json`

**What it is:** the **exact version lock file** (think of it as the
receipt that lists every brick in the box down to the part number) for
every dependency in the whole monorepo. If `package.json` says "I want
React 18-ish," `package-lock.json` says "I'm pinning React 18.3.1
specifically (pinning = locking to one exact version so it can't drift),
with React-DOM 18.3.1, and ReactQuery 5.50.0, and every dependency of
every dependency, all the way down."

**Why it exists:** so that if you, a recruiter, and a CI server all run
`npm install` six months apart, they all get the *exact* same set of
packages — not "whatever's the latest matching version today." This makes
builds reproducible. Without it, the same project can behave differently
on different machines.

**Used by:** `npm install`, every time. Don't edit it by hand; let npm
maintain it. Always commit it to git.

---

### `playwright.config.ts`

**What it is:** the config for the end-to-end browser tests (Playwright is
the browser-automation tool, like a robot that clicks through your app the
way a real person would).

**Why it exists:** unit tests prove that individual functions work (think
of it as testing one Lego brick at a time). Playwright tests prove that
**the whole app works when a real user clicks through it** (the whole
finished Lego model). The config tells Playwright: where the dev server is
(port 5173), which browser to use (Chromium — the open-source guts of
Chrome), where the test files live (`e2e/`), and how to take screenshots
when something fails.

**Used by:** `npm run test:e2e` (the command that runs the browser tests).

---

### `docker-compose.yml` and `docker-compose.full.yml`

**What they are:** two recipes for running parts of the project in
**containers** (sealed boxes that come pre-loaded with everything they
need — like a microwave meal vs. cooking from scratch).

- **`docker-compose.yml`** (the basic one) — boots just Postgres, the
  database. Useful when you want to run the backend and frontend locally
  via `npm run dev`, but you need a database somewhere.
- **`docker-compose.full.yml`** (the full one) — boots Postgres + the
  backend + the frontend all in containers. Useful for "show me the whole
  app with one command, I don't care what's inside."

**Why they exist:** containers let anyone run the project on any computer
(Mac, Windows, Linux) without installing Postgres directly. The recommended
local path still uses Node/npm for fast development, while Docker owns the
database lifecycle.

**Used by:** `docker compose up`. The `full.yml` is referenced in
`docs/DEPLOY.md`.

---

### `render.yaml`

**What it is:** a **Blueprint** for Render.com (a cloud hosting service).
It tells Render: "create a Docker-backed web service for the backend and a
static-site service for the frontend. Wire them together." The database is an
existing pgvector-capable hosted Postgres instance, usually Neon Free, restored
from the trimmed hosted dump before the services go live.

**Why it exists:** so the public portfolio deployment is repeatable instead of
being a pile of dashboard-only settings. Render's free tier is slower than a
paid service, but it is enough for the read-only hosted app path once the data
lives in Neon and the frontend caches common reads.

**Used by:** Render's blueprint system (when you run the deploy command).
Documented in `docs/DEPLOY.md`.

---

### `fly.toml`

**What it is:** the same idea as `render.yaml`, but for **Fly.io** (a
different cloud hosting service). Fly is more flexible for backend-heavy
apps but charges from the start. This config deploys just the backend
API.

**Why it exists:** so you have *two* deploy options. If Render's free tier
runs out or feels slow, you can flip to Fly without rewriting anything.

**Used by:** `fly deploy`. Documented in `docs/DEPLOY.md`.

---

## How this all connects

Think of the repo root as the **lobby of a building**. Above you are two
floors — `backend/` (the engine room downstairs) and `frontend/` (the
showroom upstairs). To either side are smaller annexes — `docs/`,
`e2e/`. And across the street is a sister building, `thoughttracker-ml`
(the standalone ML repo).

When a visitor walks in:

1. They read the lobby plaque (`README.md`).
2. If they're a contractor (engineer), they pull out the architecture
   diagrams (`ARCHITECTURE.md`) and the rulebook (`CONTRIBUTING.md`).
3. If they want to **build their own** version of this building, they
   take home the master blueprint (`REVERSE_ENGINEERED_PROMPT.md`).
4. If they want to live in this building, they read the operating manuals
   (`docker-compose*.yml`, `render.yaml`, `fly.toml`).

Everything in the lobby points to deeper content elsewhere. The lobby
itself contains no apartments.

---

## What to look at next

Once you've read this file, the next files you'd open (in order of
importance) are:

1. `README.md` — the user-facing story
2. `ARCHITECTURE.md` — the technical story
3. `backend/src/_LEARN.md` — the brain
4. `frontend/src/_LEARN.md` — the face
5. `docs/_LEARN.md` — the supporting docs
