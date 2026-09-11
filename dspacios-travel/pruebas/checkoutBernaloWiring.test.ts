import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3F-1 Bernalo — verificación por inspección del contrato de
// transporte CARRITO → CHECKOUT (`lib/cart/CartContext.tsx`,
// `app/tarifario/checkout/actions.ts`) y de que la guardia de Fase 3
// (`lib/reservar/computo.ts`) sigue intacta. Ninguno de estos archivos es
// ejecutable bajo `node --test` (React/Supabase/Next real) — se verifica el
// código FUENTE, mismo criterio que el resto de wiring tests del repo. Las
// pruebas PURAS (validación/comparación) viven en
// pruebas/solicitudAlojamientoBernalo.test.ts.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*\*?\s*$/.test(l)).join("\n");
}

// Extrae el cuerpo de una función/expresión de flecha balanceando llaves
// reales — mismo criterio brace-depth-aware que el resto de wiring tests
// del repo (ver pruebas/cotizacionBernaloWiring.test.ts).
function cuerpoFuncion(fuenteCompleta: string, ancla: string): string {
  const idx = fuenteCompleta.indexOf(ancla);
  assert.ok(idx > -1, `no se encontró "${ancla}"`);
  let profundidadParen = 0;
  let profundidadAngulo = 0;
  let idxLlaveInicial = -1;
  for (let i = idx; i < fuenteCompleta.length; i++) {
    const ch = fuenteCompleta[i];
    if (ch === "(") profundidadParen++;
    else if (ch === ")") profundidadParen--;
    else if (ch === "<") profundidadAngulo++;
    else if (ch === ">") profundidadAngulo--;
    // El "{" real del cuerpo llega DESPUÉS de cerrar tanto los paréntesis de
    // parámetros como cualquier genérico angular del tipo de retorno
    // (`Promise<{...} | {...}>`) — sin rastrear `<`/`>` el primer "{" en
    // profundidad de paréntesis 0 puede ser el de un objeto DENTRO del tipo
    // de retorno, no el cuerpo de la función (mismo criterio que
    // pruebas/bernaloIntegracionGuardWiring.test.ts).
    else if (ch === "{" && profundidadParen === 0 && profundidadAngulo === 0) { idxLlaveInicial = i; break; }
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

const fuenteCart = leer("lib/cart/CartContext.tsx");
const fuenteCheckoutActions = leer("app/tarifario/checkout/actions.ts");
const fuenteComputo = leer("lib/reservar/computo.ts");
const codigoCart = sinComentarios(fuenteCart);
const codigoCheckoutActions = sinComentarios(fuenteCheckoutActions);
const codigoComputo = sinComentarios(fuenteComputo);

describe("lib/cart/CartContext.tsx — HotelCartItem: unión discriminada real (test obligatorio 1)", () => {
  test("HotelCartItemPersona conserva EXACTAMENTE los mismos campos que el contrato de siempre", () => {
    const tipo = fuenteCart.slice(fuenteCart.indexOf("export type HotelCartItemPersona"), fuenteCart.indexOf("export type HotelCartItemBernalo"));
    for (const campo of [
      "modulo:", "paqueteId:", "hotelId:", "bloqueoId:", "hotelNombre:", "destino:", "fotoUrl:",
      "categoria:", "regimen:", "fechaIda:", "fechaRegreso:", "noches:", "habitaciones:",
      "ninos:", "ninos2:", "infantes:", "pax:", "precio:", "edadesMenores?:", "condicion?:",
    ]) {
      assert.match(tipo, new RegExp(campo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `falta el campo "${campo}" en HotelCartItemPersona`);
    }
  });

  test("el marcador de discriminación es SIEMPRE opcional/undefined en el ítem persona — nunca se le asigna un valor", () => {
    assert.match(codigoCart, /modeloTarifario\?:\s*undefined;/);
    // Ningún literal `modeloTarifario: "persona"` ni similar — el marcador
    // nunca se escribe en runtime (regla del encargo: ítems legado sin la
    // clave se interpretan como persona).
    assert.doesNotMatch(codigoCart, /modeloTarifario:\s*"persona"/);
  });

  test("HotelCartItemBernalo transporta SOLO decisiones — nunca neto/bruto/comisión/snapshot/payload/costos/markup", () => {
    const tipo = fuenteCart.slice(fuenteCart.indexOf("export type HotelCartItemBernalo"), fuenteCart.indexOf("export type HotelCartItem ="));
    assert.doesNotMatch(tipo, /totalNeto|totalBruto|comisionPct|valorComision|snapshot|payload|costoNeto|\bmarkup\b/i);
    for (const campo of ["modeloTarifario:", "paqueteId:", "hotelId:", "categoria:", "alimentacion:", "salida:", "habitaciones:", "precio:", "moneda:"]) {
      assert.match(tipo, new RegExp(campo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `falta el campo "${campo}" en HotelCartItemBernalo`);
    }
  });

  test('la salida Bernalo es `SalidaSeleccionadaBernaloEntrada` importada del módulo NEUTRAL — nunca redefinida', () => {
    assert.match(codigoCart, /import type \{ SalidaSeleccionadaBernaloEntrada \} from "@\/lib\/reservar\/solicitudAlojamientoBernalo"/);
    assert.doesNotMatch(codigoCart, /export type SalidaSeleccionadaBernaloEntrada/);
  });

  test('el módulo neutral no es "use server" — CartContext.tsx (cliente) no importa ninguna Server Action', () => {
    const primeraLinea = leer("lib/reservar/solicitudAlojamientoBernalo.ts").split(/\r?\n/).slice(0, 3).join("\n");
    assert.doesNotMatch(primeraLinea, /"use server"/);
    assert.doesNotMatch(codigoCart, /from ".*checkout\/actions"|from ".*cotizacionBernaloActions"/);
  });
});

describe("lib/cart/CartContext.tsx — add() nunca deduplica (test obligatorio 6: sigue la política actual)", () => {
  const idxAdd = fuenteCart.indexOf("const add = useCallback(");
  assert.notEqual(idxAdd, -1, 'no se encontró "const add = useCallback("');
  const finAdd = fuenteCart.indexOf("}, []);", idxAdd);
  const cuerpoAdd = fuenteCart.slice(idxAdd, finAdd);

  test("add() siempre agrega una línea nueva — nunca llama al comparador de ocupación Bernalo ni busca un ítem igual antes de insertar", () => {
    assert.doesNotMatch(cuerpoAdd, /mismaOcupacionBernalo|claveOcupacionCompletaBernalo|\.find\(/);
    assert.match(cuerpoAdd, /setItems\(\(prev\) => \[\.\.\.prev, \{ \.\.\.item, id:/);
  });
});

describe("app/tarifario/checkout/actions.ts — SolicitudItem: unión discriminada real (test obligatorio 1/9)", () => {
  test("SolicitudItemPersona conserva EXACTAMENTE los mismos campos que el contrato de siempre", () => {
    const tipo = fuenteCheckoutActions.slice(fuenteCheckoutActions.indexOf("export type SolicitudItemPersona"), fuenteCheckoutActions.indexOf("export type SolicitudItemBernalo"));
    for (const campo of [
      "modulo:", "paqueteId:", "hotelId:", "bloqueoId:", "hotelNombre:", "destino:", "categoria:", "regimen:",
      "fechaIda:", "fechaRegreso:", "noches:", "habitaciones:", "ninos:", "ninos2:", "infantes:", "pax:", "precio:", "edadesMenores?:",
    ]) {
      assert.match(tipo, new RegExp(campo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `falta el campo "${campo}" en SolicitudItemPersona`);
    }
  });

  test("SolicitudItemBernalo (test obligatorio 9: la variante COMPLETA que recibe el checkout) trae paquete/hotel/categoría/alimentación/salida/habitaciones — nunca precio como parte de la validación", () => {
    const tipo = fuenteCheckoutActions.slice(fuenteCheckoutActions.indexOf("export type SolicitudItemBernalo"), fuenteCheckoutActions.indexOf("export type SolicitudItem ="));
    for (const campo of ["modeloTarifario:", "paqueteId:", "hotelId:", "hotelNombre:", "categoria:", "alimentacion:", "salida:", "habitaciones:"]) {
      assert.match(tipo, new RegExp(campo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `falta el campo "${campo}" en SolicitudItemBernalo`);
    }
  });

  test("importa validarCrearSolicitudInput/SolicitudItemVariante del módulo NEUTRAL, nunca de edadesMenores.ts (movido en 3F-1)", () => {
    assert.match(codigoCheckoutActions, /import\s*\{[\s\S]*validarCrearSolicitudInput[\s\S]*\}\s*from\s*"@\/lib\/reservar\/solicitudAlojamientoBernalo"/);
    const importEdadesMenores = fuenteCheckoutActions.slice(fuenteCheckoutActions.indexOf('from "@/lib/reservar/edadesMenores"') - 400, fuenteCheckoutActions.indexOf('from "@/lib/reservar/edadesMenores"'));
    assert.doesNotMatch(importEdadesMenores, /validarCrearSolicitudInput/);
  });
});

describe("app/tarifario/checkout/actions.ts — crearCotizacionCarrito: rama Bernalo (test obligatorio 4/9/10)", () => {
  const cuerpoFn = cuerpoFuncion(fuenteCheckoutActions, "async function crearCotizacionCarrito(input: {");
  const idxRamaBernalo = cuerpoFn.indexOf('it.modeloTarifario === "unidad"');
  const idxCierreRama = cuerpoFn.indexOf("const reserva: ReservaInput = {", idxRamaBernalo);
  const ramaBernalo = cuerpoFn.slice(idxRamaBernalo, idxCierreRama);

  test("reconoce la variante ANTES de construir el ReservaInput persona-shaped (nunca cae al camino persona con datos de otro tipo)", () => {
    assert.notEqual(idxRamaBernalo, -1);
    assert.ok(idxRamaBernalo < idxCierreRama, "la rama Bernalo debe resolverse ANTES del camino persona");
  });

  test("mapea `salida` a modulo/bloqueoId/empaquetadoId/fechas con la MISMA regla que resolverOrigenVuelo — nunca inventa una combinación nueva", () => {
    assert.match(ramaBernalo, /bloqueoId: it\.salida\.tipo === "bloqueo" \? it\.salida\.id : null/);
    assert.match(ramaBernalo, /empaquetadoId: it\.salida\.tipo === "empaquetado" \? it\.salida\.id : null/);
    assert.match(ramaBernalo, /modulo: it\.salida\.tipo === "sin_vuelo" \? "porcion_terrestre" : "bloqueo"/);
    assert.match(ramaBernalo, /fechaIda: it\.salida\.tipo === "sin_vuelo" \? it\.salida\.fechaIda : undefined/);
  });

  test("categoria/regimen vienen de it.categoria/it.alimentacion — nunca de un valor fabricado", () => {
    assert.match(ramaBernalo, /categoria: it\.categoria/);
    assert.match(ramaBernalo, /regimen: it\.alimentacion/);
  });

  test("(test obligatorio 4) NUNCA lee it.precio/it.moneda al construir la reliquidación — el precio del carrito no se convierte en autoridad", () => {
    assert.doesNotMatch(ramaBernalo, /it\.precio/);
    assert.doesNotMatch(ramaBernalo, /it\.moneda/);
  });

  test("(test obligatorio 10) enruta HACIA computarReserva — nunca fabrica un mensaje de rechazo aparte sin pasar por la guardia real", () => {
    assert.match(cuerpoFn.slice(idxRamaBernalo, idxRamaBernalo + 3000), /await computarReserva\(sb, reservaBernalo\)/);
  });

  test("nunca escribe contrato_items/CxP/ventas para la rama Bernalo (3F-1: transporte, no integración) — siempre retorna antes de esa sección", () => {
    const bloqueCompleto = cuerpoFn.slice(idxRamaBernalo, idxRamaBernalo + 3000);
    const matchReturn = /return \{\s*\n\s*ok: false,/.exec(bloqueCompleto);
    assert.ok(matchReturn, "la rama Bernalo debe terminar en un return explícito");
    // Sin comentarios: la prosa explicativa de esta misma rama menciona
    // "contrato_items"/"CxP" a propósito (para decir que NO se escriben) —
    // solo el CÓDIGO real (fuera de comentarios) debe estar ausente.
    assert.doesNotMatch(sinComentarios(bloqueCompleto.slice(0, matchReturn!.index + 200)), /contrato_items|cuentas_por_pagar|\.insert\(/);
  });

  test("no llama ninguna función de carrito/checkout más allá de computarReserva (sin crear cotización/contrato para Bernalo en esta fase)", () => {
    assert.doesNotMatch(ramaBernalo, /hotelesSnap\.push|itemsSnap\.push|itemsOk\.push/);
  });
});

describe("lib/reservar/computo.ts — la guardia de Fase 3 sigue intacta (test obligatorio 10: computarReserva continúa bloqueando Bernalo)", () => {
  test('modelo_tarifario === "unidad" sigue bloqueando — sin cambios en esta fase (3F-1 no levanta la guardia)', () => {
    assert.match(codigoComputo, /modeloRow\?\.modelo_tarifario === "unidad"/);
    assert.match(codigoComputo, /todavía no está integrada en Reservar/);
  });
});
