// Inventario de integridad de una base de revisión (SOLO LECTURA): prueba que las filas existentes sobreviven a una intervención aditiva.
//   node inventario_integridad.mjs guardar  <base> <archivo.json> [carpeta_archivos ...]   foto: hash de CADA fila (public, auth.users/identities, storage.objects) + columnas + hash de archivos
//   node inventario_integridad.mjs comparar <base> <archivo.json> [carpeta_archivos ...]   cada fila previa debe seguir presente e idéntica en las columnas que ya existían; informa filas nuevas y diferencias
// No escribe nada en la base. Las filas se identifican por su clave primaria (o por el hash completo si la tabla no la tiene).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [modo, DB, archivo, ...carpetas] = process.argv.slice(2);
if (!["guardar", "comparar"].includes(modo) || !DB || !archivo) { console.error("uso: guardar|comparar <base> <archivo.json> [carpetas…]"); process.exit(2); }
const PG = "pgrevc";
const psql = (sql) => {
  const r = spawnSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", PG, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-F", "\t", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  return r.stdout;
};
const ESQUEMAS = `('public','auth','storage')`;
const TABLAS_EXCLUIDAS = new Set(["auth.audit_log_entries", "auth.sessions", "auth.refresh_tokens", "auth.flow_state", "auth.one_time_tokens", "storage.migrations", "auth.schema_migrations", "public.auditoria"]);
// tablas actuales, columnas y clave primaria
const meta = psql(`select c.table_schema || '.' || c.table_name, string_agg(c.column_name, ',' order by c.ordinal_position),
  (select string_agg(a.attname, ',' order by array_position(i.indkey::int2[], a.attnum)) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = (c.table_schema || '.' || quote_ident(c.table_name))::regclass and i.indisprimary)
  from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema in ${ESQUEMAS} group by c.table_schema, c.table_name order by 1;`).trim().split("\n").map((l) => l.split("\t"));
const actual = new Map(meta.filter(([t]) => !TABLAS_EXCLUIDAS.has(t)).map(([t, cols, pk]) => [t, { cols: cols.split(","), pk: pk ? pk.split(",") : null }]));

let previo = null;
if (modo === "comparar") previo = JSON.parse(fs.readFileSync(archivo, "utf8"));
const consulta = (tabla, cols, pk, excluir) => {
  const q = (c) => `"${c}"`; const [esq, nom] = tabla.split(".");
  const quitar = excluir.length ? ` - array[${excluir.map((c) => `'${c}'`).join(",")}]` : "";
  const clave = pk ? `concat_ws('|', ${pk.map((c) => `t.${q(c)}::text`).join(", ")})` : `md5(t::text)`;
  return `select ${clave}, md5((to_jsonb(t)${quitar})::text) from ${esq}.${q(nom)} t;`;
};
const tablas = modo === "guardar" ? [...actual.entries()].map(([t, m]) => [t, m.cols, m.pk, []]) : Object.entries(previo.tablas).filter(([t]) => actual.has(t)).map(([t, p]) => [t, p.cols, actual.get(t).pk ?? p.pk, actual.get(t).cols.filter((c) => !p.cols.includes(c))]);
let sql = ""; for (const [t, cols, pk, excl] of tablas) sql += `\\echo @@${t}\n${consulta(t, cols, pk, excl)}\n`;
const salida = psql(sql); const filas = {}; let cur = null;
for (const l of salida.split("\n")) { if (l.startsWith("@@")) { cur = l.slice(2); filas[cur] = {}; } else if (l && cur) { const i = l.lastIndexOf("\t"); filas[cur][l.slice(0, i)] = l.slice(i + 1); } }

const hashCarpeta = (dir) => { const out = {}; const rec = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) rec(p); else out[path.relative(dir, p).replace(/\\/g, "/")] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } }; rec(dir); return out; };
const archivos = Object.fromEntries(carpetas.map((c) => [c, hashCarpeta(c)]));

if (modo === "guardar") {
  const tablasOut = {}; for (const [t, cols] of tablas.map(([t, c]) => [t, c])) tablasOut[t] = { cols, pk: actual.get(t).pk, filas: filas[t] ?? {} };
  fs.writeFileSync(archivo, JSON.stringify({ base: DB, creado: new Date().toISOString(), tablas: tablasOut, archivos }));
  const n = Object.values(tablasOut).reduce((a, t) => a + Object.keys(t.filas).length, 0);
  console.log(`foto guardada: ${archivo} · ${Object.keys(tablasOut).length} tablas · ${n} filas · ${Object.values(archivos).reduce((a, x) => a + Object.keys(x).length, 0)} archivos`);
} else {
  let perdidas = 0, cambiadas = 0, nuevas = 0, pre = 0; const detalle = [];
  for (const [t, p] of Object.entries(previo.tablas)) {
    if (!actual.has(t)) { if (Object.keys(p.filas).length) { detalle.push(`TABLA AUSENTE ${t} (${Object.keys(p.filas).length} filas)`); perdidas += Object.keys(p.filas).length; } continue; }
    const ahora = filas[t] ?? {};
    for (const [k, h] of Object.entries(p.filas)) { pre++; if (!(k in ahora)) { perdidas++; if (detalle.length < 40) detalle.push(`PERDIDA ${t} [${k}]`); } else if (ahora[k] !== h) { cambiadas++; if (detalle.length < 40) detalle.push(`CAMBIADA ${t} [${k}]`); } }
    for (const k of Object.keys(ahora)) if (!(k in p.filas)) nuevas++;
  }
  let archPerdidos = 0, archCambiados = 0, archNuevos = 0;
  for (const [c, h0] of Object.entries(previo.archivos)) { const h1 = archivos[c] ?? {}; for (const [k, v] of Object.entries(h0)) { if (!(k in h1)) { archPerdidos++; detalle.push(`ARCHIVO PERDIDO ${c}/${k}`); } else if (h1[k] !== v) { archCambiados++; detalle.push(`ARCHIVO CAMBIADO ${c}/${k}`); } } archNuevos += Object.keys(h1).filter((k) => !(k in h0)).length; }
  console.log(`filas previas comprobadas: ${pre} · perdidas ${perdidas} · cambiadas ${cambiadas} · filas nuevas ${nuevas} · archivos perdidos ${archPerdidos} · cambiados ${archCambiados} · nuevos ${archNuevos}`);
  for (const d of detalle) console.log("  " + d);
  process.exit(perdidas + archPerdidos > 0 ? 1 : 0);
}
