// COMPARACIÓN DE BASES de la revisión (solo lectura): tabla por tabla y fila por fila (hash de las columnas que existen en AMBAS bases) entre una base ANTERIOR y la base ACTUAL, en los esquemas
// public, auth y storage. Salida: filas que estaban antes y ya no están idénticas (borradas o cambiadas) y filas añadidas, por tabla.
// Uso (desde dspacios-travel/, con pg304 arriba):  node supabase/scripts/localreview/comparar_bases_revision.mjs [base_anterior=rev_prev_cmp] [base_actual=rev_revision]
// Para crear la base anterior desde el respaldo de ampliar125 (MSYS_NO_PATHCONV=1 en Git Bash):
//   docker cp "%LOCALAPPDATA%/dspacios-local-revision/respaldos/<archivo>.dump" pg304:/tmp/rev_prev.dump
//   docker exec -e PGPASSWORD=postgres pg304 psql -U supabase_admin -d postgres -c "create database rev_prev_cmp"
//   docker exec -e PGPASSWORD=postgres pg304 pg_restore -U supabase_admin --no-owner --no-privileges -d rev_prev_cmp /tmp/rev_prev.dump
import { execFileSync } from "node:child_process";
const psql = (db, q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", maxBuffer: 1 << 28 });
const ANTES = process.argv[2] ?? "rev_prev_cmp", AHORA = process.argv[3] ?? "rev_revision";
const esquemas = ["public", "storage", "auth"];
const colsDe = (db) => {
  const filas = psql(db, `select c.table_schema||'.'||c.table_name, c.column_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where t.table_type = 'BASE TABLE' and c.table_schema in ('public','storage','auth') order by 1, c.ordinal_position`).trim().split("\n").filter(Boolean).map((l) => l.split("|"));
  const m = new Map(); for (const [t, c] of filas) (m.get(t) ?? m.set(t, []).get(t)).push(c); return m;
};
const cA = colsDe(ANTES), cB = colsDe(AHORA);
const tablas = [...cA.keys()].filter((t) => cB.has(t)).sort();
const soloAhora = [...cB.keys()].filter((t) => !cA.has(t));
const comunes = (t) => cA.get(t).filter((c) => cB.get(t).includes(c));
const sqlHash = (db) => tablas.map((t) => { const cols = comunes(t).map((c) => `"${c}"`).join(", "); return `select '${t}' as t, md5(row(${cols})::text) as h from ${t.replace(".", '."') + '"'}`; }).join("\nunion all\n");
const volcar = (db) => new Map(Object.entries(psql(db, sqlHash(db)).trim().split("\n").filter(Boolean).reduce((a, l) => { const [t, h] = l.split("|"); (a[t] ??= []).push(h); return a; }, {})));
const A = volcar(ANTES), B = volcar(AHORA);
let totalBorradasOCambiadas = 0, totalAnadidas = 0; const detalle = [];
for (const t of tablas) {
  const a = A.get(t) ?? [], b = B.get(t) ?? [];
  const cuenta = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const ca = cuenta(a), cb = cuenta(b);
  let soloA = 0, soloB = 0;
  for (const [h, n] of ca) soloA += Math.max(0, n - (cb.get(h) ?? 0));
  for (const [h, n] of cb) soloB += Math.max(0, n - (ca.get(h) ?? 0));
  totalBorradasOCambiadas += soloA; totalAnadidas += soloB;
  if (soloA || soloB) detalle.push({ tabla: t, antes: a.length, ahora: b.length, soloAntes: soloA, soloAhora: soloB });
}
console.log(`tablas comparadas: ${tablas.length} (solo en la base actual: ${soloAhora.join(", ") || "ninguna"})`);
console.log(`filas que estaban ANTES y ya no están idénticas (borradas o cambiadas): ${totalBorradasOCambiadas}`);
console.log(`filas que están AHORA y no estaban antes (añadidas): ${totalAnadidas}`);
console.table(detalle);
