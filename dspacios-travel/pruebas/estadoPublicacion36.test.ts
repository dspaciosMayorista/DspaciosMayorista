// #36 — Estado de publicación del listado: Activo ≠ publicado. Cada caso parte del estado autoritativo (tarifario_estado y compañía) y de la oferta real descubierta.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { estadoPublicacionPaquete, type EntradaPublicacion } from "../lib/paquetes/estadoPublicacion.ts";

const base: EntradaPublicacion = { activo: true, estado: "listo", error: null, diagnostico: null, generacionPublicada: 3, snapshotPublicable: true, combinaciones: 0, hotelesUnidad: 0, hotelesSolicitud: 0 };
const r = (p: Partial<EntradaPublicacion>) => estadoPublicacionPaquete({ ...base, ...p });

describe("#36 estado de publicación", () => {
  test("listo con combinaciones: «Tarifas publicadas» con su conteo; Activo no cambia nada", () => {
    const x = r({ combinaciones: 12 });
    assert.deepEqual([x.clave, x.etiqueta, x.tono, x.secundarias], ["publicado", "Tarifas publicadas", "ok", []]);
    assert.match(x.detalle!, /^12 combinaciones publicadas\.$/);
    assert.equal(r({ combinaciones: 1 }).detalle, "1 combinación publicada.");
  });
  test("ACTIVO sin generar nunca se rotula publicado: pendiente y sin publicación previa = «Pendiente de generar»", () => {
    const x = r({ estado: "pendiente", generacionPublicada: null });
    assert.deepEqual([x.clave, x.etiqueta, x.tono], ["pendiente", "Pendiente de generar", "aviso"]);
  });
  test("pendiente con una publicación anterior = «Desactualizado» y dice cuántas combinaciones quedan de la generación previa", () => {
    const x = r({ estado: "pendiente", combinaciones: 8 });
    assert.deepEqual([x.clave, x.etiqueta], ["desactualizado", "Desactualizado"]);
    assert.match(x.detalle!, /8 combinaciones publicadas de la generación anterior/);
  });
  test("un estado desconocido o vacío nunca se afirma publicado", () => {
    for (const estado of ["", null, undefined, "otro"]) assert.notEqual(r({ estado, combinaciones: 5 }).clave, "publicado");
  });
  test("fallido = «Error de generación» con el error saneado y la última publicación conservada", () => {
    const x = r({ estado: "fallido", error: "No se pudo generar: falta tarifa.", combinaciones: 4 });
    assert.deepEqual([x.clave, x.etiqueta, x.tono], ["error", "Error de generación", "error"]);
    assert.match(x.detalle!, /falta tarifa/); assert.match(x.detalle!, /Se conserva la última publicación \(4 combinaciones\)/);
    assert.match(r({ estado: "fallido", error: null }).detalle!, /No se pudo generar el tarifario/);
  });
  test("recalculando = «Generando tarifario»", () => {
    assert.deepEqual([r({ estado: "recalculando" }).clave, r({ estado: "recalculando" }).etiqueta], ["generando", "Generando tarifario"]);
  });
  test("listo sin filas por persona pero con hotel por UNIDAD ofrecido = «Cotización por unidad» (no «Sin publicar»)", () => {
    const x = r({ hotelesUnidad: 2 });
    assert.deepEqual([x.clave, x.etiqueta, x.tono], ["cotizacion_unidad", "Cotización por unidad", "ok"]);
  });
  test("listo sin filas pero bajo solicitud = «Bajo solicitud»; unidad + solicitud: principal unidad y secundaria solicitud", () => {
    assert.equal(r({ hotelesSolicitud: 1 }).etiqueta, "Bajo solicitud");
    const x = r({ hotelesUnidad: 1, hotelesSolicitud: 1 });
    assert.deepEqual([x.etiqueta, x.secundarias], ["Cotización por unidad", ["Bajo solicitud"]]);
  });
  test("tarifas por persona + unidad: principal «Tarifas publicadas», secundaria «Cotización por unidad»", () => {
    const x = r({ combinaciones: 6, hotelesUnidad: 1 });
    assert.deepEqual([x.etiqueta, x.secundarias], ["Tarifas publicadas", ["Cotización por unidad"]]);
  });
  test("pendiente + unidad ofrecida: el principal sigue siendo pendiente (la generación no está hecha) y la unidad aparece como secundaria", () => {
    const x = r({ estado: "pendiente", generacionPublicada: null, hotelesUnidad: 1 });
    assert.deepEqual([x.etiqueta, x.secundarias], ["Pendiente de generar", ["Cotización por unidad"]]);
  });
  test("listo sin nada vendible = «Publicado sin oferta vendible» con el diagnóstico; con avisos = «Tarifas publicadas con avisos»", () => {
    const sin = r({ diagnostico: "Sin oferta vendible: falta vigencia en 2 salidas." });
    assert.deepEqual([sin.clave, sin.etiqueta, sin.tono], ["sin_oferta", "Publicado sin oferta vendible", "aviso"]);
    assert.match(sin.detalle!, /Sin oferta vendible: falta vigencia/);
    const av = r({ combinaciones: 3, diagnostico: "Opcional X oculto por falta de vigencia." });
    assert.deepEqual([av.clave, av.etiqueta, av.tono], ["publicado_avisos", "Tarifas publicadas con avisos", "aviso"]);
  });
  test("inactivo o bloqueado: la vista publicable cuenta 0, así que 'listo' sin combinaciones es «Publicado, no visible» (no «sin oferta» ni «Sin publicar»)", () => {
    const ina = r({ activo: false, combinaciones: 0 });
    assert.deepEqual([ina.clave, ina.etiqueta, ina.tono], ["publicado_oculto", "Publicado, no visible", "aviso"]);
    assert.match(ina.detalle!, /inactivo/);
    const blo = r({ snapshotPublicable: false, combinaciones: 0 });
    assert.deepEqual([blo.clave, blo.detalle], ["publicado_oculto", "Las tarifas están ocultas hasta que se regenere el tarifario."]);
    assert.equal(r({ activo: false, estado: "pendiente", generacionPublicada: null }).clave, "pendiente");
    assert.match(r({ activo: false, estado: "pendiente", generacionPublicada: null }).detalle!, /inactivo/);
    assert.equal(r({ activo: false, estado: "fallido", error: "x" }).clave, "error");
  });
  test("B3-1: si la verificación de unidad/solicitud FALLÓ, listo sin filas NO afirma «sin oferta vendible»: dice «Oferta sin verificar»", () => {
    const x = r({ unidadVerificada: false, solicitudVerificada: true });
    assert.deepEqual([x.clave, x.etiqueta, x.tono], ["oferta_sin_verificar", "Oferta sin verificar", "aviso"]);
    assert.match(x.detalle!, /la cotización por unidad/); assert.match(x.detalle!, /no se puede afirmar/);
    assert.match(r({ unidadVerificada: true, solicitudVerificada: false }).detalle!, /bajo solicitud/);
    assert.match(r({ unidadVerificada: false, solicitudVerificada: false }).detalle!, /ni la de bajo solicitud/);
    assert.equal(r({ unidadVerificada: true, solicitudVerificada: true }).clave, "sin_oferta", "con ambas verificaciones OK sí es «sin oferta vendible»");
    assert.equal(r({}).clave, "sin_oferta", "por omisión se asume verificado (compatibilidad)");
  });
  test("B3-1: la evidencia conocida se conserva y lo desconocido se dice como secundaria", () => {
    const u = r({ hotelesUnidad: 1, solicitudVerificada: false });
    assert.deepEqual([u.etiqueta, u.secundarias], ["Cotización por unidad", ["Solicitud sin verificar"]]);
    const s = r({ hotelesSolicitud: 1, unidadVerificada: false });
    assert.deepEqual([s.etiqueta, s.secundarias], ["Bajo solicitud", ["Unidad sin verificar"]]);
    const p = r({ combinaciones: 4, unidadVerificada: false, solicitudVerificada: false });
    assert.deepEqual([p.etiqueta, p.secundarias], ["Tarifas publicadas", ["Unidad sin verificar", "Solicitud sin verificar"]]);
    const pend = r({ estado: "pendiente", generacionPublicada: null, unidadVerificada: false });
    assert.deepEqual([pend.etiqueta, pend.secundarias], ["Pendiente de generar", ["Unidad sin verificar"]]);
  });
  test("B3-1: un paquete inactivo no puede tener oferta por unidad/solicitud: la verificación fallida no cambia su estado", () => {
    const x = r({ activo: false, unidadVerificada: false, solicitudVerificada: false });
    assert.deepEqual([x.clave, x.secundarias], ["publicado_oculto", []]);
  });
  test("entradas defectuosas no rompen: combinaciones NaN/negativas cuentan 0", () => {
    assert.equal(r({ combinaciones: Number.NaN }).clave, "sin_oferta");
    assert.equal(r({ combinaciones: -3, estado: "pendiente", generacionPublicada: null }).clave, "pendiente");
  });
});
