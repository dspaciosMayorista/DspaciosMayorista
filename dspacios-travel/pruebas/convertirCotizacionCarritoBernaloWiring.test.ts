import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3F-4B Bernalo — verificación por inspección de
// `convertirCotizacionCarrito` (app/(dashboard)/dashboard/reservar/actions.ts):
// convierte una cotización Bernalo a contrato con persistencia financiera
// durable. No ejecutable bajo `node --test` (Supabase/Next real) — se
// verifica el código FUENTE, mismo criterio que el resto de wiring tests.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*\*?\s*$/.test(l)).join("\n");
}

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

const rutaActions = "app/(dashboard)/dashboard/reservar/actions.ts";
const fuente = leer(rutaActions);
const codigo = sinComentarios(fuente);

describe("convertirCotizacionCarrito — regla A.7: el bloqueo genérico de 3F-4A se retiró", () => {
  test('ya no existe el mensaje "integración contractual pendiente" en todo el archivo', () => {
    assert.doesNotMatch(codigo, /integración contractual pendiente/);
  });

  test("Reservar interno permanece bloqueado — computo.ts no se toca ni se importa la guardia con otro criterio", () => {
    const codigoComputo = sinComentarios(leer("lib/reservar/computo.ts"));
    assert.match(codigoComputo, /modeloRow\?\.modelo_tarifario === "unidad"/);
    assert.match(codigoComputo, /todavía no está integrada en Reservar/);
  });
});

describe("validarBernaloParaConversion — regla A: reliquidación autoritativa, nunca ReservaInput persona-shaped", () => {
  const cuerpo = cuerpoFuncion(fuente, "async function validarBernaloParaConversion(");

  test("llama computarReservaBernalo UNA sola vez — nunca ReservaInput/computarReserva para un ítem Bernalo", () => {
    const usos = [...cuerpo.matchAll(/computarReservaBernalo\(/g)];
    assert.equal(usos.length, 1, "computarReservaBernalo debe llamarse UNA sola vez");
    assert.doesNotMatch(cuerpo, /ReservaInput/);
    assert.doesNotMatch(cuerpo, /computarReserva\(/);
  });

  test("reconstruye SOLO las decisiones persistidas (paqueteId/hotelId/categoria/alimentacion/salida/habitaciones) — nunca precio/costo/snapshot como entrada", () => {
    const idxLlamada = cuerpo.indexOf("computarReservaBernalo({");
    const bloque = cuerpo.slice(idxLlamada, idxLlamada + 300);
    assert.match(bloque, /paqueteId: it\.paqueteId,/);
    assert.match(bloque, /hotelId: it\.hotelId,/);
    assert.match(bloque, /categoria: it\.categoria,/);
    assert.match(bloque, /alimentacion: it\.alimentacion,/);
    assert.match(bloque, /salida: it\.salida,/);
    assert.match(bloque, /habitaciones: it\.habitaciones,/);
    assert.doesNotMatch(bloque, /precio: it\.precio|costo|snapshot/i);
  });

  test("regla A.4: si el servicio interno rechaza (tarifa/salida/moneda/configuración inválida), bloquea con el mensaje real ANTES de cualquier otra validación", () => {
    const idxRechazo = cuerpo.indexOf("if (!resultado.ok)");
    const idxComparacionPrecio = cuerpo.indexOf("resultado.precioVenta !== it.precio");
    assert.notEqual(idxRechazo, -1);
    assert.ok(idxRechazo < idxComparacionPrecio, "el rechazo del servicio interno debe evaluarse antes de comparar el precio");
  });

  test("regla A.5: PVP recalculado ≠ PVP de la cotización → bloquea con mensaje de recotizar, NUNCA actualiza/convierte en silencio", () => {
    assert.match(cuerpo, /resultado\.precioVenta !== it\.precio/);
    const idxCmp = cuerpo.indexOf("resultado.precioVenta !== it.precio");
    const bloque = cuerpo.slice(idxCmp, idxCmp + 400);
    assert.match(bloque, /return \{\s*\n?\s*ok: false,/);
    assert.match(bloque, /recotiza/i);
    // Nunca hay un `it.precio = ` ni `.update(` en este bloque — el precio
    // persistido de la cotización jamás se sobreescribe desde acá.
    assert.doesNotMatch(bloque, /it\.precio\s*=|\.update\(/);
  });

  test("regla B.9.1: proveedor del HOTEL ausente bloquea — la vista previa tolera proveedorHotel:null, el contrato no", () => {
    assert.match(cuerpo, /if \(!resultado\.proveedorHotel\?\.nombre\)/);
    const idx = cuerpo.indexOf("if (!resultado.proveedorHotel?.nombre)");
    const bloque = cuerpo.slice(idx, idx + 300);
    assert.match(bloque, /return \{\s*\n?\s*ok: false,/);
  });

  test("regla B.9.2/B.11: cada servicio incluido con costoNeto>0 exige proveedor real — nunca \"Sin especificar\"", () => {
    const cuerpoSinComentarios = sinComentarios(cuerpo);
    assert.match(cuerpoSinComentarios, /s\.costoNeto > 0/);
    assert.doesNotMatch(cuerpoSinComentarios, /Sin especificar/);
    assert.match(cuerpoSinComentarios, /proveedoresServicios\.get\(s\.servicioId\)\?\.nombre/);
  });

  test("resuelve proveedores de servicios SERVER-SIDE (consulta servicios_adicionales/proveedores) — nunca del navegador/cotización", () => {
    assert.match(cuerpo, /from\("servicios_adicionales"\)/);
    assert.match(cuerpo, /proveedores\(nombre, aplica_retencion, pct_retencion\)/);
  });
});

describe("convertirCotizacionCarrito — Paso 1: despacha por modeloTarifario, arreglos separados persona/Bernalo", () => {
  const cuerpoConv = cuerpoFuncion(fuente, "export async function convertirCotizacionCarrito(");

  test('rama Bernalo ("unidad") se resuelve con validarBernaloParaConversion y hace `continue` — nunca cae al ReservaInput de persona', () => {
    const idxRama = cuerpoConv.indexOf('it.modeloTarifario === "unidad"');
    const idxReservaInput = cuerpoConv.indexOf("const reserva: ReservaInput = {", idxRama);
    assert.notEqual(idxRama, -1);
    assert.ok(idxRama < idxReservaInput);
    const bloque = cuerpoConv.slice(idxRama, idxReservaInput);
    // Cierre 3F-4B: gana un segundo argumento, la moneda declarada de la
    // cotización (regla 6).
    assert.match(bloque, /validarBernaloParaConversion\(it, cot\.moneda \?\? null\)/);
    assert.match(bloque, /continue;/);
  });

  test("reservasSillasDeGrupo SOLO recibe validadosPersona — Bernalo nunca participa en la reserva de sillas/inventario (regla A.8)", () => {
    const usos = [...cuerpoConv.matchAll(/reservasSillasDeGrupo\(([^,]+),/g)].map((m) => m[1].trim());
    assert.ok(usos.length >= 2, "reservasSillasDeGrupo debe llamarse en la prevalidación Y en la creación");
    for (const arg of usos) assert.equal(arg, "validadosPersona", `reservasSillasDeGrupo se llamó con "${arg}", debía ser "validadosPersona"`);
  });

  test("persona (validadosPersona) conserva la construcción de ReservaInput EXACTA de siempre — regla A.16", () => {
    const idxReservaInput = cuerpoConv.indexOf("const reserva: ReservaInput = {");
    const idxPush = cuerpoConv.indexOf("validadosPersona.push({ item: it, comp: comp.data });");
    const bloque = cuerpoConv.slice(idxReservaInput, idxPush + 60);
    assert.match(bloque, /paqueteId: it\.paqueteId, bloqueoId: it\.bloqueoId, modulo: it\.modulo, hotelId: it\.hotelId,/);
    assert.match(bloque, /const comp = await computarReserva\(sb, reserva\);/);
    assert.match(bloque, /validadosPersona\.push\(\{ item: it, comp: comp\.data \}\);/);
  });

  // ── Hallazgo confirmado P2-1: guarda de moneda también para ítems persona ──
  test("hallazgo confirmado (P2-1): compara comp.data.monedaReserva contra cot.moneda para ítems PERSONA — bloquea ANTES de acumular en validadosPersona si difieren", () => {
    const idxComp = cuerpoConv.indexOf("const comp = await computarReserva(sb, reserva);");
    const idxPush = cuerpoConv.indexOf("validadosPersona.push({ item: it, comp: comp.data });");
    assert.ok(idxComp > -1 && idxComp < idxPush);
    const bloque = cuerpoConv.slice(idxComp, idxPush);
    assert.match(bloque, /if \(cot\.moneda && comp\.data\.monedaReserva !== cot\.moneda\)/, "falta la guarda de moneda para ítems persona");
    const idxGuardMoneda = bloque.indexOf("if (cot.moneda && comp.data.monedaReserva !== cot.moneda)");
    const bloqueGuard = bloque.slice(idxGuardMoneda, idxGuardMoneda + 300);
    assert.match(bloqueGuard, /return \{\s*\n?\s*ok: false,/, "debe bloquear (ok:false), nunca continuar con la moneda mezclada");
    assert.match(bloqueGuard, /recotiza/i, "debe pedir recotizar, mismo criterio que Bernalo");
    // `bloque` ya está acotado a [idxComp, idxPush) — que la guarda se haya
    // encontrado DENTRO de `bloque` (arriba) ya demuestra que se evalúa
    // ANTES de `validadosPersona.push` (nunca después, que dejaría al ítem
    // contribuir a precioTotal/monedaGrupo antes de rechazar la operación).
  });

  test("hallazgo confirmado (P2-1): el mensaje de recotización de persona es equivalente al de Bernalo (mismo patrón \"antes X, ahora Y\")", () => {
    const cuerpoValidarBernalo = cuerpoFuncion(fuente, "async function validarBernaloParaConversion(");
    const idxMensajeBernalo = cuerpoValidarBernalo.indexOf("el precio cambió desde que se generó la cotización");
    assert.notEqual(idxMensajeBernalo, -1);
    assert.match(codigo, /la moneda cambió desde que se generó la cotización \(antes \$\{cot\.moneda\}, ahora \$\{comp\.data\.monedaReserva\}\)\. Vuelve al tarifario, recotiza y genera una nueva cotización antes de convertir\./);
  });
});

describe("convertirCotizacionCarrito — Paso 2: creación de contrato Bernalo", () => {
  const cuerpoConv = cuerpoFuncion(fuente, "export async function convertirCotizacionCarrito(");
  const idxLoopBernalo = cuerpoConv.indexOf("for (let bIdx = 0; bIdx < validadosBernalo.length; bIdx++)");
  const idxLoopTours = cuerpoConv.indexOf("if (grupo.tours.length) {", idxLoopBernalo);
  const loopBernalo = cuerpoConv.slice(idxLoopBernalo, idxLoopTours);

  test("regla C.12: ventas.precio_venta se arma sumando validadosPersona + validadosBernalo + tours (precioTotal)", () => {
    assert.match(codigo, /const precioTotal = validadosPersona\.reduce\(\(s, v\) => s \+ v\.comp\.precioVenta, 0\)/);
    assert.match(codigo, /validadosBernalo\.reduce\(\(s, v\) => s \+ v\.resultado\.precioVenta, 0\)/);
    assert.match(codigo, /precio_venta: precioTotal,/);
  });

  test("regla D.17/19: inserta contrato_alojamiento_bernalo (UNA fila por habitación) usando `admin` (service-role) — nunca `sb`", () => {
    assert.match(loopBernalo, /admin\.from\("contrato_alojamiento_bernalo"\)\.insert\(filasSnapshot\)/);
    assert.doesNotMatch(loopBernalo, /sb\.from\("contrato_alojamiento_bernalo"\)/);
  });

  test("regla D.18: el snapshot insertado sale de resultado.habitaciones[].snapshot (servidor) — nunca de it/payload de cotización", () => {
    assert.match(loopBernalo, /snapshot: h\.snapshot as unknown as Json,/);
    assert.match(loopBernalo, /resultado\.habitaciones\.map\(\(h, i\) => \(\{/);
  });

  test("regla D.21: fallarYRevertirGrupo se invoca si falla el insert de contrato_alojamiento_bernalo/contrato_items/contrato_hoteles/contrato_vuelos de Bernalo", () => {
    assert.match(loopBernalo, /if \(eHotelB\) return fallarYRevertirGrupo\(/);
    assert.match(loopBernalo, /if \(eSnap\) return fallarYRevertirGrupo\(/);
    assert.match(loopBernalo, /if \(eItemB\) return fallarYRevertirGrupo\(/);
    assert.match(loopBernalo, /if \(eVueloB\) return fallarYRevertirGrupo\(/);
  });

  test("regla C.13/14: UNA línea contrato_items con modo_precio:'total' y valor_total:resultado.precioVenta — adultos/ninos/tarifas en 0", () => {
    const idxItem = loopBernalo.indexOf('sb.from("contrato_items").insert({');
    const bloque = loopBernalo.slice(idxItem, idxItem + 400);
    assert.match(bloque, /adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0,/);
    assert.match(bloque, /modo_precio: "total", valor_total: resultado\.precioVenta,/);
  });

  test('regla C.13: la descripción es UNA línea agregada — no genera una fila por habitación en contrato_items', () => {
    const usosInsertItems = [...loopBernalo.matchAll(/contrato_items"\)\.insert\(/g)];
    assert.equal(usosInsertItems.length, 1, "solo debe haber UN insert de contrato_items en la rama Bernalo");
  });

  test("regla E.22: costo_hotel se acumula desde resultado.costoHotelTotal (única fuente, sin reimplementar la suma)", () => {
    assert.match(loopBernalo, /costoHotelTotal \+= resultado\.costoHotelTotal;/);
  });

  test("regla E.23: CxP hotelera es UNA sola fila (una llamada a pushCxP(\"hotel\"...)) por costoHotelTotal completo — nunca por habitación", () => {
    const usosHotel = [...loopBernalo.matchAll(/pushCxP\("hotel",/g)];
    assert.equal(usosHotel.length, 1);
    assert.match(loopBernalo, /pushCxP\("hotel", `Hotel \$\{resultado\.hotelNombre\}`\.trim\(\), resultado\.costoHotelTotal,/);
  });

  // ── Cierre 3F-4B, prueba obligatoria (a): rVuelo.ok=false ──────────────
  test("hallazgo confirmado (a): si datosVueloBloqueo/datosVueloEmpaquetado devuelve ok:false, FALLA y revierte el contrato — nunca best-effort/omite en silencio", () => {
    const idxVuelo = loopBernalo.indexOf("resultado.salida.tipo ===");
    const idxCosto = loopBernalo.indexOf("costoAereoTotal += costoVueloReal;");
    const bloqueVuelo = loopBernalo.slice(idxVuelo, idxCosto);
    assert.match(bloqueVuelo, /if \(!rVuelo\.ok\) return fallarYRevertirGrupo\(/, "un origen de vuelo que no se pueda leer debe abortar TODO el contrato");
    // Nunca debe quedar un `if (rVuelo.ok) { ... }` que deje pasar de largo
    // silenciosamente el caso contrario (el patrón best-effort que existía
    // antes de este cierre).
    assert.doesNotMatch(bloqueVuelo, /if \(rVuelo\.ok\) \{/);
  });

  // ── Cierre 3F-4B, hallazgo confirmado: fórmula real de costo/CxP aérea ──
  test("hallazgo confirmado: CxP aérea/costo_aereo = dv.costo_neto × paxConSilla + dv.fee_infante × infantes — nunca resultado.costoVueloTotal", () => {
    assert.match(loopBernalo, /await datosVueloBloqueo\(admin, resultado\.salida\.id\)/);
    assert.match(loopBernalo, /await datosVueloEmpaquetado\(admin, resultado\.salida\.id\)/);
    assert.match(loopBernalo, /const infantesBernalo = resultado\.paxTotal - resultado\.paxConSilla;/);
    assert.match(loopBernalo, /const costoVueloReal = dv\.costo_neto \* resultado\.paxConSilla \+ dv\.fee_infante \* infantesBernalo;/);
    assert.match(loopBernalo, /costoAereoTotal \+= costoVueloReal;/);
    assert.match(loopBernalo, /pushCxP\("aereo", `Aéreo \$\{dv\.aerolinea/);
    assert.match(loopBernalo, /pushCxP\("aereo",[\s\S]{0,40}costoVueloReal,/);
    assert.doesNotMatch(sinComentarios(loopBernalo), /pushCxP\("aereo",[\s\S]{0,60}resultado\.costoVueloTotal/, "la CxP aérea nunca debe volver a usar resultado.costoVueloTotal");
  });

  test('regla F/D: "sin_vuelo" nunca entra al bloque de vuelo (solo tipo bloqueo/empaquetado)', () => {
    assert.match(loopBernalo, /resultado\.salida\.tipo === "bloqueo" \|\| resultado\.salida\.tipo === "empaquetado"/);
    const idxIf = loopBernalo.indexOf('resultado.salida.tipo === "bloqueo" || resultado.salida.tipo === "empaquetado"');
    const idxCierre = loopBernalo.indexOf("costoHotelTotal += resultado.costoHotelTotal;");
    const bloqueVuelo = loopBernalo.slice(idxIf, idxCierre);
    assert.doesNotMatch(bloqueVuelo, /"sin_vuelo"/);
  });

  test("hallazgo confirmado: validarBernaloParaConversion bloquea CUALQUIER salida distinta de sin_vuelo (sin integración de sillas todavía) — nunca sobreventa silenciosa", () => {
    const cuerpoValidar = cuerpoFuncion(fuente, "async function validarBernaloParaConversion(");
    assert.match(cuerpoValidar, /if \(resultado\.salida\.tipo !== "sin_vuelo"\) \{/);
    const idx = cuerpoValidar.indexOf('if (resultado.salida.tipo !== "sin_vuelo")');
    const bloque = cuerpoValidar.slice(idx, idx + 500);
    assert.match(bloque, /return \{\s*\n?\s*ok: false,/);
    assert.match(bloque, /sobreventa/);
  });

  test("regla E.25: cada servicio incluido con costoNeto>0 genera su PROPIA CxP con servicio_id — nunca se absorbe en el hotel", () => {
    assert.match(loopBernalo, /for \(const s of resultado\.serviciosIncluidos\) \{/);
    assert.match(loopBernalo, /pushCxP\(tipoProveedorCxpServicio\(s\.categoria\), s\.nombre, s\.costoNeto, proveedoresServicios\.get\(s\.servicioId\) \?\? null, null, s\.servicioId, resultado\.moneda\);/);
  });

  test("regla E.28: CxP hotel/vuelo/servicios de Bernalo SIEMPRE pasan resultado.moneda explícito a pushCxP — nunca dependen del default", () => {
    // Extrae cada llamada `pushCxP(...)` balanceando paréntesis reales (los
    // argumentos incluyen sus propias llamadas anidadas — `.trim()`,
    // `${...}`, `.get(...)` — así que un simple `[^)]*` corta en el primer
    // paréntesis interno).
    const llamadas: string[] = [];
    let cursor = 0;
    while (true) {
      const idxInicio = loopBernalo.indexOf("pushCxP(", cursor);
      if (idxInicio === -1) break;
      let profundidad = 0;
      let idxFin = -1;
      for (let i = idxInicio + "pushCxP".length; i < loopBernalo.length; i++) {
        if (loopBernalo[i] === "(") profundidad++;
        else if (loopBernalo[i] === ")") {
          profundidad--;
          if (profundidad === 0) { idxFin = i; break; }
        }
      }
      assert.notEqual(idxFin, -1, "no se encontró el cierre de una llamada pushCxP");
      llamadas.push(loopBernalo.slice(idxInicio, idxFin + 1));
      cursor = idxFin + 1;
    }
    assert.ok(llamadas.length >= 2, "debe haber al menos 2 llamadas a pushCxP en la rama Bernalo (hotel + al menos otra)");
    for (const llamada of llamadas) {
      assert.match(llamada, /resultado\.moneda\)$/, `pushCxP en la rama Bernalo debe terminar pasando resultado.moneda: ${llamada}`);
    }
  });

  test("regla D.20: incluidosGrupo (snapshot persistido) EXCLUYE paqueteId de ítems Bernalo — nunca cuenta dos veces sus servicios incluidos", () => {
    assert.match(codigo, /it\.modeloTarifario !== "unidad" && it\.paqueteId === s\.paqueteId/);
  });
});

describe("lib/reservar/financieroContrato.ts — CxPFinanciera.moneda (regla E.28)", () => {
  const fuenteFin = leer("lib/reservar/financieroContrato.ts");

  test("el tipo declara moneda?: string, opcional (persona sigue sin mandarla — regla A.16)", () => {
    const tipo = fuenteFin.slice(fuenteFin.indexOf("export type CxPFinanciera"), fuenteFin.indexOf("export type CostosContrato"));
    assert.match(tipo, /moneda\?: string;/);
  });
});

describe("lib/contrato/valorContratoItem.ts / ContratoDocumento.tsx — regla C.15/F.31", () => {
  const fuenteDoc = leer("components/contrato/ContratoDocumento.tsx");
  const codigoDoc = sinComentarios(fuenteDoc);

  test("el total y las tablas de línea usan valorVisibleContratoItem/totalVisibleContratoItems — ya no queda la fórmula inline vieja", () => {
    assert.doesNotMatch(codigoDoc, /it\.adultos \* it\.tarifa_adulto \+ it\.ninos \* it\.tarifa_nino/);
    assert.match(codigoDoc, /totalVisibleContratoItems\(items\)/);
    // Cierre 3F-4B: 3 usos — la fila agregada limpia de modo_precio="total"
    // (regla F.5), la tabla per-cápita de alojamiento y la de servicios.
    const usosPorLinea = [...codigoDoc.matchAll(/valorVisibleContratoItem\(it\)/g)];
    assert.equal(usosPorLinea.length, 3, "las 3 superficies (línea total agregada + tabla alojamiento + tabla servicios) deben usar el helper por línea");
  });

  test("regla F.5 (cierre 3F-4B): las líneas modo_precio='total' se separan (alojItemsTotal) de las per-cápita (alojItemsPorPersona) — nunca en la misma tabla con Adultos 0/Niños 0/Tarifa $0", () => {
    assert.match(codigoDoc, /const alojItemsTotal = alojItems\.filter\(\(it\) => it\.modo_precio === "total"\);/);
    assert.match(codigoDoc, /const alojItemsPorPersona = alojItems\.filter\(\(it\) => it\.modo_precio !== "total"\);/);
    // La tabla per-cápita (Adultos/Niños/Tarifa Adulto/Tarifa Niño) ahora
    // itera SOLO sobre alojItemsPorPersona, nunca sobre alojItems crudo.
    assert.match(codigoDoc, /\{alojItemsPorPersona\.map\(\(it\) =>/);
    assert.doesNotMatch(codigoDoc, /\{alojItems\.map\(\(it\) =>/);
  });

  test("regla F.32/33/34: sección de habitacionesBernalo existe, muestra hotel/categoría/alimentación/adultos/edades — nunca un campo financiero/snapshot", () => {
    assert.match(codigoDoc, /habitacionesBernalo\.map\(\(h\) =>/);
    assert.doesNotMatch(codigoDoc, /h\.snapshot|h\.neto|h\.bruto|h\.comision/i);
  });
});

describe("lib/reservar/alojamientoBernaloDocumento.ts — regla D.19/20: frontera service-role, SELECT sanitizado", () => {
  const fuenteLoader = leer("lib/reservar/alojamientoBernaloDocumento.ts");
  const codigoLoader = sinComentarios(fuenteLoader);

  test("usa createAdminClient (service-role) — la tabla no tiene ninguna policy", () => {
    assert.match(codigoLoader, /createAdminClient\(\)/);
  });

  test("el SELECT nunca pide snapshot ni hotel_id — regla F.34, nunca expone datos privados", () => {
    const idxSelect = codigoLoader.indexOf(".select(");
    const bloque = codigoLoader.slice(idxSelect, idxSelect + 200);
    assert.doesNotMatch(bloque, /snapshot|hotel_id/);
    assert.match(bloque, /habitacion_id, orden, hotel_nombre, categoria, alimentacion, adultos, edades_menores/);
  });
});

describe("app/contrato/[numero]/page.tsx y app/c/[token]/page.tsx — cablean habitacionesBernaloDeContrato DESPUÉS de autorizar (regla D.19)", () => {
  for (const ruta of ["app/contrato/[numero]/page.tsx", "app/c/[token]/page.tsx"]) {
    test(`${ruta}: importa y pasa habitacionesBernalo a ContratoDocumento`, () => {
      const f = leer(ruta);
      assert.match(f, /import \{ habitacionesBernaloDeContrato \} from "@\/lib\/reservar\/alojamientoBernaloDocumento";/);
      assert.match(f, /habitacionesBernaloDeContrato\(numero\)/);
      assert.match(f, /habitacionesBernalo=\{habitacionesBernalo\}/);
    });
  }
});

// ── Cierre 3F-4B, hallazgo confirmado: guarda de moneda (regla 6) ─────────
describe("validarBernaloParaConversion — hallazgo confirmado: compara también la moneda declarada de la cotización, nunca solo el precio numérico", () => {
  const cuerpo = cuerpoFuncion(fuente, "async function validarBernaloParaConversion(");

  test("recibe monedaCotizacion como segundo parámetro y compara resultado.moneda contra ella", () => {
    assert.match(fuente, /async function validarBernaloParaConversion\(\s*\n\s*it: ItemCarritoBernaloConAsignacion,\s*\n\s*monedaCotizacion: string \| null/);
    assert.match(cuerpo, /if \(monedaCotizacion && resultado\.moneda !== monedaCotizacion\)/);
  });

  test("el bloqueo de moneda ocurre DESPUÉS del de precio y ANTES de los de proveedor — mismo patrón fail-closed", () => {
    const idxPrecio = cuerpo.indexOf("resultado.precioVenta !== it.precio");
    const idxMoneda = cuerpo.indexOf("resultado.moneda !== monedaCotizacion");
    const idxProveedor = cuerpo.indexOf("resultado.proveedorHotel?.nombre");
    assert.ok(idxPrecio < idxMoneda && idxMoneda < idxProveedor);
  });

  test("convertirCotizacionCarrito consulta cotizaciones.moneda y la pasa al validar cada ítem Bernalo", () => {
    assert.match(codigo, /\.select\("id, estado, tipo, payload, tenant, numero_contrato, detalle, moneda"\)/);
    assert.match(codigo, /validarBernaloParaConversion\(it, cot\.moneda \?\? null\)/);
  });
});

// ── Cierre 3F-4B, prueba obligatoria (e): reintento parcial multi-grupo ────
describe("convertirCotizacionCarrito — hallazgo confirmado (e): idempotencia — ni la cotización completa ni un grupo individual se duplican en un reintento", () => {
  const cuerpoConv = cuerpoFuncion(fuente, "export async function convertirCotizacionCarrito(");

  test('guarda temprano: si cot.estado === "convertida", devuelve los números YA generados (detalle.contratos o numero_contrato) — nunca vuelve a crear nada', () => {
    const idxGuard = cuerpoConv.indexOf('if (cot.estado === "convertida")');
    const idxDescartada = cuerpoConv.indexOf('if (cot.estado === "descartada")');
    const idxPaso1 = cuerpoConv.indexOf("const gruposValidados:");
    assert.notEqual(idxGuard, -1);
    assert.ok(idxGuard < idxDescartada && idxDescartada < idxPaso1, "el guard de idempotencia debe evaluarse ANTES de cualquier validación/escritura");
    const bloque = cuerpoConv.slice(idxGuard, idxDescartada);
    assert.match(bloque, /return \{ ok: true, numeros: contratosPrevios \};/);
    assert.match(bloque, /return \{ ok: true, numeros: \[cot\.numero_contrato\] \};/);
  });

  test("ronda 2 — regla (2): un grupo ya presente en contratosPorGrupo se SALTA de gruposPendientes ANTES de Paso 1 (reliquidar/validar) — nunca solo antes de escribir", () => {
    const idxContratosPorGrupo = cuerpoConv.indexOf("const contratosPorGrupo: Record<string, string> = { ...contratosPorGrupoExistente };");
    const idxGruposPendientes = cuerpoConv.indexOf("const gruposPendientes = grupos.filter((g) => !contratosPorGrupo[claveDeGrupo(g)]);");
    const idxPaso1Loop = cuerpoConv.indexOf("for (const grupo of gruposPendientes) {");
    const idxValidarBernalo = cuerpoConv.indexOf("await validarBernaloParaConversion(it, cot.moneda ?? null)");
    assert.notEqual(idxContratosPorGrupo, -1);
    assert.notEqual(idxGruposPendientes, -1);
    assert.ok(
      idxContratosPorGrupo < idxGruposPendientes && idxGruposPendientes < idxPaso1Loop && idxPaso1Loop < idxValidarBernalo,
      "gruposPendientes debe calcularse ANTES del loop de Paso 1, y Paso 1 (reliquidación) debe iterar SOLO gruposPendientes"
    );
    // El loop de Paso 1 (validación/reliquidación) itera `gruposPendientes`
    // — NUNCA `grupos` crudo (que incluiría grupos ya convertidos).
    assert.doesNotMatch(cuerpoConv.slice(idxPaso1Loop, idxPaso1Loop + 30), /for \(const grupo of grupos\) \{/);
  });

  test("ronda 2: numeros[] se siembra con los contratos ya existentes ANTES de Paso 1 — un grupo completo nunca bloquea el retry por precio/moneda/proveedor cambiados después", () => {
    const idxSiembra = cuerpoConv.indexOf("if (numeroExistente) numeros.push(numeroExistente);");
    const idxPaso1Loop = cuerpoConv.indexOf("for (const grupo of gruposPendientes) {");
    assert.notEqual(idxSiembra, -1);
    assert.ok(idxSiembra < idxPaso1Loop, "los números ya existentes deben sembrarse antes de que Paso 1 revalide nada");
    // El loop de creación (Paso 2) ya NO tiene el chequeo redundante — un
    // grupo completo nunca llega hasta `gruposValidados` en absoluto.
    assert.doesNotMatch(sinComentarios(cuerpoConv), /if \(numeroExistente\) \{/);
  });

  test("la clave de grupo es grupo.destino (estable entre reintentos porque el payload no cambia) — nunca el índice de iteración", () => {
    assert.match(cuerpoConv, /const claveDeGrupo = \(g: Grupo\) => g\.destino \?\? "__sin_destino__";/);
  });

  test("el progreso se persiste EN CADA grupo completado (no solo al final) — contratosPorGrupo[claveGrupo] se escribe justo después de numeros.push(numero) y ANTES del siguiente número de contrato", () => {
    const idxPush = cuerpoConv.indexOf("numeros.push(numero);");
    assert.notEqual(idxPush, -1);
    const idxAsigna = cuerpoConv.indexOf("contratosPorGrupo[claveGrupo] = numero;", idxPush);
    assert.notEqual(idxAsigna, -1, "no asigna contratosPorGrupo[claveGrupo] justo después de push(numero)");
    assert.ok(idxAsigna > idxPush && idxAsigna < idxPush + 700, "la asignación de progreso debe ir INMEDIATAMENTE después de numeros.push(numero)");
    const usos = [...codigo.matchAll(/contratos: numeros, contratosPorGrupo, agrupar: opts\.agrupar/g)];
    assert.equal(usos.length, 2, "debe existir el update DENTRO del loop (por grupo) y el update FINAL (fuera del loop)");
  });

  test("ronda 2 — regla (1): el update por-grupo revisa error y CORTA (ok:false) si falla — nunca sigue como si el progreso fuera durable", () => {
    const idxAsigna = cuerpoConv.indexOf("contratosPorGrupo[claveGrupo] = numero;");
    const idxUpdate = cuerpoConv.indexOf('const { error: eDetalleGrupo } = await sb.from("cotizaciones").update({', idxAsigna);
    assert.notEqual(idxUpdate, -1, "el update por-grupo debe capturar el error (const { error: ... })");
    const idxIfError = cuerpoConv.indexOf("if (eDetalleGrupo) {", idxUpdate);
    assert.notEqual(idxIfError, -1);
    const bloque = cuerpoConv.slice(idxIfError, idxIfError + 300);
    assert.match(bloque, /return \{\s*\n?\s*ok: false,/);
  });

  test("ronda 2 — regla (1): el update FINAL (cierre de la cotización) también revisa error y corta — nunca reporta éxito si no se pudo cerrar el estado", () => {
    const idxUpdateFinal = cuerpoConv.indexOf('const { error: eDetalleFinal } = await sb.from("cotizaciones").update({');
    assert.notEqual(idxUpdateFinal, -1, "el update final debe capturar el error (const { error: ... })");
    const idxIfError = cuerpoConv.indexOf("if (eDetalleFinal) {", idxUpdateFinal);
    assert.notEqual(idxIfError, -1);
    const bloque = cuerpoConv.slice(idxIfError, idxIfError + 300);
    assert.match(bloque, /return \{\s*\n?\s*ok: false,/);
  });

  test("nunca duplica sillas/CxP para un grupo ya completo: la exclusión ocurre en Paso 1 (gruposPendientes), ANTES de crear_pasajeros_contrato_multi/registrarFinancieroContrato", () => {
    const idxGruposPendientes = cuerpoConv.indexOf("const gruposPendientes = grupos.filter((g) => !contratosPorGrupo[claveDeGrupo(g)]);");
    const idxMulti = cuerpoConv.indexOf('admin.rpc("crear_pasajeros_contrato_multi"');
    const idxFinanciero = cuerpoConv.indexOf("await registrarFinancieroContrato(");
    assert.ok(idxGruposPendientes > -1 && idxGruposPendientes < idxMulti && idxGruposPendientes < idxFinanciero);
  });
});

// ── Ronda 2, regla (3): proteger cambio de opts.agrupar entre intentos ────
describe("convertirCotizacionCarrito — hallazgo confirmado: reintentar con un modo de agrupación distinto se rechaza (nunca reconcilia las dos agrupaciones)", () => {
  const cuerpoConv = cuerpoFuncion(fuente, "export async function convertirCotizacionCarrito(");

  test("detalleExistente declara agrupar?: string y el guard compara contra opts.agrupar ANTES de construir los grupos", () => {
    assert.match(codigo, /const detalleExistente = \(cot\.detalle \?\? \{\}\) as \{ contratos\?: unknown; contratosPorGrupo\?: Record<string, string>; agrupar\?: string \};/);
    const idxGuard = cuerpoConv.indexOf("detalleExistente.agrupar !== opts.agrupar");
    const idxGrupos = cuerpoConv.indexOf("let grupos: Grupo[];");
    assert.notEqual(idxGuard, -1);
    assert.ok(idxGuard < idxGrupos, "el guard de modo de agrupación debe evaluarse ANTES de construir los grupos (que ya dependen de opts.agrupar)");
  });

  test("el guard solo bloquea si YA hay progreso real (contratosPorGrupo no vacío) — una cotización sin ningún grupo convertido puede elegir cualquier modo libremente", () => {
    const idxGuard = cuerpoConv.indexOf("if (Object.keys(contratosPorGrupoExistente).length > 0");
    assert.notEqual(idxGuard, -1);
    const bloque = cuerpoConv.slice(idxGuard, idxGuard + 400);
    assert.match(bloque, /return \{\s*\n?\s*ok: false,/);
  });

  test("el modo usado se persiste (agrupar: opts.agrupar) en CADA escritura de detalle — por grupo y al cierre", () => {
    const usos = [...codigo.matchAll(/agrupar: opts\.agrupar/g)];
    assert.equal(usos.length, 2, "agrupar: opts.agrupar debe escribirse en los 2 updates (por grupo + final)");
    // El guard de comparación (arriba) sí usa el valor, aunque con otra
    // sintaxis (`detalleExistente.agrupar !== opts.agrupar`) — ya cubierto
    // por el test anterior.
    assert.match(codigo, /detalleExistente\.agrupar !== opts\.agrupar/);
  });
});
