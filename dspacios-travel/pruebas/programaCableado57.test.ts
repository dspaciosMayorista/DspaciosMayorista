// #57 — Guardas de cableado (texto del código): lo que NO puede volver a pasar
// aunque la lógica de precio esté bien probada por ejecución en
// programaPrecioParidad57.test.ts y programaReservaPrecio57.react.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const sinComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACCIONES = "app/(dashboard)/dashboard/reservar/actions.ts";
const FORM = "app/(dashboard)/dashboard/reservar/programa/[id]/ProgramaReservaForm.tsx";
const MODULO = "lib/programas/precioReserva57.ts";

function cuerpoReservarProgramaInterno(): string {
  const src = leer(ACCIONES);
  const ini = src.indexOf("async function reservarProgramaInterno");
  assert.notEqual(ini, -1, "no se encontró reservarProgramaInterno");
  return src.slice(ini);
}

test("reservarProgramaInterno ya no calcula el PVP por su cuenta: usa la regla única", () => {
  const fn = sinComentarios(cuerpoReservarProgramaInterno());
  assert.doesNotMatch(fn, /pvpPrograma\s*\(/, "volvió a llamar pvpPrograma suelto (sin regla 161 y con días distintos a la ficha)");
  assert.doesNotMatch(fn, /diasPvp/, "volvió el cálculo local de días de asistencia");
  assert.match(fn, /liquidarSeleccion\(\{/);
  assert.match(sinComentarios(leer(ACCIONES)), /from "@\/lib\/programas\/precioReserva57"/);
});

test("la consulta trae las columnas que decide la regla 161 (programa y salida)", () => {
  const fn = cuerpoReservarProgramaInterno();
  for (const col of [
    "regla_comisionable,", "regla_comisionable_modalidad_mk", "regla_comisionable_modo", "regla_comisionable_valor",
    "regla_comisionable_pct_comision", "regla_comisionable_impuesto_por_acomodacion",
    "tarifa_sencilla", "tarifa_doble", "tarifa_triple", "tarifa_multiple",
    "impuesto_sencilla", "impuesto_doble", "impuesto_triple", "impuesto_multiple",
  ]) assert.ok(fn.includes(col), `falta '${col}' en la consulta de reservarProgramaInterno`);
});

test("la confirmación del precio ocurre ANTES del número de contrato y de cualquier escritura", () => {
  const fn = cuerpoReservarProgramaInterno();
  const confirmar = fn.indexOf("evaluarPrecioConfirmado(");
  const numerar = fn.indexOf("siguienteNumeroContrato(");
  const insertarVenta = fn.indexOf('.from("ventas")');
  const rpcPasajeros = fn.indexOf("crear_pasajeros_contrato");
  assert.ok(confirmar > 0 && numerar > 0 && insertarVenta > 0, "faltan piezas");
  assert.ok(confirmar < numerar, "la confirmación debe ir antes de consumir el número de contrato");
  assert.ok(confirmar < insertarVenta && confirmar < rpcPasajeros, "la confirmación debe ir antes de escribir");
  assert.match(fn.slice(confirmar, confirmar + 400), /cambioPrecio/, "el rechazo debe devolver el nuevo importe");
});

test("ventas.impuesto solo con el impuesto verificable; nada se infiere de montoNoComisionable", () => {
  const modulo = sinComentarios(leer(MODULO));
  assert.doesNotMatch(modulo, /montoNoComisionable/, "montoNoComisionable no es sinónimo de impuesto en ningún modo");
  assert.doesNotMatch(sinComentarios(cuerpoReservarProgramaInterno()), /montoNoComisionable/);
  const fn = cuerpoReservarProgramaInterno();
  assert.match(fn, /impuestoParaVenta\(liq, input\.tipoAsesor\)/);
  assert.match(fn, /\.\.\.\(impuestoVenta != null \? \{ impuesto: impuestoVenta \} : \{\}\)/, "solo escribe la columna cuando hay fuente");
});

test("el módulo de precio es puro y apto para el cliente: sin Supabase ni alias '@/'", () => {
  const modulo = sinComentarios(leer(MODULO));
  const imports = [...modulo.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["../acomodaciones.ts", "../calc/programaPrecio.ts"].sort());
});

test("el formulario usa la misma aritmética que el servidor y exige aceptación expresa del nuevo importe", () => {
  const form = sinComentarios(leer(FORM));
  assert.match(form, /totalDesdePrecios\(/);
  assert.doesNotMatch(form, /t \+= \(a\.pvp \?\? 0\) \* paxPorHab/, "volvió la suma local del total");
  assert.match(form, /precioConfirmado/);
  // Con un cambio pendiente el submit normal no reenvía el importe viejo…
  assert.match(form, /if \(cambioVigente\) return;/);
  assert.match(form, /disabled=\{pending \|\| !!cambioVigente\}/);
  // …y el nuevo importe solo se envía desde el botón de aceptación.
  const envios = [...form.matchAll(/(?<!function )enviar\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(envios.sort(), ["cambioVigente.nuevo", "total"].sort());
  assert.match(form, /onClick=\{\(\) => enviar\(cambioVigente\.nuevo\)\}/);
  // La aceptación vale solo para la selección en que se produjo.
  assert.match(form, /cambio\.clave === claveSeleccion/);
});

test("el fee bancario no entra al costo atribuible y el control de neto vigente corre antes de confirmar el precio", () => {
  const modulo = sinComentarios(leer(MODULO));
  const ini = modulo.indexOf("export function evaluarCoberturaCosto");
  const fin = modulo.indexOf("export function liquidarSeleccion");
  assert.ok(ini > 0 && fin > ini, "no se encontró evaluarCoberturaCosto");
  const cobertura = modulo.slice(ini, fin);
  assert.doesNotMatch(cobertura, /fee/i, "el fee bancario no es costo");
  // La liquidación (que incluye neto vigente y cobertura) precede a la confirmación del precio.
  const fn = cuerpoReservarProgramaInterno();
  assert.ok(fn.indexOf("liquidarSeleccion({") < fn.indexOf("evaluarPrecioConfirmado("), "la liquidación debe ir antes de la confirmación");
  assert.match(modulo, /codigo: "neto_obsoleto"/);
  assert.match(modulo, /codigo: "precio_bajo_costo"/);
});
