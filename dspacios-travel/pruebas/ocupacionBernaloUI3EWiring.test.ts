import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3E Bernalo — verificación por inspección de la UI de descubrimiento
// y cotización (`app/tarifario/VistaBooking.tsx`, `TarifarioPublic.tsx`,
// `page.tsx`). No ejecutable bajo `node --test` (JSX/Next) — se verifica el
// código fuente, mismo criterio del resto de wiring tests del repo.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteVista = readFileSync(join(raiz, "app/tarifario/VistaBooking.tsx"), "utf8");
const fuentePublic = readFileSync(join(raiz, "app/tarifario/TarifarioPublic.tsx"), "utf8");
const fuentePage = readFileSync(join(raiz, "app/tarifario/page.tsx"), "utf8");

function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*\*?\s*$/.test(l)).join("\n");
}
const codigoVista = sinComentarios(fuenteVista);

function cuerpoFuncion(fuenteCompleta: string, ancla: string): string {
  const idx = fuenteCompleta.indexOf(ancla);
  assert.ok(idx > -1, `no se encontró "${ancla}"`);
  let profundidadParen = 0;
  let idxLlaveInicial = -1;
  for (let i = idx; i < fuenteCompleta.length; i++) {
    const ch = fuenteCompleta[i];
    if (ch === "(") profundidadParen++;
    else if (ch === ")") profundidadParen--;
    else if (ch === "{" && profundidadParen === 0) { idxLlaveInicial = i; break; }
  }
  assert.ok(idxLlaveInicial > -1, `no se encontró el "{" del cuerpo tras "${ancla}"`);
  let profundidad = 0;
  for (let i = idxLlaveInicial; i < fuenteCompleta.length; i++) {
    if (fuenteCompleta[i] === "{") profundidad++;
    else if (fuenteCompleta[i] === "}") {
      profundidad--;
      if (profundidad === 0) return fuenteCompleta.slice(idx, i + 1);
    }
  }
  throw new Error(`no se encontró el cierre del cuerpo de "${ancla}"`);
}

const cuerpoEditorPax = cuerpoFuncion(fuenteVista, "function EditorPax({");

describe("VistaBooking.tsx — descubrimiento paralelo, sin filas ficticias", () => {
  test("hotelesBernalo se renderiza en su PROPIA sección, nunca mezclado con `hoteles` (la grilla que sale de tarifario_resultado)", () => {
    assert.match(codigoVista, /hotelesBernalo\.map\(/);
    // La sección Bernalo nunca empuja a `hoteles` ni a `filas` — son fuentes
    // independientes (regla "paralela").
    assert.doesNotMatch(codigoVista, /hoteles\.push\([\s\S]*hotelesBernalo/);
  });

  test('las tarjetas Bernalo muestran "Consultar tarifa", nunca un precio', () => {
    const seccion = fuenteVista.slice(fuenteVista.indexOf("hotelesBernalo.length > 0"), fuenteVista.indexOf("hotelesBernalo.length > 0") + 1600);
    assert.match(seccion, /Consultar tarifa/);
    assert.doesNotMatch(seccion, /formatMoneda/);
  });

  test("abre HotelBernaloCotizarModal, que renderiza EditorPax con modeloTarifario=\"unidad\"", () => {
    assert.match(codigoVista, /<HotelBernaloCotizarModal hotel=\{modalBernalo\}/);
    const cuerpoModal = cuerpoFuncion(fuenteVista, "function HotelBernaloCotizarModal({");
    assert.match(cuerpoModal, /modeloTarifario="unidad"/);
    assert.match(cuerpoModal, /hotelId=\{hotel\.hotelId\}/);
    assert.match(cuerpoModal, /paqueteId=\{hotel\.paqueteId\}/);
    assert.match(cuerpoModal, /categoriasDisponibles=\{hotel\.categorias\}/);
    assert.match(cuerpoModal, /alimentacionesDisponibles=\{hotel\.regimenes\}/);
  });
});

describe("EditorPax — identidad real hasta el componente (regla 9: sin placeholders)", () => {
  test("los 2 call sites EXISTENTES (hoteles persona) no pasan modeloTarifario — comportamiento anterior intacto", () => {
    const llamadas = [...fuenteVista.matchAll(/<EditorPax\s/g)];
    // 2 originales (persona) + 1 nueva (HotelBernaloCotizarModal) = 3 en total.
    assert.equal(llamadas.length, 3);
    let sinModelo = 0;
    for (const m of llamadas) {
      const bloque = fuenteVista.slice(m.index, m.index + 400);
      if (!/modeloTarifario=/.test(bloque)) sinModelo++;
    }
    assert.equal(sinModelo, 2, "deben quedar exactamente 2 call sites sin modeloTarifario (el flujo persona intacto)");
  });

  test("hotelId/paqueteId/categoriasDisponibles/alimentacionesDisponibles son props reales, no hay ningún valor hardcodeado como \"estandar\"", () => {
    assert.doesNotMatch(codigoVista, /categoria:\s*"estandar"/i);
    assert.doesNotMatch(codigoVista, /alimentacion:\s*"estandar"/i);
    assert.match(cuerpoEditorPax, /categoriasDisponibles = \[\]/);
    assert.match(cuerpoEditorPax, /alimentacionesDisponibles = \[\]/);
  });

  test("el selector de categoría/alimentación usa las opciones REALES recibidas por prop (no una lista fija)", () => {
    assert.match(cuerpoEditorPax, /categoriasDisponibles\.map\(\(c\) => <option key=\{c\} value=\{c\}>\{c\}<\/option>\)/);
    assert.match(cuerpoEditorPax, /alimentacionesDisponibles\.map\(\(r\) => <option key=\{r\} value=\{r\}>\{r\}<\/option>\)/);
  });
});

describe("EditorPax — el selector de habitaciones ya no depende de un PVP inexistente para Bernalo", () => {
  test("el conteo de habitaciones/hayHabBernalo se calcula independiente de `pvp` para Bernalo", () => {
    assert.match(cuerpoEditorPax, /const totalHabBernalo = ACOM_ROOMS\.reduce\(\(s, a\) => s \+ \(habs\[a\] \?\? 0\), 0\);/);
    assert.match(cuerpoEditorPax, /const hayHabBernalo = totalHabBernalo > 0;/);
  });

  test("el input de conteo por tipo de habitación queda HABILITADO en modo Bernalo aunque pvp[a] sea undefined", () => {
    assert.match(cuerpoEditorPax, /const habilitada = esBernalo \|\| pvp\[a\] != null;/);
    assert.match(cuerpoEditorPax, /disabled=\{!habilitada\}/);
  });
});

describe("EditorPax — sin 'Agregar al carrito' en modo Bernalo (regla 19)", () => {
  test("la rama esBernalo del botón final nunca llama onAgregar/agregar()", () => {
    // Hay DOS ramas `esBernalo ? (` en el componente (el bloque de menores
    // por habitación y la barra de acción final) — la del botón es la
    // ÚLTIMA.
    const idxBoton = cuerpoEditorPax.lastIndexOf("esBernalo ? (");
    const idxFinBoton = cuerpoEditorPax.indexOf(") : (", idxBoton);
    const ramaBernalo = cuerpoEditorPax.slice(idxBoton, idxFinBoton);
    assert.doesNotMatch(ramaBernalo, /onClick=\{agregar\}/);
    assert.doesNotMatch(ramaBernalo, /onAgregar\(/);
    assert.match(ramaBernalo, /onClick=\{cotizarBernalo\}/);
  });

  test("cotizarBernalo llama cotizarAlojamientoBernaloPublico (nunca crearCotizacionCarrito/checkout)", () => {
    assert.match(cuerpoEditorPax, /await cotizarAlojamientoBernaloPublico\(\{/);
    assert.doesNotMatch(codigoVista, /crearCotizacionCarrito|crearSolicitudReserva/);
  });

  test("el total mostrado (pvp) es la autoridad; el promedio por viajero se etiqueta como referencia (regla 18)", () => {
    assert.match(cuerpoEditorPax, /Total solicitado/);
    assert.match(cuerpoEditorPax, /promedioPorViajero/);
    assert.match(cuerpoEditorPax, /por viajero \(referencia\)/);
  });
});

describe("EditorPax — cambiar/quitar una habitación limpia sus propias edades (regla 5, sigue vigente en 3E)", () => {
  test("setHab sincroniza edadesPorHabitacion con los ids vigentes, solo cuando esBernalo", () => {
    assert.match(cuerpoEditorPax, /setEdadesPorHabitacion\(\(ep\) => sincronizarHabitaciones\(ep, idsHabitacionesPorConteo\(next\)\)\)/);
  });
});

describe("HotelBernaloCotizarModal — B1.18: configuración incompleta muestra mensaje genérico, nunca monta el editor", () => {
  const cuerpoModal = cuerpoFuncion(fuenteVista, "function HotelBernaloCotizarModal({");

  test("gatea por categorias/regimenes vacíos ANTES de renderizar EditorPax", () => {
    assert.match(cuerpoModal, /hotel\.categorias\.length === 0 \|\| hotel\.regimenes\.length === 0/);
    assert.match(cuerpoModal, /configuracionIncompleta \?/);
  });

  test("pasa `salidas` real al EditorPax (identidad de la salida, nunca inventada)", () => {
    assert.match(cuerpoModal, /salidas=\{hotel\.salidas\}/);
  });
});

describe("EditorPax — B1.17: sin texto libre para categoría/alimentación (auditoría DeepSeek)", () => {
  test("ya no existe ningún <input type=\"text\"> de respaldo para categoría/alimentación en el bloque Bernalo", () => {
    assert.doesNotMatch(cuerpoEditorPax, /type="text" value=\{categoriaSel\}/);
    assert.doesNotMatch(cuerpoEditorPax, /type="text" value=\{alimentacionSel\}/);
    assert.doesNotMatch(cuerpoEditorPax, /placeholder="Categoría"/);
    assert.doesNotMatch(cuerpoEditorPax, /placeholder="Alimentación"/);
  });

  test("los <select> de categoría/alimentación quedan deshabilitados cuando no hay opciones reales (nunca se abren a adivinar)", () => {
    assert.match(cuerpoEditorPax, /disabled=\{!categoriasDisponibles\.length\}/);
    assert.match(cuerpoEditorPax, /disabled=\{!alimentacionesDisponibles\.length\}/);
  });
});

describe("EditorPax — A1.2/A1.3/A1.6: selección de salida, nunca [0]", () => {
  test("con 0 salidas, se muestran los inputs de fecha manual (porción terrestre)", () => {
    assert.match(cuerpoEditorPax, /salidas\.length === 0 \?/);
    assert.match(cuerpoEditorPax, /id=\{`\$\{idBase\}-fecha-ida`\}/);
  });

  test("con 1 salida, se autoselecciona y se muestra como información (no editable)", () => {
    assert.match(cuerpoEditorPax, /salidas\.length === 1 \?/);
  });

  test("con más de 1 salida, la UI exige clic explícito — nunca autocompleta ni toma la primera", () => {
    assert.match(cuerpoEditorPax, /salidas\.length > 1 &&/);
    assert.match(cuerpoEditorPax, /onClick=\{\(\) => \{ setSalidaElegidaKey\(key\); setResultadoCotizacion\(null\); \}\}/);
  });

  test("el payload de cotización envía `salida` como identidad {tipo,id}/sin_vuelo — nunca fechaIda/fechaRegreso sueltos", () => {
    assert.match(cuerpoEditorPax, /salida: salidaPayload/);
    assert.doesNotMatch(cuerpoEditorPax, /fechaIda: fechaIdaBernalo, fechaRegreso: fechaRegresoBernalo,\s*\n\s*habitaciones: payloadBernalo/);
  });

  test("salidaPayload nunca se arma indexando `salidas[0]` de forma incondicional (solo dentro de la rama length===1)", () => {
    const idxDecl = cuerpoEditorPax.indexOf("const salidaPayload");
    assert.notEqual(idxDecl, -1);
    // La única ocurrencia de `salidas[0]` en todo el componente debe estar
    // dentro de la derivación `salidaElegidaKeyEfectiva` (autoselección
    // legítima cuando length===1) o en el bloque informativo JSX — nunca en
    // `salidaPayload` mismo, que siempre pasa por `salidaElegida` (buscado
    // por identidad).
    assert.doesNotMatch(cuerpoEditorPax.slice(idxDecl, idxDecl + 400), /salidas\[0\]/);
  });
});

describe("TarifarioPublic.tsx / page.tsx — hilo completo de props hasta VistaBooking", () => {
  test("TarifarioPublic recibe hotelesBernalo y lo reenvía a VistaBooking sin transformarlo", () => {
    assert.match(fuentePublic, /hotelesBernalo = \[\]/);
    assert.match(fuentePublic, /<VistaBooking[^>]*hotelesBernalo=\{hotelesBernalo\}/);
  });

  test("page.tsx carga el descubrimiento Bernalo en PARALELO (Promise.all) con la carga principal, nunca la bloquea", () => {
    assert.match(fuentePage, /Promise\.all\(\[/);
    assert.match(fuentePage, /cargarHotelesBernaloDescubiertos\(\)/);
  });

  test("un fallo en el descubrimiento Bernalo degrada a lista vacía, nunca rompe la página (best-effort)", () => {
    assert.match(fuentePage, /\.catch\(\(\) => \(\{ ok: false as const/);
    assert.match(fuentePage, /const hotelesBernalo = resultadoBernalo\.ok \? resultadoBernalo\.hoteles : \[\];/);
  });
});
