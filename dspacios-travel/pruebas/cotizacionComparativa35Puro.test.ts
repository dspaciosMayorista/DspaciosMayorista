// #35 — lógica PURA de las cotizaciones comparativas (lib/cotizacion/comparativa.ts).
// Sin base de datos ni red. Cubre: totales por opción sin sumar alternativas,
// partes comunes contadas UNA vez, reglas v1 (2–3 hoteles, nada exclusivo de
// una opción), privacidad del resumen público, errores neutros, contacto,
// IP de origen confiable, acomodaciones uniformes y "desde" sin $0 ficticio.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  construirComparativaManual, mensajeErrorComparativa, codigoErrorComparativa, esErrorReintentable,
  normalizarTelefono, normalizarCorreo, validarContactoSolicitud, ipOrigenConfiable, ipValida,
  composicionesUniformes, agruparPorHotel, desdeComparativa, esMadre, esTipoMadre,
  MENSAJES_COMPARATIVA, ACOMODACION_UNICA, type EntradaComparativaManual,
} from "@/lib/cotizacion/comparativa";

const HOY = "2026-10-15";
function entrada(sobre: Partial<EntradaComparativaManual> = {}): EntradaComparativaManual {
  return {
    cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123456", telefono: "3001112233", email: "a@x.test", nacimiento: "1990-01-01" },
    destino: "Cartagena", fechaIda: "2026-11-10", fechaRegreso: "2026-11-14", pax: 2, ninos: 0, tarifaNino: 0,
    recobro: 0, recobroAliado: 0, moneda: "COP", tipoAsesor: "interno", asesorInterno: "Asesor", agenciaNombre: "",
    freelanceNombre: "", plazo: "", vigenciaHasta: "2026-10-20", observaciones: "", incluye: "", noIncluye: "",
    servicios: [
      { tipo: "aereo", plataforma: "Despegar", nombre: "Aéreo BOG-CTG", proveedor: "Avianca", costoNeto: 800000, modo: "mk", pctMarkup: 20, ta: 0 },
      { tipo: "traslado", plataforma: "Directo", nombre: "Traslados", proveedor: "TransCo", costoNeto: 80000, modo: "mk", pctMarkup: 20, ta: 0 },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel A", proveedor: "Hoteles A", costoNeto: 400000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "A" },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel B", proveedor: "Hoteles B", costoNeto: 560000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "B" },
    ],
    ...sobre,
  };
}
function construir(sobre: Partial<EntradaComparativaManual> = {}) {
  const r = construirComparativaManual(entrada(sobre), { hoy: HOY, creadoPorEmail: "x@y.test" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.datos;
}

describe("manual: totales por opción", () => {
  test("cada opción = comunes UNA vez + SU hotel; nunca se suma una alternativa", () => {
    const d = construir();
    const [a, b] = d.opciones;
    // valores: aéreo 800000/0.8=1.000.000 · traslado 100.000 · hotel A 500.000 · hotel B 700.000
    assert.equal(a.total, 1_600_000);
    assert.equal(b.total, 1_800_000);
    assert.notEqual(a.total + b.total, a.total, "los totales no se acumulan");
    assert.ok(d.opciones.every((o) => o.total < 3_400_000), "ninguna opción incluye el hotel de la otra");
  });
  test("no existe ningún total global en lo que se persiste", () => {
    const d = construir();
    const texto = JSON.stringify(d);
    assert.equal(d.cabecera.precio_venta, undefined, "la madre no lleva precio_venta");
    assert.ok(!/precio_total|total_global|suma_opciones/i.test(texto));
  });
  test("las partes comunes se numeran en las filas sin opción y el hotel lleva su opción", () => {
    const d = construir();
    const comunes = d.servicios.filter((s) => s.opcion_ref === null).map((s) => s.tipo_servicio);
    assert.deepEqual(comunes, ["aereo", "traslado"]);
    assert.deepEqual(d.servicios.filter((s) => s.tipo_servicio === "hotel").map((s) => s.opcion_ref), ["A", "B"]);
  });
  test("la plantilla de cada hija contiene solo lo común + su hotel", () => {
    const d = construir();
    for (const o of d.opciones) {
      const pl = o.plantilla_hija as { payload: { servicios: { tipo: string; nombre: string }[] } };
      const nombres = pl.payload.servicios.map((s) => s.nombre);
      assert.equal(nombres.filter((n) => n.startsWith("Hotel")).length, 1);
      assert.ok(nombres.includes(o.etiqueta));
      assert.ok(!JSON.stringify(pl.payload).includes("opcionRef"), "la hija no arrastra la etiqueta de opción");
    }
  });
  test("recobro y niños entran en cada opción (iguales) y el recobro nunca sale en el resumen público", () => {
    const d = construir({ recobro: 100000, ninos: 1, tarifaNino: 250000 });
    assert.deepEqual(d.opciones.map((o) => o.total), [1_600_000 + 100_000 + 250_000, 1_800_000 + 100_000 + 250_000]);
    for (const o of d.opciones) {
      const pub = JSON.stringify(o.resumen_publico);
      assert.ok(!/recobro|costo_neto|proveedor|plataforma/i.test(pub), "el resumen público no revela neto, proveedor ni recobro");
    }
  });
  test("tarifa por persona = tarifa del adulto del documento (recobro oculto dentro)", () => {
    const d = construir({ recobro: 100000 });
    assert.equal(d.opciones[0].tarifa_persona, Math.round((1_600_000 + 100_000) / 2));
  });
  test("TA solo aplica al aéreo; el resto siempre markup", () => {
    const d = construir({ servicios: entrada().servicios.map((s) => (s.tipo === "traslado" ? { ...s, modo: "ta" as const, ta: 5 } : s)) });
    assert.equal(d.servicios.find((s) => s.tipo_servicio === "traslado")!.modo, "mk");
  });
  test("acomodación de la comparativa manual: «unica»", () => {
    assert.ok(construir().opciones.every((o) => o.acomodacion_ref === ACOMODACION_UNICA));
  });
  test("la vigencia solicitada se respeta y no supera la salida", () => {
    assert.equal(construir().cabecera.vigencia_hasta, "2026-10-20");
    const r = construirComparativaManual(entrada({ vigenciaHasta: "2026-12-01" }), { hoy: HOY });
    assert.equal(r.ok, false);
  });
});

describe("manual: reglas v1", () => {
  const falla = (sobre: Partial<EntradaComparativaManual>, patron: RegExp) => {
    const r = construirComparativaManual(entrada(sobre), { hoy: HOY });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, patron);
  };
  test("un solo hotel no es una comparativa", () => {
    falla({ servicios: entrada().servicios.filter((s) => s.opcionRef !== "B") }, /al menos dos hoteles/);
  });
  test("más de tres opciones: la cuarta etiqueta no existe", () => {
    const base = entrada().servicios;
    falla({ servicios: [...base, { ...base[3], nombre: "Hotel D", opcionRef: "D" as never }] }, /A, B o C/);
  });
  test("un hotel sin opción asignada se rechaza", () => {
    falla({ servicios: entrada().servicios.map((s) => (s.nombre === "Hotel B" ? { ...s, opcionRef: null } : s)) }, /Asigna cada hotel/);
  });
  test("un vuelo o servicio EXCLUSIVO de una opción queda fuera de v1", () => {
    falla({ servicios: entrada().servicios.map((s) => (s.tipo === "aereo" ? { ...s, opcionRef: "A" as const } : s)) }, /exclusivos de una opción/);
  });
  test("hotel sin costo se rechaza (nada de opción en $0)", () => {
    falla({ servicios: entrada().servicios.map((s) => (s.nombre === "Hotel A" ? { ...s, costoNeto: 0, nombre: "Hotel A" } : s)) }, /costo mayor a cero/);
  });
  test("moneda inválida y cliente vacío se rechazan", () => {
    falla({ moneda: "EUR" }, /COP o USD/);
    falla({ cliente: { ...entrada().cliente, nombres: "", apellidos: "" } }, /nombre del cliente/);
  });
  test("aliado con venta interna se rechaza; con agencia se conserva", () => {
    falla({ aliadoId: 7 }, /solo aplica a una venta de agencia o freelance/);
    const d = construir({ tipoAsesor: "agencia", agenciaNombre: "Ag", aliadoId: 7 });
    assert.equal(d.aliadoId, 7);
    assert.equal((d.opciones[0].plantilla_hija.payload as { aliadoId?: number }).aliadoId, undefined, "el aliado no entra al payload de la hija");
  });
  test("tres hoteles generan tres opciones (A, B, C)", () => {
    const base = entrada().servicios;
    const d = construir({ servicios: [...base, { ...base[3], nombre: "Hotel C", costoNeto: 640000, opcionRef: "C" }] });
    assert.deepEqual(d.opciones.map((o) => o.opcion_ref), ["A", "B", "C"]);
  });
});

describe("errores neutros", () => {
  test("mapea cada código conocido a su mensaje y nada más", () => {
    for (const [codigo, msg] of Object.entries(MENSAJES_COMPARATIVA)) {
      if (codigo === "DATOS") continue;
      assert.equal(mensajeErrorComparativa(`COMPARATIVA_${codigo}: texto interno`), msg);
    }
  });
  test("un error de Postgres crudo nunca llega al navegador", () => {
    for (const raw of ['duplicate key value violates unique constraint "uq_x"', 'relation "cotizaciones" does not exist', "permission denied for table x", "", null, undefined]) {
      const m = mensajeErrorComparativa(raw as string);
      assert.equal(m, "No se pudo completar la operación. Inténtalo de nuevo.");
    }
  });
  test("sin permiso y no existe no se distinguen entre sí por el mensaje de elección", () => {
    assert.equal(mensajeErrorComparativa("COMPARATIVA_NO_AUTORIZADO: x"), "No tienes permiso para esta cotización.");
    assert.ok(!/existe/i.test(MENSAJES_COMPARATIVA.NO_AUTORIZADO));
  });
  test("el límite de solicitudes es neutro: no dice qué tope se alcanzó", () => {
    assert.ok(!/b(50|tres|3|ip|hora|horas|contacto|madre)b/i.test(MENSAJES_COMPARATIVA.LIMITE));
  });
  test("DATOS conserva la frase en español pero filtra restos de SQL", () => {
    assert.equal(mensajeErrorComparativa("COMPARATIVA_DATOS: el teléfono no es válido."), "el teléfono no es válido.");
    assert.equal(mensajeErrorComparativa('COMPARATIVA_DATOS: new row violates check constraint "x"'), MENSAJES_COMPARATIVA.DATOS);
  });
  test("código y reintento", () => {
    assert.equal(codigoErrorComparativa("COMPARATIVA_VERSION: x"), "VERSION");
    assert.equal(codigoErrorComparativa("otra cosa"), null);
    assert.ok(esErrorReintentable("RECIBO"));
    assert.ok(!esErrorReintentable("NO_AUTORIZADO"));
  });
});

describe("contacto (mismo criterio que la base)", () => {
  test("teléfono: solo dígitos; correo: minúsculas", () => {
    assert.equal(normalizarTelefono("+57 (310) 111-2233"), "573101112233");
    assert.equal(normalizarTelefono("  "), null);
    assert.equal(normalizarCorreo("  Ana@X.Test "), "ana@x.test");
  });
  test("validación: nombre, un medio de contacto, formatos y largo de la nota", () => {
    const ok = { nombre: "Ana", telefono: "3101112233", email: "", nota: "" };
    assert.deepEqual(validarContactoSolicitud(ok), { ok: true });
    assert.equal(validarContactoSolicitud({ ...ok, nombre: "A" }).ok, false);
    assert.equal(validarContactoSolicitud({ ...ok, telefono: "", email: "" }).ok, false);
    assert.equal(validarContactoSolicitud({ ...ok, telefono: "123" }).ok, false);
    assert.equal(validarContactoSolicitud({ ...ok, telefono: "", email: "no-es-correo" }).ok, false);
    assert.equal(validarContactoSolicitud({ ...ok, nota: "x".repeat(501) }).ok, false);
    assert.equal(validarContactoSolicitud({ ...ok, telefono: "", email: "a@x.co" }).ok, true);
  });
});

describe("IP de origen confiable", () => {
  const cab = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  test("fuera de Vercel no hay proxy confiable: null (cupo estricto)", () => {
    assert.equal(ipOrigenConfiable(cab({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }), { enVercel: false }), null);
  });
  test("en Vercel solo se usan las cabeceras que fija la plataforma", () => {
    assert.equal(ipOrigenConfiable(cab({ "x-vercel-forwarded-for": "203.0.113.7" }), { enVercel: true }), "203.0.113.7");
    assert.equal(ipOrigenConfiable(cab({ "x-real-ip": "198.51.100.2" }), { enVercel: true }), "198.51.100.2");
  });
  test("un x-forwarded-for escrito por el cliente se IGNORA", () => {
    assert.equal(ipOrigenConfiable(cab({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }), { enVercel: true }), null);
  });
  test("valores inválidos se descartan", () => {
    assert.equal(ipOrigenConfiable(cab({ "x-vercel-forwarded-for": "no-es-ip" }), { enVercel: true }), null);
    assert.equal(ipOrigenConfiable(cab({ "x-vercel-forwarded-for": "999.1.1.1" }), { enVercel: true }), null);
    assert.ok(ipValida("2001:db8::1"));
  });
  test("en una lista toma el primero válido", () => {
    assert.equal(ipOrigenConfiable(cab({ "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1" }), { enVercel: true }), "203.0.113.7");
  });
});

describe("acomodaciones uniformes (origen tarifario)", () => {
  const caps = { sencilla: 1, doble: 2, triple: 3, multiple: 4 };
  test("2 adultos: sencilla×2 y doble×1; la del carrito va primero", () => {
    const r = composicionesUniformes(2, caps, { conMenores: false, composicionActual: { doble: 1 } });
    assert.deepEqual(r.map((c) => c.acomodacionRef), ["doble", "sencilla"]);
    assert.deepEqual(r[1].habitaciones, { sencilla: 2 });
  });
  test("4 adultos: sencilla×4, doble×2 y múltiple×1 (triple no divide)", () => {
    const r = composicionesUniformes(4, caps, { conMenores: false, composicionActual: { multiple: 1 } });
    assert.deepEqual(new Set(r.map((c) => c.acomodacionRef)), new Set(["multiple", "sencilla", "doble"]));
  });
  test("con menores solo se conserva la composición del carrito", () => {
    const r = composicionesUniformes(2, caps, { conMenores: true, composicionActual: { doble: 1 } });
    assert.equal(r.length, 1);
    assert.equal(r[0].acomodacionRef, "doble");
  });
  test("composición mixta del carrito figura como «mixta» y no se pierde", () => {
    const r = composicionesUniformes(3, caps, { conMenores: false, composicionActual: { doble: 1, sencilla: 1 } });
    assert.equal(r[0].acomodacionRef, "mixta");
    assert.deepEqual(r[0].habitaciones, { doble: 1, sencilla: 1 });
    assert.ok(r.some((c) => c.acomodacionRef === "triple"));
  });
  test("referencias inválidas o capacidades absurdas se ignoran", () => {
    const r = composicionesUniformes(2, { "Doble Raro!": 2, doble: 2, cero: 0 }, { conMenores: false, composicionActual: { doble: 1 } });
    assert.deepEqual(r.map((c) => c.acomodacionRef), ["doble"]);
  });
});

describe("vista de opciones", () => {
  const ops = [
    { opcionRef: "A", acomodacionRef: "doble", etiqueta: "Uno", moneda: "COP", tarifaPersona: 700000, total: 1_400_000, orden: 0 },
    { opcionRef: "A", acomodacionRef: "sencilla", etiqueta: "Uno", moneda: "COP", tarifaPersona: 900000, total: 1_900_000, orden: 1 },
    { opcionRef: "B", acomodacionRef: "doble", etiqueta: "Dos", moneda: "COP", tarifaPersona: 650000, total: 1_300_000, orden: 2 },
  ];
  test("agrupa por hotel y ordena las acomodaciones por total", () => {
    const g = agruparPorHotel(ops);
    assert.deepEqual(g.map((x) => x.opcionRef), ["A", "B"]);
    assert.deepEqual(g[0].acomodaciones.map((a) => a.acomodacionRef), ["doble", "sencilla"]);
  });
  test("«desde» es el mínimo real, nunca 0 ni una suma", () => {
    assert.deepEqual(desdeComparativa(ops), { total: 1_300_000, moneda: "COP" });
    assert.equal(desdeComparativa([]), null);
    assert.equal(desdeComparativa([{ total: 0, moneda: "COP" }, { total: Number.NaN, moneda: "COP" }]), null);
  });
  test("esMadre reconoce modo y tipo", () => {
    assert.ok(esMadre({ modo: "comparativa", tipo: "x" }));
    assert.ok(esMadre({ modo: "simple", tipo: "comparativa_manual" }));
    assert.ok(!esMadre({ modo: "simple", tipo: "manual" }));
    assert.ok(esTipoMadre("comparativa_carrito"));
  });
});
