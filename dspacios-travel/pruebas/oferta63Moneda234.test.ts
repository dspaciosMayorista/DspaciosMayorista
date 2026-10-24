// #90 · #63 (234) — reglas PURAS del modo de oferta con conversión por TRM publicando en COP o en USD, y cableado de la migración 234.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aCop63, aMoneda63, feeACop63, feeAMoneda63, impuestoPorPersona63, redondearCentavos63 } from "../lib/reservar/ofertaDinamica63.ts";
import { equivalenteCop63, equivalenteOferta63, resolverImporteContable63, validarObligacion63 } from "../lib/reservar/importeObligacion63.ts";
import { camposCxP63, sumaEquivalentesCop63, sumaEquivalentesOferta63 } from "../lib/reservar/payloadFinanciero63.ts";
import { precioMenorDeDos } from "../lib/calc/paquetes.ts";
import { construirObligaciones63, mapearErrorRpc63, MENSAJE_TRM_PROVISIONAL_REQUERIDA_63, MENSAJE_TRM_PROVISIONAL_INVALIDA_63, validarTrmProvisional63 } from "../lib/reservar/aceptacion63.ts";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("aMoneda63: misma moneda exacta, USD→COP × TRM, COP→USD / TRM", () => {
  test("misma moneda NO usa la TRM (ni siquiera una inválida)", () => {
    for (const trm of [null, 0, -1, 4000]) {
      assert.equal(aMoneda63(290, "USD", "USD", trm), 290);
      assert.equal(aMoneda63(1_130_000, "COP", "COP", trm), 1_130_000);
    }
  });
  test("USD→COP: × TRM sin redondear", () => {
    assert.equal(aMoneda63(290, "USD", "COP", 4000), 1_160_000);
    assert.equal(aMoneda63(25, "USD", "COP", 3987.65), 99_691.25);
  });
  test("COP→USD: / TRM sin redondear (la regla aprobada COP / TRM)", () => {
    assert.equal(aMoneda63(1_130_000, "COP", "USD", 4000), 282.5);
    assert.equal(aMoneda63(2_000_000, "COP", "USD", 4000), 500);
    assert.ok(Math.abs(aMoneda63(100, "COP", "USD", 3987.65) - 100 / 3987.65) < 1e-12);
  });
  test("convertir sin TRM positiva es un error de invariante: nunca 1 ni 0", () => {
    for (const trm of [null, 0, -4000, Number.NaN]) {
      assert.throws(() => aMoneda63(100, "COP", "USD", trm as never), /exige una TRM positiva/);
      assert.throws(() => aMoneda63(100, "USD", "COP", trm as never), /exige una TRM positiva/);
    }
  });
  test("aCop63 sigue siendo el atajo hacia COP (comportamiento de siempre)", () => {
    assert.equal(aCop63(210, "USD", 4000), 840_000);
    assert.equal(aCop63(2_080_500, "COP", null), 2_080_500);
    assert.throws(() => aCop63(210, "USD", null), /exige una TRM positiva/);
  });
  test("una moneda no reconocida se trata como COP (monedaNormalizada63), igual que antes", () => {
    assert.equal(aMoneda63(100, "EUR", "COP", null), 100);
    assert.equal(aMoneda63(4000, "EUR", "USD", 4000), 1);
  });
});

describe("feeAMoneda63: centavos exactos, nunca al peso ni al mil", () => {
  test("misma moneda: exacto", () => {
    assert.equal(feeAMoneda63(20, "USD", "USD", null), 20);
    assert.equal(feeAMoneda63(80_500, "COP", "COP", null), 80_500);
  });
  test("USD→COP conserva los centavos (R1): 25 USD × 3.987,65 = 99.691,25", () => {
    assert.equal(feeAMoneda63(25, "USD", "COP", 3987.65), 99_691.25);
    assert.equal(feeACop63(25, "USD", 3987.65), 99_691.25);
  });
  test("COP→USD conserva los centavos: 80.500 / 4.000 = 20,125 → 20,13", () => {
    assert.equal(feeAMoneda63(80_500, "COP", "USD", 4000), 20.13);
    assert.equal(feeAMoneda63(180_000, "COP", "USD", 4000), 45);
  });
  test("un fee inválido, cero o negativo es 0 sin tocar la TRM", () => {
    for (const f of [0, -5, Number.NaN]) assert.equal(feeAMoneda63(f, "COP", "USD", null), 0);
  });
});

describe("equivalentes: contrato en la moneda de la oferta; obligación en su moneda de origen con su equivalente COP", () => {
  test("equivalenteOferta63: costo de origen expresado en la moneda del contrato", () => {
    assert.equal(equivalenteOferta63(520, "USD", "USD", 4000), 520, "USD→USD exacto");
    assert.equal(equivalenteOferta63(2_080_500, "COP", "USD", 4000), 520.13, "COP→USD con centavos (520,125 → 520,13)");
    assert.equal(equivalenteOferta63(520, "USD", "COP", 4000), 2_080_000, "USD→COP (modo de siempre)");
    assert.equal(equivalenteOferta63(2_080_500, "COP", "COP", null), 2_080_500, "COP→COP sin TRM");
  });
  test("sumaEquivalentesOferta63: suma en la moneda de la oferta; la de COP no cambia", () => {
    const obl = [{ valor: 210, moneda: "USD" as const }, { valor: 1_000_000, moneda: "COP" as const }];
    assert.equal(sumaEquivalentesOferta63(obl, "USD", 4000), 460);
    assert.equal(sumaEquivalentesOferta63(obl, "COP", 4000), 1_840_000);
    assert.equal(sumaEquivalentesOferta63(obl, "COP", 4000), sumaEquivalentesCop63(obl, 4000));
  });
  test("camposCxP63: el equivalente COP congelado sale de la moneda de ORIGEN, no de la de la oferta", () => {
    assert.deepEqual(camposCxP63({ valor: 520, moneda: "USD" }, 4000), { moneda: "USD", valor_cop: 2_080_000, trm: 4000 });
    assert.deepEqual(camposCxP63({ valor: 2_080_500, moneda: "COP" }, 4000), { moneda: "COP", valor_cop: 2_080_500, trm: 4000 });
    assert.equal(equivalenteCop63(520, "USD", 4000), 2_080_000);
  });
  test("validarObligacion63: una obligación en USD sin TRM se rechaza (la contabilidad está en pesos)", () => {
    assert.equal(validarObligacion63({ moneda: "USD", valor_total: 400, valor_cop: 1_600_000, trm: null }).ok, false);
    assert.equal(validarObligacion63({ moneda: "USD", valor_total: 400, valor_cop: 1_600_000, trm: 4000 }).ok, true);
    assert.equal(validarObligacion63({ moneda: "COP", valor_total: 2_000_000, valor_cop: 2_000_000, trm: 4000 }).ok, true, "una COP en una oferta USD lleva la TRM congelada");
    assert.equal(validarObligacion63({ moneda: "COP", valor_total: 2_000_000, valor_cop: 2_000_000, trm: null }).ok, true, "una COP de una oferta COP sin TRM sigue válida");
  });
});

describe("oferta en USD SIN TRM: las obligaciones nacen sin equivalente hasta que la aceptación congele la TRM provisional", () => {
  test("camposCxP63: una obligación USD sin TRM no inventa equivalente (ni 1 ni el nominal); una COP sí queda igual a su valor", () => {
    assert.deepEqual(camposCxP63({ valor: 520, moneda: "USD" }, null), { moneda: "USD", valor_cop: null, trm: null });
    assert.deepEqual(camposCxP63({ valor: 2_000_000, moneda: "COP" }, null), { moneda: "COP", valor_cop: 2_000_000, trm: null });
    assert.deepEqual(camposCxP63({ valor: 520, moneda: "USD" }, 4000), { moneda: "USD", valor_cop: 2_080_000, trm: 4000 });
  });
  test("construirObligaciones63 conserva valor_cop y trm NULL de una obligación USD sin TRM (la huella financiera cotizada = la recalculada)", () => {
    const entrada = [{
      proveedor: "P", tipo_proveedor: "hotel", servicio: "Hotel", valor_total: 210, aplica_retencion: false, pct_retencion: 0, observaciones: "o", servicio_id: null,
      ...camposCxP63({ valor: 210, moneda: "USD" }, null),
    }];
    const [o] = construirObligaciones63(entrada, null);
    assert.equal(o.moneda, "USD");
    assert.equal(o.valor_cop, null);
    assert.equal(o.trm, null);
    assert.deepEqual(construirObligaciones63(entrada, null), construirObligaciones63(entrada, null));
  });
  test("validarTrmProvisional63: vacía = usar la de referencia; si se escribe, finita y positiva (nunca 0, negativa, NaN, texto ni booleano)", () => {
    for (const v of [null, undefined, "", "  "]) assert.deepEqual(validarTrmProvisional63(v), { ok: true, trm: null });
    assert.deepEqual(validarTrmProvisional63(4321.5), { ok: true, trm: 4321.5 });
    assert.deepEqual(validarTrmProvisional63("4100.25"), { ok: true, trm: 4100.25 });
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "abc", "0", true, false, 1e11, 1e20, "100000000000", 0.00001]) {
      assert.deepEqual(validarTrmProvisional63(v), { ok: false, error: MENSAJE_TRM_PROVISIONAL_INVALIDA_63 }, String(v));
    }
  });
  test("p63_trm_invalida se explica como TRM provisional inválida", () => {
    assert.equal(mapearErrorRpc63("p63_trm_invalida: la TRM provisional debe ser un número positivo").error, MENSAJE_TRM_PROVISIONAL_INVALIDA_63);
  });
  test("sin tasa ingresada el error de la RPC se explica (no es un fallo técnico genérico) y no promete ninguna TRM de referencia", () => {
    const r = mapearErrorRpc63("p63_trm_requerida: la oferta está en USD sin TRM: quien la convierte a contrato debe ingresar la TRM provisional");
    assert.equal(r.error, MENSAJE_TRM_PROVISIONAL_REQUERIDA_63);
    assert.equal(r.cambio, false);
    assert.match(r.error, /ingresa la TRM provisional/);
    assert.doesNotMatch(r.error, /referencia/);
  });
});

describe("dependencia contable: el libro nunca devenga el nominal en dólares como pesos", () => {
  const base = { numero_contrato: "DTM-1", tenant: "mayorista", aceptacion_63_id: 1, obligacion_63: "hotel:0" };
  test("una obligación aceptada en USD se devenga por su equivalente COP congelado", () => {
    const r = resolverImporteContable63({ ...base, moneda: "USD", valor_cop_63: 1_600_000, trm_63: 4000 }, { numeroContrato: "DTM-1", tenant: "mayorista", valorTotal: 400 });
    assert.deepEqual(r, { ok: true, importe: 1_600_000 });
  });
  test("una obligación aceptada en USD SIN TRM ni equivalente se rechaza: jamás cae al nominal (400)", () => {
    for (const fila of [{ ...base, moneda: "USD", valor_cop_63: null, trm_63: null }, { ...base, moneda: "USD", valor_cop_63: 1_600_000, trm_63: null }]) {
      const r = resolverImporteContable63(fila, { numeroContrato: "DTM-1", tenant: "mayorista", valorTotal: 400 });
      assert.equal(r.ok, false);
    }
  });
});

describe("precio del menor de 2 años: el fee con centavos no arrastra ruido de coma flotante (se fija a centavos en el generador)", () => {
  test("el motor congelado devuelve 33,129999… y redondearCentavos63 lo deja en 33,13", () => {
    const crudo = precioMenorDeDos({ aporteHotel: 12.5, aporteServiciosMenor: 0, feeInfante: 20.13, moneda: "USD" });
    assert.notEqual(crudo, 33.13, "documenta por qué el generador redondea a centavos");
    assert.equal(redondearCentavos63(crudo), 33.13);
  });
  test("lo de siempre no cambia: COP al mil + fee exacto; USD entero + fee entero", () => {
    assert.equal(precioMenorDeDos({ aporteHotel: 76_250, aporteServiciosMenor: 0, feeInfante: 80_500, moneda: "COP" }), 157_500);
    assert.equal(precioMenorDeDos({ aporteHotel: 18.75, aporteServiciosMenor: 12.5, feeInfante: 25, moneda: "USD" }), 57);
    assert.equal(precioMenorDeDos({ aporteHotel: 1000, aporteServiciosMenor: 0, feeInfante: Number.NaN, moneda: "COP" }), 1000);
  });
  test("un fee COP con centavos (R1: 99.691,25) se conserva", () => {
    assert.equal(precioMenorDeDos({ aporteHotel: 50_000, aporteServiciosMenor: 0, feeInfante: 99_691.25, moneda: "COP" }), 149_691.25);
  });
});

describe("impuestoPorPersona63: el fijo del paquete se captura YA en la moneda de la oferta (no se convierte)", () => {
  test("tiquete → R (en la moneda de la oferta); fijo → el importe configurado", () => {
    assert.equal(impuestoPorPersona63({ tipo: "tiquete", tarifaParaEmpaquetar: 282.5, fijo: 100 }), 282.5);
    assert.equal(impuestoPorPersona63({ tipo: "fijo", tarifaParaEmpaquetar: 282.5, fijo: 100 }), 100);
    assert.equal(impuestoPorPersona63({ tipo: "fijo", tarifaParaEmpaquetar: 282.5, fijo: -5 }), 0);
  });
});

describe("cableado de la migración 234 y de los scripts (texto)", () => {
  const mig = leer("supabase/migrations/20260601000234_oferta_usd_trm.sql");
  const rb = leer("supabase/scripts/rollback_234_oferta_usd.sql");
  const m233 = leer("supabase/migrations/20260601000233_moneda_publicacion_trm_condicional.sql");

  test("la 234 es aditiva: NO edita la 227, la 230 ni la 233 (otro archivo) y corre en una transacción", () => {
    assert.match(mig, /^begin;$/m);
    assert.match(mig, /^commit;$/m);
    assert.match(mig, /234 ya aplicada/);
    assert.doesNotMatch(mig, /alter table public\.armado_paquetes drop constraint armado_paquetes_moneda_publicacion_chk/);
  });
  test("elimina SOLO el CHECK que ataba el modo 63 a COP y conserva el de COP/USD", () => {
    assert.match(mig, /alter table public\.armado_paquetes drop constraint armado_paquetes_modo63_moneda_chk;/);
    assert.doesNotMatch(mig, /drop constraint armado_paquetes_modo63_chk/);
  });
  test("p63_requiere_trm exige TRM solo si hay fuentes en la moneda OPUESTA a la de publicación (nunca por publicar en USD a secas)", () => {
    assert.match(mig, /case coalesce\(p\.moneda_publicacion, 'COP'\) when 'USD' then 'COP' else 'USD' end into v_otra/);
    for (const parte of ["h.moneda = v_otra", "sa.moneda = v_otra", "sd.moneda = v_otra", "e.moneda = v_otra"]) assert.ok(mig.includes(parte), parte);
    assert.doesNotMatch(mig, /p\.moneda_publicacion = 'USD'\) then\s+return true;/);
  });
  test("al ACEPTAR una oferta USD sin TRM la TRM provisional INGRESADA es obligatoria (sin respaldo en trm_referencia) y se congela inmutable", () => {
    assert.match(mig, /alter table public\.p63_aceptacion add column trm_provisional numeric\(15,4\)/);
    // La función de aceptación ya no lee el parámetro de referencia en ninguna parte (ni en el código ni en sus comentarios internos).
    const iAce = mig.indexOf("create or replace function public.aceptar_oferta_63(");
    const cuerpoAce = mig.slice(iAce, mig.indexOf("revoke all on function public.aceptar_oferta_63(", iAce));
    assert.doesNotMatch(cuerpoAce, /trm_referencia|parametros_tributarios/, "aceptar_oferta_63 no consulta la TRM de referencia");
    assert.match(cuerpoAce, /if p_trm_provisional is null then\s+raise exception 'p63_trm_requerida:/);
    assert.match(mig, /v_o\.trm is null and coalesce\(nullif\(v_snap ->> 'moneda', ''\), 'COP'\) = 'USD'/);
    assert.match(mig, /insert into public\.p63_aceptacion \(oferta_id, cotizacion_id, tenant, numero_contrato, usuario_id, fecha_negocio, snapshot, trm_provisional\)/);
    assert.match(mig, /or new\.trm_provisional is distinct from old\.trm_provisional/);
  });
  test("el payload financiero derivado y la RPC financiera usan la TRM provisional; el rollback la elimina solo sin datos", () => {
    assert.match(mig, /a\.trm_provisional is not null and coalesce\(nullif\(e\.v ->> 'moneda', ''\), 'COP'\) = 'USD' and nullif\(e\.v ->> 'trm', ''\) is null/);
    assert.match(mig, /round\(\(e\.v ->> 'valor_total'\)::numeric \* a\.trm_provisional, 2\)/);
    assert.match(mig, /v_trm_snap := coalesce\(\(v_a\.snapshot ->> 'trm'\)::numeric, v_a\.trm_provisional\)/);
    const rb2 = leer("supabase/scripts/rollback_234_oferta_usd.sql");
    assert.match(rb2, /ROLLBACK 234 ABORTADO: hay aceptaciones #63 con TRM provisional congelada/);
    assert.match(rb2, /alter table public\.p63_aceptacion drop column trm_provisional;/);
  });
  test("el publicador acepta COP o USD, contrasta la elegida (devuelve false si cambió) y conserva la guarda de TRM", () => {
    assert.match(mig, /p_moneda not in \('COP', 'USD'\)/);
    assert.match(mig, /coalesce\(v_mp, 'COP'\) is distinct from p_moneda then\s+return false;/);
    assert.match(mig, /v_trm is null and public\.p63_requiere_trm\(p_paquete_id\)/);
  });
  test("cotizar exige la misma moneda en snapshot, cabecera y cotización, y aceptar rechaza si el paquete cambió de moneda", () => {
    assert.match(mig, /la moneda de publicación del paquete cambió mientras se cotizaba/);
    assert.match(mig, /la moneda de la cabecera de la oferta no es la de la oferta/);
    assert.match(mig, /la moneda de la cotización no es la de la oferta/);
    assert.match(mig, /la moneda de publicación del paquete cambió desde la cotización/);
  });
  test("la 234 no toca el CHECK de las obligaciones: toda obligación aceptada en USD termina con TRM y equivalente (nunca el nominal como pesos)", () => {
    const sinComentarios = mig.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.doesNotMatch(sinComentarios, /cuentas_por_pagar_cop63_chk/);
  });
  test("las ACL de las funciones reemplazadas se conservan igual que en la 233", () => {
    for (const linea of [
      "revoke all on function public.p63_requiere_trm(bigint) from public, anon, authenticated;",
      "grant execute on function public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric) to authenticated;",
      "grant execute on function public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb) to service_role;",
    ]) {
      assert.ok(m233.includes(linea), `la 233 trae: ${linea}`);
      assert.ok(mig.includes(linea), `la 234 conserva: ${linea}`);
    }
  });
  test("aceptar_oferta_63 gana p_trm_provisional (6.º parámetro) y la firma de 5 argumentos se ELIMINA; ACL igual (solo service_role)", () => {
    assert.match(mig, /drop function public\.aceptar_oferta_63\(bigint, text, uuid, text, text\);/);
    assert.match(mig, /p_huella_financiera text,\s+p_trm_provisional\s+numeric default null/);
    assert.ok(mig.includes("revoke all on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric) from public, anon, authenticated;"));
    assert.ok(mig.includes("grant execute on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric) to service_role;"));
    assert.doesNotMatch(mig, /grant execute on function public\.aceptar_oferta_63\(bigint, text, uuid, text, text\) /);
    // La tasa ingresada es obligatoria y se valida positiva y finita ANTES de reservar número.
    assert.match(mig, /if p_trm_provisional is null then/);
    assert.match(mig, /p_trm_provisional = 'NaN'::numeric or p_trm_provisional <= 0 or p_trm_provisional >= 100000000000/);
    assert.match(mig, /p63_trm_invalida: la TRM provisional debe ser un número positivo/);
    assert.ok(mig.indexOf("p63_trm_invalida") < mig.indexOf("siguiente_numero_contrato_para_tenant"), "la validación ocurre antes de reservar el número");
    const rb2 = leer("supabase/scripts/rollback_234_oferta_usd.sql");
    assert.match(rb2, /drop function public\.aceptar_oferta_63\(bigint, text, uuid, text, text, numeric\);/);
  });
  test("cierre de las dos vías: el publicador base solo se alcanza por el envoltorio y toda TRM debe ser finita (SQL)", () => {
    // Publicar: frontera de base de datos sin banderas de sesión. El cuerpo real vive en publicar_tarifario_resultado_interno (sin EXECUTE para la API),
    // el publicador base es una fachada que rechaza cop_trm_63 (con o sin filas), el envoltorio delega en el interno y la tabla no admite escritura directa.
    const sinComentarios = mig.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    assert.ok(!/app\.p63_pub|trg_tarifario_resultado_solo_por_63/.test(sinComentarios), "ninguna bandera de sesión ni trigger de bandera");
    assert.match(mig, /create or replace function public\.publicar_tarifario_resultado_interno\(/);
    assert.ok(mig.includes("revoke all on function public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb) from public, anon, authenticated;"));
    assert.match(mig, /p63_publicador: un paquete en modo cop_trm_63 solo se publica por publicar_tarifario_resultado_63/);
    const iFachada = mig.indexOf("create or replace function public.publicar_tarifario_resultado(\n");
    const iRechazo = mig.indexOf("v_modo = 'cop_trm_63'", iFachada);
    const iDelega = mig.indexOf("return public.publicar_tarifario_resultado_interno(", iFachada);
    assert.ok(iFachada > 0 && iFachada < iRechazo && iRechazo < iDelega, "la fachada rechaza el modo 63 ANTES de delegar, sin mirar las filas");
    assert.match(mig, /for update;\s*\n\s*if found and v_modo = 'cop_trm_63'/);
    assert.match(mig, /grant execute on function public\.publicar_tarifario_resultado\(bigint, bigint, bigint, text, jsonb\) to authenticated;/);
    assert.match(mig, /v_publicado := public\.publicar_tarifario_resultado_interno\(p_paquete_id, p_generacion, p_revision_capturada, p_moneda, p_filas\);/);
    assert.ok(!mig.includes("v_publicado := public.publicar_tarifario_resultado(p_paquete_id"), "el envoltorio no pasa por la fachada");
    assert.match(mig, /revoke insert, update, delete, truncate on public\.tarifario_resultado from public, anon, authenticated;/);
    // TRM finita en las tres puertas (publicar, cotizar, aceptar) y en la columna.
    assert.match(mig, /p_trm = 'NaN'::numeric or p_trm <= 0 or p_trm >= 100000000000/);
    assert.match(mig, /v_trm = 'NaN'::numeric or v_trm <= 0 or v_trm >= 100000000000/);
    assert.match(mig, /armado_paquetes_trm_finita_chk check \(trm_oferta is null or \(trm_oferta <> 'NaN'::numeric and trm_oferta < 100000000000\)\)/);
    // Numerar: la tasa se valida antes de reservar el número (ya cubierto arriba) y el rollback deshace todo lo nuevo.
    assert.match(rb, /drop function if exists public\.publicar_tarifario_resultado_interno\(bigint, bigint, bigint, text, jsonb\);/);
    assert.match(rb, /grant insert, update, delete, truncate on public\.tarifario_resultado to anon, authenticated;/);
    assert.match(rb, /drop constraint if exists armado_paquetes_trm_finita_chk;/);
    const pre = leer("supabase/scripts/preflight_postcheck_234_oferta_usd.sql");
    assert.match(pre, /publicar_tarifario_resultado_interno/);
    assert.match(pre, /tabla_cerrada/);
    assert.match(pre, /armado_paquetes_trm_finita_chk/);
  });
  test("el rollback restaura el CHECK, se niega con datos en USD y restaura el texto de la 233", () => {
    assert.match(rb, /armado_paquetes_modo63_moneda_chk check \(modo_oferta = 'legacy' or moneda_publicacion is null or moneda_publicacion = 'COP'\)/);
    assert.match(rb, /ROLLBACK 234 ABORTADO: hay paquetes en modo cop_trm_63 que se publican en USD/);
    assert.match(rb, /ROLLBACK 234 ABORTADO: hay ofertas #63 cotizadas en USD/);
    assert.match(rb, /ROLLBACK 234 ABORTADO: hay contratos nacidos de una oferta #63 en USD/);
    for (const fn of ["p63_requiere_trm", "publicar_tarifario_resultado_63", "crear_cotizacion_oferta_63", "aceptar_oferta_63"]) {
      assert.ok(rb.includes(`create or replace function public.${fn}(`), fn);
    }
  });
  test("el preflight/postcheck es UNA sola consulta (una sola sentencia SELECT, con columna de estado)", () => {
    const sql = leer("supabase/scripts/preflight_postcheck_234_oferta_usd.sql");
    // Sin comentarios de línea ni literales de texto (un ';' dentro de un literal no termina la sentencia).
    const sinComentarios = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'(?:[^']|'')*'/g, "''");
    assert.equal((sinComentarios.match(/;/g) ?? []).length, 1, "una sola sentencia terminada en ';'");
    assert.match(sinComentarios, /^with\b/m);
    assert.match(sinComentarios, /select control, valor, esperado, estado/);
  });
  test("preflight/postcheck: ofertas desfasadas publicables = REVISAR, históricas (snapshot no publicable) = INFO con ids, una sola consulta", () => {
    const pre = leer("supabase/scripts/preflight_postcheck_234_oferta_usd.sql");
    assert.match(pre, /ofertas_desfasadas as \(select \* from ofertas_desfasadas_todas where publicable\)/);
    assert.match(pre, /ofertas_desfasadas_historicas as \(select \* from ofertas_desfasadas_todas where not publicable\)/);
    assert.match(pre, /select 11, 'ofertas_63_abiertas_cotizadas_en_otra_moneda_que_la_del_paquete_con_tarifario_aun_publicable'[\s\S]*?then 'OK' else 'REVISAR' end/);
    assert.match(pre, /select 25, 'ofertas_63_historicas_desfasadas_con_snapshot_no_publicable[^']*',\s*\(select count\(\*\) from ofertas_desfasadas_historicas\)::text, 'dato \(trazabilidad\)', 'INFO'/);
    assert.match(pre, /select 26, 'ids oferta\/cotizacion\/paquete de esas ofertas históricas/);
    assert.match(pre, /select 28, 'ids de paquetes 63 con filas en otra moneda que la elegida: regenerar/);
    assert.ok(!/\b(update|delete|insert)\b\s+(public\.|from|into)/i.test(pre.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")), "solo lectura");
    assert.equal((pre.match(/;\s*$/gm) ?? []).length, 1, "una sola sentencia");
  });
});
