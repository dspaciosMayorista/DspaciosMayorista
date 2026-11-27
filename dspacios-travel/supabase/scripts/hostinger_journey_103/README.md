# Hostinger inbound journey harness (#103) — local, loopback, disposable

Reproduces the compiled-app journey for the Hostinger adapter with a **simulated Mail API**. Nothing leaves the machine: no Hostinger/Resend call, no live mailbox, no owner data. Windows only (PowerShell process inspection).

## Prerequisites (explicit local settings — nothing is guessed)

The harness **never mutates a PostgreSQL container you point it at.** Roles and passwords are cluster-wide, so a database marker cannot protect the other databases of a shared container. It creates, uses and removes its **own dedicated container `hj103_pg`** (`pg-create`).

| Setting | Meaning |
|---|---|
| `HJ_SOURCE_PG_CONTAINER`, `HJ_SOURCE_TEMPLATE_DB` | only for `pg-create`: an existing container and template database holding the base schema (migrations 001–314). They are **only read** (`pg_dump`); the source is never modified. Password: `HJ_SOURCE_PG_PASSWORD` (default `postgres`) |
| `HJ_WORK` | folder for generated credentials, the container ownership record (`pg.json`), process records and logs. Default `%TEMP%\hostinger-journey-103`. **Must be outside the repository** (`init` refuses otherwise) |
| `HJ_DB` | target database inside the dedicated container, default `hj103_journey`; must match `hj103_[a-z0-9_]+` and carry the harness marker comment |
| `HJ_APP_PORT` | optional override of the app port (default from the work folder config) |
| `HJ_PG_IMAGE` | optional image for the dedicated container (default `public.ecr.aws/supabase/postgres:15.8.1.085`) |
| `HJ_PG_CONTAINER` | **not a way to choose a container**: any value other than `hj103_pg` makes every PostgreSQL-touching command refuse |

Docker Desktop, Node ≥ 22, the product build in `.next` (made with the environment printed by `harness.mjs build-env` — the gateway URL and the generated anon key are inlined into the bundle; `cpus2.cjs` + `guardia.mjs` are optional memory helpers for the build).

## One sequence

```
cd supabase/scripts/hostinger_journey_103
node harness.mjs init              # generates credentials in HJ_WORK (outside the repo)
node harness.mjs pg-create         # DEDICATED container hj103_pg (no published port) + template loaded read-only from the source; writes the ownership record
node harness.mjs up                # ownership check FIRST, then database from the template + migrations ≥315, Mailpit, GoTrue, PostgREST, local gateway
node harness.mjs seed              # synthetic users, two contracts, eight supplier requests (validated target first)
node harness.mjs sim-start         # simulated Mail API (127.0.0.1)
node harness.mjs app-start         # `next start -H 127.0.0.1`, then proves loopback-only
node recorrido_hostinger.mjs       # the 32-check journey (evidence → HJ_WORK/evidence.json)
node harness.mjs app-stop ; node harness.mjs sim-stop
node harness.mjs down              # stack containers/network with the harness label + the marked database; keeps the dedicated container and HJ_WORK
node harness.mjs pg-destroy        # removes the dedicated container (only after verifying it is the one this work folder created)
node checks_harness.mjs            # focused checks: foreign ports, ownership-verified stop, loopback bind (needs the build in .next)
node checks_pg_ownership.mjs       # focused checks: PostgreSQL container ownership (needs HJ_SOURCE_PG_CONTAINER / HJ_SOURCE_TEMPLATE_DB; creates and removes its own control containers)
```

## Safety properties (checked by `checks_harness.mjs`)

* **Ports.** The harness never kills by port. `app-start`, `sim-start` and `up` **refuse** a port that is already listening (named pid, left untouched).
* **Ownership.** Each process the harness starts gets a record (`pid`, start time, expected command-line marker). `*-stop`/`down`/`app-restart` stop a process only if pid + start time + command line all still match (protects against PID reuse); otherwise they refuse and leave it alone.
* **Loopback.** `next start` is started with `-H 127.0.0.1` (Next's default is all interfaces) and `app-start` proves it: every listener address is `127.0.0.1`, and every non-loopback address of the machine refuses a connection. Control: `next start` without `-H` is shown to listen on `::` and be reachable on the machine's LAN addresses.
* **PostgreSQL container (cluster-wide roles).** Before ANY template, database or role statement — on every entry point, because all SQL goes through one guard — the container must be `hj103_pg`, with a full container id equal to the ownership record written at creation (an existing container cannot acquire that id; relabelling does not help), the harness labels, running, and holding **no database other than harness databases** (defence in depth against a forged record). Otherwise `up`/`seed`/`down`/`pg-destroy` refuse and nothing is touched; `down` still stops the harness's own processes/containers first.
* **Database.** Every reset/seed/drop then validates the target: name pattern **and** a marker comment written only when the harness created the database. Unmarked or differently named databases (`postgres`, an owner/review database…) are refused before any statement. Containers/networks are removed only if they carry the harness label.
* **Credentials.** Generated per work folder, never printed to logs except by `build-env` (local anon key), never stored in the repository.

## Files

`harness.mjs` (commands) · `checks_pg_ownership.mjs` (HJ-3 checks) · `lib.mjs` (settings, validation, ownership-verified process control, loopback proof) · `gateway.mjs` (local Auth/REST front door) · `auth_owner_fix.sql` (local-only ownership fix for the template's `auth` schema) · `mailapi_sim.mjs` (simulated Mail API) · `recorrido_hostinger.mjs` (journey) · `checks_harness.mjs` (harness checks) · `guardia.mjs`, `cpus2.cjs` (memory guard / build parallelism) · `huella.mjs` (source fingerprint) · `evidence_*` (retained run-3 and build evidence, including the before/after fingerprint digests).

Not covered: the product build itself (this harness does not build), hosted function limits, the real Hostinger contract, a live mailbox.

## Owner review session (lifecycle that PRESERVES the review)

`review.mjs` wraps the harness for the owner's walkthrough (`docs/tecnico/owner-walkthrough-103.md`). All review scripts read the same settings: **`HJ_REVIEW_DIR`** (or `HJ_WORK`), default `%USERPROFILE%\hostinger-review-103`; the read-only schema source defaults to `pg127` / `plantilla127`.

| Command | What it does |
|---|---|
| `node review.mjs start` | First time: dedicated container → stack → `seed_review.mjs` (synthetic data, four accounts, contracts DTM-2001…2004, credentials sheet, sample proof) → simulator → app → **observed** readiness checks. Afterwards: **resumes** the stopped environment (`harness.mjs resume`) — no re-creation, no re-seeding |
| `node review.mjs stop` | `harness.mjs stop`: stops app, simulator, gateway and containers; **deletes nothing** (database, volumes with captured mail and uploaded files, simulated mailbox `sim-state.json`, config, credentials, browser profile). The stopped state is observed before success is printed |
| `node review.mjs status` | real checks; exit 0 = running and ready or cleanly stopped, 1 otherwise |
| `node review.mjs reply DTM-2001 "text"` | walkthrough W8 (same as `node review_reply.mjs …`, same settings) |
| `node review.mjs browser [account]` / `browser-prepare [account] [--verify]` | dedicated Edge profile with the four synthetic accounts saved (no typing; see `review_browser.mjs`) |
| `node review.mjs fingerprint` | fingerprint of the review progress (rows, uploaded bytes, captured mail, simulated mailbox, files, saved accounts): equal before stop and after start |
| `node review.mjs reset --destroy-review-data` | **explicit, owner-authorized only**: deletes the review database, volumes and dedicated container (config, credentials, browser profile kept). `up`, `down` and `pg-destroy` refuse over a seeded review unless `HJ_CONFIRM_DESTROY=yes` (set only by `reset`) |

Every failing step makes the exit status non-zero and the final line says so («NOT READY», «STOP FAILED»); the seed is **not atomic** (Auth users first, data in several transactions) but idempotent — running `start` again completes it. `checks_review.mjs` (no services) proves the failure reporting and the shared settings; `rehearsal_walkthrough.mjs` (W1–W11) and `rehearsal_lifecycle.mjs` (stop/start preservation and refusals) are the executor's rehearsal on a separate fixture (`HJ_REVIEW_DIR=<other folder>`; create it with `review.mjs start` after copying `config.json` there; destroy it with `review.mjs reset --destroy-review-data`).
