// Se ejecuta por comando directo (sin tocar package.json):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/salidaVinculada63Editor.react.ts
//
// #63 — editor de salidas del paquete Dinámico, componente REAL con las Server Actions sustituidas por dobles:
//   · sin modo COP: no ofrece vincular Empaquetados (avisa cómo habilitarlo) y el formulario manual es el de siempre;
//   · en modo COP: lista MÚLTIPLE de vuelos de Empaquetados sin record (los nuevos = pendientes), se eligen y se agregan a
//     propósito (nada se incorpora solo), se muestran las vinculadas con su aéreo y fee, se marcan "Revisar" las que cambiaron
//     o dejaron de ser elegibles, y se pueden actualizar desde la fuente o desvincular; el formulario manual gana la moneda.
import * as nodeModule from "node:module";
import { botonConTexto, clic, dom, esperar, montar } from "./support/fechaNegocioArnes.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const G = "globalThis.__ed63";
const ACCIONES = `data:text/javascript,${encodeURIComponent(`
  const reg = (n, a) => ${G}.llamadas.push([n, a]);
  export async function crearSalidaDinamica(...a) { reg('crear', a); return { ok: true }; }
  export async function actualizarSalidaDinamica(...a) { reg('actualizar', a); return { ok: true }; }
  export async function eliminarSalidaDinamica(...a) { reg('eliminar', a); return { ok: true }; }
  export async function listarEmpaquetadosParaSalidas63(...a) { reg('listar', a); return ${G}.respListar(a); }
  export async function vincularSalidasEmpaquetados63(...a) { reg('vincular', a); return ${G}.respVincular(a); }
  export async function actualizarSalidaDesdeFuente63(...a) { reg('desdeFuente', a); return { ok: true }; }
  export async function desvincularSalidasEmpaquetados63(...a) { reg('desvincular', a); return { ok: true, procesados: a[1].length }; }
`)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../actions" && (context.parentURL ?? "").endsWith("/SalidasDinamicasEditor.tsx")) return { url: ACCIONES, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type Cand = { id: number; ruta: string | null; aerolinea: string | null; fechaIda: string; fechaRegreso: string; compraInicio: string | null; compraFin: string | null;
  tarifaParaEmpaquetar: number; feeInfante: number; /** 230: moneda de R y F (los fixtures anteriores no la traen: COP). */ moneda?: "COP" | "USD";
  salidaId: number | null; vinculado: boolean; desactualizado: boolean };
const estado = {
  llamadas: [] as [string, unknown[]][],
  respListar: (): unknown => ({ ok: true, candidatos: [], pendientes: 0 }),
  respVincular: (): unknown => ({ ok: true, id: 1 }),
};
(globalThis as unknown as { __ed63: typeof estado }).__ed63 = estado;

const cand = (id: number, o: Partial<Cand> = {}): Cand => ({
  id, ruta: `BOG - CTG - BOG #${id}`, aerolinea: "JetSMART", fechaIda: "2030-01-10", fechaRegreso: "2030-01-13", compraInicio: null, compraFin: null,
  tarifaParaEmpaquetar: 1_130_000, feeInfante: 80_500, salidaId: null, vinculado: false, desactualizado: false, ...o,
});
const salida = (id: number, empaquetado: number | null, o: Record<string, unknown> = {}) => ({
  id, aerolinea: "JetSMART", ruta: `BOG - CTG - BOG #${empaquetado ?? id}`, origen: null, fecha_ida: "2030-01-10", fecha_regreso: "2030-01-13",
  hora_salida_ida: null, hora_llegada_ida: null, hora_salida_reg: null, hora_llegada_reg: null,
  valor_tiquete: empaquetado ? 1_130_000 : 400, aplica_mk: !empaquetado, ta: 0, fee_infante: empaquetado ? 80_500 : 0,
  compra_inicio: null, compra_fin: null, notas: null, empaquetado_id: empaquetado, moneda: "COP", ...o,
});

const { SalidasDinamicasEditor } = await import("../app/(dashboard)/dashboard/paquetes/[id]/SalidasDinamicasEditor.tsx");
const React = await import("react");

let montado: Awaited<ReturnType<typeof montar>> | null = null;
async function render(props: { salidas: ReturnType<typeof salida>[]; modo63: boolean; trm?: number | null; moneda?: string }) {
  montado = await montar(React.createElement(SalidasDinamicasEditor, { paqueteId: 70, salidas: props.salidas, moneda: props.moneda ?? "COP", modo63: props.modo63, trm: props.trm ?? null }));
  await esperar(() => true, 3);
  return montado.contenedor;
}
const texto = (el: Element) => el.textContent ?? "";
const llamadasDe = (n: string) => estado.llamadas.filter(([x]) => x === n);

beforeEach(() => {
  estado.llamadas.length = 0;
  estado.respListar = () => ({ ok: true, candidatos: [], pendientes: 0 });
  estado.respVincular = () => ({ ok: true, id: 1 });
  // #107: ya no se usa confirm() del navegador; si algo lo llama, la prueba debe fallar.
  const prohibido = () => { throw new Error("se llamó a confirm()"); };
  (dom.window as unknown as { confirm: () => boolean }).confirm = prohibido;
  (globalThis as unknown as { confirm: () => boolean }).confirm = prohibido;
});
afterEach(async () => { await montado?.desmontar(); montado = null; });

test("sin el modo de conversión por TRM: no ofrece vincular Empaquetados, avisa cómo habilitarlo y NO consulta ninguna lista", async () => {
  const c = await render({ salidas: [salida(1, null)], modo63: false });
  assert.match(texto(c), /activa el modo con conversión por TRM/i);
  assert.equal(c.querySelector('[data-testid="salidas-vinculadas-63"]'), null);
  assert.equal(llamadasDe("listar").length, 0);
  assert.equal(c.querySelector('select[aria-label="Moneda del tiquete"]'), null, "el formulario manual de siempre no pide moneda");
  assert.match(texto(c), /Salidas manuales/);
});

test("modo COP: la lista múltiple muestra los pendientes; elegir varios y agregar manda TODOS los ids juntos (nada se incorpora solo)", async () => {
  estado.respListar = () => ({ ok: true, candidatos: [cand(5), cand(6), cand(7, { vinculado: true, salidaId: 21 })], pendientes: 2 });
  const c = await render({ salidas: [salida(21, 7)], modo63: true, trm: 4000 });
  await esperar(() => llamadasDe("listar").length > 0);
  await esperar(() => /2 pendientes/.test(texto(c)));
  assert.match(texto(c), /2 pendientes/);
  assert.equal(llamadasDe("vincular").length, 0, "listar NO vincula nada");
  const checks = [...c.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
  assert.equal(checks.length, 3, "Seleccionar todos + una casilla por pendiente (el 7 ya está vinculado)");
  for (const k of checks.slice(1)) await clic(k, "casilla");
  await clic(botonConTexto(c, /Vincular seleccionados \(2\)/), "botón vincular");
  await esperar(() => llamadasDe("vincular").length > 0);
  assert.deepEqual(llamadasDe("vincular")[0][1], [70, [5, 6]]);
});

test("modo COP: muestra la TRM del paquete y las vinculadas con su aéreo (R) y fee (F), no editables a mano", async () => {
  estado.respListar = () => ({ ok: true, candidatos: [cand(7, { vinculado: true, salidaId: 21 })], pendientes: 0 });
  const c = await render({ salidas: [salida(21, 7)], modo63: true, trm: 4000 });
  await esperar(() => llamadasDe("listar").length > 0);
  const fila = c.querySelector('[data-testid="salida-vinculada"]');
  assert.ok(fila, "fila de la salida vinculada");
  assert.match(texto(fila!), /Aéreo/);
  assert.match(texto(fila!), /1\.130\.000/);
  assert.match(texto(fila!), /inf .*80\.500/);
  assert.match(texto(c), /TRM del paquete/);
  assert.equal(fila!.querySelectorAll("input").length, 0, "una vinculada no tiene campos editables");
  assert.equal(c.querySelector('[data-testid="salida-vinculada-revisar"]'), null, "vigente y coincidente: sin alerta");
});

test("paquete en USD: el selector lista los vuelos elegibles SIN IMPORTAR su moneda y avisa cuáles se convierten con la TRM (hallazgo de Preview #395)", async () => {
  estado.respListar = () => ({
    ok: true,
    candidatos: [cand(5, { moneda: "USD", tarifaParaEmpaquetar: 290, feeInfante: 20 }), cand(6, { moneda: "COP" })] as never,
    pendientes: 2,
  });
  const c = await render({ salidas: [], modo63: true, moneda: "USD", trm: 4000 });
  await esperar(() => /2 pendientes/.test(texto(c)));
  assert.ok(c.querySelector('[data-testid="salidas-vinculadas-63"]'), "el selector existe en un paquete publicado en USD");
  assert.match(texto(c), /Aparecen todos los vuelos elegibles sin importar su moneda/);
  assert.match(texto(c), /El paquete se publica en USD/);
  assert.match(texto(c), /COP \/ TRM/);
  assert.match(texto(c), /USD\s*\$\s*290/, "el vuelo en USD se muestra en su moneda");
  assert.match(texto(c), /sin conversión/);
  assert.match(texto(c), /se convierte con la TRM/);
  const checks = [...c.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
  assert.equal(checks.length, 3, "Seleccionar todos + una casilla por cada vuelo, de cualquier moneda");
  for (const k of checks.slice(1)) await clic(k, "casilla");
  await clic(botonConTexto(c, /Vincular seleccionados \(2\)/), "botón vincular");
  await esperar(() => llamadasDe("vincular").length > 0);
  assert.deepEqual(llamadasDe("vincular")[0][1], [70, [5, 6]], "ambos vuelos se vinculan; el cálculo lo decide la configuración del paquete");
});

test("paquete en COP: un vuelo en USD sigue listado y marcado como convertible con la TRM (USD × TRM)", async () => {
  estado.respListar = () => ({ ok: true, candidatos: [cand(5, { moneda: "USD", tarifaParaEmpaquetar: 290, feeInfante: 20 }), cand(6)] as never, pendientes: 2 });
  const c = await render({ salidas: [], modo63: true, moneda: "COP", trm: 4000 });
  await esperar(() => /2 pendientes/.test(texto(c)));
  assert.match(texto(c), /El paquete se publica en COP/);
  assert.match(texto(c), /USD × TRM/);
});

test("una vinculada cuya fuente cambió o dejó de ser elegible se marca REVISAR", async () => {
  estado.respListar = () => ({ ok: true, candidatos: [cand(7, { vinculado: true, salidaId: 21, desactualizado: true })], pendientes: 0 });
  const c = await render({ salidas: [salida(21, 7)], modo63: true, trm: 4000 });
  await esperar(() => c.querySelector('[data-testid="salida-vinculada-revisar"]') != null);
  assert.match(texto(c.querySelector('[data-testid="salida-vinculada-revisar"]')!), /Revisar.*con record|cambió/i);
});

test("una vinculada que ya no aparece en la lista (fuente con record u otro destino) también se marca REVISAR", async () => {
  estado.respListar = () => ({ ok: true, candidatos: [], pendientes: 0 });
  const c = await render({ salidas: [salida(21, 7)], modo63: true, trm: 4000 });
  await esperar(() => c.querySelector('[data-testid="salida-vinculada-revisar"]') != null);
  assert.ok(c.querySelector('[data-testid="salida-vinculada-revisar"]'));
});

test("'Actualizar desde la fuente' y 'Desvincular' llaman a las acciones con el id de la salida", async () => {
  estado.respListar = () => ({ ok: true, candidatos: [cand(7, { vinculado: true, salidaId: 21 })], pendientes: 0 });
  const c = await render({ salidas: [salida(21, 7)], modo63: true, trm: 4000 });
  await esperar(() => llamadasDe("listar").length > 0);
  await clic(botonConTexto(c, /Actualizar desde la fuente/), "actualizar");
  await esperar(() => llamadasDe("desdeFuente").length > 0);
  assert.deepEqual(llamadasDe("desdeFuente")[0][1], [21]);
  await clic(botonConTexto(c, "Desvincular"), "desvincular");
  assert.equal(llamadasDe("desvincular").length, 0, "pide confirmación en el diálogo propio antes de actuar");
  const dlg = document.body.querySelector('[role="dialog"]')!;
  assert.ok(dlg, "diálogo propio");
  await clic([...dlg.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Desvincular"), "confirmar");
  await esperar(() => llamadasDe("desvincular").length > 0);
  assert.deepEqual(llamadasDe("desvincular")[0][1], [70, [21]]);
  assert.equal(llamadasDe("eliminar").length, 0);
});

test("un rechazo del servidor al vincular se muestra al usuario (todo o nada: no queda nada a medias)", async () => {
  estado.respListar = () => ({ ok: true, candidatos: [cand(5)], pendientes: 1 });
  estado.respVincular = () => ({ ok: false, error: "No se vinculó ningún vuelo. BOG - CTG: ya tiene record (PNR)." });
  const c = await render({ salidas: [], modo63: true, trm: 4000 });
  await esperar(() => /1 pendiente/.test(texto(c)));
  await clic(c.querySelector('input[type="checkbox"]'), "casilla");
  await clic(botonConTexto(c, /Vincular seleccionados/), "agregar");
  await esperar(() => /ya tiene record/.test(texto(c)));
  assert.match(texto(c), /No se vincul[oó] ning[uú]n vuelo/);
});

test("un error al listar se muestra como error (no como 'no hay vuelos')", async () => {
  estado.respListar = () => ({ ok: false, error: "No se pudo completar la operación por un error técnico. Intenta nuevamente." });
  const c = await render({ salidas: [], modo63: true, trm: 4000 });
  await esperar(() => /error técnico/.test(texto(c)));
  assert.match(texto(c), /error técnico/);
  assert.doesNotMatch(texto(c), /No hay vuelos de Empaquetados sin record pendientes/);
});

test("sin pendientes se dice por qué (no hay nada que agregar) y el botón no hace nada sin selección", async () => {
  estado.respListar = () => ({ ok: true, candidatos: [], pendientes: 0 });
  const c = await render({ salidas: [], modo63: true, trm: 4000 });
  await esperar(() => /No hay vuelos de Empaquetados sin record pendientes/.test(texto(c)));
  const boton = botonConTexto(c, /Vincular seleccionados/) as HTMLButtonElement;
  assert.equal(boton.disabled, true);
});

test("en modo COP el formulario de la salida MANUAL pide la moneda del tiquete (COP o USD)", async () => {
  const c = await render({ salidas: [], modo63: true, trm: 4000 });
  const sel = c.querySelector('select[aria-label="Moneda del tiquete"]') as HTMLSelectElement | null;
  assert.ok(sel, "selector de moneda");
  assert.deepEqual([...sel!.options].map((o) => o.value), ["COP", "USD"]);
  await act(async () => {});
});
