// #94 — el resumen de precios por pasajero llega al contrato: la conversión lo decide ANTES de numerar y lo congela ANTES del cierre financiero (un fallo revierte el grupo
// incompleto), los dos documentos lo leen distinguiendo «sin snapshot» de «error de lectura», y la tabla nace integrada con las guardas de identidad (284) y la
// elegibilidad de #75 (289). Guardas estáticas; el comportamiento real contra Postgres/PostgREST está en test_304_conversion_resumen.sh y test_304_resumen_contrato.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { clasificarLecturaResumen } from "../lib/contrato/resumenPreciosContrato.ts";

const leer = (r: string) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
const MIG = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((f) => f.startsWith("20260601000304_"));

test("la migración 304 es única, estricta, heredada de las guardas y de la elegibilidad", () => {
  assert.equal(MIG.length, 1, "una sola migración 304");
  const sql = leer(`supabase/migrations/${MIG[0]}`);
  assert.match(sql, /create table if not exists public\.contrato_resumen_precios/);
  assert.match(sql, /references public\.ventas\(numero_contrato\) on delete cascade/);
  assert.match(sql, /constraint contrato_resumen_precios_valido check \(public\.p94_resumen_valido\(resumen\)\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for select to authenticated using \(public\.puede_ver_contrato\(numero_contrato\)\)/);
  assert.doesNotMatch(sql, /for (insert|update|delete|all)/i, "ninguna policy de escritura: solo service_role escribe");
  assert.match(sql, /revoke all on public\.contrato_resumen_precios from anon/);
  assert.match(sql, /grant select on public\.contrato_resumen_precios to authenticated/);
  assert.match(sql, /grant select, insert, update, delete on public\.contrato_resumen_precios to service_role/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*to authenticated/i);
  // 284: clasificada e instalada. 289: preparación (no compromiso), con la comprobación de la versión que reemplaza.
  assert.match(sql, /insert into public\.contrato_guardas_config \(tabla, modo, motivo\)[\s\S]*'contrato_resumen_precios', 'estricto'/);
  assert.match(sql, /select public\.contrato_instalar_guardas\(\)/);
  assert.match(sql, /'aliados_b2b',\s*'contrato_resumen_precios'\];/, "se agrega a la lista de PREPARACIÓN de dtm_reuso_bloqueos");
  assert.match(sql, /md5\(replace\(\(select prosrc from pg_proc where oid = 'public\.dtm_reuso_bloqueos\(text,boolean\)'::regprocedure\), chr\(13\), ''\)\) is distinct from '[0-9a-f]{32}'/);
  assert.match(leer("supabase/scripts/rollback_304_contrato_resumen_precios.sql"), /drop table if exists public\.contrato_resumen_precios[\s\S]*create or replace function public\.dtm_reuso_bloqueos/);
});

test("el validador estricto exige claves y tipos (no basta con 'version = 1')", () => {
  const sql = leer(`supabase/migrations/${MIG[0]}`);
  for (const c of ["version", "modalidad", "moneda", "totalCentavos", "unidades", "ref", "ajusteCentavos", "grupos", "tipo", "cantidad", "tarifaCentavos", "subtotalCentavos", "incluye", "cupos"]) {
    assert.ok(sql.includes(`'${c}'`), `el validador revisa la clave ${c}`);
  }
  assert.match(sql, /subtotalCentavos'\)::bigint <> \(g->>'cantidad'\)::bigint \* \(g->>'tarifaCentavos'\)::bigint/, "las sumas deben cuadrar");
  assert.ok(readFileSync(new URL("../supabase/scripts/test_304_validacion.sql", import.meta.url), "utf8").includes("VALIDADOR_RESUMEN"), "hay prueba SQL del validador");
});

test("la conversión decide el resumen ANTES de numerar y lo congela ANTES del cierre financiero; un fallo revierte el grupo incompleto", () => {
  const f = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const decide = f.indexOf("resumenParaContrato(resumenGuardadoCot");
  const numera = f.indexOf("await siguienteNumeroContrato(tenantCotizacion)", decide);
  const guarda = f.indexOf('from("contrato_resumen_precios").insert', numera);
  const cierra = f.indexOf("await registrarFinancieroContrato(", guarda);
  assert.ok(decide > 0 && numera > decide && guarda > numera && cierra > guarda, "decisión → número → escritura → cierre financiero");
  const antes = f.slice(decide - 400, numera);
  assert.match(antes, /no coincide con el total de este contrato/, "un resumen nuevo que no cuadra se rechaza antes de numerar");
  assert.match(antes, /modoCompra === "neta" \? "neto" : "pvp"/);
  assert.match(antes, /Math\.round\(precioExigibleGrupo \* 100\)/, "se valida contra lo EXIGIBLE del contrato");
  assert.match(antes, /resumenGuardadoCot != null && refsGrupoResumen\.length/, "histórico (sin resumen) o grupo sin hoteles ⇒ no hay snapshot");
  const escritura = f.slice(guarda - 120, cierra);
  assert.match(escritura, /registrarErrorTecnico/, "el fallo se registra");
  assert.match(escritura, /return fallarYRevertirGrupo\(/, "un fallo revierte el contrato incompleto con el mecanismo de siempre");
  assert.doesNotMatch(f.slice(cierra), /from\("contrato_resumen_precios"\)\.insert/, "no hay una segunda escritura best-effort tras el cierre");
});

test("los documentos distinguen «sin snapshot» de «error de lectura»", () => {
  for (const p of ["app/contrato/[numero]/page.tsx", "app/c/[token]/page.tsx"]) {
    const s = leer(p);
    assert.match(s, /leerResumenContrato\(sb, numero\)/, p);
    assert.match(s, /resumenPrecios=\{resumenContrato\}/, p);
    assert.doesNotMatch(s, /from\("contrato_resumen_precios"\)/, `${p}: usa el lector común, no una consulta suelta que ignora el error`);
  }
  assert.equal(clasificarLecturaResumen({ data: { resumen: { version: 1 } }, error: null }, "N").tipo, "resumen");
  assert.equal(clasificarLecturaResumen({ data: null, error: null }, "N").tipo, "sin_snapshot");
  assert.equal(clasificarLecturaResumen({ data: null, error: { code: "PGRST301", message: "JWT" } }, "N").tipo, "error");
  assert.equal(clasificarLecturaResumen({ data: null, error: { message: "sin código" } }, "N").tipo, "error");
  assert.equal(clasificarLecturaResumen({ data: null, error: { code: "PGRST200", message: "Could not find a relationship" } }, "N").tipo, "error", "PGRST200 es un error de relación, NO tabla ausente");
  for (const code of ["PGRST205", "42P01"]) assert.equal(clasificarLecturaResumen({ data: null, error: { code, message: "x" } }, "N").tipo, "sin_snapshot", `${code}: tabla aún inexistente (desplegado antes de la 304)`);
});

test("el tipo de la tabla existe en types/database.ts", () => {
  assert.match(leer("types/database.ts"), /contrato_resumen_precios: \{/);
});
