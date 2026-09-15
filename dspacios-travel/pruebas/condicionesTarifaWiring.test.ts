import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// "Condiciones de la tarifa" (Dubai → cotización/contrato) — verificación
// por inspección de fuente de los puntos que no son testeables como función
// pura (I/O de Supabase, JSX/React sin testing-library en este repo). Mismo
// criterio que el resto de "wiring tests" del proyecto.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const computo = readFileSync(join(raiz, "lib/reservar/computo.ts"), "utf8");
const checkout = readFileSync(join(raiz, "app/tarifario/checkout/actions.ts"), "utf8");
const contratoDoc = readFileSync(join(raiz, "components/contrato/ContratoDocumento.tsx"), "utf8");
const cotizacionPage = readFileSync(join(raiz, "app/cotizacion/[id]/page.tsx"), "utf8");
const cotTokenPage = readFileSync(join(raiz, "app/cot/[token]/page.tsx"), "utf8");
const contratoPage = readFileSync(join(raiz, "app/contrato/[numero]/page.tsx"), "utf8");
const cTokenPage = readFileSync(join(raiz, "app/c/[token]/page.tsx"), "utf8");
const reservarActions = readFileSync(join(raiz, "app/(dashboard)/dashboard/reservar/actions.ts"), "utf8");
const types = readFileSync(join(raiz, "types/database.ts"), "utf8");

describe("computo.ts — reusa temporadasTarifaPorAcom, nunca una resolución paralela", () => {
  test("ambas ramas seleccionan 'notas' de tarifa_hotel junto con las columnas de edad (mismo query, sin consulta extra)", () => {
    const ocurrencias = computo.match(/notas/g) ?? [];
    assert.ok(ocurrencias.length >= 2);
    // Confirma explícitamente que el select de tarifa_hotel en cada rama
    // incluye "notas" (búsqueda más laxa por si el formato cambia de línea).
    const selectsSueltos = computo.split('.from("tarifa_hotel")').slice(1);
    assert.equal(selectsSueltos.length, 2, "deben existir exactamente 2 consultas a tarifa_hotel (rama usarFechas y rama tarifario_resultado)");
    for (const bloque of selectsSueltos) {
      assert.match(bloque.slice(0, 400), /notas/, "el select inmediatamente después de .from(\"tarifa_hotel\") debe incluir 'notas'");
    }
  });

  test("extraerCondicionesTarifa se invoca exactamente 2 veces (una por rama), reusando temporadasSeleccionadasF/temporadasEstadia — los MISMOS sets que resolverReglaEdadEstadiaSegura", () => {
    const usos = computo.match(/extraerCondicionesTarifa\(/g) ?? [];
    assert.equal(usos.length, 2);
    // Rama usarFechas: mismo set `temporadasSeleccionadasF` en ambas llamadas.
    const posRamaF = computo.indexOf("resolverReglaEdadEstadiaSegura({");
    const posCondF = computo.indexOf("extraerCondicionesTarifa({", posRamaF);
    const bloqueF = computo.slice(posRamaF, posCondF + 300);
    const ocurrenciasSetF = bloqueF.match(/temporadasSeleccionadasF/g) ?? [];
    assert.ok(ocurrenciasSetF.length >= 2, "ambas llamadas (edad y condiciones) deben reusar temporadasSeleccionadasF en la rama usarFechas");

    // Rama tarifario_resultado: mismo set `temporadasEstadia`.
    const posRamaB = computo.indexOf("resolverReglaEdadEstadiaSegura({", posCondF);
    const posCondB = computo.indexOf("extraerCondicionesTarifa({", posRamaB);
    const bloqueB = computo.slice(posRamaB, posCondB + 300);
    const ocurrenciasSetB = bloqueB.match(/temporadasEstadia/g) ?? [];
    assert.ok(ocurrenciasSetB.length >= 2, "ambas llamadas (edad y condiciones) deben reusar temporadasEstadia en la rama tarifario_resultado");
  });

  test("ComputoReserva.condicionesTarifa es SIEMPRE un arreglo (tipo sin '?' ni '| null' en la declaración del campo)", () => {
    assert.match(computo, /condicionesTarifa: CondicionTarifaAplicada\[\];/);
  });

  test("el valor de retorno final incluye condicionesTarifa", () => {
    const posReturn = computo.lastIndexOf("data: {");
    const bloque = computo.slice(posReturn, posReturn + 500);
    assert.match(bloque, /condicionesTarifa/);
  });
});

function posicionesHotelesSnapPush(): number[] {
  return [...checkout.matchAll(/hotelesSnap\.push\(\{/g)].map((m) => m.index as number);
}

describe("checkout/actions.ts (crearCotizacionCarrito) — referencia estable server-side, NUNCA confiada del navegador", () => {
  test("el bucle recorre input.items por índice (posOriginal), nunca `for (const it of input.items)` sin índice", () => {
    assert.match(checkout, /for \(let posOriginal = 0; posOriginal < input\.items\.length; posOriginal\+\+\) \{/);
    assert.match(checkout, /const it = input\.items\[posOriginal\];/);
  });

  test("`ref` se deriva de posOriginal (posición ya validada por validarCrearSolicitudInput), NUNCA de un campo enviado por el navegador (it.ref/it.itemId)", () => {
    const posRef = checkout.indexOf("const ref = `item-${posOriginal}`;");
    assert.notEqual(posRef, -1, "debe existir la construcción `const ref = \\`item-${posOriginal}\\`;`");
    assert.doesNotMatch(checkout, /const ref = it\.ref/);
    assert.doesNotMatch(checkout, /const ref = it\.itemId/);
  });

  test("ambos hotelesSnap.push(...) (Bernalo y persona) incluyen `ref` — misma referencia disponible en detalle.hoteles[] para ambos modelos", () => {
    const [posBernaloPush, posPersonaPush] = posicionesHotelesSnapPush();
    const posCierreBernalo = checkout.indexOf("});", posBernaloPush);
    const posCierrePersona = checkout.indexOf("});", posPersonaPush);
    assert.match(checkout.slice(posBernaloPush, posCierreBernalo), /id: hIdx, ref,/);
    assert.match(checkout.slice(posPersonaPush, posCierrePersona), /id: hIdx, ref,/);
  });

  test("itemsOk/itemsBernaloOk (payload.items) también llevan `ref` — la MISMA referencia en ambas superficies del snapshot (detalle.hoteles[] y payload.items[])", () => {
    assert.match(checkout, /itemsOk\.push\(\{ \.\.\.it, ref,/);
    assert.match(checkout, /modeloTarifario: "unidad", ref,/);
  });
});

describe("checkout/actions.ts (crearCotizacionCarrito) — condiciones solo en hoteles PERSONA, nunca Bernalo", () => {
  test("hay exactamente 2 hotelesSnap.push(...) en el archivo (Bernalo y persona)", () => {
    assert.equal(posicionesHotelesSnapPush().length, 2);
  });

  test("el bloque Bernalo (primer hotelesSnap.push, modeloTarifario === 'unidad') NUNCA escribe condiciones_tarifa", () => {
    const [posBernaloPush] = posicionesHotelesSnapPush();
    const posCierre = checkout.indexOf("});", posBernaloPush);
    const bloqueBernalo = checkout.slice(posBernaloPush, posCierre);
    assert.match(bloqueBernalo, /resultadoBernalo\.hotelNombre/, "confirma que este es en efecto el bloque Bernalo");
    assert.doesNotMatch(bloqueBernalo, /condiciones_tarifa/, "Bernalo no debe recibir condiciones Dubai por accidente");
  });

  test("el bloque PERSONA (segundo hotelesSnap.push) sí escribe condiciones_tarifa, tomado de comp.data.condicionesTarifa (destructurado de computarReserva)", () => {
    assert.match(checkout, /const \{ meta, precioVenta, monedaReserva, lineasHab, pvpPorAcom, numNinos, numNinos2, numInfantes, totalPax, distribucionMenores, edadesMenoresUsadas, serviciosIncluidos, condicionesTarifa \} = comp\.data;/);
    const [, posPersonaPush] = posicionesHotelesSnapPush();
    const posCierre = checkout.indexOf("});", posPersonaPush);
    const bloquePersona = checkout.slice(posPersonaPush, posCierre);
    assert.match(bloquePersona, /meta\.hotel_nombre/, "confirma que este es en efecto el bloque persona");
    assert.match(bloquePersona, /condiciones_tarifa: condicionesTarifa,/);
  });

  test("condiciones_tarifa NUNCA aparece junto a un campo de costo/neto/comisión/proveedor en la misma entrada de hotelesSnap (sin fuga de datos privados)", () => {
    const [, posPersonaPush] = posicionesHotelesSnapPush();
    const posCierre = checkout.indexOf("});", posPersonaPush);
    const bloquePersona = checkout.slice(posPersonaPush, posCierre);
    for (const campoProhibido of ["costo", "neto", "comision", "comisión", "proveedor_id"]) {
      assert.doesNotMatch(bloquePersona.toLowerCase(), new RegExp(campoProhibido.toLowerCase()), `hotelesSnap (persona) no debe exponer '${campoProhibido}'`);
    }
  });
});

describe("ContratoDocumento.tsx — sección sobria, solo cuando hay condiciones, sin exponer campos privados", () => {
  test("el tipo HotelConNota declara condiciones_tarifa como OPCIONAL (compatibilidad histórica: contratos/cotizaciones sin el campo no rompen)", () => {
    assert.match(contratoDoc, /condiciones_tarifa\?: CondicionTarifaAplicada\[\] \| null;/);
  });

  test("el render de la sección está condicionado a longitud > 0 (nunca se muestra un encabezado vacío)", () => {
    assert.match(contratoDoc, /\{h\.condiciones_tarifa && h\.condiciones_tarifa\.length > 0 && \(/);
  });

  test("CondicionesTarifaSection solo renderiza { texto, temporadas } — ningún campo financiero", () => {
    const posFn = contratoDoc.indexOf("function CondicionesTarifaSection");
    assert.notEqual(posFn, -1);
    const cuerpoFn = contratoDoc.slice(posFn, posFn + 900);
    for (const campoProhibido of ["costo", "neto", "comision", "comisión", "proveedor", "hotel_id", "hotelid"]) {
      assert.doesNotMatch(cuerpoFn.toLowerCase(), new RegExp(campoProhibido), `CondicionesTarifaSection no debe referenciar '${campoProhibido}'`);
    }
  });

  test("agrupa por texto sin perder identidad de temporadas (agruparCondicionesPorTexto conserva un arreglo de temporadas por grupo)", () => {
    assert.match(contratoDoc, /function agruparCondicionesPorTexto\(condiciones: CondicionTarifaAplicada\[\]\): \{ texto: string; temporadas: string\[\] \}\[\]/);
  });

  test("solo muestra la etiqueta de temporada cuando hay MÁS de una temporada distinta (evita ruido en el caso trivial)", () => {
    assert.match(contratoDoc, /const multiTemporada = new Set\(condiciones\.map\(\(c\) => c\.temporada\)\)\.size > 1;/);
  });
});

describe("Rutas de cotización (autenticada y pública) reciben la MISMA forma de datos — nunca releen tarifa_hotel", () => {
  test("app/cotizacion/[id]/page.tsx nunca consulta tarifa_hotel ni recalcula condiciones — solo lee cotizaciones.detalle", () => {
    assert.doesNotMatch(cotizacionPage, /tarifa_hotel/);
    assert.doesNotMatch(cotizacionPage, /computarReserva/);
    assert.doesNotMatch(cotizacionPage, /extraerCondicionesTarifa/);
  });

  test("app/cot/[token]/page.tsx (pública) nunca consulta tarifa_hotel ni recalcula condiciones — solo lee cotizaciones.detalle", () => {
    assert.doesNotMatch(cotTokenPage, /tarifa_hotel/);
    assert.doesNotMatch(cotTokenPage, /computarReserva/);
    assert.doesNotMatch(cotTokenPage, /extraerCondicionesTarifa/);
  });

  test("ambas rutas normalizan condiciones_tarifa con condicionesTarifaParaRender antes de pasar `hoteles` a ContratoDocumento — mismo prop, mismo shape, ninguna releyó ni transformó el snapshot financiero", () => {
    assert.match(cotizacionPage, /import \{ condicionesTarifaParaRender \} from "@\/lib\/calc\/condicionesTarifa";/);
    assert.match(cotTokenPage, /import \{ condicionesTarifaParaRender \} from "@\/lib\/calc\/condicionesTarifa";/);
    assert.match(cotizacionPage, /hoteles=\{\(d\.hoteles \?\? \[\]\)\.map\(\(h\) => \(\{ \.\.\.h, condiciones_tarifa: condicionesTarifaParaRender\(h\.condiciones_tarifa\) \}\)\)\}/);
    assert.match(cotTokenPage, /hoteles=\{\(d\.hoteles \?\? \[\]\)\.map\(\(h\) => \(\{ \.\.\.h, condiciones_tarifa: condicionesTarifaParaRender\(h\.condiciones_tarifa\) \}\)\)\}/);
  });

  test("ambas rutas leen la cotización SOLO por su identidad propia (id autenticado con chequeo de tenant / share_token público) — la fuente del snapshot es cotizaciones.detalle en ambas", () => {
    assert.match(cotizacionPage, /\.from\("cotizaciones"\)/);
    assert.match(cotTokenPage, /\.from\("cotizaciones"\)/);
    assert.match(cotizacionPage, /cot\.detalle/);
    assert.match(cotTokenPage, /cot\.detalle/);
  });
});

// `cuerpoFuncion` (conteo de llaves) no sirve para esta función en particular:
// tiene tipos multilínea / template literals con `${...}` que desbalancean el
// conteo simple de llaves y cortan el cuerpo prematuramente (mismo problema ya
// visto antes en este archivo). Se usa en su lugar el siguiente `export
// (async )?function` de nivel superior como límite de cierre.
function cuerpoFuncionPorSiguienteExport(fuenteCompleta: string, ancla: string): string {
  const idx = fuenteCompleta.indexOf(ancla);
  assert.ok(idx > -1, `no se encontró "${ancla}"`);
  const resto = fuenteCompleta.slice(idx + ancla.length);
  const m = resto.match(/\nexport (async function|function|const) /);
  assert.ok(m, `no se encontró el siguiente "export function/const" de nivel superior tras "${ancla}"`);
  return fuenteCompleta.slice(idx, idx + ancla.length + (m as RegExpMatchArray).index!);
}

describe("Gap cerrado — lado CONTRATO (convertirCotizacionCarrito) SÍ escribe condiciones_tarifa (migración 178, propuesta)", () => {
  const cuerpoConv = cuerpoFuncionPorSiguienteExport(reservarActions, "export async function convertirCotizacionCarrito(");

  test("convertirCotizacionCarrito importa resolverCondicionesTarifaParaConversion (nunca reimplementa la correlación por su cuenta)", () => {
    assert.match(reservarActions, /import \{ resolverCondicionesTarifaParaConversion, type HotelSnapConRef \} from "@\/lib\/calc\/condicionesTarifa";/);
  });

  test("resuelve el snapshot de hoteles UNA vez desde cot.detalle.hoteles (detalleHotelesSnap), no desde un query nuevo", () => {
    assert.match(cuerpoConv, /const detalleHotelesSnap: HotelSnapConRef\[\] = \(\(\) => \{/);
    assert.match(cuerpoConv, /cot\.detalle as \{ hoteles\?: unknown \} \| null/);
  });

  test("la correlación se hace por `it.ref` (referencia estable), NUNCA por hIdx/posición/nombre/hotelId+categoría", () => {
    assert.match(cuerpoConv, /resolverCondicionesTarifaParaConversion\(detalleHotelesSnap, it\.ref\)/);
    // hIdx sigue existiendo (es el índice de iteración/orden del contrato), pero
    // NUNCA debe pasarse como segundo argumento de resolverCondicionesTarifaParaConversion.
    assert.doesNotMatch(cuerpoConv, /resolverCondicionesTarifaParaConversion\(detalleHotelesSnap, hIdx\)/);
  });

  test("si la resolución falla (referencia ausente-con-ambigüedad, duplicada o snapshot inválido), revierte con fallarYRevertirGrupo — nunca un `continue` silencioso ni un contrato a medias", () => {
    const posResolver = cuerpoConv.indexOf("resolverCondicionesTarifaParaConversion(detalleHotelesSnap, it.ref)");
    const bloque = cuerpoConv.slice(posResolver, posResolver + 400);
    assert.match(bloque, /if \(!rCondiciones\.ok\) \{/);
    assert.match(bloque, /return fallarYRevertirGrupo\(/);
  });

  test("el insert de contrato_hoteles (rama persona) captura {error} explícitamente y revierte el grupo si falla — nunca continúa creando items/CxP", () => {
    const posInsert = cuerpoConv.indexOf('const { error: eHotelP } = await sb.from("contrato_hoteles").insert({');
    assert.notEqual(posInsert, -1, "el insert debe capturar {error: eHotelP} explícitamente");
    const posCierreInsert = cuerpoConv.indexOf("});", posInsert);
    const bloqueInsert = cuerpoConv.slice(posInsert, posCierreInsert);
    assert.match(bloqueInsert, /condiciones_tarifa: rCondiciones\.condiciones as unknown as Json,/);
    const posCheckError = cuerpoConv.indexOf("if (eHotelP)", posCierreInsert);
    assert.notEqual(posCheckError, -1);
    const bloqueCheck = cuerpoConv.slice(posCheckError, posCheckError + 200);
    assert.match(bloqueCheck, /return fallarYRevertirGrupo\(/);
    // El check de error debe preceder a cualquier inserción posterior de contrato_items/CxP para este hotel.
    const posSiguienteItemsInsert = cuerpoConv.indexOf('.from("contrato_items")', posCheckError);
    if (posSiguienteItemsInsert !== -1) {
      assert.ok(posCheckError < posSiguienteItemsInsert, "el chequeo de error del insert de contrato_hoteles debe preceder cualquier insert posterior de contrato_items");
    }
  });

  test("el insert de contrato_hoteles de Bernalo (bIdx) sigue SIN condiciones_tarifa — Bernalo nunca recibe condiciones Dubai", () => {
    const posBernaloInsert = cuerpoConv.indexOf('const { error: eHotelB }');
    assert.notEqual(posBernaloInsert, -1, "el insert de Bernalo debe seguir capturando {error: eHotelB}");
    const posCierre = cuerpoConv.indexOf("});", posBernaloInsert);
    const bloqueBernalo = cuerpoConv.slice(posBernaloInsert, posCierre);
    assert.doesNotMatch(bloqueBernalo, /condiciones_tarifa/);
  });

  test("convertirCotizacionCarrito NUNCA consulta tarifa_hotel — un cambio posterior en el catálogo no debe alterar un contrato ya convertido (la única fuente es el snapshot ya congelado en cot.detalle)", () => {
    assert.doesNotMatch(cuerpoConv, /\.from\("tarifa_hotel"\)/);
  });

  test("cotizaciones históricas sin `ref` (payload.items sin ref) siguen convirtiendo — `it.ref` es opcional y resolverCondicionesTarifaParaConversion trata la ausencia como 'sin snapshot que copiar', nunca como error", () => {
    assert.match(reservarActions, /ref\?: string;/);
  });

  test("contrato_hoteles (types/database.ts) declara condiciones_tarifa: Json | null en Row (la migración 178 ya está reflejada en los tipos)", () => {
    const posTabla = types.indexOf("contrato_hoteles:");
    const posSiguienteTabla = types.indexOf("contrato_vuelos:", posTabla);
    const bloque = types.slice(posTabla, posSiguienteTabla);
    assert.match(bloque, /condiciones_tarifa: Json \| null;/);
  });
});

describe("Las 4 rutas de documento (cotización/contrato × autenticada/pública) usan el MISMO componente y la misma normalización — nunca releen tarifa_hotel", () => {
  const paginas = [
    { nombre: "app/cotizacion/[id]/page.tsx", src: cotizacionPage },
    { nombre: "app/cot/[token]/page.tsx", src: cotTokenPage },
    { nombre: "app/contrato/[numero]/page.tsx", src: contratoPage },
    { nombre: "app/c/[token]/page.tsx", src: cTokenPage },
  ];

  for (const { nombre, src } of paginas) {
    test(`${nombre} importa/renderiza ContratoDocumento y normaliza condiciones_tarifa con condicionesTarifaParaRender antes de pasarlo`, () => {
      assert.match(src, /import \{ ContratoDocumento \} from "@\/components\/contrato\/ContratoDocumento";/, `${nombre} debe importar ContratoDocumento`);
      assert.match(src, /import \{ condicionesTarifaParaRender \} from "@\/lib\/calc\/condicionesTarifa";/, `${nombre} debe importar condicionesTarifaParaRender`);
      assert.match(src, /condicionesTarifaParaRender\(h\.condiciones_tarifa\)/, `${nombre} debe normalizar condiciones_tarifa por hotel antes de renderizar`);
    });

    test(`${nombre} nunca consulta tarifa_hotel ni recalcula condiciones (solo lee el snapshot ya persistido)`, () => {
      assert.doesNotMatch(src, /\.from\("tarifa_hotel"\)/, `${nombre} no debe consultar tarifa_hotel`);
      assert.doesNotMatch(src, /extraerCondicionesTarifa/, `${nombre} no debe recalcular condiciones`);
    });
  }

  test("las páginas de contrato (autenticada y pública) leen contrato_hoteles con select(\"*\") — reciben condiciones_tarifa automáticamente, sin query adicional", () => {
    assert.match(contratoPage, /\.from\("contrato_hoteles"\)[\s\S]{0,80}\.select\("\*"\)/);
    assert.match(cTokenPage, /\.from\("contrato_hoteles"\)[\s\S]{0,80}\.select\("\*"\)/);
  });
});
