// #40 / #37 — cableado (la prueba de comportamiento contra Postgres real es supabase/scripts/test_334_335_vuelos_destinos.sql, casos L y R).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");

describe("#40 conversión de cotización idempotente", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");

  test("convertirCotizacion pasa SU id (del servidor) a la reserva y la venta lo guarda en cotizacion_id solo sin oferta #63", () => {
    assert.match(src, /esInterno: ctx\.ok && ctx\.interno !== false \}, id\);/);
    assert.match(src, /cotizacion_id: aceptacion63 \? null : \(cotizacionOrigen \?\? null\),/);
  });

  test("la reserva interna NO está exportada (el navegador no puede elegir cotizacionOrigen)", () => {
    assert.doesNotMatch(src, /export async function reservarDesdeTarifarioInterno/);
  });

  test("ante la violación de la llave única solo devuelve un contrato COMPLETO; una cabecera pendiente es «en curso» (Codex F1)", () => {
    const i = src.indexOf('ve.code === "23505" && /ventas_cotizacion_id_key/');
    assert.ok(i > 0);
    const bloque = src.slice(i, i + 900);
    assert.ok(bloque.includes("resultadoDeConversionExistente("));
    assert.ok(bloque.includes("if (previo) return previo;"));
    assert.ok(!bloque.includes("previo?.numero_contrato"), "ya no acepta una cabecera sin comprobar financiero_estado");
    assert.ok(i < src.indexOf("if (ve) return { ok: false, error: aceptacion63"));
  });

  test("convertirCotizacion reclama la cotización ANTES de numerar y la libera siempre (finally); la oferta #63 no usa el reclamo", () => {
    const i = src.indexOf("export async function convertirCotizacion(");
    const f = src.slice(i, src.indexOf("export async function convertirCotizacionCarrito("));
    assert.ok(f.includes("!payload.oferta63)"));
    assert.ok(f.indexOf("reclamarConversion(adminConv") < f.indexOf("reservarDesdeTarifarioInterno({"), "el reclamo va antes de numerar");
    assert.ok(/\} finally \{\s*if \(adminConv && tokenReclamo\) await liberarConversion\(/.test(f));
    assert.ok(f.includes('estado === "en_curso") return { ok: false, error: MENSAJE_CONVERSION_EN_CURSO'));
  });

  test("con el reclamo en la mano se REVALIDA el estado antes de reservar/numerar, y toda salida libera el reclamo (Codex C1)", () => {
    const i = src.indexOf("export async function convertirCotizacion(");
    const f = src.slice(i, src.indexOf("export async function convertirCotizacionCarrito("));
    const iReclamo = f.indexOf("reclamarConversion(adminConv");
    const iBajo = f.indexOf("const bajoReclamo = await estadoConversionCotizacion(");
    const iReserva = f.indexOf("res = await reservarDesdeTarifarioInterno({");
    assert.ok(iReclamo > 0 && iBajo > iReclamo && iReserva > iBajo, "reclamar → revalidar → reservar");
    const bloque = f.slice(f.indexOf("if (adminConv && tokenReclamo) {"), iReserva);
    assert.ok(bloque.includes('if (bajoReclamo.estado === "en_curso") return { ok: false, error: MENSAJE_CONVERSION_EN_CURSO }'));
    assert.ok(bloque.includes('if (bajoReclamo.estado === "completa") res = '));
    assert.ok(bloque.includes("if (!bajoReclamo.ok) return"));
    // la revalidación y la reserva viven dentro del MISMO try cuyo finally libera el reclamo (ninguna salida temprana lo deja vivo)
    const iTry = f.lastIndexOf("try {", iBajo);
    const iFinally = f.indexOf("} finally {", iReserva);
    assert.ok(iTry > iReclamo && iFinally > iReserva && f.slice(iTry, iBajo).indexOf("}") < 0, "revalidación dentro del try/finally");
    assert.ok(f.slice(iFinally, iFinally + 200).includes("liberarConversion(adminConv, id, tokenReclamo)"));
  });

  test("la completitud se lee de ventas.financiero_estado (lo escribe solo registrar_financiero_contrato, al final)", () => {
    const h = leer("lib/cotizacion/conversionReclamo.ts");
    assert.ok(h.includes('if (e.estado === "completa") return { ok: true') && h.includes('if (e.estado === "en_curso") return { ok: false, error: MENSAJE_CONVERSION_EN_CURSO }'));
    assert.match(h, /financiero_estado === "completo"/);
    assert.ok(h.includes("data.tenant !== tenant"));
  });
});

describe("#37 la vista exige un componente aéreo", () => {
  const mig = leer("supabase/migrations/20260601000335_vuelos_sistema_exige_componente_aereo.sql");
  test("la 335 reescribe SOLO el predicado dinámico y conserva la rama de la Promoción", () => {
    assert.match(mig, /viejo constant text := 'v\\\.tipo_paquete = ''dinamico''::text'/);
    assert.match(mig, /EXISTS \(SELECT 1 FROM public\.contrato_vuelos cvx/);
    assert.match(mig, /cxp_aer\.total/);
    assert.match(mig, /aborta|raise exception 'ventas_vuelo_sistema tiene una forma inesperada/);
    assert.doesNotMatch(mig, /drop view|delete from|update public\./i, "no reclasifica ni borra datos");
  });
  test("las migraciones 334/335 no editan ninguna anterior y tienen el siguiente número libre", () => {
    assert.match(mig, /Migration 335/);
    assert.match(leer("supabase/migrations/20260601000334_destinos_aereos_alternativos_integridad.sql"), /Migration 334/);
  });
});

describe("enlace al editor del vuelo (Codex F3): la MISMA vista que lista y abre el editor", () => {
  const page = leer("app/(dashboard)/dashboard/contratos/[numero]/page.tsx");
  const editor = leer("app/(dashboard)/dashboard/vuelos/contrato/[numero]/page.tsx");
  test("la ficha consulta ventas_vuelo_sistema (solo la llave) y solo para roles editores", () => {
    assert.ok(page.includes('puedeAbrirEditorVuelos\n    ? await sb.from("ventas_vuelo_sistema").select("numero_contrato")'));
    assert.ok(page.includes("{enlaceEditorVuelos && ("));
    assert.doesNotMatch(page, /empaquetadoContrato|contratoEntraEnVuelosSistema/);
  });
  test("el editor decide con la misma vista", () => {
    assert.ok(editor.includes('from("ventas_vuelo_sistema")'));
  });
});
