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

  test("SolicitudItemBernalo (test obligatorio 9: la variante COMPLETA que recibe el checkout) trae itemId/paquete/hotel/categoría/alimentación/salida/habitaciones — nunca precio como parte de la validación", () => {
    const tipo = fuenteCheckoutActions.slice(fuenteCheckoutActions.indexOf("export type SolicitudItemBernalo"), fuenteCheckoutActions.indexOf("export type SolicitudItem ="));
    for (const campo of ["modeloTarifario:", "itemId:", "paqueteId:", "hotelId:", "hotelNombre:", "categoria:", "alimentacion:", "salida:", "habitaciones:"]) {
      assert.match(tipo, new RegExp(campo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `falta el campo "${campo}" en SolicitudItemBernalo`);
    }
  });

  test("importa validarCrearSolicitudInput/SolicitudItemVariante del módulo NEUTRAL, nunca de edadesMenores.ts (movido en 3F-1)", () => {
    assert.match(codigoCheckoutActions, /import\s*\{[\s\S]*validarCrearSolicitudInput[\s\S]*\}\s*from\s*"@\/lib\/reservar\/solicitudAlojamientoBernalo"/);
    const importEdadesMenores = fuenteCheckoutActions.slice(fuenteCheckoutActions.indexOf('from "@/lib/reservar/edadesMenores"') - 400, fuenteCheckoutActions.indexOf('from "@/lib/reservar/edadesMenores"'));
    assert.doesNotMatch(importEdadesMenores, /validarCrearSolicitudInput/);
  });
});

describe("app/tarifario/checkout/actions.ts — crearCotizacionCarrito: rama Bernalo (Fase 3F-4A)", () => {
  const cuerpoFn = cuerpoFuncion(fuenteCheckoutActions, "async function crearCotizacionCarrito(input: {");
  const idxRamaBernalo = cuerpoFn.indexOf('it.modeloTarifario === "unidad"');
  // La rama Bernalo termina en `continue;` (procesa el ítem y sigue el loop,
  // igual que persona) — el camino persona arranca justo después con
  // `const reserva: ReservaInput = {`.
  const idxCierreRama = cuerpoFn.indexOf("const reserva: ReservaInput = {", idxRamaBernalo);
  const ramaBernalo = cuerpoFn.slice(idxRamaBernalo, idxCierreRama);

  test("reconoce la variante ANTES de construir el ReservaInput persona-shaped (nunca cae al camino persona con datos de otro tipo)", () => {
    assert.notEqual(idxRamaBernalo, -1);
    assert.ok(idxRamaBernalo < idxCierreRama, "la rama Bernalo debe resolverse ANTES del camino persona");
  });

  test("regla D.17: llama computarReservaBernalo UNA sola vez — nunca computarReserva ni una segunda implementación del cálculo", () => {
    assert.match(ramaBernalo, /await computarReservaBernalo\(\{/);
    const usos = [...ramaBernalo.matchAll(/computarReservaBernalo\(/g)];
    assert.equal(usos.length, 1, "computarReservaBernalo debe llamarse UNA sola vez en la rama Bernalo");
    assert.doesNotMatch(ramaBernalo, /computarReserva\(sb,/);
  });

  test("construye la entrada del servicio con la salida/habitaciones YA VALIDADAS de it — nunca fabrica una forma nueva", () => {
    assert.match(ramaBernalo, /categoria: it\.categoria,/);
    assert.match(ramaBernalo, /alimentacion: it\.alimentacion,/);
    assert.match(ramaBernalo, /salida: it\.salida,/);
    assert.match(ramaBernalo, /habitaciones: it\.habitaciones,/);
  });

  test("regla D.18: si el servicio interno rechaza (tarifa/salida no vigente), retorna error y corta ANTES de comparar precio o escribir snapshot", () => {
    const idxRechazo = ramaBernalo.indexOf("if (!resultadoBernalo.ok)");
    const idxComparacion = ramaBernalo.indexOf("precioVenta !== it.precioDeclarado");
    assert.notEqual(idxRechazo, -1);
    assert.ok(idxRechazo < idxComparacion, "el rechazo del servicio interno debe resolverse antes de comparar el precio");
  });

  test("regla B.9/B.10/B.11: compara precioVenta/moneda AUTORITATIVOS contra precioDeclarado/monedaDeclarada — nunca acepta it.precio/it.moneda del wire crudo", () => {
    assert.match(ramaBernalo, /resultadoBernalo\.precioVenta !== it\.precioDeclarado/);
    assert.match(ramaBernalo, /resultadoBernalo\.moneda !== it\.monedaDeclarada/);
    // `it` en este punto es `SolicitudItemBernaloValidado` (ya pasó por
    // validarSolicitudItemBernalo) — nunca lee `it.precio`/`it.moneda`
    // directo (esas claves no existen en el tipo validado, solo en el wire).
    assert.doesNotMatch(ramaBernalo, /it\.precio\b/);
    assert.doesNotMatch(ramaBernalo, /it\.moneda\b/);
  });

  test("regla B.10: ante un cambio de precio, retorna tipo:'precio_actualizado' con SOLO itemId/pvp/moneda públicos — nunca inserta la cotización", () => {
    const bloqueMismatch = ramaBernalo.slice(ramaBernalo.indexOf("resultadoBernalo.precioVenta !== it.precioDeclarado") - 50, ramaBernalo.indexOf("resultadoBernalo.precioVenta !== it.precioDeclarado") + 800);
    assert.match(bloqueMismatch, /tipo: "precio_actualizado"/);
    assert.match(bloqueMismatch, /itemId: it\.itemId,/);
    assert.match(bloqueMismatch, /pvp: resultadoBernalo\.precioVenta,/);
    assert.match(bloqueMismatch, /moneda: resultadoBernalo\.moneda,/);
    assert.doesNotMatch(bloqueMismatch, /costoHotelTotal|aportePvp|proveedorHotel|serviciosIncluidos\b|\.insert\(/i);
  });

  test("regla C.13: el snapshot de habitaciones toma SOLO `.ocupacion` de cada habitación — nunca `.resultado`/`.snapshot` (netos/comisión/fuente)", () => {
    assert.match(ramaBernalo, /resultadoBernalo\.habitaciones\.map\(\(h\) => h\.ocupacion\)/);
    assert.doesNotMatch(ramaBernalo, /h\.resultado|h\.snapshot/);
  });

  test("regla C.14: el ítem acumulado (itemsBernaloOk) queda marcado con modeloTarifario: \"unidad\" para que 3F-4B lo detecte", () => {
    const idxPush = ramaBernalo.indexOf("itemsBernaloOk.push({");
    assert.notEqual(idxPush, -1);
    assert.match(ramaBernalo.slice(idxPush, idxPush + 200), /modeloTarifario: "unidad",/);
  });

  test("nunca escribe contrato_items/CxP/ventas para la rama Bernalo (3F-4A: cotización informativa, no contrato) — solo cotizaciones vía el insert compartido con persona", () => {
    assert.doesNotMatch(sinComentarios(ramaBernalo), /contrato_items|cuentas_por_pagar/);
  });
});

describe("app/tarifario/checkout/actions.ts — cierre #2: metadatos autoritativos (hotelNombre/destino)", () => {
  const cuerpoFn = cuerpoFuncion(fuenteCheckoutActions, "async function crearCotizacionCarrito(input: {");
  const idxRamaBernalo = cuerpoFn.indexOf('it.modeloTarifario === "unidad"');
  const idxCierreRama = cuerpoFn.indexOf("const reserva: ReservaInput = {", idxRamaBernalo);
  const ramaBernalo = cuerpoFn.slice(idxRamaBernalo, idxCierreRama);

  test("el destino persistido en hotelesSnap/itemsSnap/itemsBernaloOk sale de resultadoBernalo.hotelDestino — nunca de it.destino (texto libre del carrito)", () => {
    assert.match(ramaBernalo, /const destinoAutoritativo = resultadoBernalo\.hotelDestino;/);
    assert.match(ramaBernalo, /ciudad: destinoAutoritativo,/);
    assert.match(ramaBernalo, /destino: destinoAutoritativo,/);
    // `it.destino` (el valor crudo del carrito) NUNCA se escribe en ningún
    // snapshot/objeto persistido de esta rama — la única lectura permitida
    // de `it.destino` sería para lógica de decisión, y ni siquiera esa existe.
    assert.doesNotMatch(ramaBernalo, /:\s*it\.destino\b/);
  });

  test("hotelNombre persistido sale SIEMPRE de resultadoBernalo.hotelNombre — nunca de it.hotelNombre", () => {
    assert.doesNotMatch(ramaBernalo, /nombre:\s*it\.hotelNombre/);
    assert.match(ramaBernalo, /nombre: resultadoBernalo\.hotelNombre,/);
    assert.match(ramaBernalo, /hotelNombre: resultadoBernalo\.hotelNombre,/);
  });

  test("hotelNombre/destino MANIPULADOS por el navegador (ej. it.hotelNombre=\"Hotel Falso 5 estrellas\", it.destino=\"Dubai\") nunca llegan a hotelesSnap/itemsSnap/itemsBernaloOk — solo resultadoBernalo.hotelNombre/hotelDestino, que ignoran por completo lo que trae `it`", () => {
    // `it` (SolicitudItemBernaloValidado) puede traer CUALQUIER texto en
    // hotelNombre/destino — `validarSolicitudItemBernalo` solo acota longitud,
    // nunca verifica que coincida con el hotel/paquete real. Un navegador
    // manipulado podría mandar it.hotelNombre="Hotel Falso 5 estrellas" y
    // it.destino="Dubai" para un hotel que en realidad es otro — el código de
    // esta rama nunca lee esas dos propiedades para construir ningún snapshot
    // persistido (ya verificado campo por campo arriba); esta prueba lo
    // confirma de forma agregada, sobre el bloque completo de la rama.
    const bloqueSnapshots = ramaBernalo.slice(ramaBernalo.indexOf("hIdx++"), ramaBernalo.indexOf("continue;", ramaBernalo.indexOf("itemsBernaloOk.push({")));
    assert.doesNotMatch(bloqueSnapshots, /it\.hotelNombre|it\.destino\b/);
    assert.match(bloqueSnapshots, /resultadoBernalo\.hotelNombre/);
    assert.match(bloqueSnapshots, /destinoAutoritativo/);
  });

  test("computarReservaBernalo (servicio interno) resuelve el destino desde armado_paquetes.destinos — no un segundo query duplicado en checkout/actions.ts", () => {
    // El servicio interno YA es la fuente: checkout/actions.ts no vuelve a
    // consultar `destinos` por su cuenta (evita divergencia entre dos
    // consultas que podrían responder distinto).
    assert.doesNotMatch(sinComentarios(fuenteCheckoutActions), /\.from\("destinos"\)/);
    const fuenteComputoBernalo = leer("lib/reservar/computoReservaBernalo.ts");
    assert.match(fuenteComputoBernalo, /destinos\(nombre\)/);
    assert.match(fuenteComputoBernalo, /hotelDestino: destinoNombre,/);
  });
});

describe("app/tarifario/checkout/actions.ts — cierre #3: vuelosSnap público para salida bloqueo/empaquetado", () => {
  const cuerpoFn = cuerpoFuncion(fuenteCheckoutActions, "async function crearCotizacionCarrito(input: {");
  const idxRamaBernalo = cuerpoFn.indexOf('it.modeloTarifario === "unidad"');
  const idxCierreRama = cuerpoFn.indexOf("const reserva: ReservaInput = {", idxRamaBernalo);
  const ramaBernalo = cuerpoFn.slice(idxRamaBernalo, idxCierreRama);

  test("reutiliza construirTramosVueloSnap/CAMPOS_VUELO_SNAP — el MISMO constructor que ya usa la rama persona, nunca copia la consulta/transformación", () => {
    assert.match(ramaBernalo, /construirTramosVueloSnap\(bq\)/);
    assert.match(ramaBernalo, /\.select\(CAMPOS_VUELO_SNAP\)/);
    // El constructor mismo (fuera de esta rama) debe existir una sola vez —
    // ambas ramas (persona/Bernalo) lo importan del mismo lugar (está en el
    // mismo archivo, no se copia su cuerpo).
    const usosConstructor = [...codigoCheckoutActions.matchAll(/function construirTramosVueloSnap\(/g)];
    assert.equal(usosConstructor.length, 1, "construirTramosVueloSnap debe definirse UNA sola vez");
  });

  test("consulta SIEMPRE resultadoBernalo.salida (la salida RESUELTA/autoritativa) — nunca it.salida (la elección cruda del navegador)", () => {
    const idxVuelo = ramaBernalo.indexOf("resultadoBernalo.salida.tipo ===");
    assert.notEqual(idxVuelo, -1);
    const bloque = ramaBernalo.slice(idxVuelo, idxVuelo + 500);
    assert.match(bloque, /\.eq\("id", resultadoBernalo\.salida\.id\)/);
    assert.doesNotMatch(bloque, /it\.salida\.id/);
  });

  test('cubre tipo "bloqueo" (tabla bloqueos_vuelo) Y "empaquetado" (tabla empaquetados) — nunca solo uno de los dos', () => {
    const idxVuelo = ramaBernalo.indexOf("resultadoBernalo.salida.tipo ===");
    const bloque = ramaBernalo.slice(idxVuelo, idxVuelo + 500);
    assert.match(bloque, /"bloqueo"/);
    assert.match(bloque, /"empaquetado"/);
    assert.match(bloque, /"bloqueos_vuelo"/);
    assert.match(bloque, /"empaquetados"/);
  });

  test('"sin_vuelo" NUNCA entra al bloque que arma vuelosSnap (no inventa un vuelo)', () => {
    const idxVuelo = ramaBernalo.indexOf("resultadoBernalo.salida.tipo ===");
    const bloque = ramaBernalo.slice(idxVuelo, idxVuelo + 500);
    assert.doesNotMatch(bloque, /"sin_vuelo"/);
  });

  test("no expone tarifa/costo en el snapshot de vuelo — CAMPOS_VUELO_SNAP nunca selecciona tarifa_para_empaquetar/tarifa_proveedor", () => {
    assert.doesNotMatch(codigoCheckoutActions, /CAMPOS_VUELO_SNAP\s*=\s*"[^"]*tarifa/);
  });

  test("elegir entre dos salidas persiste la SELECCIONADA, nunca la primera: la consulta se filtra por resultadoBernalo.salida.id (ya resuelto por identidad real contra las salidas válidas del paquete, ver computoReservaBernaloWiring), nunca por índice [0]", () => {
    const idxVuelo = ramaBernalo.indexOf("resultadoBernalo.salida.tipo ===");
    const bloque = ramaBernalo.slice(idxVuelo, idxVuelo + 500);
    assert.doesNotMatch(bloque, /\[0\]/);
    assert.match(bloque, /resultadoBernalo\.salida\.id/);
  });
});

describe("app/tarifario/checkout/actions.ts — hallazgo confirmado: la línea de alojamiento Bernalo en la cotización NUNCA se renderiza per-cápita", () => {
  const cuerpoFn = cuerpoFuncion(fuenteCheckoutActions, "async function crearCotizacionCarrito(input: {");
  const idxRamaBernalo = cuerpoFn.indexOf('it.modeloTarifario === "unidad"');
  const idxCierreRama = cuerpoFn.indexOf("const reserva: ReservaInput = {", idxRamaBernalo);
  const ramaBernalo = cuerpoFn.slice(idxRamaBernalo, idxCierreRama);

  test('itemsSnap de un ítem Bernalo se arma con modo_precio: "total" y valor_total — nunca adultos: 1/tarifa_adulto (eso es lo que producía "Adultos 1" para una doble de 2 adultos)', () => {
    const idxPush = ramaBernalo.indexOf("itemsSnap.push({");
    assert.notEqual(idxPush, -1);
    const bloque = ramaBernalo.slice(idxPush, idxPush + 500);
    assert.match(bloque, /modo_precio: "total", valor_total: resultadoBernalo\.precioVenta,/);
    assert.doesNotMatch(bloque, /adultos: 1,/);
    assert.match(bloque, /adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0,/);
  });

  test("la descripción de la línea agregada incluye habitaciones Y viajeros (mismo criterio que el contrato ya convertido en reservar/actions.ts)", () => {
    const idxPush = ramaBernalo.indexOf("itemsSnap.push({");
    const bloque = ramaBernalo.slice(idxPush, idxPush + 400);
    assert.match(bloque, /habitación\(es\), \$\{resultadoBernalo\.paxTotal\} viajero\(s\)/);
  });

  test("habitacionesBernaloSnap se llena con la ocupación REAL de cada habitación (h.adultos) — nunca con la cantidad de habitaciones ni un valor fijo", () => {
    const idxPush = ramaBernalo.indexOf("habitacionesBernaloSnap.push({");
    assert.notEqual(idxPush, -1);
    const bloque = ramaBernalo.slice(idxPush, idxPush + 300);
    assert.match(bloque, /adultos: h\.adultos,/);
    assert.match(bloque, /edadesMenores: h\.edadesMenores,/);
    assert.doesNotMatch(bloque, /adultos: habitacionesSnap\.length/);
  });

  test("habitacionesBernaloSnap itera habitacionesSnap (las mismas ocupaciones ya validadas, .ocupacion de cada habitación) — no reconstruye la lista desde it.habitaciones crudo", () => {
    const idxForEach = ramaBernalo.indexOf("habitacionesSnap.forEach(");
    assert.notEqual(idxForEach, -1);
    const idxOcupacion = ramaBernalo.indexOf("resultadoBernalo.habitaciones.map((h) => h.ocupacion)");
    assert.ok(idxOcupacion !== -1 && idxOcupacion < idxForEach, "habitacionesSnap debe construirse (desde .ocupacion) antes de recorrerla para el detalle por habitación");
  });
});

describe("app/tarifario/checkout/actions.ts — la cotización persiste habitacionesBernalo en su detalle", () => {
  test('el objeto `detalle` guardado incluye "habitacionesBernalo: habitacionesBernaloSnap"', () => {
    const idxDetalle = codigoCheckoutActions.indexOf("const detalle = {");
    assert.notEqual(idxDetalle, -1);
    const bloque = codigoCheckoutActions.slice(idxDetalle, idxDetalle + 300);
    assert.match(bloque, /habitacionesBernalo: habitacionesBernaloSnap,/);
  });
});

describe("app/cotizacion/[id]/page.tsx — pasa habitacionesBernalo al documento previo (mismo detalle por habitación que el contrato ya convertido)", () => {
  const fuentePage = leer("app/cotizacion/[id]/page.tsx");

  test("el tipo Detalle declara habitacionesBernalo opcional", () => {
    const tipo = fuentePage.slice(fuentePage.indexOf("type Detalle = {"), fuentePage.indexOf("type Detalle = {") + 700);
    assert.match(tipo, /habitacionesBernalo\?: HabitacionBernaloDocumento\[\];/);
  });

  test("<ContratoDocumento> de la rama de cotización del tarifario recibe habitacionesBernalo={d.habitacionesBernalo ?? []}", () => {
    const idxContrato = fuentePage.indexOf("<ContratoDocumento");
    const idxFinTarifario = fuentePage.indexOf("</ContratoDocumento>", idxContrato);
    const bloque = fuentePage.slice(idxContrato, idxFinTarifario === -1 ? idxContrato + 500 : idxFinTarifario);
    assert.match(bloque, /habitacionesBernalo=\{d\.habitacionesBernalo \?\? \[\]\}/);
  });
});

describe("lib/reservar/computoReservaBernalo.ts — cierre #2: hotelDestino autoritativo (Fase 3F-4A)", () => {
  const fuenteComputoBernalo = leer("lib/reservar/computoReservaBernalo.ts");
  const codigoComputoBernalo = sinComentarios(fuenteComputoBernalo);

  test("ComputoReservaBernaloOk declara hotelDestino: string | null", () => {
    const tipo = fuenteComputoBernalo.slice(fuenteComputoBernalo.indexOf("export type ComputoReservaBernaloOk"), fuenteComputoBernalo.indexOf("export type ResultadoComputoReservaBernalo"));
    assert.match(tipo, /hotelDestino: string \| null;/);
  });

  test("destinoNombre se resuelve desde el JOIN armado_paquetes.destinos(nombre) — nunca desde input (el llamador no puede mandar un destino)", () => {
    assert.match(codigoComputoBernalo, /destinos\(nombre\)/);
    assert.match(codigoComputoBernalo, /const destinoNombre = \(pq\.destinos as unknown as \{ nombre: string \} \| null\)\?\.nombre \?\? null;/);
    assert.doesNotMatch(codigoComputoBernalo, /hotelDestino:\s*input\./);
  });
});

describe("app/tarifario/checkout/actions.ts — SolicitudResult: precio_actualizado (regla B.10)", () => {
  test("SolicitudResult incluye la variante ResultadoPrecioActualizadoBernalo (tipo:'precio_actualizado', ok:false)", () => {
    const tipo = fuenteCheckoutActions.slice(
      fuenteCheckoutActions.indexOf("export type ResultadoPrecioActualizadoBernalo"),
      fuenteCheckoutActions.indexOf("export type SolicitudResult =")
    );
    for (const campo of ["ok: false;", 'tipo: "precio_actualizado";', "itemId: string;", "paqueteId: number;", "hotelId: number;", "pvp: number;", "moneda: string;"]) {
      assert.match(tipo, new RegExp(campo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(codigoCheckoutActions, /export type SolicitudResult =[\s\S]*ResultadoPrecioActualizadoBernalo/);
  });

  test("crearSolicitudReserva propaga precio_actualizado ANTES del insert en crm_contactos/mensaje (if (!cot.ok) return cot;)", () => {
    const cuerpoFn = cuerpoFuncion(fuenteCheckoutActions, "export async function crearSolicitudReserva(inputRaw: unknown)");
    const idxCall = cuerpoFn.indexOf("await crearCotizacionCarrito(");
    const idxReturn = cuerpoFn.indexOf("if (!cot.ok) return cot;", idxCall);
    const idxCrm = cuerpoFn.indexOf("crm_contactos");
    assert.notEqual(idxReturn, -1);
    assert.ok(idxCall < idxReturn && idxReturn < idxCrm, "precio_actualizado/error deben salir ANTES de los efectos secundarios (CRM/mensaje)");
  });
});

// El describe "convertirCotizacionCarrito bloquea Bernalo (regla C.15)" que
// vivía aquí (Fase 3F-4A) se RETIRÓ: Fase 3F-4B levantó ese bloqueo genérico
// — `convertirCotizacionCarrito` ahora reliquida y convierte un ítem Bernalo
// (con las guardias de precio/proveedor de la nueva fase). Sus pruebas de
// wiring viven en pruebas/convertirCotizacionCarritoBernaloWiring.test.ts.

describe("lib/reservar/solicitudAlojamientoBernalo.ts — precioDeclarado/monedaDeclarada (regla B.10, Fase 3F-4A)", () => {
  const fuenteSolicitud = leer("lib/reservar/solicitudAlojamientoBernalo.ts");

  test("SolicitudItemBernaloValidado declara precioDeclarado/monedaDeclarada como number|null / string|null", () => {
    const tipo = fuenteSolicitud.slice(fuenteSolicitud.indexOf("export type SolicitudItemBernaloValidado"), fuenteSolicitud.indexOf("export function validarSolicitudItemBernalo"));
    assert.match(tipo, /precioDeclarado: number \| null;/);
    assert.match(tipo, /monedaDeclarada: string \| null;/);
  });

  test("nunca se usan para calcular nada dentro de este módulo — solo se asignan al ítem validado", () => {
    // `cuerpoFuncion` (brace-depth-aware) confunde el tipo de retorno de esta
    // función (`{ ok: true; ... } | { ok: false; error: string }`, sin
    // envoltorio genérico) con el cuerpo real — se acota manualmente hasta el
    // siguiente bloque del archivo en su lugar.
    const idxInicio = fuenteSolicitud.indexOf("export function validarSolicitudItemBernalo(");
    const idxFin = fuenteSolicitud.indexOf("// ── Comparación de composiciones Bernalo", idxInicio);
    assert.ok(idxInicio > -1 && idxFin > idxInicio);
    const cuerpoFn = fuenteSolicitud.slice(idxInicio, idxFin);
    // Las únicas apariciones de `precioDeclarado`/`monedaDeclarada` en el
    // cuerpo son su declaración `const` y su uso en el objeto de retorno.
    const usosPrecio = [...cuerpoFn.matchAll(/precioDeclarado/g)].length;
    const usosMoneda = [...cuerpoFn.matchAll(/monedaDeclarada/g)].length;
    assert.equal(usosPrecio, 2);
    assert.equal(usosMoneda, 2);
  });

  test("cierre #1: SolicitudItemBernaloValidado declara itemId: string, y validarSolicitudItemBernalo lo exige (validarTextoAcotado, sin permitir vacío)", () => {
    const tipo = fuenteSolicitud.slice(fuenteSolicitud.indexOf("export type SolicitudItemBernaloValidado"), fuenteSolicitud.indexOf("export function validarSolicitudItemBernalo"));
    assert.match(tipo, /itemId: string;/);
    const idxInicio = fuenteSolicitud.indexOf("export function validarSolicitudItemBernalo(");
    const idxFin = fuenteSolicitud.indexOf("// ── Comparación de composiciones Bernalo", idxInicio);
    const cuerpoFn = fuenteSolicitud.slice(idxInicio, idxFin);
    assert.match(cuerpoFn, /validarTextoAcotado\(v\.itemId,/);
    assert.match(cuerpoFn, /itemId: vItemId\.texto,/);
  });
});

describe("lib/reservar/computo.ts — la guardia de Fase 3 sigue intacta (regla D.16: computarReserva sigue bloqueando Bernalo)", () => {
  test('modelo_tarifario === "unidad" sigue bloqueando — sin cambios en Fase 3F-4A', () => {
    assert.match(codigoComputo, /modeloRow\?\.modelo_tarifario === "unidad"/);
    assert.match(codigoComputo, /todavía no está integrada en Reservar/);
  });
});

describe("lib/cart/CartContext.tsx — actualizarPrecioBernalo (regla B.10, Fase 3F-4A)", () => {
  test("expuesto en CartCtx y en el valor del Provider", () => {
    assert.match(codigoCart, /actualizarPrecioBernalo: \(id: string, precio: number, moneda: string \| null\) => void;/);
    assert.match(codigoCart, /items, add, remove, actualizarPrecioBernalo, clear, total, count: items\.length,/);
  });

  test("solo actualiza precio/moneda de un ítem Bernalo por id — nunca toca otros campos ni ítems persona/tour", () => {
    const idxFn = codigoCart.indexOf("const actualizarPrecioBernalo = useCallback(");
    const cuerpo = codigoCart.slice(idxFn, idxFn + 300);
    assert.match(cuerpo, /i\.modeloTarifario === "unidad"/);
    assert.match(cuerpo, /\{ \.\.\.i, precio, moneda \}/);
  });

  test("el fallback fuera de CartProvider también declara actualizarPrecioBernalo (no-op)", () => {
    // "Outside CartProvider" es texto de comentario — buscar en la fuente
    // CRUDA (codigoCart le quita las líneas de comentario).
    const idxFallback = fuenteCart.indexOf("Outside CartProvider");
    assert.notEqual(idxFallback, -1);
    const cuerpo = fuenteCart.slice(idxFallback, idxFallback + 400);
    assert.match(cuerpo, /actualizarPrecioBernalo: \(\) => \{\},/);
  });
});

describe("app/tarifario/checkout/page.tsx — envía ítems Bernalo y maneja precio_actualizado (Fase 3F-4A)", () => {
  const fuentePage = leer("app/tarifario/checkout/page.tsx");
  const codigoPage = sinComentarios(fuentePage);

  test("filtra bernaloItems del carrito y los incluye en el payload de crearSolicitudReserva", () => {
    assert.match(codigoPage, /modeloTarifario === "unidad"/);
    assert.match(codigoPage, /bernaloItems\.map\(\(it\) => \(\{/);
    assert.match(codigoPage, /modeloTarifario: "unidad" as const,/);
  });

  test('detecta la variante precio_actualizado (discriminada por "tipo" in r) y actualiza el carrito vía actualizarPrecioBernalo — nunca acepta el resultado como éxito', () => {
    assert.match(codigoPage, /else if \("tipo" in r\)/);
    assert.match(codigoPage, /actualizarPrecioBernalo\(item\.id, r\.pvp, r\.moneda\)/);
    // El branch de éxito (`setRes`/`clear()`) solo se alcanza en `r.ok` — el
    // branch de precio_actualizado nunca llama a `clear()` ni a `setRes`.
    const idxBranch = codigoPage.indexOf('else if ("tipo" in r)');
    const bloque = codigoPage.slice(idxBranch, idxBranch + 400);
    assert.doesNotMatch(bloque, /setRes\(|clear\(\)/);
  });

  test("exige un clic explícito adicional para reintentar (el botón cambia de texto, no se auto-reenvía)", () => {
    assert.match(codigoPage, /precioCambio \? "Confirmar con el nuevo precio y enviar" : "Generar cotización y enviar solicitud"/);
  });

  test("cierre #1: envía itemId (it.id del carrito) en el payload Bernalo — nunca lo omite", () => {
    const idxMap = codigoPage.indexOf("bernaloItems.map((it) => ({");
    const bloque = codigoPage.slice(idxMap, idxMap + 300);
    assert.match(bloque, /itemId: it\.id,/);
  });

  test("cierre #1: correlaciona el precio_actualizado por itemId (r.itemId) — nunca por paqueteId+hotelId", () => {
    const idxBranch = codigoPage.indexOf('else if ("tipo" in r)');
    const bloque = codigoPage.slice(idxBranch, idxBranch + 400);
    assert.match(bloque, /bernaloItems\.find\(\(i\) => i\.id === r\.itemId\)/);
    assert.doesNotMatch(bloque, /i\.paqueteId === r\.paqueteId && i\.hotelId === r\.hotelId/);
  });
});
