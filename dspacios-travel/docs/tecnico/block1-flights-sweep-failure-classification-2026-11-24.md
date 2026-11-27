# Block 1 — classification of the 22-file sweep failure (valorContratoItem / ContratoDocumento C.15/F.31)

Date: 2026-11-24. Result: **baseline parity — not a regression of the delivery.** No code was changed.

**Failing test** (file `pruebas/convertirCotizacionCarritoBernaloWiring.test.ts`, 52 tests): describe «lib/contrato/valorContratoItem.ts / ContratoDocumento.tsx — regla C.15/F.31», test «el total y las tablas de línea usan valorVisibleContratoItem/totalVisibleContratoItems — ya no queda la fórmula inline vieja».

**Method.** Same command, flags and Node (v24.22.1) on both trees, one worker, 256 MB heap, from each tree's `dspacios-travel/`:
`node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs --test --test-concurrency=1 <file>` (whole file) and the same with `--test-name-pattern="el total y las tablas de línea usan valorVisibleContratoItem"` (exact test).
- Delivery: `block1-vuelos` worktree (HEAD `cd9bb1946` plus the uncommitted block-1 work).
- Clean baseline: a new detached worktree of `cd9bb1946` (`C:/tmp/base_block1_cd9bb1946`, 0 modified files), created only for this check. Other worktrees (including the three others sitting at the same commit) were not touched.

| Run | Delivery | Clean cd9bb1946 |
|---|---|---|
| whole file | 52 tests, **51 pass, 1 fail** | 52 tests, **51 pass, 1 fail** |
| exact test | 1 test, **0 pass, 1 fail** | 1 test, **0 pass, 1 fail** |

The same single test fails in both, with the same assertion: `las 3 superficies (línea total agregada + tabla alojamiento + tabla servicios) deben usar el helper por línea — actual: 0, expected: 3`. After normalizing paths and timings the logs differ only in the Node process id inside two warning lines. Raw outputs are preserved in `docs/tecnico/evidence-block1-r7/` (`delivery-file.log`, `delivery-exact.log`, `base-file.log`, `base-exact.log`).
`git diff cd9bb1946` is empty for `components/contrato/ContratoDocumento.tsx`, `lib/contrato/valorContratoItem.ts` and the test file: the delivery did not touch the code under test or the test.

**Cause (pre-existing, outside block 1).** The test counts the literal text `valorVisibleContratoItem(it)` in `ContratoDocumento.tsx`; the document now calls the helper with other variable names (`valorVisibleContratoItem(item)` at line 256 and `valorVisibleContratoItem(linea)` at line 289) and `totalVisibleContratoItems(items)` is still used, so the behavior the rule protects is intact and the test's regex is simply stale. Left unchanged: it is not part of block 1 and the owner/other blocks may be working on those files; the fix (matching the helper call regardless of variable name) can be taken separately.
