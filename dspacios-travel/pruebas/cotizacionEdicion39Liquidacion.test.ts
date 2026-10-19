// #39 fase 1 — fórmula ÚNICA de la cotización dinámica y reglas de edición (puras).
//
//   · construirCotizacionManual produce la misma cabecera que la plantilla de una
//     opción de comparativa (#35): paridad hija ↔ dinámica común, ahora sin pasar
//     por un INSERT directo (la creación va por la RPC de la 216);
//   · reliquidarServicios / reliquidarRecobroNinos conservan lo que no cambia y
//     dejan el total y el documento coherentes (Σ servicios + recobro + niños);
//   · elegibilidadEdicion aplica C1/C2 en el MISMO orden que la base;
//   · diff, motivo, revisión y mensajes de error.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  construirCotizacionManual, reliquidarServicios, reliquidarRecobroNinos, liquidarServicios, serviciosConContenido,
  servicioDesdeFila, valorServicio, calcularRecobroNinos, totalesYDocumento, nombrePaqueteItem,
  type CotizacionManualInput,
} from "../lib/cotizacion/liquidacionManual.ts";
import {
  elegibilidadEdicion, validarMotivo, validarRevision, diffServicios, hayCambios, mensajeEdicion39, codigoEdicion39,
  entradaHistorialServicios, type CotizacionEditable,
} from "../lib/cotizacion/edicionServiciosManual.ts";
import { construirComparativaManual, type EntradaComparativaManual } from "../lib/cotizacion/comparativa.ts";

const HOY = "2026-10-15";

function base(sobre: Partial<EntradaComparativaManual> = {}): EntradaComparativaManual {
  return {
    cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123456", telefono: "3001112233", email: "a@x.test", nacimiento: "1990-01-01" },
    destino: "Cartagena", fechaIda: "2030-11-10", fechaRegreso: "2030-11-14", pax: 2, ninos: 0, tarifaNino: 0,
    recobro: 0, recobroAliado: 0, moneda: "COP", tipoAsesor: "interno", asesorInterno: "Asesor Uno", agenciaNombre: "",
    freelanceNombre: "", plazo: "Inmediato", vigenciaHasta: "2030-11-05", observaciones: "Obs", incluye: "", noIncluye: "",
    servicios: [
      { tipo: "aereo", plataforma: "Despegar", nombre: "Aéreo BOG-CTG", proveedor: "Avianca", costoNeto: 800000, modo: "mk", pctMarkup: 20, ta: 0 },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel A", proveedor: "Hoteles A", costoNeto: 400000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "A" },
      { tipo: "traslado", plataforma: "Directo", nombre: "Traslados", proveedor: "TransCo", costoNeto: 80000, modo: "mk", pctMarkup: 20, ta: 0 },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel B", proveedor: "Hoteles B", costoNeto: 560000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "B" },
      { tipo: "asistencia", plataforma: "Directo", nombre: "Asistencia", proveedor: "Assist", costoNeto: 50000, modo: "mk", pctMarkup: 25, ta: 0 },
    ],
    ...sobre,
  };
}

function comun(entrada: EntradaComparativaManual, ref: "A" | "B"): CotizacionManualInput {
  const { aliadoId: _a, tenant: _t, ...resto } = entrada;
  void _a; void _t;
  const servicios = entrada.servicios.filter((s) => !s.opcionRef || s.opcionRef === ref).map(({ opcionRef: _o, ...s }) => { void _o; return s; });
  return { ...resto, servicios } as CotizacionManualInput;
}

describe("paridad: la plantilla de cada opción = la cotización dinámica que arma la creación", () => {
  for (const [nombre, sobre] of [
    ["interno sin recobro", {}],
    ["interno con recobro oculto", { recobro: 100000 }],
    ["con niños y recobro", { recobro: 100000, ninos: 2, tarifaNino: 250000 }],
    ["B2B agencia con recobro al aliado", { tipoAsesor: "agencia" as const, agenciaNombre: "Agencia Uno", recobro: 100000, recobroAliado: 60000 }],
    ["B2B freelance", { tipoAsesor: "freelance" as const, freelanceNombre: "Free Uno", recobro: 50000, recobroAliado: 20000 }],
    ["USD", { moneda: "USD" }],
  ] as const) {
    test(nombre, () => {
      const entrada = base(sobre);
      const r = construirComparativaManual(entrada, { hoy: HOY, creadoPorEmail: "asesor@dspacios.test" });
      assert.ok(r.ok, r.ok ? "" : r.error);
      for (const op of r.datos.opciones) {
        const ref = op.opcion_ref as "A" | "B";
        const a = construirCotizacionManual(comun(entrada, ref), { vigencia: "2030-11-05" });
        assert.ok(a.ok, a.ok ? "" : a.error);
        const pl = op.plantilla_hija as Record<string, unknown>;
        assert.equal(op.total, a.cabecera.precio_venta, `${ref}: total`);
        assert.deepEqual(pl.payload, a.cabecera.payload, `${ref}: payload idéntico`);
        assert.deepEqual(pl.detalle, a.cabecera.detalle, `${ref}: detalle idéntico`);
        for (const col of ["cliente", "cliente_documento", "destino", "hotel", "plan_nombre", "pax", "fecha_salida", "fecha_regreso"] as const) {
          assert.deepEqual(pl[col], a.cabecera[col], `${ref}: columna ${col}`);
        }
        assert.equal(op.moneda, a.cabecera.moneda);
        type FilaServicio = { orden: number; tipo_servicio: string; plataforma: string | null; nombre_servicio: string | null; proveedor: string | null;
          costo_neto: number; modo: string; pct_markup: number; ta: number; valor: number };
        const propias: FilaServicio[] = r.datos.servicios.filter((s) => s.opcion_ref === null || s.opcion_ref === ref)
          .map((s, i): FilaServicio => ({ orden: i, tipo_servicio: s.tipo_servicio, plataforma: s.plataforma, nombre_servicio: s.nombre_servicio, proveedor: s.proveedor,
            costo_neto: s.costo_neto, modo: s.modo, pct_markup: s.pct_markup, ta: s.ta, valor: s.valor }));
        assert.deepEqual(propias, a.servicios, `${ref}: filas de servicios`);
      }
    });
  }
});

describe("construirCotizacionManual", () => {
  test("rechaza sin nombre y sin servicios, con los mensajes de siempre", () => {
    const sinNombre = construirCotizacionManual({ ...comun(base(), "A"), cliente: { ...base().cliente, nombres: "", apellidos: "" } }, { vigencia: "2030-11-05" });
    assert.deepEqual(sinNombre, { ok: false, error: "El nombre del cliente es obligatorio." });
    const sinServ = construirCotizacionManual({ ...comun(base(), "A"), servicios: [] }, { vigencia: "2030-11-05" });
    assert.deepEqual(sinServ, { ok: false, error: "Agrega al menos un servicio con su costo." });
  });
  test("Σ servicios + recobro + niños = precio_venta = Σ líneas del documento", () => {
    const a = construirCotizacionManual(comun(base({ recobro: 100000, ninos: 2, tarifaNino: 250000 }), "A"), { vigencia: "2030-11-05" });
    assert.ok(a.ok);
    const suma = a.servicios.reduce((s, f) => s + f.valor, 0);
    assert.equal(a.cabecera.precio_venta, suma + 100000 + 2 * 250000);
    const items = (a.cabecera.detalle as { items: { valor: number }[] }).items;
    assert.equal(items.reduce((s, i) => s + i.valor, 0), a.cabecera.precio_venta);
    assert.equal(a.cabecera.vigencia_hasta, "2030-11-05");
  });
  test("TA solo en aéreo; un hotel con TA cae a markup", () => {
    const filas = liquidarServicios([
      { tipo: "aereo", plataforma: "", nombre: "A", proveedor: "", costoNeto: 100, modo: "ta", pctMarkup: 0, ta: 50 },
      { tipo: "hotel", plataforma: "", nombre: "H", proveedor: "", costoNeto: 80, modo: "ta", pctMarkup: 20, ta: 999 },
    ]);
    assert.equal(filas[0].modo, "ta"); assert.equal(filas[0].valor, 150);
    assert.equal(filas[1].modo, "mk"); assert.equal(filas[1].valor, 100); assert.equal(filas[1].ta, 0);
  });
});

const guardada = (sobre: Partial<CotizacionManualInput> = {}) => ({
  payload: { ...comun(base(), "A"), ...sobre }, pax: 2, destino: "Cartagena", fecha_salida: "2030-11-10", fecha_regreso: "2030-11-14",
});

describe("reliquidarServicios (editar servicios)", () => {
  test("conserva recobro y niños, recalcula total, hotel/aerolínea y líneas", () => {
    const c = guardada({ recobro: 100000, ninos: 1, tarifaNino: 200000 });
    const r = reliquidarServicios(c, [
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel Nuevo", proveedor: "HN", costoNeto: 800000, modo: "mk", pctMarkup: 20, ta: 0 },
    ]);
    assert.ok(r.ok);
    assert.equal(r.servicios.length, 1);
    assert.equal(r.precioVenta, 1_000_000 + 100000 + 200000);
    assert.equal(r.cambios.hotel, "Hotel Nuevo");
    assert.equal(r.cambios.aerolinea, null);
    assert.equal(r.cambios.items.reduce((s, i) => s + i.valor, 0), r.precioVenta);
    assert.equal(r.cambios.items[0].descripcion, nombrePaqueteItem("Cartagena", "2030-11-10", "2030-11-14"));
    assert.equal(r.cambios.payload_servicios.length, 1);
  });
  test("quitar el último servicio se rechaza (y una fila vacía no cuenta)", () => {
    const r = reliquidarServicios(guardada(), [{ tipo: "otro", plataforma: "", nombre: "", proveedor: "", costoNeto: 0, modo: "mk", pctMarkup: 0, ta: 0 }]);
    assert.deepEqual(r, { ok: false, error: "La cotización debe conservar al menos un servicio." });
  });
  test("costo negativo se rechaza", () => {
    const r = reliquidarServicios(guardada(), [{ tipo: "otro", plataforma: "x", nombre: "x", proveedor: "", costoNeto: -1, modo: "mk", pctMarkup: 0, ta: 0 }]);
    assert.equal(r.ok, false);
  });
});

describe("reliquidarRecobroNinos (C5)", () => {
  test("interno: el recobro va 100% a la empresa (el aliado se ignora)", () => {
    const r = reliquidarRecobroNinos(guardada(), 1_000_000, { ninos: 2, tarifaNino: 100000, recobro: 50000, recobroAliado: 30000 });
    assert.equal(r.cambios.recobroAliado, 0);
    assert.equal(r.precioVenta, 1_000_000 + 50000 + 200000);
    assert.equal(r.cambios.items.reduce((s, i) => s + i.valor, 0), r.precioVenta);
  });
  test("B2B: el aliado se acota al recobro; niños se truncan", () => {
    const r = reliquidarRecobroNinos(guardada({ tipoAsesor: "agencia" }), 500_000, { ninos: 1.9, tarifaNino: 10, recobro: 100, recobroAliado: 999 });
    assert.equal(r.cambios.ninos, 1);
    assert.equal(r.cambios.recobroAliado, 100);
  });
  test("mismo cálculo que la creación", () => {
    const rec = calcularRecobroNinos({ pax: 2, ninos: 2, tarifaNino: 5, recobro: 7, recobroAliado: 0, tipoAsesor: "interno" });
    const t = totalesYDocumento({ totalServicios: 100, pax: 2, destino: "X", fechaIda: null, fechaRegreso: null, rec });
    assert.equal(t.precioVenta, reliquidarRecobroNinos(guardada(), 100, { ninos: 2, tarifaNino: 5, recobro: 7, recobroAliado: 0 }).precioVenta);
  });
});

describe("servicioDesdeFila ↔ liquidarServicios (ida y vuelta)", () => {
  test("una fila guardada vuelve al formulario y se re-liquida al mismo valor", () => {
    const filas = liquidarServicios(serviciosConContenido(comun(base(), "B").servicios));
    const vuelta = liquidarServicios(filas.map(servicioDesdeFila));
    assert.deepEqual(vuelta, filas);
  });
  test("valorServicio: margen y TA", () => {
    assert.equal(valorServicio(800000, "mk", 20, 0), 1_000_000);
    assert.equal(valorServicio(100, "ta", 0, 25), 125);
    assert.equal(valorServicio(100, "mk", 100, 0), 0);
  });
});

// ── Elegibilidad (C1/C2) ────────────────────────────────────────────────────
const cotOk: CotizacionEditable = {
  tipo: "manual", modo: "simple", estado: "abierta", numero_contrato: null, cotizacion_origen_id: null,
  condicion_pago_congelada_en: null, vigencia_hasta: "2026-10-20", creado_por_id: "u-venta",
};
const ctxOk = { actor: { id: "u-admin", rol: "administracion", activo: true }, habilitada: true, hoy: "2026-10-18", tienePagos: false };
const motivoDe = (e: ReturnType<typeof elegibilidadEdicion>) => (e.ok ? "ok" : e.codigo);

describe("elegibilidadEdicion (mismo orden que p39_priv.bloquear_para_editar)", () => {
  const casos: [string, Partial<CotizacionEditable>, Partial<typeof ctxOk>, string][] = [
    ["elegible", {}, {}, "ok"],
    ["actor inactivo", {}, { actor: { id: "u", rol: "administracion", activo: false } }, "NO_AUTORIZADO"],
    ["rol externo", {}, { actor: { id: "u", rol: "agencia", activo: true } }, "NO_AUTORIZADO"],
    ["edición no habilitada (sin 217 o suspendida)", {}, { habilitada: false }, "SUSPENDIDA"],
    ["madre comparativa", { tipo: "comparativa_manual", modo: "comparativa" }, {}, "NO_ELEGIBLE"],
    ["hija de la 211", { cotizacion_origen_id: 7 }, {}, "NO_ELEGIBLE"],
    ["carrito", { tipo: "carrito" }, {}, "NO_ELEGIBLE"],
    ["convertida", { estado: "convertida", numero_contrato: "DTM-0001" }, {}, "NO_ELEGIBLE"],
    ["descartada", { estado: "descartada" }, {}, "NO_ELEGIBLE"],
    ["congelada", { condicion_pago_congelada_en: "2026-10-17T10:00:00Z" }, {}, "CONGELADA"],
    ["con pago (aunque anulado)", {}, { tienePagos: true }, "CON_PAGOS"],
    ["vencida", { vigencia_hasta: "2026-10-17" }, {}, "VENCIDA"],
    ["vence hoy (inclusive)", { vigencia_hasta: "2026-10-18" }, {}, "ok"],
    ["sin vigencia", { vigencia_hasta: null }, {}, "VENCIDA"],
    ["venta, propia", {}, { actor: { id: "u-venta", rol: "venta", activo: true } }, "ok"],
    ["venta, ajena (V2)", {}, { actor: { id: "otra", rol: "venta", activo: true } }, "AUTOR"],
    ["venta, antigua sin autor (V4)", { creado_por_id: null }, { actor: { id: "u-venta", rol: "venta", activo: true } }, "AUTOR"],
    ["gerencia, antigua sin autor", { creado_por_id: null }, { actor: { id: "g", rol: "gerencia", activo: true } }, "ok"],
    ["congelada Y vencida: manda congelada", { condicion_pago_congelada_en: "x", vigencia_hasta: "2000-01-01" }, {}, "CONGELADA"],
  ];
  for (const [nombre, c, ctx, esperado] of casos) {
    test(nombre, () => assert.equal(motivoDe(elegibilidadEdicion({ ...cotOk, ...c }, { ...ctxOk, ...ctx })), esperado));
  }
});

describe("motivo, revisión y mensajes", () => {
  test("motivo obligatorio, recortado, máximo 500", () => {
    assert.equal(validarMotivo("   ").ok, false);
    assert.equal(validarMotivo(undefined).ok, false);
    assert.deepEqual(validarMotivo("  cambio  "), { ok: true, motivo: "cambio" });
    assert.equal(validarMotivo("x".repeat(501)).ok, false);
  });
  test("revisión: entero positivo", () => {
    assert.equal(validarRevision(3), 3);
    for (const v of [0, -1, 1.5, "a", null, undefined]) assert.equal(validarRevision(v), null);
  });
  test("errores propios se traducen; los crudos se enmascaran", () => {
    assert.equal(codigoEdicion39("EDICION_39_REVISION: la cotización cambió…"), "REVISION");
    assert.match(mensajeEdicion39("EDICION_39_AUTOR: solo puedes…"), /creaste/);
    assert.match(mensajeEdicion39("PAGO_39_COMPOSICION: las condiciones enviadas no corresponden"), /^las condiciones enviadas/);
    assert.match(mensajeEdicion39("FRONTERA_39: los datos económicos…"), /operación autorizada/);
    assert.equal(mensajeEdicion39('duplicate key value violates unique constraint "x"'), "No se pudo guardar el cambio. Inténtalo de nuevo.");
    assert.equal(mensajeEdicion39(""), "No se pudo guardar el cambio. Inténtalo de nuevo.");
  });
});

describe("diff de servicios e historial", () => {
  const a = liquidarServicios(serviciosConContenido(comun(base(), "A").servicios));
  test("sin cambios", () => {
    const d = diffServicios(a, a);
    assert.equal(hayCambios(d), false);
    assert.equal(d.sinCambios, a.length);
  });
  test("modificar, quitar y agregar", () => {
    const b = a.map((f, i) => (i === 0 ? { ...f, proveedor: "Otro" } : f)).slice(0, -1);
    const d1 = diffServicios(a, b);
    assert.equal(d1.modificados.length, 1); assert.deepEqual(d1.modificados[0].campos, ["proveedor"]);
    assert.equal(d1.quitados.length, 1);
    const d2 = diffServicios(b, a);
    assert.equal(d2.agregados.length, 1);
  });
  test("la entrada del historial tiene la forma que guarda la base", () => {
    const e = entradaHistorialServicios({ precioAntes: 10, precioDespues: 20, serviciosAntes: a, serviciosDespues: a });
    assert.deepEqual(Object.keys(e.antes).sort(), ["precio_venta", "servicios"]);
    assert.deepEqual(Object.keys(e.despues).sort(), ["precio_venta", "servicios"]);
  });
});
