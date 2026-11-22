# Real-chain verification on embedded PostgreSQL (PGlite) — no Docker

Purpose: execute the REAL migration chain (`supabase/migrations/*.sql`, in order) and the new B2B migrations' lifecycle when the Docker engine is unavailable.
It is a SUBSTITUTE for the Docker/PostgREST/GoTrue runs, not an equivalent: single connection (no concurrency tests), PGlite's Postgres build instead of the Supabase image,
and a minimal environment (`entorno.mjs`: roles, `auth` and `storage` stubs, Supabase default privileges). No application schema is faked.

Setup (PGlite is NOT a repo dependency; install it in a folder outside the repo):
    mkdir pgl && cd pgl && npm i @electric-sql/pglite@0.3.14 && copy these four .mjs files there

Run (argument = path to `dspacios-travel`):
    node cadena.mjs   <repo>            # replays every migration; CONTINUE=1 lists all failures; HASTA=<n> stops after migration n
    node ciclo.mjs    <repo>            # 316 → 314 → 317 → 318 → 319 → 322 → 323: preflight, migration, postcheck, re-apply, SQL tests (SOLO=323 to limit)
    node rollbacks.mjs <repo>           # protected rollbacks with data (must refuse), without data (must succeed), preflight back to "to apply", re-apply + postcheck
Exit code is non-zero when any control fails. Psql meta-commands in the test files (`\ir`, `\set`) are interpreted by `ciclo.mjs`.
