// Se ejecuta con npm run test:react: el productor de la tarjeta (.tsx) y el del modal viven en módulos cliente que solo carga el loader del arnés; la acción y computarReserva son los REALES.
// #439 — La tarjeta/modal del tarifario envía TODAS las combinaciones categoría×régimen de la salida (las que tienen doble publicada) y `validarEntradaTarjeta` solo admitía 12.
// Un hotel con 16 (4 categorías × PA/PAE/PAM/PC) era rechazado ANTES de `computarReserva`, sin ningún registro, con el mensaje genérico — en TODAS sus salidas.
// Recorrido completo con código real: productor (`salidasDeTarjeta` de la tarjeta y `entradaSalida` del modal «Ver opciones») → `validarEntradaTarjeta` → `cotizarTarjetaHotel` → `computarReserva`
// (cliente de base falso). Sin excepciones por hotel: ids y nombres son arbitrarios.
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBd, tablasBase, JOINS_ARMADO, PAQUETE_ID, type Fila } from "./destinosAereos67Soporte.ts";

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

let clienteActual: unknown = null;
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteActual } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteActual } });

const { cotizarTarjetaHotel } = await import("@/app/tarifario/cotizarTarjetaActions.ts");
const { entradaSalida } = await import("../app/tarifario/cotizacionSalidaModal.ts");
const { salidasDeTarjeta } = await import("../app/tarifario/TarjetaHotelFechas.tsx");
const Entrada = await import("../lib/tarifario/entradaTarjeta.ts");
const MENSAJE = "No pudimos calcular el precio para esas fechas. Elige otras o intenta de nuevo.";

type Combo = { categoria: string; regimen: string };
const combosDe = (cats: string[], regs: string[]): Combo[] => cats.flatMap((categoria) => regs.map((regimen) => ({ categoria, regimen })));
const CAT4 = ["Estándar", "Superior", "Junior Suite", "Suite"], REG4 = ["PA", "PAE", "PAM", "PC"];
const HOTELES: [string, number, Combo[]][] = [
  ["hotel con 16 combinaciones (4 categorías × PA, PAE, PAM, PC)", 94, combosDe(CAT4, REG4)],
  ["otro hotel con 15 combinaciones (5 categorías × 3 regímenes)", 555, combosDe(["Standard", "Deluxe", "Familiar", "Vista Mar", "Penthouse"], ["PA", "PAM", "PC"])],
];

/** El combo más barato va ÚLTIMO a propósito: si algo recorta la lista, el mínimo se pierde. */
const precioDe = (i: number, n: number) => (i === n - 1 ? 900_000 : 1_256_000 + i * 1_000);

function tablas(hotelId: number, combos: Combo[]): Record<string, Fila[]> {
  return {
    ...tablasBase({ check: false }),
    hoteles: [{ id: hotelId, modelo_tarifario: "persona", nombre: `Hotel ${hotelId}`, moneda: "COP", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, pax_min: 1, pax_max: 4, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, adults_only: false, pet_friendly: false }],
    hotel_acomodaciones: [{ hotel_id: hotelId, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }],
    hotel_temporadas: [{ id: 1, hotel_id: hotelId, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null, condicion_pago_tipo: null, condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null }],
    tarifa_hotel: combos.map((c, i) => ({ id: 10 + i, hotel_id: hotelId, tipo_habitacion: c.categoria, alimentacion: c.regimen, temporada: "Base", neto_sencilla: null, neto_doble: 300_000, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, nota_infante: null, notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, precio_final_autoritativo: false })),
    hotel_blackouts: [], hotel_reglas_descuento: [], armado_servicios: [], servicios_adicionales: [],
    // Lo que publica el generador: una fila «doble» por combo (el productor deriva de ellas los combos).
    tarifario_resultado_publicable: combos.map((c, i) => ({
      modulo: "bloqueo", paquete_id: PAQUETE_ID, hotel_id: hotelId, categoria: c.categoria, regimen: c.regimen, bloqueo_id: 101, empaquetado_id: null, salida_id: null, acomodacion: "doble",
      precio_doble: precioDe(i, combos.length), precio_pvp: precioDe(i, combos.length), hotel_nombre: `Hotel ${hotelId}`, destino_nombre: "X", fecha_ida: "2030-11-20", fecha_regreso: "2030-11-23", noches: 3, moneda: "COP",
    })),
  };
}

describe("recorrido completo: productor → validador → cotizarTarjetaHotel → computarReserva, con más de 12 combinaciones", () => {
  for (const [nombre, hotelId, combos] of HOTELES) {
    test(`${nombre}: el modal calcula TODAS y encuentra la más barata (la última de la lista)`, async () => {
      const t = tablas(hotelId, combos);
      const bd = crearBd(t, { joins: JOINS_ARMADO });
      clienteActual = bd.cliente;
      const entrada = entradaSalida(t.tarifario_resultado_publicable as never, PAQUETE_ID, hotelId);
      assert.ok(entrada, "el productor debe construir la entrada de la salida");
      assert.equal((entrada.input.combos as Combo[]).length, combos.length, "el productor envía todas las combinaciones, sin recortar");
      const r = await cotizarTarjetaHotel(entrada.input);
      assert.equal(r.ok, true, r.ok ? "" : `rechazada antes de computarReserva: ${r.error}`);
      if (!r.ok) return;
      assert.equal(r.combos.length, combos.length, "ninguna combinación se pierde");
      assert.equal(r.precio, 900_000, "el mínimo está en la última combinación: nada se recortó");
      assert.equal(r.categoria, combos[combos.length - 1].categoria);
      assert.equal(r.regimen, combos[combos.length - 1].regimen);
      assert.ok(bd.lecturas.length >= combos.length, "computarReserva se ejecutó por cada combinación");
    });

    test(`${nombre}: lo que produce la TARJETA (salidasDeTarjeta) pasa la validación y se cotiza completo`, async () => {
      const t = tablas(hotelId, combos);
      const bd = crearBd(t, { joins: JOINS_ARMADO });
      clienteActual = bd.cliente;
      const [s] = salidasDeTarjeta(t.tarifario_resultado_publicable as never, "2030-01-01");
      assert.equal(s.combos.length, combos.length);
      // Mismo literal que `seleccionActual` (TarjetaHotelFechas.tsx).
      const entrada = { modulo: s.modulo, paqueteId: PAQUETE_ID, hotelId, bloqueoId: s.bloqueoId, empaquetadoId: s.empaquetadoId, salidaId: s.salidaId, combos: s.combos };
      const v = Entrada.validarEntradaTarjeta(entrada);
      assert.equal(v.ok, true, "el validador rechazó lo que la propia tarjeta produce");
      const r = await cotizarTarjetaHotel(entrada);
      assert.equal(r.ok, true, r.ok ? "" : r.error);
      if (r.ok) { assert.equal(r.combos.length, combos.length); assert.equal(r.precio, 900_000); }
    });
  }

  test("VISTA TABLA: dos hoteles en el detalle de UNA salida, agrupados por hotel como TarifarioPublic.tsx (una cotización por hotel con el MISMO productor y validador)", async () => {
    const [t94, t555] = [tablas(94, HOTELES[0][2]), tablas(555, HOTELES[1][2])];
    const filasSalida = [...(t94.tarifario_resultado_publicable as Fila[]), ...(t555.tarifario_resultado_publicable as Fila[])];
    const bd = crearBd({
      ...t94,
      hoteles: [...t94.hoteles, ...t555.hoteles], hotel_acomodaciones: [...t94.hotel_acomodaciones, ...t555.hotel_acomodaciones],
      hotel_temporadas: [...t94.hotel_temporadas, { ...t555.hotel_temporadas[0], id: 2 }], tarifa_hotel: [...t94.tarifa_hotel, ...t555.tarifa_hotel.map((x, i) => ({ ...x, id: 500 + i }))],
      tarifario_resultado_publicable: filasSalida,
    }, { joins: JOINS_ARMADO });
    clienteActual = bd.cliente;
    // Misma agrupación que TarifarioPublic.tsx (líneas 745-757): `${hotel_id}|${paquete_id}`.
    const porHotel = new Map<string, Fila[]>();
    for (const f of filasSalida) { const k = `${f.hotel_id}|${f.paquete_id}`; (porHotel.get(k) ?? porHotel.set(k, []).get(k)!).push(f); }
    assert.equal(porHotel.size, 2);
    for (const [, fs2] of porHotel) {
      const e = entradaSalida(fs2 as never, fs2[0].paquete_id as number, fs2[0].hotel_id as number);
      assert.ok(e);
      const r = await cotizarTarjetaHotel(e.input);
      assert.equal(r.ok, true, r.ok ? "" : `Vista tabla: ${r.error}`);
      if (r.ok) assert.equal(r.combos.length, (e.input.combos as Combo[]).length);
    }
  });

  test("el límite está declarado en UNA constante compartida, cubre el catálogo real y el exacto se acepta", () => {
    const MAX = (Entrada as Record<string, unknown>).MAX_COMBOS_TARJETA;
    assert.equal(typeof MAX, "number", "MAX_COMBOS_TARJETA debe exportarse: productor y validador comparten el mismo límite");
    assert.ok((MAX as number) >= 16, "el catálogo real (hotel de 16 combinaciones) debe caber");
    const justo = Array.from({ length: MAX as number }, (_, i) => ({ categoria: `Cat ${i}`, regimen: "PC" }));
    assert.equal(Entrada.validarEntradaTarjeta({ modulo: "bloqueo", paqueteId: 1, hotelId: 2, bloqueoId: 3, combos: justo }).ok, true);
  });
});

describe("entrada inválida: sigue rechazándose ANTES de tocar la base (0 lecturas)", () => {
  const ok = { modulo: "bloqueo", paqueteId: PAQUETE_ID, hotelId: 94, bloqueoId: 101, empaquetadoId: null, salidaId: null, combos: [{ categoria: "Estándar", regimen: "PC" }] };
  const casos: [string, unknown][] = [
    ["sin combinaciones", { ...ok, combos: [] }],
    ["combos no es arreglo", { ...ok, combos: "Estándar|PC" }],
    ["muy por encima del límite", { ...ok, combos: Array.from({ length: 10_000 }, (_, i) => ({ categoria: `C${i}`, regimen: "PC" })) }],
    ["paqueteId como texto", { ...ok, paqueteId: "33" }],
    ["hotelId decimal", { ...ok, hotelId: 94.5 }],
    ["categoría vacía", { ...ok, combos: [{ categoria: "  ", regimen: "PC" }] }],
    ["régimen demasiado largo", { ...ok, combos: [{ categoria: "Estándar", regimen: "x".repeat(121) }] }],
    ["bloqueo sin bloqueoId ni empaquetadoId", { ...ok, bloqueoId: null }],
    ["dinámico sin salidaId", { ...ok, modulo: "dinamico", bloqueoId: null, salidaId: null }],
    ["módulo inventado", { ...ok, modulo: "servicios" }],
    ["null", null],
    ["arreglo", []],
  ];
  for (const [nombre, entrada] of casos) {
    test(nombre, async () => {
      const bd = crearBd(tablas(94, combosDe(CAT4, REG4)), { joins: JOINS_ARMADO });
      clienteActual = bd.cliente;
      const r = await cotizarTarjetaHotel(entrada);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error, MENSAJE);
      assert.deepEqual(bd.lecturas.filter((t) => t !== "usuarios"), [], "no debe llegar a computarReserva ni a leer tarifas (solo `usuarios`, para decidir el motivo interno)");
    });
  }

  test("justo por encima del límite declarado se rechaza (el límite sigue existiendo)", () => {
    const MAX = (Entrada as Record<string, unknown>).MAX_COMBOS_TARJETA as number;
    assert.equal(typeof MAX, "number");
    const combos = Array.from({ length: MAX + 1 }, (_, i) => ({ categoria: `Cat ${i}`, regimen: "PC" }));
    assert.equal(Entrada.validarEntradaTarjeta({ ...ok, combos }).ok, false);
  });
});
