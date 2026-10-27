import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  descripcionContratoManual, descripcionCotizacionManual, leerManualesEntrada, reemplazarManual,
  validarCostoManual, validarServicioManual, MAX_MANUALES, lineaB2BManual, primerGrupoPendiente, verificarManualesCotizados, tramosVueloManual,
} from "../lib/cart/servicioManual.ts";
import { construirPlanB2B } from "../lib/cotizacion/asistidaB2B.ts";
import { preverCotizacion, resumirMonedas } from "../lib/cart/monedaCarrito.ts";
import { normalizarVinculos, quitarConVinculos } from "../lib/cart/vinculoServicios.ts";

// #64 — servicio manual del carrito: validación, edición aislada y sumas por moneda.

const vuelo = { clase: "vuelo", tramo: "ida_regreso", hotelRef: "h1", nombre: "Tiquete aéreo ida y regreso", origen: "BOG", destino: "CTG", fechaIda: "2026-12-10", fechaRegreso: "2026-12-14", pax: 2, precio: 1800000, moneda: "COP", impuestoNoComisionable: 200000 };

describe("validarServicioManual", () => {
  test("acepta un vuelo completo y normaliza espacios", () => {
    const r = validarServicioManual({ ...vuelo, nombre: "  Tiquete   aéreo " });
    assert.ok(r.ok);
    if (r.ok) { assert.equal(r.valor.nombre, "Tiquete aéreo"); assert.equal(r.valor.precio, 1800000); }
  });
  test("un vuelo exige origen, destino y fecha de ida; 'otro' no", () => {
    for (const falta of ["origen", "destino", "fechaIda"]) {
      assert.equal(validarServicioManual({ ...vuelo, [falta]: "" }).ok, false, falta);
    }
    const otro = validarServicioManual({ clase: "otro", nombre: "Traslado privado", pax: 2, precio: 90000, moneda: "COP", impuestoNoComisionable: 0 });
    assert.ok(otro.ok);
    if (otro.ok) assert.equal(otro.valor.origen, null);
  });
  test("rechaza precio 0, negativo, NaN, texto o COP con decimales", () => {
    for (const precio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1000", 1000.5]) {
      assert.equal(validarServicioManual({ ...vuelo, precio }).ok, false, String(precio));
    }
  });
  test("USD admite 2 decimales, no 3", () => {
    assert.ok(validarServicioManual({ ...vuelo, moneda: "USD", precio: 199.99, impuestoNoComisionable: 0 }).ok);
    assert.equal(validarServicioManual({ ...vuelo, moneda: "USD", precio: 199.999, impuestoNoComisionable: 0 }).ok, false);
  });
  test("rechaza pax fuera de 1..99 o no entero", () => {
    for (const pax of [0, 100, 1.5, "2"]) assert.equal(validarServicioManual({ ...vuelo, pax }).ok, false, String(pax));
  });
  test("rechaza fechas inválidas o regreso anterior a la ida", () => {
    assert.equal(validarServicioManual({ ...vuelo, fechaIda: "2026-02-31" }).ok, false);
    assert.equal(validarServicioManual({ ...vuelo, fechaRegreso: "2026-12-01" }).ok, false);
    assert.equal(validarServicioManual({ ...vuelo, fechaRegreso: "10/12/2026" }).ok, false);
  });
  test("NUNCA convierte ni excluye: otra moneda que la de la cotización se rechaza", () => {
    const r = validarServicioManual({ ...vuelo, moneda: "USD" }, "COP");
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /COP/);
    assert.ok(validarServicioManual(vuelo, "COP").ok);
  });
  test("rechaza clase o moneda desconocidas y entradas que no son objeto", () => {
    assert.equal(validarServicioManual({ ...vuelo, clase: "sistema" }).ok, false);
    assert.equal(validarServicioManual({ ...vuelo, moneda: "EUR" }).ok, false);
    assert.equal(validarServicioManual(null).ok, false);
    assert.equal(validarServicioManual([vuelo]).ok, false);
  });
});

describe("leerManualesEntrada", () => {
  test("ausente = ninguno; no-arreglo y exceso se rechazan; cada uno se valida", () => {
    assert.deepEqual(leerManualesEntrada({}), { ok: true, manuales: [] });
    assert.equal(leerManualesEntrada({ manuales: "x" }).ok, false);
    assert.equal(leerManualesEntrada({ manuales: Array(MAX_MANUALES + 1).fill(vuelo) }).ok, false);
    const mala = leerManualesEntrada({ manuales: [vuelo, { ...vuelo, precio: 0 }] });
    assert.equal(mala.ok, false);
    assert.match(mala.ok ? "" : mala.error, /Servicio manual 2/);
  });
});

describe("la cotización no finge proveedor, costo ni reserva", () => {
  const m = (validarServicioManual(vuelo) as { valor: Parameters<typeof descripcionCotizacionManual>[0] }).valor;
  test("la línea de cotización dice 'sujeto a confirmación' y no menciona proveedor ni record", () => {
    const d = descripcionCotizacionManual(m);
    assert.match(d, /sujeto a confirmación/);
    assert.match(d, /BOG → CTG/);
    assert.doesNotMatch(d, /proveedor|record|PNR|confirmado|reservad/i);
  });
  test("la línea de contrato conserva el detalle sin la salvedad", () => {
    assert.doesNotMatch(descripcionContratoManual(m), /sujeto a confirmación/);
    assert.match(descripcionContratoManual(m), /BOG → CTG/);
  });
});

describe("validarCostoManual (se exige al convertir)", () => {
  test("exige proveedor y costo positivo en la moneda del servicio", () => {
    assert.ok(validarCostoManual({ costo: 1500000, proveedor: "Proveedor X" }, "COP").ok);
    assert.equal(validarCostoManual({ costo: 0, proveedor: "Proveedor X" }, "COP").ok, false);
    assert.equal(validarCostoManual({ costo: 1500000, proveedor: " " }, "COP").ok, false);
    assert.equal(validarCostoManual({ costo: 100.5, proveedor: "Proveedor X" }, "COP").ok, false);
    assert.ok(validarCostoManual({ costo: 100.5, proveedor: "Proveedor X" }, "USD").ok);
    assert.equal(validarCostoManual(undefined, "COP").ok, false);
  });
});

describe("agregar, editar y quitar no alteran los demás componentes", () => {
  const hotel = { id: "h1", tipo: "hotel", precio: 2400000, moneda: "COP", hotelNombre: "Hotel A" };
  const addon = { id: "t1", tipo: "tour", precio: 300000, moneda: "COP", nombre: "Tour", hotelItemId: "h1" };
  const manual = { id: "m1", tipo: "manual", precio: 1800000, moneda: "COP", nombre: "Vuelo", pax: 2 };
  const base = [hotel, addon];

  test("agregar suma solo su importe; hotel y add-on quedan idénticos (misma referencia)", () => {
    const con = [...base, manual];
    assert.equal(con[0], hotel);
    assert.equal(con[1], addon);
    assert.equal(resumirMonedas(base).unica?.monto, 2700000);
    assert.equal(resumirMonedas(con).unica?.monto, 4500000);
  });
  test("editar reemplaza solo el manual", () => {
    const antes = [hotel, addon, manual];
    const despues = reemplazarManual(antes, "m1", { precio: 2000000, pax: 3 });
    assert.equal(despues[0], hotel);
    assert.equal(despues[1], addon);
    assert.equal(despues[2].precio, 2000000);
    assert.equal(despues[2].tipo, "manual");
    assert.equal(despues[2].id, "m1");
    assert.equal(resumirMonedas(despues).unica?.monto, 4700000);
  });
  test("editar no puede cambiar el tipo ni el id, ni tocar un ítem que no es manual", () => {
    const r = reemplazarManual([hotel, manual], "m1", { tipo: "hotel", id: "otro" });
    assert.equal(r[1].tipo, "manual");
    assert.equal(r[1].id, "m1");
    const sinCambio = reemplazarManual([hotel, manual], "h1", { precio: 1 });
    assert.equal(sinCambio[0], hotel);
  });
  test("quitar el manual deja hotel y add-on vinculado; quitar el hotel se lleva al add-on pero no al manual", () => {
    const todo = [hotel, addon, manual];
    const sinManual = quitarConVinculos(todo as never, "m1");
    assert.deepEqual(sinManual.map((i) => i.id), ["h1", "t1"]);
    const sinHotel = quitarConVinculos(todo as never, "h1");
    assert.deepEqual(sinHotel.map((i) => i.id), ["m1"]);
  });
  test("hidratar un carrito guardado conserva el manual independiente", () => {
    assert.deepEqual(normalizarVinculos([hotel, addon, manual] as never).map((i) => i.id), ["h1", "t1", "m1"]);
  });
  test("la previsión de moneda cuenta el manual como servicio sin vincular", () => {
    const p = preverCotizacion([hotel, addon, manual]);
    assert.equal(p.moneda, "COP");
    assert.equal(p.montoIncluido, 4500000);
    assert.equal(p.excluidos.length, 0);
  });
});

describe("#64 impuesto no comisionable del manual (0 ≤ impuesto ≤ PVP, obligatorio)", () => {
  test("acepta 0, un valor intermedio y el PVP completo", () => {
    for (const impuestoNoComisionable of [0, 200000, 1800000]) assert.ok(validarServicioManual({ ...vuelo, impuestoNoComisionable }).ok, String(impuestoNoComisionable));
  });
  test("rechaza ausente, negativo, mayor que el PVP, NaN, texto y COP con decimales", () => {
    const { impuestoNoComisionable: _omitido, ...sinCampo } = vuelo;
    assert.equal(validarServicioManual(sinCampo).ok, false, "ausente");
    for (const impuestoNoComisionable of [-1, 1800001, Number.NaN, Number.POSITIVE_INFINITY, "100", null, 10.5]) {
      assert.equal(validarServicioManual({ ...vuelo, impuestoNoComisionable }).ok, false, String(impuestoNoComisionable));
    }
  });
  test("USD admite 2 decimales y respeta el tope del PVP", () => {
    assert.ok(validarServicioManual({ ...vuelo, moneda: "USD", precio: 500, impuestoNoComisionable: 49.99 }).ok);
    assert.equal(validarServicioManual({ ...vuelo, moneda: "USD", precio: 500, impuestoNoComisionable: 500.01 }).ok, false);
  });
  test("la línea B2B reutiliza el modelo de #102: comisión sobre PVP − impuesto, en PVP y NETO", () => {
    const m = (validarServicioManual(vuelo) as { valor: Parameters<typeof lineaB2BManual>[0] }).valor;
    assert.deepEqual(lineaB2BManual(m, 0), { clave: "manual-0", pvp: 1800000, impuesto: 200000 });
    const actor = { id: "u", email: null, rol: "venta" as const };
    for (const modo of ["comisionable", "neta"] as const) {
      const r = construirPlanB2B({ aliado: { id: 1, nombre: "A", tipo: "agencia", pctAliado: 0.1 }, pct: 0.1, pctOrigen: "aliado", modo, moneda: "COP", lineas: [lineaB2BManual(m, 0)], actor, congeladoEn: "2030-01-01T00:00:00Z" });
      assert.ok(r.ok);
      if (!r.ok) continue;
      assert.deepEqual({ base: r.plan.base, comision: r.plan.comision, total: r.plan.total_exigible }, { base: 1600000, comision: 160000, total: modo === "neta" ? 1640000 : 1800000 }, modo);
    }
  });
});

describe("#64 lo cotizado manda: verificarManualesCotizados", () => {
  const m = (validarServicioManual(vuelo) as { valor: Parameters<typeof lineaB2BManual>[0] }).valor;
  const item = { descripcion: descripcionCotizacionManual(m), valor_total: m.precio };
  const bueno = { payload: { manuales: [m] } as unknown, detalleItems: [item] as unknown, detalleVuelos: tramosVueloManual(m, true) as unknown, plan: null, moneda: "COP" };
  test("coincidente: devuelve los manuales validados", () => {
    const r = verificarManualesCotizados(bueno);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.manuales, [m]);
  });
  test("sin manuales declarados en ningún lado: lista vacía", () => {
    assert.deepEqual(verificarManualesCotizados({ payload: { items: [] }, detalleItems: [{ descripcion: "Hotel", valor_total: 1 }], plan: null, moneda: "COP" }), { ok: true, manuales: [] });
  });
  test("bloque AUSENTE o MALFORMADO con manuales declarados en el documento: se rechaza, nunca []", () => {
    for (const payload of [{}, { manuales: null }, { manuales: "x" }, { manuales: {} }, { manuales: [] }, { manuales: [{ ...m, precio: -1 }] }, { manuales: ["x"] }]) {
      const r = verificarManualesCotizados({ ...bueno, payload });
      assert.equal(r.ok, false, JSON.stringify(payload));
    }
  });
  test("clave presente pero el documento no lo respalda: se rechaza", () => {
    assert.equal(verificarManualesCotizados({ ...bueno, detalleItems: [] }).ok, false);
  });
  test("lo convertido debe coincidir con lo cotizado: precio, ruta o cantidad distintos se rechazan", () => {
    assert.equal(verificarManualesCotizados({ ...bueno, payload: { manuales: [{ ...m, precio: 1000000, impuestoNoComisionable: 0 }] } }).ok, false, "precio");
    assert.equal(verificarManualesCotizados({ ...bueno, payload: { manuales: [{ ...m, destino: "SMR" }] } }).ok, false, "ruta");
    assert.equal(verificarManualesCotizados({ ...bueno, payload: { manuales: [m, m] } }).ok, false, "cantidad");
  });
  test("moneda distinta a la de la cotización: se rechaza", () => {
    assert.equal(verificarManualesCotizados({ ...bueno, moneda: "USD" }).ok, false);
  });
  test("B2B: las líneas manual-N del plan deben ser tantas como los manuales", () => {
    const actor = { id: "u", email: null, rol: "venta" as const };
    const plan = (lineas: ReturnType<typeof lineaB2BManual>[]) => { const r = construirPlanB2B({ aliado: { id: 1, nombre: "A", tipo: "agencia", pctAliado: 0.1 }, pct: 0.1, pctOrigen: "aliado", modo: "neta", moneda: "COP", lineas, actor, congeladoEn: "2030-01-01T00:00:00Z" }); assert.ok(r.ok); return r.ok ? r.plan : null; };
    assert.ok(verificarManualesCotizados({ ...bueno, plan: plan([lineaB2BManual(m, 0)]) }).ok);
    assert.equal(verificarManualesCotizados({ ...bueno, plan: plan([lineaB2BManual(m, 0), lineaB2BManual(m, 1)]) }).ok, false);
    assert.equal(verificarManualesCotizados({ payload: {}, detalleItems: [], plan: plan([lineaB2BManual(m, 0)]), moneda: "COP" }).ok, false, "el plan declara un manual que el payload no trae");
  });
});

describe("#64 reintento parcial: ¿hay que pedir costos manuales?", () => {
  test("el primer grupo pendiente los exige; el ya convertido no", () => {
    assert.equal(primerGrupoPendiente({}, "CARTAGENA"), true);
    assert.equal(primerGrupoPendiente({ "SANTA MARTA": "00-1" }, "CARTAGENA"), true);
    assert.equal(primerGrupoPendiente({ CARTAGENA: "00-1" }, "CARTAGENA"), false);
    assert.equal(primerGrupoPendiente({ __sin_destino__: "00-1" }, null), false);
    assert.equal(primerGrupoPendiente(undefined, null), true);
  });
});
