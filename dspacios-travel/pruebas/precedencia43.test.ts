import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";
import { resolverPrecedencia, mismoDescuento, descuentoMostrado } from "../lib/calc/precedenciaPromociones.ts";
import { leerComposicion } from "../lib/cotizacion/composicionPrecio.ts";
import { normCombinacion } from "../lib/calc/promocionesGrupo.ts";
import { requiereOrden, validarCombinacion, mensajePromo300 } from "../lib/hoteles/promocionesVigencia.ts";
import { leerBaseGuardada } from "../lib/tarifario/composicionTarifario.ts";

// ─────────────────────────────────────────────────────────────────────────
// #43/#60 entrega 5 — acumulación y precedencia de promociones con EBB / Long Stay (especificación §5; historial R.2, R.5, S.1;
// diseño AK). Estadía de 7 noches desde el lunes 8 de marzo de 2027 a 100.000 por persona y noche (base 700.000); promoción
// −10 % materializada (90.000 ⇒ 630.000); EBB 12 % con ≥ 30 días; Long Stay 15 % con ≥ 7 noches. Sin Supabase ni reloj.
// ─────────────────────────────────────────────────────────────────────────
const IDA = "2027-03-08";
const ANTICIPADA = "2027-01-04"; // 63 días antes: cumple EBB
const TARDE = "2027-03-01";      // 7 días antes: no cumple EBB
const EBB = { tipo: "ebb" as const, umbral: 30, pct: 12 };
const LS = { tipo: "long_stay" as const, umbral: 7, pct: 15 };

const vigencia = (over: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: "2027-03-01", fecha_fin: "2027-03-31", prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...over,
});
const tarifa = (temporada: string, over: Partial<FilaTarifaHotelRaw> = {}): FilaTarifaHotelRaw => ({
  tipo_habitacion: "Estandar", alimentacion: "PAM", temporada,
  neto_sencilla: null, neto_doble: 100_000, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...over,
});
type Comb = { estado: "heredada" | "configurada" | "pendiente"; alternativas: string[]; acumulable_ebb?: boolean | null; acumulable_long_stay?: boolean | null; orden?: string[] | null };
const promo = (comb: Comb | null, over: Partial<FilaTemporadaHotelRaw> = {}) =>
  vigencia({ nombre: "PROMO", prioridad: 2, tipo: "descuento_pct", descuento_valor: 10, ...(comb ? { hotel_promocion_combinacion: [comb] } : {}), ...over } as FilaTemporadaHotelRaw);
const filaPromo = (nombre = "PROMO") => tarifa(nombre, { neto_doble: 90_000, precio_final_autoritativo: true, temporada_base: "ALTA" });

function evaluar(temporadas: FilaTemporadaHotelRaw[], reglas: { tipo: "ebb" | "long_stay"; umbral: number; pct: number }[], fechaReserva: string, tarifas = [tarifa("ALTA"), filaPromo()]) {
  const d: DatosHotelPaquete = {
    paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2027-01-01", fecha_viaje_fin: "2027-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel Test", hotel_moneda: "COP" },
    temporadas, tarifas, serviciosIncluidos: [], blackouts: [], reglasDescuento: reglas, fechaReserva,
  };
  return evaluarHotelPorFechas(d, IDA, 7);
}
const neto = (r: ReturnType<typeof evaluar>) => r?.combos[0]?.netos?.["doble"];
const cerca = (a: number | undefined, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

const NO_ACUM: Comb = { estado: "configurada", alternativas: ["ebb", "long_stay"], acumulable_ebb: false, acumulable_long_stay: false, orden: ["ebb", "long_stay", "promocion"] };
const R5: Comb = { estado: "configurada", alternativas: ["ebb", "long_stay"], acumulable_ebb: true, acumulable_long_stay: false, orden: ["ebb", "long_stay", "promocion"] };

describe("R.2 — orden EBB > Long Stay > promoción, nada acumula", () => {
  const t = [vigencia({ nombre: "ALTA" }), promo(NO_ACUM)];
  test("las tres cumplen: gana EBB (primera del orden) sobre el neto SIN la promoción: 616.000", () => cerca(neto(evaluar(t, [EBB, LS], ANTICIPADA)), 616_000));
  test("EBB no cumple; Long Stay y promoción sí: Long Stay excluye la promoción: 595.000", () => cerca(neto(evaluar(t, [EBB, LS], TARDE)), 595_000));
  test("solo la promoción: 630.000", () => cerca(neto(evaluar(t, [EBB], TARDE)), 630_000));
  test("nada: 700.000", () => cerca(neto(evaluar([vigencia({ nombre: "ALTA" })], [], TARDE, [tarifa("ALTA")])), 700_000));
  test("el orden manda sobre el mayor %: 616.000 aunque Long Stay descuente más", () => {
    const r = evaluar(t, [EBB, LS], ANTICIPADA);
    assert.equal(r!.combos[0].descuentoPorAcom?.["doble"]?.tipo, "ebb");
    assert.equal(r!.descuentoHotel?.tipo, "long_stay", "el de la estadía sin promoción sigue siendo el mayor %");
  });
});

describe("Solo EBB y Long Stay (sin promoción aplicable): regla vigente exacta", () => {
  test("gana el mayor % y no se suman: 595.000, aunque una promoción del hotel tenga otro orden", () => {
    const fuera = promo(NO_ACUM, { fecha_inicio: "2027-04-01", fecha_fin: "2027-04-30" }); // no cubre la estadía
    const r = evaluar([vigencia({ nombre: "ALTA" }), fuera], [EBB, LS], ANTICIPADA, [tarifa("ALTA"), filaPromo()]);
    cerca(neto(r), 595_000);
    assert.equal(r!.combos[0].descuentoPorAcom, undefined);
  });
});

describe("R.5 — promoción–EBB acumulable, promoción–Long Stay no", () => {
  const t = [vigencia({ nombre: "ALTA" }), promo(R5)];
  test("las tres: EBB, Long Stay descartada (choca con EBB), promoción incluida: 630.000 × 0,88 = 554.400", () => cerca(neto(evaluar(t, [EBB, LS], ANTICIPADA)), 554_400));
  test("promoción y EBB: 554.400", () => cerca(neto(evaluar(t, [EBB], ANTICIPADA)), 554_400));
  test("promoción y Long Stay: Long Stay excluye la promoción: 595.000", () => cerca(neto(evaluar(t, [EBB, LS], TARDE)), 595_000));
});

describe("Promociones existentes: comportamiento vigente (golden 264.000 frente a 330.000)", () => {
  // Mismo caso que la caracterización E3: 3 noches, promoción 80.000 materializada, EBB 12 %.
  const base = [vigencia({ nombre: "ALTA" })];
  const fila80 = tarifa("PROMO", { neto_doble: 80_000, precio_final_autoritativo: true, temporada_base: "ALTA" });
  const ev = (t: FilaTemporadaHotelRaw[]) => evaluarHotelPorFechas({
    paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2027-01-01", fecha_viaje_fin: "2027-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel Test", hotel_moneda: "COP" },
    temporadas: t, tarifas: [tarifa("ALTA"), fila80], serviciosIncluidos: [], blackouts: [], reglasDescuento: [EBB], fechaReserva: "2027-01-04",
  }, "2027-03-05", 3)!.combos[0];
  for (const [nombre, comb] of [["heredada", { estado: "heredada", alternativas: ["ebb"] } as Comb], ["sin fila", null]] as const) {
    test(`${nombre}: EBB sobre el total con la promoción: 211.200 neto → 264.000`, () => {
      const c = ev([...base, promo(comb, { prioridad: 2, descuento_valor: 20 })]);
      assert.equal(c.netos?.["doble"], 211_200);
      assert.equal(c.precios["doble"], 264_000);
    });
  }
});

describe("Pendiente y sin resolver: no se elige nada implícito", () => {
  test("promoción nueva pendiente: el motor la ignora; la base se sigue vendiendo (700.000 → con Long Stay 595.000)", () => {
    const t = [vigencia({ nombre: "ALTA" }), promo({ estado: "pendiente", alternativas: ["long_stay"] })];
    cerca(neto(evaluar(t, [LS], TARDE)), 595_000);
    cerca(neto(evaluar(t, [], TARDE)), 700_000);
  });
  test("configurada sin respuesta para una regla que la reserva cumple: la acomodación no se vende y se informa", () => {
    const t = [vigencia({ nombre: "ALTA" }), promo({ estado: "configurada", alternativas: ["ebb"], acumulable_ebb: true, orden: null })];
    const r = evaluar(t, [EBB, LS], ANTICIPADA);
    assert.equal(r!.combos.length, 0);
    assert.match(r!.precedenciaSinResolver ?? "", /PROMO/);
  });
  test("sin la regla que falta, la misma configuración vende: promoción + EBB acumulados = 554.400", () => {
    const t = [vigencia({ nombre: "ALTA" }), promo({ estado: "configurada", alternativas: ["ebb"], acumulable_ebb: true, orden: null })];
    cerca(neto(evaluar(t, [EBB], ANTICIPADA)), 554_400);
  });
});

describe("S.1 — dos promociones configuradas que coinciden con órdenes distintos", () => {
  const args = { reglas: [EBB, LS], fechaReserva: ANTICIPADA, fechaIda: IDA, numNoches: 7 };
  const A = normCombinacion(NO_ACUM)!, B = normCombinacion({ ...NO_ACUM, orden: ["long_stay", "ebb", "promocion"] })!;
  test("se rechaza (no se elige una arbitrariamente)", () => {
    const d = resolverPrecedencia({ promos: [{ nombre: "A", combinacion: A }, { nombre: "B", combinacion: B }], ...args });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.motivo, "contradiccion");
    // El aviso distingue las dos, dice qué decisión difiere y usa la estadía cotizada como ejemplo.
    assert.equal(d.ok === false && d.detalle,
      "«A» y «B» aplican en esta estadía (entrada 08/03/2027, 7 noches) y deciden distinto frente a EBB / Long Stay: el orden de aplicación: "
      + "«A» compra anticipada (EBB) → larga estadía (Long Stay) → promoción; «B» larga estadía (Long Stay) → compra anticipada (EBB) → promoción. "
      + "No se vende hasta que tengan la misma configuración o se separen sus fechas, compra o régimen.");
  });
  test("acumulación distinta: el aviso nombra la regla en la que difieren", () => {
    const C = normCombinacion({ ...NO_ACUM, acumulable_ebb: true })!;
    const d = resolverPrecedencia({ promos: [{ nombre: "A", combinacion: A }, { nombre: "C", combinacion: C }], ...args });
    assert.match(d.ok === false ? d.detalle : "", /deciden distinto frente a EBB \/ Long Stay: «A» no acumula con compra anticipada \(EBB\) y «C» sí\./);
  });
  test("con la misma configuración, se aplica normalmente", () => {
    const d = resolverPrecedencia({ promos: [{ nombre: "A", combinacion: A }, { nombre: "B", combinacion: A }], ...args });
    assert.ok(d.ok && d.descuento?.tipo === "ebb" && !d.usarPromocion);
  });
});

describe("Formulario de combinación (misma regla que la RPC)", () => {
  test("sin respuesta no hay valor por defecto", () => {
    assert.equal(validarCombinacion({ acumulable: {} }, ["ebb"]).ok, false);
  });
  test("todo acumulable con una sola regla: no pide orden", () => {
    assert.equal(requiereOrden(["ebb"], { ebb: true }), false);
    const v = validarCombinacion({ acumulable: { ebb: true } }, ["ebb"]);
    assert.ok(v.ok && v.valor.orden === null);
  });
  test("EBB y Long Stay a la vez siempre piden orden (nunca acumulan entre sí)", () => {
    assert.equal(requiereOrden(["ebb", "long_stay"], { ebb: true, long_stay: true }), true);
    assert.equal(validarCombinacion({ acumulable: { ebb: true, long_stay: true } }, ["ebb", "long_stay"]).ok, false);
    assert.ok(validarCombinacion({ acumulable: { ebb: true, long_stay: true }, orden: ["long_stay", "promocion", "ebb"] }, ["ebb", "long_stay"]).ok);
  });
  test("orden con repetidos o incompleto: rechazado", () => {
    assert.equal(validarCombinacion({ acumulable: { ebb: false }, orden: ["ebb", "ebb"] }, ["ebb"]).ok, false);
    assert.equal(validarCombinacion({ acumulable: { ebb: false }, orden: ["ebb"] }, ["ebb"]).ok, false);
  });
  test("mensajes de la base sin prefijo técnico", () => {
    assert.equal(mensajePromo300("ERROR: COMBINACION_SIN_CONFIGURAR: «X» puede coincidir"), "«X» puede coincidir");
    assert.equal(mensajePromo300("CONTRADICCION_PROMOCIONES: «A» y «B»"), "«A» y «B»");
    assert.equal(mensajePromo300("CONFLICTO_PROMOCIONES:  dos"), "dos");
  });
  test("mismoDescuento compara regla y %", () => {
    assert.ok(mismoDescuento(null, undefined));
    assert.ok(!mismoDescuento({ tipo: "ebb", umbral: 30, pct: 12 } as never, null));
  });
});

describe("Composición publicada: promociones y neto sin ellas sobreviven a la relectura", () => {
  const base = { pctMk: 0.2, impuesto: 0, vuelo: 0, vueloNeto: null, feeInfante: 0, servicios: [], netos: { doble: 630_000 }, pvps: { doble: { pvp: 788_000, pvpMenor2: null } } };
  test("se conserva", () => {
    const r = leerBaseGuardada({ ...base, promociones: { doble: { nombres: ["PROMO"], netoSinPromocion: 700_000 } } });
    assert.deepEqual(r?.promociones, { doble: { nombres: ["PROMO"], netoSinPromocion: 700_000 } });
  });
  test("forma inválida: la composición no se acepta (no se recompone a ciegas)", () => {
    assert.equal(leerBaseGuardada({ ...base, promociones: { doble: { nombres: "PROMO" } } }), null);
  });
  test("sin promociones: igual que antes (sin la clave)", () => {
    assert.equal("promociones" in (leerBaseGuardada(base) ?? {}), false);
  });
});

describe("Etiqueta cuando la precedencia decide distinto por acomodación (presentación; importes intactos)", () => {
  // La promoción solo tiene precio para la doble (su fila no trae triple): la triple se vende con la base y su regla es la de la
  // estadía (Long Stay, mayor %); la doble, con la promoción, gana EBB por el orden del proveedor.
  const t = [vigencia({ nombre: "ALTA" }), promo(NO_ACUM)];
  const tarifas = [tarifa("ALTA", { neto_triple: 80_000 }), filaPromo()];
  test("motor: doble = EBB sobre el neto sin promoción (616.000 / pers.), triple = Long Stay (476.000 / pers.)", () => {
    const r = evaluar(t, [EBB, LS], ANTICIPADA, tarifas)!;
    cerca(r.combos[0].netos?.["doble"], 616_000);
    cerca(r.combos[0].netos?.["triple"], 476_000);
    assert.equal(r.combos[0].descuentoPorAcom?.["doble"]?.tipo, "ebb");
    assert.equal(r.descuentoHotel?.tipo, "long_stay");
  });
  test("se muestra una etiqueta por acomodación, nunca la de una como si fuera de todas", () => {
    const r = evaluar(t, [EBB, LS], ANTICIPADA, tarifas)!;
    const m = descuentoMostrado(r.descuentoHotel, r.combos[0].descuentoPorAcom, ["triple", "doble"])!;
    assert.deepEqual(m.porAcomodacion?.map((x) => [x.acom, x.etiqueta]), [["doble", r.combos[0].descuentoPorAcom!.doble!.etiqueta], ["triple", r.descuentoHotel!.etiqueta]]);
    assert.equal(m.tipo, undefined, "mixta: sin una sola regla");
    assert.match(m.etiqueta, /^Doble: .*EBB.* · Triple: .*Long Stay/);
  });
  test("una sola acomodación pedida: su regla, como siempre", () => {
    const r = evaluar(t, [EBB, LS], ANTICIPADA, tarifas)!;
    assert.equal(descuentoMostrado(r.descuentoHotel, r.combos[0].descuentoPorAcom, ["doble"])?.tipo, "ebb");
    assert.equal(descuentoMostrado(r.descuentoHotel, r.combos[0].descuentoPorAcom, ["triple"])?.tipo, "long_stay");
  });
  test("sin regla en una acomodación: lo dice («sin EBB / Long Stay»); todas iguales: la de siempre; ninguna: null", () => {
    const e = { ...EBB, etiqueta: "EBB · 30+ días · 12 %" };
    assert.match(descuentoMostrado(e, { triple: null }, ["doble", "triple"])!.etiqueta, /^Doble: EBB · 30\+ días · 12 % · Triple: sin EBB \/ Long Stay$/);
    assert.deepEqual(descuentoMostrado(e, { triple: e }, ["doble", "triple"]), { etiqueta: e.etiqueta, tipo: "ebb", umbral: 30, pct: 12 });
    assert.equal(descuentoMostrado(null, undefined, ["doble"]), null);
  });
  test("la composición guardada conserva la etiqueta mixta y sigue aceptando la de siempre", () => {
    const comp = { version: 1, moneda: "COP", trm: null, markup: { tipo: "global", pct: 0.2 }, impuestoIncluido: 0, lineas: [], adicionales: [], total: 0 };
    const mixta = { etiqueta: "Doble: EBB · Triple: sin EBB / Long Stay", porAcomodacion: [{ acom: "doble", etiqueta: "EBB" }, { acom: "triple", etiqueta: null }] };
    assert.deepEqual(leerComposicion({ ...comp, descuentoHotel: mixta })?.descuentoHotel, mixta);
    assert.deepEqual(leerComposicion({ ...comp, descuentoHotel: { etiqueta: "EBB", tipo: "ebb", umbral: 30, pct: 12 } })?.descuentoHotel, { etiqueta: "EBB", tipo: "ebb", umbral: 30, pct: 12 });
  });
});
