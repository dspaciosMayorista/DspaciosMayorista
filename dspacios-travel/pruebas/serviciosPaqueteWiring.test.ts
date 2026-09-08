import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// Propagación de servicios INCLUIDOS/opcionales (asistencia/tours/otro) desde
// el paquete hasta cotización, contrato y CxP — corrige el defecto donde
// `asistencia_medica`/`tours_traslados` se armaban distinto (o se hardcodeaban
// a false/null) en cada camino de creación, y donde un servicio opcional
// perdía su categoría real al pasar por `tarifario_resultado`/el carrito.
//
// `computo.ts`/`reservar/actions.ts`/`checkout/actions.ts`/
// `contratos/actions.ts` requieren Supabase real — igual que el resto del
// wiring de este proyecto (ver pruebas/cotizarFechasWiring.test.ts,
// pruebas/edadesMenores.test.ts), se verifica por inspección del código
// FUENTE real: que los 5 caminos de escritura usan la MISMA fuente
// compartida (lib/reservar/serviciosPaquete.ts) en vez de reinventar/
// hardcodear la clasificación, y que los puntos de error identificados
// fallan cerrado ANTES de insertar cualquier fila.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

function cuerpoFuncion(fuenteCompleta: string, firmaOAncla: string): string {
  const idx = fuenteCompleta.indexOf(firmaOAncla);
  assert.ok(idx > -1, `no se encontró "${firmaOAncla}" en el archivo`);
  let profundidadParen = 0;
  let profundidadAngulo = 0;
  let idxLlaveInicial = -1;
  for (let i = idx; i < fuenteCompleta.length; i++) {
    const ch = fuenteCompleta[i];
    if (ch === "(") profundidadParen++;
    else if (ch === ")") profundidadParen--;
    else if (ch === "<") profundidadAngulo++;
    else if (ch === ">") profundidadAngulo--;
    else if (ch === "{" && profundidadParen === 0 && profundidadAngulo === 0) { idxLlaveInicial = i; break; }
  }
  assert.ok(idxLlaveInicial > -1, `no se encontró el "{" real del cuerpo tras "${firmaOAncla}"`);
  let profundidad = 0;
  for (let i = idxLlaveInicial; i < fuenteCompleta.length; i++) {
    if (fuenteCompleta[i] === "{") profundidad++;
    else if (fuenteCompleta[i] === "}") {
      profundidad--;
      if (profundidad === 0) return fuenteCompleta.slice(idx, i + 1);
    }
  }
  throw new Error(`no se encontró el cierre del cuerpo de "${firmaOAncla}"`);
}

const computo = leer("lib/reservar/computo.ts");
const reservarActions = leer("app/(dashboard)/dashboard/reservar/actions.ts");
const checkoutActions = leer("app/tarifario/checkout/actions.ts");
const contratosActions = leer("app/(dashboard)/dashboard/contratos/actions.ts");
const cotizar = leer("lib/reservar/cotizar.ts");
const liquidacion = leer("lib/reservar/liquidacionServicio.ts");

describe("computo.ts (computarReserva) — fuente única autoritativa, fail-closed ANTES de cualquier insert", () => {
  test("importa el módulo compartido de clasificación/resumen de servicios (nunca reinventa la clasificación)", () => {
    assert.match(computo, /from ["']@\/lib\/reservar\/serviciosPaquete["']/);
    assert.match(computo, /normalizarCategoriaServicio/);
    assert.match(computo, /costoNetoServicioIncluido/);
  });
  test("ComputoReserva.serviciosItems carga categoria/proveedorId reales del catálogo, no un default fijo en la construcción final", () => {
    const cuerpo = cuerpoFuncion(computo, "export type ComputoReserva = {");
    assert.match(cuerpo, /serviciosItems:[\s\S]*?categoria: CategoriaServicio[\s\S]*?proveedorId: number \| null/);
    assert.match(cuerpo, /serviciosIncluidos: ServicioEfectivo\[\]/);
  });
  test("la consulta de categoría/proveedor de servicios OPCIONALES revisa error y falla cerrado (nunca clasifica 'otro' por un fallo técnico)", () => {
    assert.match(computo, /servicios_adicionales["']\)\s*\n\s*\.select\("id, categoria, proveedor_id"\)/);
    assert.match(computo, /if \(catErr\) return \{ ok: false,/);
  });
  test("la consulta de servicios OPCIONALES en tarifario_resultado también revisa error y falla cerrado", () => {
    assert.match(computo, /if \(srvRowsErr\) return \{ ok: false,/);
  });
  test("servicios INCLUIDOS: consulta armado_servicios con incluido=true, revisa error y falla cerrado", () => {
    assert.match(computo, /\.eq\("paquete_id", input\.paqueteId\)\s*\n\s*\.eq\("incluido", true\)/);
    assert.match(computo, /if \(incErr\) return \{ ok: false,/);
  });
  test("modo 'grupo' incluido SIN rango de pax que cubra la reserva real falla cerrado con un mensaje explícito (nunca se asume $0 en silencio)", () => {
    const cuerpo = cuerpoFuncion(computo, "const serviciosIncluidos: ServicioEfectivo[] = [];");
    assert.match(cuerpo, /if \(modo === "persona"\)/);
    assert.match(cuerpo, /if \(costoNeto == null\) \{\s*\n\s*return \{\s*\n\s*ok: false,/);
  });
  test("modo inválido en un servicio incluido falla cerrado (nunca 'persona' por default)", () => {
    const cuerpo = cuerpoFuncion(computo, "const serviciosIncluidos: ServicioEfectivo[] = [];");
    assert.match(cuerpo, /const modo = validarModoServicio\(r\.modo\);/);
    assert.match(cuerpo, /if \(modo == null\) \{\s*\n\s*return \{ ok: false,/);
  });
});

describe("liquidacionServicio.ts (ResultadoServicio) — categoría/proveedor real fluyen desde buscarReceptivos hasta el checkout", () => {
  test("ResultadoServicio incluye categoria/proveedorId (nunca se pierde la identidad del catálogo)", () => {
    const tipo = cuerpoFuncion(liquidacion, "export type ResultadoServicio = {");
    assert.match(tipo, /categoria: CategoriaServicio/);
    assert.match(tipo, /proveedorId: number \| null/);
  });
  test("calcularPrecioConModoYMarkup — única construcción — usa normalizarCategoriaServicio (nunca inventa la categoría)", () => {
    const cuerpo = cuerpoFuncion(liquidacion, "export function calcularPrecioConModoYMarkup(");
    assert.match(cuerpo, /categoria: normalizarCategoriaServicio\(srv\.categoria\)/);
  });
});

describe("cotizar.ts — las consultas de buscarReceptivos/liquidarServicioPuntual seleccionan categoria/proveedor_id", () => {
  test("buscarReceptivos selecciona categoria/proveedor_id de servicios_adicionales", () => {
    const cuerpo = cuerpoFuncion(cotizar, "export async function buscarReceptivos(inputRaw: unknown)");
    assert.match(cuerpo, /servicios_adicionales["']\)[\s\S]{0,400}categoria, proveedor_id/);
  });
  test("liquidarServicioPuntual selecciona categoria/proveedor_id de servicios_adicionales", () => {
    const idx = cotizar.indexOf("export async function liquidarServicioPuntual(");
    assert.ok(idx > -1);
    const cuerpo = cuerpoFuncion(cotizar, "export async function liquidarServicioPuntual(");
    assert.match(cuerpo, /categoria, proveedor_id/);
  });
});

describe("reservar/actions.ts (crearCotizacion) — asistencia_medica/tours_traslados YA NO se hardcodean", () => {
  test("crearCotizacion ya no fija asistencia_medica: false / tours_traslados: null a ciegas", () => {
    const cuerpo = cuerpoFuncion(reservarActions, "export async function crearCotizacion(");
    assert.doesNotMatch(cuerpo, /asistencia_medica:\s*false,\s*\n?\s*tours_traslados:\s*null/);
    assert.match(cuerpo, /resumirServiciosContrato\(/);
    assert.match(cuerpo, /asistencia_medica:\s*resumenServicios\.asistenciaMedica/);
    assert.match(cuerpo, /tours_traslados:\s*resumenServicios\.toursTraslados/);
  });
});

describe("reservar/actions.ts (reservarDesdeTarifarioInterno) — CxP de servicios usa el mapeo correcto de tipo_proveedor", () => {
  test("ya no existe el ternario viejo que colapsaba 'otro' en 'receptivo'", () => {
    const cuerpo = cuerpoFuncion(reservarActions, "async function reservarDesdeTarifarioInterno(input: ReservaInput");
    assert.doesNotMatch(cuerpo, /cat === "asistencia" \? "asistencia" : "receptivo"/);
    assert.match(cuerpo, /tipoProveedorCxpServicio\(categoria\)/);
  });
  test("servicios INCLUIDOS generan su propia CxP (antes se perdían dentro de la CxP de hotel)", () => {
    const cuerpo = cuerpoFuncion(reservarActions, "async function reservarDesdeTarifarioInterno(input: ReservaInput");
    assert.match(cuerpo, /serviciosIncluidos\.length && process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(cuerpo, /tipoProveedorCxpServicio\(s\.categoria\)/);
  });
  test("el resumen final de asistencia/tours usa resumirServiciosContrato sobre incluidos+opcionales combinados", () => {
    const cuerpo = cuerpoFuncion(reservarActions, "async function reservarDesdeTarifarioInterno(input: ReservaInput");
    assert.match(cuerpo, /resumirServiciosContrato\(serviciosEfectivos\)/);
  });
});

describe("reservar/actions.ts (convertirCotizacionCarrito) — el carrito ya no ignora incluidos/categoría real de los tours", () => {
  test("el comentario viejo 'sin CxP automática' ya no describe el comportamiento actual", () => {
    const cuerpo = cuerpoFuncion(reservarActions, "export async function convertirCotizacionCarrito(");
    assert.doesNotMatch(cuerpo, /sin CxP automática — ver nota arriba/);
  });
  test("ventas.insert usa el resumen del grupo (nunca vuelve a fijar tours_traslados a partir de nombres crudos sin categoría ni asistencia_medica a false fijo)", () => {
    const cuerpo = cuerpoFuncion(reservarActions, "export async function convertirCotizacionCarrito(");
    assert.match(cuerpo, /asistencia_medica:\s*resumenGrupo\.asistenciaMedica/);
    assert.match(cuerpo, /tours_traslados:\s*resumenGrupo\.toursTraslados/);
  });
  test("servicios incluidos se filtran por paqueteId del grupo (nunca se le atribuye a un contrato el incluido de OTRO paquete del carrito)", () => {
    const cuerpo = cuerpoFuncion(reservarActions, "export async function convertirCotizacionCarrito(");
    assert.match(cuerpo, /serviciosIncluidosCot\.filter\(/);
    assert.match(cuerpo, /grupo\.items\.some\(\(it\) => it\.paqueteId === s\.paqueteId\)/);
  });
  test("tours opcionales con servicioId/paqueteId generan CxP re-liquidando el costo NETO (nunca usa t.precio, que es PVP)", () => {
    const cuerpo = cuerpoFuncion(reservarActions, "export async function convertirCotizacionCarrito(");
    assert.match(cuerpo, /if \(t\.servicioId == null \|\| t\.paqueteId == null\) continue;/);
    assert.match(cuerpo, /pushCxP\(tipoProveedorCxpServicio\(normalizarCategoriaServicio\(srv\?\.categoria\)\), srv\?\.nombre \?\? t\.nombre, costoNeto,/);
  });
  test("servicios incluidos del grupo generan CxP sin volver a sumar su PVP (ya horneado en el snapshot del carrito)", () => {
    const cuerpo = cuerpoFuncion(reservarActions, "export async function convertirCotizacionCarrito(");
    assert.match(cuerpo, /if \(incluidosGrupo\.length\)/);
    assert.match(cuerpo, /pushCxP\(tipoProveedorCxpServicio\(s\.categoria\), s\.nombre, s\.costoNeto,/);
  });
});

describe("checkout/actions.ts (crearCotizacionCarrito) — el snapshot del carrito conserva categoría/proveedor + servicios incluidos", () => {
  test("no hardcodea asistencia_medica:false/tours_traslados fijo a partir solo de grupo.tours", () => {
    const cuerpo = cuerpoFuncion(checkoutActions, "async function crearCotizacionCarrito(input: {");
    assert.doesNotMatch(cuerpo, /asistencia_medica:\s*false/);
    assert.match(cuerpo, /resumirServiciosContrato\(/);
  });
  test("persiste serviciosIncluidos en el payload de la cotización (antes se perdían al convertir)", () => {
    const cuerpo = cuerpoFuncion(checkoutActions, "async function crearCotizacionCarrito(input: {");
    assert.match(cuerpo, /serviciosIncluidos:\s*incluidosSnap/);
  });
  test("los tours opcionales conservan categoria/proveedorId de la re-liquidación server-side (nunca del cliente)", () => {
    const cuerpo = cuerpoFuncion(checkoutActions, "async function crearCotizacionCarrito(input: {");
    assert.match(cuerpo, /categoria:\s*resultado\.resultado\.categoria,\s*proveedorId:\s*resultado\.resultado\.proveedorId/);
  });
});

describe("contratos/actions.ts (actualizarServiciosContrato) — editar opcionales nunca apaga una asistencia/tour incluido en el documento", () => {
  test("consulta también los servicios INCLUIDOS del paquete (incluido=true), no solo los opcionales recién elegidos", () => {
    const cuerpo = cuerpoFuncion(contratosActions, "export async function actualizarServiciosContrato(");
    assert.match(cuerpo, /\.eq\("paquete_id", venta\.paquete_armado_id\)\.eq\("incluido", true\)/);
  });
  test("usa resumirServiciosContrato (fuente única) en vez de acumular tours[]/hayAsistencia a mano con comparación directa de string", () => {
    const cuerpo = cuerpoFuncion(contratosActions, "export async function actualizarServiciosContrato(");
    assert.match(cuerpo, /resumirServiciosContrato\(/);
    assert.doesNotMatch(cuerpo, /cat === "asistencia"\) hayAsistencia = true/);
  });
});
