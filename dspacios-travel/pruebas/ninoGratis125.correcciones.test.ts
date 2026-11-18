import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";
import { calcularBeneficioNinoGratis, type HabitacionOcupada } from "../lib/hoteles/ninoGratis.ts";
import { ventaNinoCondonada, ajustarNochesNinoGratis } from "../lib/reservar/ninoGratisPrecio.ts";
import { esLineaNinoGratis } from "../lib/reservar/ninoGratisLinea.ts";
import { componerTarifa, marcar } from "../lib/calc/paquetes.ts";
import { construirResumenCarrito, type PersonaBase, type UnidadBase } from "../lib/cotizacion/resumenCarrito.ts";
import { resumenNetoCarrito } from "../lib/cotizacion/resumenNeto.ts";
import { desgloseInterno } from "../lib/cotizacion/desgloseInterno.ts";
import type { NocheNinoGratis } from "../lib/calc/paquetes.ts";

// #125 · correcciones F1–F4 (auditoría Codex): consumidores de precio con el MOTOR REAL (sin mocks de precio).
// F1 = noches PAGADERAS (promoción de estadía, EBB/Long Stay y centavos aplicados a la SUMA) · F3 = resumen por pasajero · F4 = rechazos sin omisiones silenciosas.
const PCT_MK = 0.2;
const FECHA_RESERVA = "2026-11-17";

const vig = (o: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: null, fecha_fin: null, prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...o,
});
const tar = (temporada: string, o: Partial<FilaTarifaHotelRaw>): FilaTarifaHotelRaw => ({
  tipo_habitacion: "Estandar", alimentacion: "PAM", temporada,
  neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...o,
});
const BASE = vig({ id: 1, nombre: "BASE", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31" });
const SIGUE = (o: Partial<FilaTemporadaHotelRaw> = {}) => vig({
  id: 10, nombre: "PRE BF", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10,
  hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: null }], promo_sigue_base: true, nino_gratis: true, ...o,
} as FilaTemporadaHotelRaw);
const TAR = [tar("BASE", { neto_doble: 200, neto_nino: 100, neto_nino2: 100, neto_infante: 0 })];

function evaluar(temporadas: FilaTemporadaHotelRaw[], o: { ida?: string; noches?: number; tarifas?: FilaTarifaHotelRaw[]; extra?: Partial<DatosHotelPaquete> } = {}) {
  const datos: DatosHotelPaquete = {
    paquete: { pct_mk: PCT_MK, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-12-01", fecha_viaje_fin: "2026-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel Test", hotel_moneda: "COP" },
    temporadas, tarifas: o.tarifas ?? TAR, serviciosIncluidos: [], blackouts: [], fechaReserva: FECHA_RESERVA, ...o.extra,
  };
  return evaluarHotelPorFechas(datos, o.ida ?? "2026-12-04", o.noches ?? 2);
}
const combo = (r: ReturnType<typeof evaluar>) => r!.combos[0];
const UNA: HabitacionOcupada[] = [{ indice: 0, adultos: 2, nino: 1, nino2: 0, infantes: 0 }];
const sumaNoches = (n: readonly NocheNinoGratis[] | undefined) => (n ?? []).reduce((t, x) => t + x.neto, 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

describe("F1 · el beneficio usa las noches PAGADERAS (promoción de estadía): caso de la auditoría", () => {
  // 2 noches, adulto 200/noche, niño 100/noche, seguir la base −10 % con niño gratis, y una noche gratis de estadía.
  const UNA_GRATIS = vig({ id: 11, nombre: "UNA GRATIS", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31", prioridad: 6, tipo: "promo_noche_gratis", min_noches: 2 });
  test("niño = 90 (una noche de 90, no dos), beneficio −90 (no −180) y costo del hotel 360 (no 270)", () => {
    const c = combo(evaluar([BASE, SIGUE(), UNA_GRATIS]));
    assert.equal(c.netos?.nino, 90);
    assert.equal(c.netos?.doble, 180);
    assert.equal(sumaNoches(c.ninoGratisNoches?.nino), 90, "las noches del niño gratis ya vienen con la promoción de estadía");
    const b = calcularBeneficioNinoGratis({ habitaciones: UNA, nochesNino: c.ninoGratisNoches?.nino, pctMk: PCT_MK })!;
    assert.equal(b.costoNeto, 90);
    assert.equal(b.total, -r2(marcar(90, PCT_MK))); // −112,5 (con markup); antes −225 (la estadía de 2 noches pagada dos veces)
    const hotelPagado = 2 * c.netos!.doble + c.netos!.nino - b.costoNeto; // 2 adultos × 180 + niño 90 − 90 condonado
    assert.equal(hotelPagado, 360);
  });
  test("invariante: lo condonado nunca supera lo que el niño pagaría (Σ noches = neto del niño) en promedio, última, más barata y monto fijo por persona", () => {
    const casos: [string, Partial<FilaTemporadaHotelRaw>][] = [
      ["promedio", {}],
      ["última", { noche_gratis_regla: "ultima" }],
      ["más barata", { noche_gratis_regla: "mas_barata" }],
      ["más cara", { noche_gratis_regla: "mas_cara" }],
    ];
    for (const [nombre, regla] of casos) {
      const c = combo(evaluar([BASE, SIGUE(), { ...UNA_GRATIS, ...regla } as FilaTemporadaHotelRaw]));
      assert.equal(sumaNoches(c.ninoGratisNoches?.nino), c.netos?.nino, `noche gratis ${nombre}: Σ noches pagaderas = neto del niño`);
      assert.equal(c.netos?.nino, 90, `noche gratis ${nombre}: el niño paga una noche de 90`);
    }
    const monto = vig({ id: 12, nombre: "MONTO", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31", prioridad: 6, tipo: "descuento_monto", descuento_valor: 30, descuento_unidad: "persona_estadia" } as Partial<FilaTemporadaHotelRaw> & { nombre: string });
    const cm = combo(evaluar([BASE, SIGUE(), monto]));
    assert.equal(sumaNoches(cm.ninoGratisNoches?.nino), cm.netos?.nino, "monto fijo por persona: Σ noches pagaderas = neto del niño");
    assert.ok((cm.netos?.nino ?? 0) < 180, "el monto fijo bajó el neto del niño");
  });
  test("«última»: la noche regalada queda en 0 y la otra conserva su neto; el beneficio solo condona la que se paga", () => {
    const c = combo(evaluar([BASE, SIGUE(), { ...UNA_GRATIS, noche_gratis_regla: "ultima" } as FilaTemporadaHotelRaw]));
    assert.deepEqual(c.ninoGratisNoches?.nino?.map((n) => n.neto), [90, 0]);
    const b = calcularBeneficioNinoGratis({ habitaciones: UNA, nochesNino: c.ninoGratisNoches?.nino, pctMk: PCT_MK })!;
    assert.equal(b.costoNeto, 90);
  });
  test("estadía parcialmente promocionada: la promoción de estadía escala solo las noches que ganó la promoción", () => {
    const parcial = SIGUE({ fecha_inicio: "2026-12-05" }); // gana solo la noche 2 (5 dic)
    const c = combo(evaluar([BASE, parcial, UNA_GRATIS]));
    assert.equal(c.netos?.nino, (100 + 90) / 2);
    assert.equal(sumaNoches(c.ninoGratisNoches?.nino), 45, "la noche promocional a mitad de precio: 90 × 1/2");
    const b = calcularBeneficioNinoGratis({ habitaciones: UNA, nochesNino: c.ninoGratisNoches?.nino, pctMk: PCT_MK })!;
    assert.ok(b.costoNeto < (c.netos?.nino ?? 0), "menos que el hotel completo del niño");
  });
  test("EBB / Long Stay legítimos se aplican a la SUMA pagadera (sin recortes), con o sin promoción de estadía, y los centavos se redondean una sola vez", () => {
    const sin = combo(evaluar([BASE, SIGUE()]));
    assert.equal(sin.netos?.nino, 180);
    for (const regla of [{ tipo: "long_stay" as const, umbral: 2, pct: 10 }, { tipo: "ebb" as const, umbral: 10, pct: 10 }]) {
      const c = combo(evaluar([BASE, SIGUE()], { extra: { reglasDescuento: [regla] } }));
      assert.equal(c.netos?.nino, 162, `${regla.tipo}: 10 % sobre el neto del niño ya promocionado (180 → 162), igual que hoy`);
      assert.equal(sumaNoches(c.ninoGratisNoches?.nino), 162, `${regla.tipo}: las noches del niño gratis suman lo que el niño paga`);
      const conEstadia = combo(evaluar([BASE, SIGUE(), vig({ id: 11, nombre: "UNA GRATIS", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-31", prioridad: 6, tipo: "promo_noche_gratis", min_noches: 2 })], { extra: { reglasDescuento: [regla] } }));
      assert.equal(sumaNoches(conEstadia.ninoGratisNoches?.nino), conEstadia.netos?.nino, `${regla.tipo} + noche gratis de estadía: Σ noches = neto del niño`);
      assert.equal(conEstadia.netos?.nino, 81);
    }
  });
  test("USD con centavos: la suma de las noches se redondea una sola vez a centavos (no noche por noche)", () => {
    const tarifas = [tar("BASE", { neto_doble: 200, neto_nino: 33.33, neto_nino2: 33.33, neto_infante: 0 })];
    const c = combo(evaluar([BASE, SIGUE()], { tarifas, noches: 3, extra: { redondeoCentavos: true, reglasDescuento: [{ tipo: "long_stay", umbral: 2, pct: 10 }] } }));
    assert.equal(r2(sumaNoches(c.ninoGratisNoches?.nino)), r2(c.netos!.nino));
  });
  test("ajustarNochesNinoGratis: ajusta la SUMA de cada promoción y reparte el resultado entre sus noches (sin recortes ni negativos)", () => {
    const noches: NocheNinoGratis[] = [
      { indice: 0, neto: 90, promocion: "A", edadMin: null, edadMax: null },
      { indice: 1, neto: 90, promocion: "A", edadMin: null, edadMax: null },
      { indice: 2, neto: 50, promocion: "B", edadMin: null, edadMax: null },
    ];
    const r = ajustarNochesNinoGratis(noches, (suma) => r2(suma * 0.9))!;
    assert.equal(r2(r.filter((n) => n.promocion === "A").reduce((t, n) => t + n.neto, 0)), 162);
    assert.equal(r.find((n) => n.promocion === "B")!.neto, 45);
    assert.equal(ajustarNochesNinoGratis(undefined, (s) => s), undefined);
  });
});

describe("F2/F4 · lo condonado es el PVP del niño menos el PVP SIN su alojamiento, con el mismo compositor", () => {
  const baseSolo = { pctMk: PCT_MK, impuesto: 0, vuelo: 0, feeInfante: 0, servicios: [] as { nombre: string; neto: number; netoMenor: number }[] };
  test("redondeo: neto 292.500 al 20 % ⇒ PVP del niño 366.000; se condonan 366.000 y el niño paga 0 (sin residuo de redondeo)", () => {
    const pvpNino = componerTarifa({ aporteHotel: marcar(292_500, PCT_MK), aporteServicios: 0, aporteVuelo: 0, impuesto: 0, moneda: "COP" }).pvp;
    assert.equal(pvpNino, 366_000);
    const v = ventaNinoCondonada({ pvpCobrado: pvpNino, netoPagadero: 292_500, netoCondonado: 292_500, base: baseSolo, moneda: "COP" });
    assert.equal(v, 366_000);
    assert.equal(pvpNino - v, 0);
  });
  test("paquete con vuelo y servicio: se condona PVP del niño − PVP sin hotel (nunca el PVP completo del paquete)", () => {
    const VUELO = 400_000, SERV_NETO = 50_000;
    const base = { ...baseSolo, vuelo: VUELO, servicios: [{ nombre: "Asistencia", neto: SERV_NETO, netoMenor: SERV_NETO }] };
    const comp = (hotelNeto: number) => componerTarifa({ aporteHotel: marcar(hotelNeto, PCT_MK), aporteServicios: marcar(SERV_NETO, PCT_MK), aporteVuelo: VUELO, impuesto: 0, moneda: "COP" }).pvp;
    const pvpNino = comp(292_500), sinHotel = comp(0);
    const v = ventaNinoCondonada({ pvpCobrado: pvpNino, netoPagadero: 292_500, netoCondonado: 292_500, base, moneda: "COP" });
    assert.equal(v, pvpNino - sinHotel);
    assert.ok(v < pvpNino && sinHotel >= VUELO, "el vuelo y el servicio se siguen cobrando");
  });
  test("condonación parcial (promoción de estadía): el niño conserva el alojamiento que sí paga y el redondeo se rehace sobre ello", () => {
    const pvpNino = componerTarifa({ aporteHotel: marcar(300_000, PCT_MK), aporteServicios: 0, aporteVuelo: 0, impuesto: 0, moneda: "COP" }).pvp;
    const v = ventaNinoCondonada({ pvpCobrado: pvpNino, netoPagadero: 300_000, netoCondonado: 100_000, base: baseSolo, moneda: "COP" });
    const resto = componerTarifa({ aporteHotel: marcar(200_000, PCT_MK), aporteServicios: 0, aporteVuelo: 0, impuesto: 0, moneda: "COP" }).pvp;
    assert.equal(v, pvpNino - resto);
  });
});

describe("F3 · resumen por pasajero con el niño gratis (misma identidad de clase, sin adulto ficticio)", () => {
  const adultos: PersonaBase = { clave: "adulto:doble", etiqueta: "Adulto · Doble", tipo: "adulto", cantidad: 2, tarifa: 500_000 };
  const unidad = (personas: PersonaBase[], extra: Partial<UnidadBase> = {}): UnidadBase => ({
    ref: "item-0", paquete: { id: 1, nombre: "Paquete" }, hotel: "Hotel", categoria: "Estándar", regimen: "PAM",
    paxTotal: personas.reduce((s, p) => s + p.cantidad, 0), infantes: 0, personas, cuposActivos: null, grupoIncluido: 0, ...extra,
  });
  const cent = (n: number) => Math.round(n * 100);
  const filas = (r: ReturnType<typeof construirResumenCarrito>) => { assert.ok(r.ok, r.ok ? "" : r.motivo); return r.resumen.unidades[0].grupos.map((g) => [g.tipo, g.cantidad, g.tarifaCentavos]); };

  test("B2C (PVP): un niño de 200.000 con 150.000 condonados paga 50.000; el total del resumen = suma de pasajeros = precio de venta", () => {
    const nino: PersonaBase = { clave: "nino", etiqueta: "Niño 1", tipo: "nino", cantidad: 1, tarifa: 200_000, condonado: [150_000] };
    const r = construirResumenCarrito({ unidades: [unidad([adultos, nino])], servicios: [], modalidad: "pvp", moneda: "COP", total: 1_000_000 + 200_000 - 150_000 });
    assert.deepEqual(filas(r), [["adulto", 2, cent(500_000)], ["nino", 1, cent(50_000)]]);
    assert.ok(r.ok && r.resumen.totalCentavos === cent(1_050_000));
  });
  test("dos niños de la misma clase, uno gratis: dos filas distintas (50.000 y 200.000), cada una con su tarifa real, y el total cuadra", () => {
    const ninos: PersonaBase = { clave: "nino", etiqueta: "Niño 1", tipo: "nino", cantidad: 2, tarifa: 200_000, condonado: [200_000, 0] };
    const r = construirResumenCarrito({ unidades: [unidad([adultos, ninos])], servicios: [], modalidad: "pvp", moneda: "COP", total: 1_000_000 + 400_000 - 200_000 });
    assert.deepEqual(filas(r), [["adulto", 2, cent(500_000)], ["nino", 1, cent(200_000)], ["nino", 1, 0]]);
    assert.ok(r.ok && r.resumen.totalCentavos === cent(1_200_000));
  });
  test("sin condonado todo es idéntico a hoy; un condonado mayor que la tarifa del niño se rechaza (no se inventa un negativo)", () => {
    const igual = construirResumenCarrito({ unidades: [unidad([adultos, { clave: "nino", etiqueta: "Niño 1", tipo: "nino", cantidad: 1, tarifa: 200_000 }])], servicios: [], modalidad: "pvp", moneda: "COP", total: 1_200_000 });
    assert.deepEqual(filas(igual), [["adulto", 2, cent(500_000)], ["nino", 1, cent(200_000)]]);
    const mal = construirResumenCarrito({ unidades: [unidad([adultos, { clave: "nino", etiqueta: "Niño 1", tipo: "nino", cantidad: 1, tarifa: 200_000, condonado: [250_000] }])], servicios: [], modalidad: "pvp", moneda: "COP", total: 950_000 });
    assert.equal(mal.ok, false);
  });
  test("con un servicio que cubre a todos el niño gratis lleva su parte del servicio y el total sigue cuadrando", () => {
    const nino: PersonaBase = { clave: "nino", etiqueta: "Niño 1", tipo: "nino", cantidad: 1, tarifa: 200_000, condonado: [150_000] };
    const r = construirResumenCarrito({
      unidades: [unidad([adultos, nino])], servicios: [{ id: "t", nombre: "Tour", precio: 300_000, pax: 3, hotelRef: "item-0" }],
      modalidad: "pvp", moneda: "COP", total: 1_050_000 + 300_000,
    });
    assert.ok(r.ok);
    assert.equal(r.resumen.totalCentavos, cent(1_350_000));
  });
  test("B2B con comisión (PVP del hotel a la vista): la comisión no cambia el resumen PVP; con recobro el niño gratis no lo recibe", () => {
    const nino: PersonaBase = { clave: "nino", etiqueta: "Niño 1", tipo: "nino", cantidad: 1, tarifa: 200_000, condonado: [150_000] };
    const r = construirResumenCarrito({ unidades: [unidad([adultos, nino])], servicios: [], modalidad: "pvp", moneda: "COP", total: 1_050_000 + 100_000, recobroPorUnidad: { "item-0": 100_000 } });
    assert.ok(r.ok, r.ok ? "" : r.motivo);
    assert.equal(r.resumen.totalCentavos, cent(1_150_000));
    const n = r.resumen.unidades[0].grupos.find((g) => g.tipo === "nino")!;
    assert.equal(n.tarifaCentavos, cent(50_000), "el recobro va a los adultos, no al niño");
  });
  test("NETO: la comisión parte de lo que de verdad se cobra (niño con alojamiento condonado) y Σ pasajeros = total exigible", () => {
    const nino: PersonaBase = { clave: "nino", etiqueta: "Niño 1", tipo: "nino", cantidad: 1, tarifa: 200_000, condonado: [150_000] };
    const exigible = 1_050_000 - 80_000;
    const r = resumenNetoCarrito({ unidades: [unidad([adultos, nino])], servicios: [], impuestoPorUnidad: { "item-0": 100_000 }, impuestoServicio: {}, recobroTotal: 0, participacion: 0, comisionTotalAliado: 80_000, moneda: "COP", exigible });
    assert.ok(r.ok, r.ok ? "" : r.motivo);
    const u = r.resumen.unidades[0];
    assert.equal(u.grupos.reduce((s, g) => s + g.subtotalCentavos, 0) + u.ajusteCentavos, cent(exigible));
    assert.equal(r.resumen.totalCentavos, cent(exigible));
    const n = u.grupos.find((g) => g.tipo === "nino")!;
    assert.ok(n.tarifaCentavos < cent(50_000), "el niño NETO parte de 50.000 (lo que paga), no de 200.000");
  });
});

describe("F3 · la línea firmada del niño gratis no es un adulto para ningún lector", () => {
  test("esLineaNinoGratis reconoce la descripción del contrato y la del carrito (con hotel delante) y nada más", () => {
    assert.equal(esLineaNinoGratis("Niño gratis por habitación · PRE BF (hab. 1: niño (Niño 1))"), true);
    assert.equal(esLineaNinoGratis("Hotel X · Niño gratis por habitación · PRE BF (hab. 1: niño (Niño 1))"), true);
    assert.equal(esLineaNinoGratis("Niño 1 · Estandar / PAM"), false);
    assert.equal(esLineaNinoGratis(undefined), false);
  });
  test("desglose interno: la línea firmada cuenta como hotel y Σ renglones = precio de venta", () => {
    const items = [
      { descripcion: "1 hab Doble (2 pax) · Estandar / PAM", adultos: 2, ninos: 0, tarifa_adulto: 500_000, tarifa_nino: 0 },
      { descripcion: "Niño 1 · Estandar / PAM", adultos: 0, ninos: 1, tarifa_adulto: 0, tarifa_nino: 200_000 },
      { descripcion: "Niño gratis por habitación · PRE BF (hab. 1: niño (Niño 1))", adultos: 1, ninos: 0, tarifa_adulto: -150_000, tarifa_nino: 0 },
    ];
    const d = desgloseInterno({ precio_venta: 1_050_000, detalle: { items } })!;
    assert.equal(d.cuadra, true);
    assert.equal(d.lineas[2].grupo, "hotel");
  });
});

describe("F4 · rechazos sin omisiones silenciosas y TRM (cableado en el código real)", () => {
  const leer = (r: string) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const computo = leer("lib/reservar/computo.ts");
  const cotizar = leer("lib/reservar/cotizar.ts");
  // Integración con #102: el cuerpo del bucle de combos de la búsqueda vive ahora en el motor compartido de composición.
  const motor = leer("lib/reservar/composicionHotelBusqueda.ts");
  test("computo: la oferta con TRM ya no se omite; convierte la venta con aMoneda63 y rechaza si faltan TRM, edades, desglose o menor de 2 años", () => {
    assert.match(computo, /aMonedaVentaNG = oferta63 \? \(n: number\) => aMoneda63\(n, monedaHotelNG, oferta63!\.moneda, oferta63!\.trm \?\? null\)/);
    assert.doesNotMatch(computo, /!oferta63 &&[^\n]*nochesNinoGratis/);
    assert.match(computo, /if \(b\?\.bloqueo\) return \{ ok: false, error: b\.bloqueo \}/);
    assert.match(computo, /la TRM de la oferta no está disponible/);
    assert.match(computo, /if \(!distribucionMenores\) \{\s*return \{ ok: false, error: "Este hotel tiene una promoción con un niño gratis por habitación/);
    assert.match(computo, /faltaDesglose/);
  });
  test("cotizar (buscador): las mismas condiciones rechazan en vez de quitar el beneficio; el costo se conserva en moneda del hotel", () => {
    assert.match(motor, /ventaNinoCondonada/);
    assert.match(motor, /\.bloqueo/);
    assert.match(motor, /motivoPrimero \?\?= b\.bloqueo/);
    assert.match(motor, /faltaDesglose/);
    assert.match(motor, /esMenorDeDos\(n\.edad\)/);
    // el resultado de buscarHoteles sigue exponiendo el beneficio del combo más barato
    assert.match(cotizar, /mejor\.beneficioNinoGratis/);
  });
  test("no queda el comentario de atajo (shortcut) de la TRM", () => {
    assert.doesNotMatch(computo, /shortcut:/);
    assert.doesNotMatch(cotizar, /shortcut:[^\n]*TRM/i);
  });
});
