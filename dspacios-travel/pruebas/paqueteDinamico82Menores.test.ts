// #82 — experiencia del paquete dinámico: menores (edades → Niño 1 / Niño 2 / infante por habitación), capacidad del hotel manual y de la ficha,
// servicios vinculados con las reglas de su ficha (rango por grupo, menores de 2 años) y persistencia de la selección. Reglas puras + cableado.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("hotel manual: capacidad y edades", async () => {
  const { validarConfigMenoresManual, reglasHotelManual } = await import("../lib/paqueteDinamico/menores.ts");
  test("se piden la capacidad (0 a 2) y los dos umbrales de edad", () => {
    assert.equal(validarConfigMenoresManual({ capacidadNinos: 2, edadInfanteMax: 2, edadNinoMax: 10 }).ok, true);
    assert.equal(validarConfigMenoresManual({ capacidadNinos: 0, edadInfanteMax: 2, edadNinoMax: 10 }).ok, true);
    for (const malo of [{ capacidadNinos: 3 }, { capacidadNinos: null }, { capacidadNinos: -1 }, { edadInfanteMax: null }, { edadNinoMax: 18 }, { edadInfanteMax: 10, edadNinoMax: 10 }, { edadInfanteMax: 5, edadNinoMax: 3 }]) {
      const r = validarConfigMenoresManual({ capacidadNinos: 1, edadInfanteMax: 2, edadNinoMax: 10, ...malo });
      assert.equal(r.ok, false, JSON.stringify(malo));
    }
  });
  test("la capacidad se aplica de forma general a todas las acomodaciones", () => {
    const r = reglasHotelManual({ capacidadNinos: 1, edadInfanteMax: 2, edadNinoMax: 10 });
    assert.equal(r.reglas.length, 4);
    for (const a of r.reglas) { assert.equal(a.chd_max, 1); assert.equal(a.pax_max, a.pax_tarifa + 1); }
  });
});

describe("menores por edad y capacidad (pantalla = servidor)", async () => {
  const { resolverMenores, reglasHotelManual, reglasHotelFicha, explicarEdades } = await import("../lib/paqueteDinamico/menores.ts");
  const cap2 = reglasHotelManual({ capacidadNinos: 2, edadInfanteMax: 2, edadNinoMax: 10 });
  const doble = (n: number) => ({ doble: n });

  test("sin menores no se pide nada", () => {
    const r = resolverMenores({ habitaciones: doble(1), edades: [], reglas: cap2 });
    assert.deepEqual(r.ok && [r.ninos, r.ninos2, r.infantes], [0, 0, 0]);
  });
  test("las edades se clasifican con los umbrales del hotel: niño, segundo niño e infante", () => {
    const r = resolverMenores({ habitaciones: doble(1), edades: [5, 8], reglas: cap2 });
    assert.deepEqual(r.ok && [r.ninos, r.ninos2, r.infantes], [1, 1, 0]);
    const i = resolverMenores({ habitaciones: doble(1), edades: [1], reglas: cap2 });
    assert.deepEqual(i.ok && [i.ninos, i.ninos2, i.infantes, i.menoresDeDos], [0, 0, 1, 1]);
  });
  test("CINCO NIÑOS: 1 habitación (cabe 2) y 2 habitaciones (caben 4) se rechazan con un motivo; con 3 se aceptan", () => {
    const edades = [4, 5, 6, 7, 8];
    const r1 = resolverMenores({ habitaciones: doble(1), edades, reglas: cap2 });
    assert.equal(r1.ok, false);
    assert.match(r1.ok ? "" : r1.error, /niño/i);
    assert.equal(resolverMenores({ habitaciones: doble(2), edades, reglas: cap2 }).ok, false);
    const r3 = resolverMenores({ habitaciones: doble(3), edades, reglas: cap2 });
    assert.deepEqual(r3.ok && [r3.ninos, r3.ninos2], [3, 2]);
  });
  test("capacidad 0: ningún niño; el infante solo si la capacidad lo permite", () => {
    const cero = reglasHotelManual({ capacidadNinos: 0, edadInfanteMax: 2, edadNinoMax: 10 });
    assert.equal(resolverMenores({ habitaciones: doble(1), edades: [5], reglas: cero }).ok, false);
  });
  test("la edad de un adulto no se cobra como menor", () => {
    const r = resolverMenores({ habitaciones: doble(1), edades: [15], reglas: cap2 });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /adulto/i);
  });
  test("edades inválidas (texto, negativas, más de 17) y demasiados menores", () => {
    assert.equal(resolverMenores({ habitaciones: doble(1), edades: ["x"], reglas: cap2 }).ok, false);
    assert.equal(resolverMenores({ habitaciones: doble(1), edades: [-1], reglas: cap2 }).ok, false);
    assert.equal(resolverMenores({ habitaciones: doble(1), edades: [18], reglas: cap2 }).ok, false);
    assert.equal(resolverMenores({ habitaciones: doble(5), edades: Array(11).fill(5), reglas: cap2 }).ok, false);
    assert.equal(resolverMenores({ habitaciones: doble(1), edades: "no", reglas: cap2 }).ok, false);
  });
  test("hotel con ficha: usa SUS umbrales, su capacidad por acomodación y «solo adultos»", () => {
    const ficha = reglasHotelFicha({ edad_infante_max: 1, edad_nino_max: 11 }, [{ acomodacion: "doble", pax_tarifa: 2, pax_max: 3, adt_min: 2, adt_max: 2, chd_min: 0, chd_max: 1, inf_min: 0, inf_max: 1 }]);
    const r = resolverMenores({ habitaciones: doble(1), edades: [2], reglas: ficha });
    assert.deepEqual(r.ok && [r.ninos, r.infantes], [1, 0]); // con umbral de infante 1, la edad 2 ya es niño
    assert.equal(resolverMenores({ habitaciones: doble(1), edades: [5, 6], reglas: ficha }).ok, false); // la ficha admite 1 niño en doble
    const adultos = reglasHotelFicha({ adults_only: true }, []);
    assert.equal(resolverMenores({ habitaciones: doble(1), edades: [5], reglas: adultos }).ok, false);
    assert.equal(resolverMenores({ habitaciones: doble(1), edades: [], reglas: adultos }).ok, true);
  });
  test("sin hotel (vuelo/servicios) se clasifica con los umbrales por defecto y no hay capacidad por habitación", () => {
    const r = resolverMenores({ habitaciones: doble(1), edades: [1, 5], reglas: null });
    assert.deepEqual(r.ok && [r.ninos, r.ninos2, r.infantes], [1, 0, 1]);
  });
  test("la explicación aclara las edades del hotel y que Niño 1 / Niño 2 son tarifas por habitación", () => {
    const t = explicarEdades(cap2);
    assert.match(t.edades, /infante hasta los 2 años/);
    assert.match(t.edades, /niño de 3 a 10 años/);
    assert.match(t.ninos12, /no son rangos de edad/);
    assert.match(t.ninos12, /habitación/);
  });
});

describe("servicio vinculado: reglas reales de su ficha", async () => {
  const { evaluarServicioFicha, resumenFicha, validarCapacidadFicha } = await import("../lib/paqueteDinamico/servicioFicha.ts");
  const vig = { nombre: "2099", fecha_inicio: "2099-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: 100_000, precio_infante: 30_000, recargo_individual: 0 };
  const persona = { id: 1, nombre: "Tour Islas", modo: "persona" as const, liquidacion: null, moneda: "COP", temporadas: [vig], grupos: [] };
  const grupo = { ...persona, modo: "grupo" as const, grupos: [{ pax_desde: 1, pax_hasta: 6, precio: 600_000, temporada: "2099" }] };
  const base = { fechaIda: "2099-06-10", noches: 3 };

  test("por persona: acepta cinco niños y cobra a todos con silla", () => {
    const r = evaluarServicioFicha(persona, { ...base, adultos: 2, ninos: 5, infantes: 0, menoresDeDos: 0 });
    assert.deepEqual(r.ok && [r.paxConSilla, r.costoNeto], [7, 700_000]);
  });
  test("por persona: el menor de 2 años no ocupa silla y paga la tarifa de infante de la ficha", () => {
    const r = evaluarServicioFicha(persona, { ...base, adultos: 2, ninos: 0, infantes: 1, menoresDeDos: 1 });
    assert.deepEqual(r.ok && [r.paxConSilla, r.costoNeto], [2, 230_000]);
  });
  test("por grupo con rango 1–6: DOS adultos y CINCO niños (7 con silla) se rechazan con motivo comprensible", () => {
    const r = evaluarServicioFicha(grupo, { ...base, adultos: 2, ninos: 5, infantes: 0, menoresDeDos: 0 });
    assert.equal(r.ok, false);
    const msg = r.ok ? "" : r.error;
    assert.match(msg, /Tour Islas/);
    assert.match(msg, /de 1 a 6 pasajeros/);
    assert.match(msg, /7/);
    assert.match(msg, /menores de 2 años no cuentan/);
  });
  test("por grupo: si uno de los cinco menores tiene menos de 2 años, el grupo con silla es de 6 y se acepta al precio del rango", () => {
    const r = evaluarServicioFicha(grupo, { ...base, adultos: 2, ninos: 4, infantes: 1, menoresDeDos: 1 });
    assert.deepEqual(r.ok && [r.paxConSilla, r.costoNeto], [6, 600_000]);
  });
  test("sin vigencia para la fecha, y servicios que este producto no soporta", () => {
    const r = evaluarServicioFicha(persona, { ...base, fechaIda: "2098-01-10", adultos: 2, ninos: 0, infantes: 0, menoresDeDos: 0 });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /vigencia/i);
    const t = evaluarServicioFicha({ ...persona, noSoportado: "es un traslado/combo." }, { ...base, adultos: 2, ninos: 0, infantes: 0, menoresDeDos: 0 });
    assert.equal(t.ok, false);
  });
  test("el resumen de la ficha dice cómo se cobra y qué rango cubre", () => {
    assert.match(resumenFicha(grupo).texto, /por grupo: cubre de 1 a 6 pasajeros/);
    assert.match(resumenFicha(persona).texto, /por persona/);
  });
  test("solo PVP: el precio lo escribe el equipo, pero la capacidad de la ficha se valida igual", () => {
    assert.equal(validarCapacidadFicha(grupo, { adultos: 2, ninos: 5, infantes: 0, menoresDeDos: 0 }).ok, false);
    assert.equal(validarCapacidadFicha(grupo, { adultos: 2, ninos: 2, infantes: 0, menoresDeDos: 0 }).ok, true);
    assert.equal(validarCapacidadFicha(persona, { adultos: 2, ninos: 9, infantes: 0, menoresDeDos: 0 }).ok, true);
  });
});

describe("cálculo con servicios de ficha y habitaciones de la ficha", async () => {
  const { liquidarPaquete, validarPaquete, adultosDe } = await import("../lib/paqueteDinamico/calculo.ts");
  const calc = {
    esquema: "neta_markup" as const, pvpModo: null, moneda: "COP", pctMk: 0.2, usaVuelo: false, usaHotel: true, usaServicios: true,
    hotel: { nombre: "H", neto: { sencilla: 100, doble: 100, triple: 100, multiple: 100, nino: 50, nino2: 50, infante: 0 }, pvp: {} },
    servicios: [{ id: "9", nombre: "Tour", neto: null, pvp: null, fichaPrecio: true }],
  };
  const c = { habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0 };
  test("un servicio de ficha no exige neto escrito, pero liquidar exige su total resuelto", () => {
    assert.deepEqual(validarPaquete(calc), []);
    assert.throws(() => liquidarPaquete(calc, c), /Falta el cobro del servicio/);
    const r = liquidarPaquete(calc, c, { "9": { valor: 700_000, costoNeto: 583_333, cantidad: 7 } });
    const s = r.lineas.find((l) => l.ref === "servicio:9");
    assert.deepEqual(s && [s.valor, s.costoNeto, s.cantidad, s.exigeCosto], [700_000, 583_333, 7, false]);
  });
  test("las habitaciones usan el pax por tipo de la ficha cuando el servidor lo fija", () => {
    assert.equal(adultosDe({ habitaciones: { triple: 1 }, ninos: 0, ninos2: 0, infantes: 0 }), 3);
    assert.equal(adultosDe({ habitaciones: { triple: 1 }, ninos: 0, ninos2: 0, infantes: 0, paxPorHabitacion: { triple: 2 } }), 2);
  });
});

describe("selección: URL y persistencia", async () => {
  const { aQuery, deQuery, restaurarEstado, seleccionVacia } = await import("../lib/paqueteDinamico/seleccionUrl.ts");
  const s = { ...seleccionVacia(4, 7, 8), habitaciones: { sencilla: 0, doble: 2, triple: 0, multiple: 1 }, edades: [3, 9], servicios: ["11"], fechaIda: "2099-01-10", fechaRegreso: "2099-01-13" };
  test("la selección sobrevive el viaje al checkout (ida y vuelta por la URL)", () => {
    assert.deepEqual(deQuery(Object.fromEntries(aQuery(s))), s);
  });
  test("servicios: ausente = todos; vacío = ninguno", () => {
    assert.equal(deQuery(Object.fromEntries(aQuery({ ...s, servicios: null })))?.servicios, null);
    assert.deepEqual(deQuery(Object.fromEntries(aQuery({ ...s, servicios: [] })))?.servicios, []);
  });
  test("URL manipulada: edades, habitaciones, fechas o ids inválidos se rechazan", () => {
    const ok = Object.fromEntries(aQuery(s));
    for (const mala of [{ e: "5,x" }, { e: "5,40" }, { hd: "99" }, { ida: "10/01/2099" }, { p: "0" }, { h: "abc" }, { e: Array(11).fill(5).join(",") }]) assert.equal(deQuery({ ...ok, ...mala }), null, JSON.stringify(mala));
  });
  test("lo guardado en sessionStorage se sanea al restaurar (vuelo/servicios que ya no existen se descartan)", () => {
    const guardado = { habitaciones: { sencilla: 0, doble: 1, triple: 0, multiple: 0 }, viajanMenores: true, edades: ["4", ""], vueloId: 99, fechaIda: "2099-01-10", fechaRegreso: "no-es-fecha", servicios: ["11", "77"] };
    const r = restaurarEstado(JSON.parse(JSON.stringify(guardado)), [8], ["11"]);
    assert.deepEqual(r && [r.viajanMenores, r.edades, r.vueloId, r.fechaRegreso, r.servicios], [true, ["4", ""], null, "", ["11"]]);
    assert.equal(restaurarEstado({ habitaciones: { doble: "x" } }, [], []), null);
    assert.equal(restaurarEstado("basura", [], []), null);
  });
});

describe("cableado de pantalla y servidor", () => {
  const form = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/PaqueteTotalForm.tsx"));
  const acciones = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
  const tarjeta = sinComentarios(leer("app/tarifario/PorDinamicos.tsx"));
  const seleccion = sinComentarios(leer("lib/paqueteDinamico/seleccion.ts"));

  test("montaje: capacidad de niños, edades y catálogo de categoría/plan en el hotel manual; el vinculado solo muestra su ficha", () => {
    // Desde la fila compacta del hotel, esa edición vive en la ventana «Tarifas y configuración» (HotelFilaDin.tsx).
    const fila = leer("app/(dashboard)/dashboard/paquetes/total/HotelFilaDin.tsx");
    assert.match(fila, /aria-label="Capacidad de niños por habitación"/);
    assert.match(fila, /aria-label="Infante hasta"/);
    assert.match(fila, /aria-label="Categoría de habitación"/);
    assert.match(fila, /aria-label="Plan de alimentación"/);
    assert.match(fila, /catalogo\.categorias/);
    assert.match(form, /catalogo=\{catalogoHotel\}/);
    assert.match(fila, /data-testid="menores-ficha"/);
  });
  test("montaje: validación de catálogo y de capacidad también en el servidor, y no se guardan reglas propias de un hotel con ficha", () => {
    assert.match(acciones, /cargarCatalogoHotel\(adm\)/);
    assert.match(acciones, /no existe en el catálogo/);
    assert.match(acciones, /no está configurada en la ficha del hotel/);
    assert.match(acciones, /capacidad_ninos: h\.hotelId == null \? h\.capacidadNinos : null/);
  });
  test("montaje: solo PVP por componente ya no muestra «Total declarado» y al cambiar de modalidad se limpia la inactiva (cliente y servidor)", () => {
    assert.doesNotMatch(form, /Total declarado/);
    assert.match(form, /const cambiarModalidad = /);
    assert.match(form, /totalDeclarado: null/);
    assert.match(acciones, /total_declarado: null/);
    assert.match(acciones, /neto: neta && s\.servicioId == null \? s\.neto : null/);
  });
  test("servicio vinculado: sin neto escrito cuando el precio sale de la ficha; muestra su cobro", () => {
    assert.match(form, /!\(neta && vinculado\)/);
    assert.match(form, /data-testid="cobro-ficha"/);
  });
  test("tarjeta: secciones de hotel, alimentación, habitaciones, viajeros, vuelo y servicios; edades solo si viajan menores", () => {
    for (const t of ["Hotel", "Alimentación", "Habitaciones", "Viajeros", "Vuelo", "Servicios"]) assert.match(tarjeta, new RegExp(`titulo="${t}"`));
    assert.match(tarjeta, /¿Viajan menores de edad\?/);
    assert.match(tarjeta, /\{viajanMenores && \(/);
    assert.match(tarjeta, /explicarEdades\(reglas\)/);
    assert.match(tarjeta, /sessionStorage/);
  });
  test("servidor: Niño 1 / Niño 2 / infante salen SIEMPRE de las edades (los conteos del navegador se ignoran) y los servicios se evalúan con su ficha", () => {
    assert.match(seleccion, /resolverMenores\(\{ habitaciones: a\.composicion\.habitaciones, edades: a\.composicion\.edadesMenores, reglas \}\)/);
    assert.match(seleccion, /ninos: m\.ninos, ninos2: m\.ninos2, infantes: m\.infantes/);
    assert.match(seleccion, /resolverServiciosVinculados\(\{/);
    const vinculados = sinComentarios(leer("lib/paqueteDinamico/serviciosVinculados.ts"));
    assert.match(vinculados, /evaluarServicioFicha\(f,/);
    assert.match(vinculados, /cobrarServicioPvp\(f,/);
    assert.match(seleccion, /paxPorHabitacion/);
  });
  test("cotizar y vista previa comparten el mismo núcleo", () => {
    assert.match(sinComentarios(leer("app/(dashboard)/dashboard/cotizaciones/din-actions.ts")), /resolverSeleccionDin\(admin,/);
    assert.match(sinComentarios(leer("app/tarifario/checkout/dinamico/actions.ts")), /resolverSeleccionDin\(admin,/);
  });
  test("checkout: secciones de hotel, alimentación, habitaciones, viajeros, vuelo (horarios) y servicios; se puede volver con la selección", () => {
    const c = leer("app/tarifario/checkout/dinamico/CheckoutDinamico.tsx");
    for (const t of ["res-hotel", "res-alimentacion", "res-habitaciones", "res-viajeros", "res-vuelo", "res-servicios", "cambiar-seleccion"]) assert.match(c, new RegExp(`data-testid="${t}"`));
    assert.match(sinComentarios(leer("app/tarifario/checkout/dinamico/page.tsx")), /\/tarifario\?vista=dinamicos&din=/);
    assert.match(sinComentarios(leer("app/tarifario/page.tsx")), /vistaInicial=\{sp\.vista === "dinamicos"/);
  });
});

describe("migración 277", () => {
  test("es nueva, con preflight y postcheck de UNA consulta y rollback", () => {
    leer("supabase/migrations/20260601000277_paquete_dinamico_hotel_menores.sql");
    for (const f of ["preflight", "postcheck"]) {
      const s = sinComentarios(leer(`supabase/scripts/${f}_277_paquete_dinamico_hotel_menores.sql`)).replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
      assert.equal((s.match(/;/g) ?? []).length, 1, `${f}: una sola sentencia`);
    }
    assert.match(leer("supabase/scripts/rollback_277_paquete_dinamico_hotel_menores.sql"), /drop column if exists capacidad_ninos/);
  });
});
