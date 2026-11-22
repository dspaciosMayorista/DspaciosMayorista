# Paths deliberately NOT staged — integrated block #126 / #127 / B2B (2026-11-21)

Counts come from `git status --porcelain=v1 -uall` on the integration worktree (root `.worktrees/integracion-126-127-b2b`), 0 files staged, before this document was added (re-counted 2026-11-21 after REL-1/REL-2: 459 releasable, 17 774 excluded; `publish-release.ps1` re-checks both numbers and refuses any other dirty path).

| Excluded | Files | Why |
|---|---:|---|
| `dspacios-travel/.next-4drj-anterior/`, `.next-dvq-anterior/`, `.next-mjuz-anterior/`, `.next-r2-anterior/`, `.next-zjq-anterior/`, `.next-previo/` | 17 715 | Old compiled builds kept for rollback during local review. **Not** covered by `.gitignore` (it ignores only `/.next/`), so a blanket `git add .` would stage them. Keep them on disk; never stage. |
| `dspacios-travel/docs/tecnico/evidence-326/*.png` | 55 | Screenshots of the owner-review journeys (≈ 30 MB, executor evidence) and tiny synthetic upload fixtures (`texto-disfrazado.png`, `unico-*.png`). Earlier merged work committed Markdown only (3 non-Markdown files in `docs/tecnico` at `origin/main`). The text logs and failing-name lists next to them **are** staged so the documents' references to logs resolve. The screenshots stay local at `docs/tecnico/evidence-326/`. |
| `dspacios-travel/docs/tecnico/evidence-326/no-es-imagen.txt` | 1 | Synthetic upload fixture written by the journey. |
| `dspacios-travel/integrar-lote-local.mjs` | 1 | Codex's local composition script («never stages or commits»); not product code, hard-codes local paths. |
| `dspacios-travel/supabase/scripts/localreview_integrado/preparar_navegador_revision.mjs` and `navegador_revision.ps1` | 2 | Seed passwords into a browser's credential store by reading its DPAPI-protected key. Local-environment/credential tooling, unrelated to the product release; keep local. |

## Also not part of this branch (never in this worktree's status)
- `node_modules`, `.next/` (ignored), `*.tsbuildinfo`, `.env*`, `*.dump`, `backups/`, `**/roles.sql|schema.sql|data.sql|MANIFEST.txt` (all covered by `.gitignore`).
- The owner's review database dumps and file backups (`rev_verif_int_revision_pre325_*.dump`, `rev_verif_int_revision_pre326_*.dump`, `storage_pre32*`), the Edge review profile, `config.json` and logs: they live in `%LOCALAPPDATA%\dspacios-local-revision-int\`, outside the repository.
- Codex coordination documents that exist only in the main checkout (audits, handoffs, probes).
- Other worktrees under `.worktrees/` and `C:\tmp\*` (source branches of the integration; their commits are not touched).

## Checks run on everything that IS staged
- **Secrets scan** over the 449 originally accepted release files plus the 10 REL-1/REL-2/REL-3 artifacts (also clean: no user-name path, no token pattern) (text; PNG/old builds excluded): no JWT, private key, GitHub/AWS token, `sb_secret_*` or service key. Only synthetic values: local Docker URLs `postgres://…@v1real_pg:5432`, three test-literal `*_SECRET` values (one already in `origin/main`), the synthetic review password already present in `origin/main` (`localreview/*`), placeholder e-mail domains (`agencia.com`, `x.co`, `test.co`…).
- Two new artifacts carried the Windows user name in a local path; the path prefix was replaced by `%LOCALAPPDATA%` / `<repo>` (literal, equivalent substitution). Two older tracked documents at `origin/main` still contain such paths (unchanged by this block).
- No dependency change: `package.json` differs only in the `test:*` scripts (`test:react` is 8 106 characters, 85 under the Windows command-line limit); no lockfile change; no new environment variable name in the code.
