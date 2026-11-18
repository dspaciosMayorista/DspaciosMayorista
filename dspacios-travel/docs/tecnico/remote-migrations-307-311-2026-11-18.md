# Owner-executed remote migrations — 2026-11-18

Source: owner-provided SQL editor results from Production. Codex did not execute remote SQL. Application publication remains pending; these results are not a hosted application acceptance.

| Migration | Preflight | Execution | Postcheck | Current status |
|---|---|---|---|---|
| 307 | 11 OK, 6 INFO | Owner returned guard installation: 46 | 15 OK, 2 INFO | Applied and postchecked according to owner evidence |
| 308 | 9 OK, 2 INFO (both zero) | Owner proceeded to postcheck | 10 OK, 1 INFO (2 positions) | Applied and postchecked according to owner evidence |
| 309 | 10 OK, 2 INFO | Owner proceeded to postcheck | 9 OK, 2 INFO; counts unchanged | Applied and postchecked according to owner evidence |
| 310 | 8 OK, 3 INFO; LISTA PARA 310 | Owner proceeded to postcheck | 11 OK, 2 INFO; 310 CORRECTA | Applied and postchecked according to owner evidence |
| 311 | 3 OK, 4 INFO | Owner proceeded to postcheck | 1 OK, 3 INFO; counts unchanged | Applied and postchecked according to owner evidence |

## 307 evidence

- Preflight confirmed expected 288/284/304 dependencies and dtm_reuso_bloqueos fingerprint. No currently counted pending NETO contracts with payments, expired pending contracts with payments or expired pending contracts without payments; 39 contracts with prepared vouchers.
- Postcheck: required objects, RLS, privileges, identity guards, append-only/audit triggers and replacement reuse-function fingerprint all OK. Confirmation rule has no special NETO-total branch and supports the agreement. Expiration preserves pending contracts with payments. Agreement count immediately after applying: zero.
- Commission cycle #97: **0 before and after**. Consecutive-number reuse: **1 before and after**. Preserve both settings.
- Continue one stage at a time: each owner preflight/postcheck is one integral query; inspect its returned controls before advancing. Do not rerun 307 or edit applied migration SQL.

## 308 evidence

Owner's postcheck confirms both single-signature facades accept pendiente_tarifa, anonymity rules are present, SECURITY DEFINER/fixed search_path/ownership are preserved and only service_role can execute. Existing titular update, CRM listing/document lookup and participant RLS checks are OK. Informational participant-position count: 2. This count does not prove a backfill or identify when those positions were created. No remote SQL executed by Codex.

## 309 evidence

Preflight: 10 OK controls and two INFO counts. Postcheck: 9 OK controls confirm the table, single superadmin-read RLS policy, grants, three triggers, strict identity classification, functions and RPC privileges; the internal reference function is not API-executable. Initial acknowledgment count: zero. Counts match before/after: Mayorista/Minorista contracts **22/158**; contracts/payments/vouchers **180/528/46**. These are count checks, not a row-by-row content comparison. No remote SQL executed by Codex.

## 310 evidence

Preflight verdict LISTA PARA 310, with one linked promotion, one group rule and 1009 hotel seasons. Postcheck verdict 310 CORRECTA: four columns, validated constraint, single eight-argument RPC without the old overload, expected execution privileges, nightly validation and updated rule trigger all OK. No existing promotion was enabled in the new follow-base/free-child modes (count zero). Linked-promotion and rule counts remain one each. Postcheck did not return a new total-season count; no broader row-content preservation is inferred. No remote SQL executed by Codex.

## 311 preflight evidence

Owner returned 3 OK and 4 INFO preflight controls, followed by the postcheck confirming that all four age columns now have no defaults. Counts match before/after: **378 hotels / 58 Adults Only**, **2 non-Adults-Only hotels with invalid/missing age configuration**, **30 hotels matching the old 0–2/2–10 default values**. The two configuration cases are **254 DECAMERON MARYLAND** and **239 OCEAN CORAL SPRING**; complete authoritative ages through Producto, without inventing them. Existing 30 matching-default configurations were not automatically invalidated or rewritten. Migration removes defaults rather than setting ages to zero. The owner initially pasted JSON and received a syntax error, then proceeded to the successful SQL/postcheck; do not rerun an already applied migration.

## Chain complete

**307–311 applied and postchecked in Production according to owner-provided results on 2026-11-18.** Application Git publication and hosted Preview acceptance remain pending. #97 OFF and reuse ON were confirmed unchanged by the 307 checks; no later switch change was requested or executed by Codex.
