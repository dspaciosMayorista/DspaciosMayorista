import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3F-3 Bernalo — verificación por inspección de la frontera PÚBLICA de
// cotización (`app/tarifario/cotizacionBernaloActions.ts`) y del loader de
// descubrimiento (`lib/tarifario/datosBernalo.ts`). Ninguno de los dos es
// ejecutable bajo `node --test` (Supabase/Next real) — se verifica el
// código FUENTE, mismo criterio que el resto de wiring tests del repo.
//
// Desde 3F-3, TODA la autorización/resolución/cálculo vive en el servicio
// interno `lib/reservar/computoReservaBernalo.ts` — sus pruebas de wiring
// viven en pruebas/computoReservaBernaloWiring.test.ts. Este archivo prueba
// SOLO lo que le queda a la Server Action: validar forma, llamar al
// servicio UNA vez y sanitizar su respuesta.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteAction = readFileSync(join(raiz, "app/tarifario/cotizacionBernaloActions.ts"), "utf8");
const fuenteDiscovery = readFileSync(join(raiz, "lib/tarifario/datosBernalo.ts"), "utf8");

function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*\*?\s*$/.test(l)).join("\n");
}
const codigoAction = sinComentarios(fuenteAction);
const codigoDiscovery = sinComentarios(fuenteDiscovery);

describe("cotizacionBernaloActions.ts — es la Server Action pública de cotización", () => {
  test('lleva "use server" al inicio del archivo', () => {
    assert.match(fuenteAction.split(/\r?\n/).slice(0, 3).join("\n"), /"use server"/);
  });

  test("YA NO usa createAdminClient/Supabase directamente — todo el acceso a datos se movió al servicio interno (Fase 3F-3)", () => {
    assert.doesNotMatch(codigoAction, /createAdminClient\(\)/);
    assert.doesNotMatch(codigoAction, /createClient\(\)/);
    assert.doesNotMatch(codigoAction, /\.from\(/);
  });

  test("importa y usa computarReservaBernalo como ÚNICA fuente del cálculo (regla 1: no dos implementaciones monetarias)", () => {
    assert.match(codigoAction, /import\s*\{[\s\S]*computarReservaBernalo[\s\S]*\}\s*from\s*"@\/lib\/reservar\/computoReservaBernalo"/);
    const usos = [...codigoAction.matchAll(/computarReservaBernalo\(/g)];
    assert.equal(usos.length, 1, "computarReservaBernalo debe llamarse UNA sola vez");
  });

  test("no reimplementa orquestación/composición de PVP — no importa orquestarCotizacionAlojamientoBernalo/calcularPvpAlojamientoBernalo directo", () => {
    assert.doesNotMatch(codigoAction, /orquestarCotizacionAlojamientoBernalo|calcularPvpAlojamientoBernalo/);
  });
});

describe("cotizacionBernaloActions.ts — valida FORMA antes de llamar al servicio interno", () => {
  test("valida el arreglo de habitaciones con validarHabitacionesOcupacion (Fase 3D) antes de invocar computarReservaBernalo", () => {
    const posValidacion = fuenteAction.indexOf("validarHabitacionesOcupacion(input.habitaciones)");
    const posServicio = fuenteAction.indexOf("await computarReservaBernalo(");
    assert.notEqual(posValidacion, -1);
    assert.notEqual(posServicio, -1);
    assert.ok(posValidacion < posServicio, "la ocupación debe validarse en forma antes de llamar al servicio interno");
  });

  test('valida la salida con validarSalidaSeleccionadaBernalo (Fase 3F-1) — reutilizada, no reimplementada', () => {
    assert.match(codigoAction, /import\s*\{[\s\S]*validarSalidaSeleccionadaBernalo[\s\S]*\}\s*from\s*"@\/lib\/reservar\/solicitudAlojamientoBernalo"/);
    const posValidacion = fuenteAction.indexOf("validarSalidaSeleccionadaBernalo(input.salida)");
    const posServicio = fuenteAction.indexOf("await computarReservaBernalo(");
    assert.notEqual(posValidacion, -1);
    assert.ok(posValidacion < posServicio, "la salida debe validarse en forma antes de llamar al servicio interno");
  });

  test("construye la entrada del servicio con la salida/habitaciones YA VALIDADAS (vSalida.salida / validacionOcupacion.habitaciones), nunca el input crudo", () => {
    const bloqueLlamada = fuenteAction.slice(fuenteAction.indexOf("const resultado = await computarReservaBernalo({"), fuenteAction.indexOf("const resultado = await computarReservaBernalo({") + 400);
    assert.match(bloqueLlamada, /salida: vSalida\.salida,/);
    assert.match(bloqueLlamada, /habitaciones: validacionOcupacion\.habitaciones,/);
  });
});

describe("cotizacionBernaloActions.ts — mensajes públicos con motivo comercial saneado", () => {
  test("MENSAJES_PUBLICOS tiene entradas para servicio_sin_tarifa/servicio_sin_rango_grupal", () => {
    const mapa = fuenteAction.slice(fuenteAction.indexOf("const MENSAJES_PUBLICOS"), fuenteAction.indexOf("function mensajePublico"));
    assert.match(mapa, /servicio_sin_tarifa:/);
    assert.match(mapa, /servicio_sin_rango_grupal:/);
  });

  test("el fallo del servicio interno se traduce con mensajePublico(resultado.codigo, resultado.mensaje) — nunca reenvía el objeto interno completo", () => {
    assert.match(codigoAction, /mensajePublico\(resultado\.codigo, resultado\.mensaje\)/);
    assert.doesNotMatch(codigoAction, /return resultado;/);
    assert.doesNotMatch(codigoAction, /\.\.\.resultado/);
  });

  test("ningún mensaje público fijo en MENSAJES_PUBLICOS interpola una variable (todos son texto fijo, nunca nombres internos)", () => {
    const mapa = fuenteAction.slice(fuenteAction.indexOf("const MENSAJES_PUBLICOS"), fuenteAction.indexOf("function mensajePublico"));
    assert.doesNotMatch(mapa, /\$\{/);
  });

  test("solo los rechazos comerciales pueden adjuntar Motivo y el detalle se limpia de campos/tablas sensibles", () => {
    const fn = fuenteAction.slice(fuenteAction.indexOf("function mensajePublico"), fuenteAction.indexOf("/**", fuenteAction.indexOf("function mensajePublico")));
    for (const codigo of ["no_cotizable", "configuracion_invalida", "ocupacion_no_permitida", "edad_fuera_de_regla", "tarifa_no_encontrada"]) {
      assert.match(fn, new RegExp(codigo));
    }
    assert.match(fn, /Motivo:/);
    for (const sensible of ["snapshot", "totalNeto", "valorComision", "hotel_tarifas_unidad", "armado_hoteles", "armado_paquetes", "servicios_adicionales"]) {
      assert.match(fn, new RegExp(sensible));
    }
  });
});

describe("cotizacionBernaloActions.ts — la respuesta pública conserva ÚNICAMENTE sus 6 claves autorizadas", () => {
  test("el tipo de salida OK declara exactamente ok/pvp/moneda/paxTotal/promedioPorViajero/composicionHabitaciones", () => {
    const tipo = fuenteAction.slice(
      fuenteAction.indexOf("export type ResultadoCotizarAlojamientoBernaloPublicoOk"),
      fuenteAction.indexOf("export type ResultadoCotizarAlojamientoBernaloPublico =")
    );
    for (const campo of ["ok: true;", "pvp: number;", "moneda: string;", "paxTotal: number;", "promedioPorViajero: number;", "composicionHabitaciones: ComposicionHabitacionPublica[];"]) {
      assert.match(tipo, new RegExp(campo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  test("el objeto final se construye a mano campo por campo — nunca `return resultado`/spread del objeto interno completo", () => {
    assert.doesNotMatch(codigoAction, /return resultado;/);
    assert.doesNotMatch(codigoAction, /\.\.\.resultado/);
    assert.match(codigoAction, /pvp: resultado\.precioVenta,/);
    assert.match(codigoAction, /moneda: resultado\.moneda,/);
    assert.match(codigoAction, /paxTotal: resultado\.paxTotal,/);
  });

  test("composicionHabitaciones se construye EXCLUSIVAMENTE vía construirComposicionHabitacionesPublica(resultado.habitaciones) — nunca el arreglo interno reenviado tal cual", () => {
    const bloqueOk = codigoAction.slice(codigoAction.indexOf("return {\n    ok: true,"), codigoAction.indexOf("};", codigoAction.indexOf("return {\n    ok: true,")));
    assert.match(bloqueOk, /composicionHabitaciones:\s*construirComposicionHabitacionesPublica\(resultado\.habitaciones\)/);
    // La ÚNICA aparición de "habitaciones" en el bloque OK debe ser ESE
    // argumento — nunca una clave "habitaciones:" propia devuelta tal cual.
    assert.doesNotMatch(bloqueOk, /\bhabitaciones:/);
  });

  test("no reenvía ningún campo interno en los objetos de respuesta pública (costos/aportes/proveedor/snapshot)", () => {
    const bloqueOk = codigoAction.slice(codigoAction.indexOf("return {\n    ok: true,"), codigoAction.indexOf("};", codigoAction.indexOf("return {\n    ok: true,")));
    assert.doesNotMatch(bloqueOk, /costoHotelTotal|costoVueloTotal|costoServiciosTotal|aportePvp|proveedorHotel|serviciosIncluidos\b|snapshot/i);
    const rechazo = codigoAction.slice(codigoAction.indexOf("if (!resultado.ok)"), codigoAction.indexOf("return {\n    ok: true,"));
    assert.match(rechazo, /return \{ ok: false, codigo: resultado\.codigo, mensaje: mensajePublico\(resultado\.codigo, resultado\.mensaje\) \};/);
    assert.doesNotMatch(rechazo, /costoHotelTotal|costoVueloTotal|costoServiciosTotal|aportePvp|proveedorHotel|serviciosIncluidos\b|snapshot|habitaciones:/i);
  });
});

describe("composicionHabitacionBernalo.ts — sanitización propia (adultos/niños/infantes), nunca netos/comisión/proveedor", () => {
  const fuenteComposicion = readFileSync(join(raiz, "lib/reservar/composicionHabitacionBernalo.ts"), "utf8");
  test("solo expone habitacionId/adultos/ninos/infantes en ComposicionHabitacionPublica", () => {
    const idx = fuenteComposicion.indexOf("export type ComposicionHabitacionPublica");
    const cuerpo = fuenteComposicion.slice(idx, idx + 300);
    assert.match(cuerpo, /habitacionId: string;/);
    assert.match(cuerpo, /adultos: number;/);
    assert.match(cuerpo, /ninos: number;/);
    assert.match(cuerpo, /infantes: number;/);
    assert.doesNotMatch(cuerpo, /neto|comision|proveedor|snapshot|payload|suplemento/i);
  });
});

describe("cotizacionBernaloActions.ts — nunca confía en el navegador", () => {
  test("el error_interno de forma inválida se devuelve ANTES de tocar el servicio interno", () => {
    const posPaqueteCheck = fuenteAction.indexOf('typeof input.paqueteId !== "number"');
    const posServicio = fuenteAction.indexOf("await computarReservaBernalo(");
    assert.notEqual(posPaqueteCheck, -1);
    assert.ok(posPaqueteCheck < posServicio);
  });
});

describe("cotizacionBernaloActions.ts — reutiliza Fase 3D/3F-1, no reimplementa nada", () => {
  test("importa validarHabitacionesOcupacion (3D) y validarSalidaSeleccionadaBernalo (3F-1)", () => {
    assert.match(codigoAction, /import\s*\{[\s\S]*validarHabitacionesOcupacion[\s\S]*\}\s*from\s*"@\/lib\/reservar\/ocupacionPorHabitacion"/);
    assert.match(codigoAction, /import\s*\{[\s\S]*validarSalidaSeleccionadaBernalo[\s\S]*\}\s*from\s*"@\/lib\/reservar\/solicitudAlojamientoBernalo"/);
  });

  test("no llama ninguna función de carrito/checkout (sin salida hacia carrito/contrato)", () => {
    assert.doesNotMatch(codigoAction, /crearCotizacionCarrito|crearSolicitudReserva|useCart|\.add\(/);
    assert.doesNotMatch(codigoAction, /computarReserva\(/); // el legado persona, distinto de computarReservaBernalo
  });
});

describe("lib/tarifario/datosBernalo.ts — descubrimiento paralelo, sin tarifario_resultado, sin precio", () => {
  test("nunca consulta tarifario_resultado/tarifario_resumen", () => {
    assert.doesNotMatch(codigoDiscovery, /tarifario_resultado|tarifario_resumen/);
  });

  test("filtra por armado_paquetes.activo=true — mismo criterio que el tarifario público", () => {
    assert.match(codigoDiscovery, /\.eq\("activo", true\)/);
  });

  test("filtra por modelo_tarifario === 'unidad' — nunca lista hoteles persona", () => {
    assert.match(codigoDiscovery, /modelo_tarifario !== "unidad"/);
  });

  test("el tipo de salida (hotel descubierto) NO tiene ningún campo de precio (pvp/precio/tarifa/neto/bruto) — tampoco en SalidaAereaBernalo", () => {
    const tipoSalida = fuenteDiscovery.slice(
      fuenteDiscovery.indexOf("export type HotelBernaloDescubierto"),
      fuenteDiscovery.indexOf("export type ResultadoHotelesBernaloDescubiertos")
    );
    assert.doesNotMatch(tipoSalida, /pvp|precio|tarifa|neto|bruto/i);
    const tipoSalidaAerea = fuenteDiscovery.slice(
      fuenteDiscovery.indexOf("export type SalidaAereaBernalo"),
      fuenteDiscovery.indexOf("export type HotelBernaloDescubierto")
    );
    assert.doesNotMatch(tipoSalidaAerea, /pvp|precio|tarifa|neto|bruto/i);
  });

  test("usa createAdminClient (mismo cliente que ya usan los loaders públicos existentes, cargarDatosTarifario/cargarResumenTarifario)", () => {
    assert.match(codigoDiscovery, /createAdminClient\(\)/);
  });

  test("expone la moneda del hotel como nullable (nunca colapsada a COP por defecto)", () => {
    assert.match(codigoDiscovery, /moneda:\s*"COP" \| "USD" \| null/);
  });

  test("las salidas se calculan con los MISMOS filtros exactos que el generador legado (fecha completa; empaquetado activo+vigente)", () => {
    assert.match(codigoDiscovery, /!b\.fecha_ida \|\| !b\.fecha_regreso/);
    assert.match(codigoDiscovery, /!e\.activo \|\| !e\.fecha_ida \|\| !e\.fecha_regreso/);
    assert.match(codigoDiscovery, /empaquetadoVigente\(e\.compra_inicio, e\.compra_fin, hoy\)/);
  });

  // P1-3 (hallazgo confirmado): antes se exponía cualquier hotel con
  // categorías/regímenes CONFIGURADOS, sin comprobar que hubiera tarifa
  // PUBLICADA (`hotel_tarifas_unidad`, estado='publicada') que cubriera
  // TODO el cartesiano — un hotel con config pero sin tarifa cargada (o con
  // tarifas en borrador/inactiva) se anunciaba como disponible y solo
  // fallaba al cotizar.
  // P1 (hallazgo confirmado, validación final — ronda 2): el conjunto que
  // VistaBooking usa para excluir tarjetas persona obsoletas NO puede
  // derivarse de `hoteles` (el catálogo cotizable, ya filtrado por
  // disponibilidad publicada P1-3 y compatibilidad de tipo P2) — un hotel
  // `modelo_tarifario = 'unidad'` sigue siendo unidad aunque su oferta no
  // sea publicable/compatible/visible. `hotelIdsUnidadAutoritativos` es un
  // conjunto SEPARADO, calculado directo de la columna fresca
  // `hoteles.modelo_tarifario` (vía el join de `armado_hoteles`), ANTES de
  // cualquier filtro.
  describe("P1 (ronda 2) — hotelIdsUnidadAutoritativos: identidad SEPARADA, sin ningún filtro de publicación/compatibilidad/visibilidad", () => {
    test("se calcula justo después de `filas` (armado_hoteles), ANTES del filtro de tipo compatible (P2) y ANTES del cruce con hotel_tarifas_unidad (P1-3)", () => {
      const idxAutoritativo = fuenteDiscovery.indexOf("const hotelIdsUnidadAutoritativos = [");
      const idxTipoCompatible = fuenteDiscovery.indexOf("const TIPOS_UNIDAD_COMPATIBLES");
      const idxParesPublicados = fuenteDiscovery.indexOf("const paresPublicadosPorHotel = new Map");
      assert.notEqual(idxAutoritativo, -1);
      assert.notEqual(idxTipoCompatible, -1);
      assert.notEqual(idxParesPublicados, -1);
      assert.ok(idxAutoritativo < idxTipoCompatible, "debe calcularse antes del filtro de tipo compatible (P2)");
      assert.ok(idxAutoritativo < idxParesPublicados, "debe calcularse antes del cruce de disponibilidad publicada (P1-3)");
    });

    test("incluye TODOS los hotel_id con modelo_tarifario='unidad' — sin `.filter(tipoCompatible)` ni chequeo de pares publicados en su propia declaración", () => {
      const idxDecl = fuenteDiscovery.indexOf("const hotelIdsUnidadAutoritativos = [");
      const idxFin = fuenteDiscovery.indexOf("];", idxDecl);
      assert.notEqual(idxDecl, -1);
      const bloque = fuenteDiscovery.slice(idxDecl, idxFin);
      assert.match(bloque, /modelo_tarifario === "unidad"/);
      assert.doesNotMatch(bloque, /tipoCompatible/, "no debe filtrar por tipo de paquete compatible — eso es responsabilidad de `hoteles`, no de esta identidad");
      assert.doesNotMatch(bloque, /paresPublicados/, "no debe filtrar por disponibilidad publicada — eso es responsabilidad de `hoteles`, no de esta identidad");
    });

    test("se devuelve en el resultado ok:true junto con `hoteles` — ambos campos expuestos, nunca solo uno", () => {
      assert.match(codigoDiscovery, /return \{ ok: true, hoteles, hotelIdsUnidadAutoritativos \};/);
    });

    test("el early-return de catálogo vacío (0 paquetes activos) también expone hotelIdsUnidadAutoritativos: [] — nunca un campo faltante que rompa el tipo en el llamador", () => {
      assert.match(codigoDiscovery, /if \(!paquetesActivos\.length\) return \{ ok: true, hoteles: \[\], hotelIdsUnidadAutoritativos: \[\] \};/);
    });

    test("el tipo de salida documenta explícitamente por qué es un canal separado de `hoteles` (nunca debe usarse para decidir qué tarjeta unidad mostrar)", () => {
      const idxTipo = fuenteDiscovery.indexOf("export type ResultadoHotelesBernaloDescubiertos");
      const idxFinTipo = fuenteDiscovery.indexOf("export async function cargarHotelesBernaloDescubiertos");
      assert.notEqual(idxTipo, -1);
      const bloqueTipo = fuenteDiscovery.slice(idxTipo, idxFinTipo);
      assert.match(bloqueTipo, /hotelIdsUnidadAutoritativos: number\[\];/);
    });
  });

  describe("P1-3 — disponibilidad real publicada (cruce con hotel_tarifas_unidad)", () => {
    test("cruza armado_hoteles con hotel_tarifas_unidad por hotel_id, filtrando estado='publicada'", () => {
      assert.match(codigoDiscovery, /\.from\("hotel_tarifas_unidad"\)/);
      assert.match(codigoDiscovery, /\.select\("hotel_id, categoria, alimentacion"\)/);
      assert.match(codigoDiscovery, /\.eq\("estado", "publicada"\)/);
    });

    test("categoria/alimentacion SIEMPRE salen de las columnas espejo de hotel_tarifas_unidad — nunca se leen/derivan del payload", () => {
      assert.doesNotMatch(codigoDiscovery, /payload\.categoria|payload\.alimentacion|\.payload\[/);
    });

    test("usa el MISMO helper puro compartido (construirSetParesPublicados/todosLosParesConfiguradosPublicados) que setHotelFiltros/generarTarifario — ninguna regla de pares publicados duplicada", () => {
      assert.match(fuenteDiscovery, /from "\.\.\/calc\/paresPublicadosUnidad\.ts"/);
      assert.match(codigoDiscovery, /construirSetParesPublicados\(filasPub\)/);
      assert.match(codigoDiscovery, /todosLosParesConfiguradosPublicados\(categorias, regimenes, paresPublicados\)/);
    });

    test("una oferta sin categorías/regímenes configurados, o cuyo cartesiano configurado no está 100% publicado, se DESCARTA (continue) antes de agregarse a `hoteles`", () => {
      const idxLoop = fuenteDiscovery.indexOf("const hoteles: HotelBernaloDescubierto[] = [];");
      const idxCheck = fuenteDiscovery.indexOf("if (!todosLosParesConfiguradosPublicados(categorias, regimenes, paresPublicados)) continue;", idxLoop);
      const idxPush = fuenteDiscovery.indexOf("hoteles.push({", idxLoop);
      assert.notEqual(idxCheck, -1);
      assert.notEqual(idxPush, -1);
      assert.ok(idxCheck < idxPush, "el chequeo de disponibilidad real debe ocurrir ANTES de exponer la oferta");
    });

    test("un error TÉCNICO consultando hotel_tarifas_unidad se propaga (ok:false) — nunca se disfraza de catálogo vacío", () => {
      assert.match(codigoDiscovery, /if \(eTarifas\) return \{ ok: false, error: eTarifas\.message \};/);
    });

    test("con 0 hoteles unidad en `filas`, ni siquiera se consulta hotel_tarifas_unidad (gate por hotelIdsUnidad.length) — no es una llamada desperdiciada ni una fuente extra de error espurio", () => {
      assert.match(codigoDiscovery, /if \(hotelIdsUnidad\.length\) \{/);
    });
  });

  // P2 (hallazgo confirmado, validación final): `computarReservaBernalo` no
  // soporta `salidas_dinamicas` todavía, y el tipo "servicios" no tiene
  // concepto de hotel cotizable. Un hotel unidad de un paquete "dinamico" o
  // "servicios" NUNCA debe anunciarse como disponible en Vista Booking,
  // aunque tenga tarifa publicada — no hay UI que pueda mostrarlo/cotizarlo.
  describe("P2 — paquetes dinamico/servicios se EXCLUYEN del catálogo cotizable (nunca se anuncian como disponibles)", () => {
    test("define TIPOS_UNIDAD_COMPATIBLES = {bloqueo, porcion_terrestre} y lo usa para filtrar tanto hotelIdsUnidad como el push final", () => {
      assert.match(codigoDiscovery, /const TIPOS_UNIDAD_COMPATIBLES = new Set<HotelBernaloDescubierto\["tipo"\]>\(\["bloqueo", "porcion_terrestre"\]\);/);
      assert.match(codigoDiscovery, /const tipoCompatible = \(paqueteId: number\) => TIPOS_UNIDAD_COMPATIBLES\.has\(tipoPorPaquete\.get\(paqueteId\) \?\? "bloqueo"\);/);
    });

    test("hotelIdsUnidad (usado para consultar hotel_tarifas_unidad) excluye hoteles de paquetes dinamico/servicios — no se gasta la consulta en algo que nunca se va a exponer", () => {
      const idxDecl = fuenteDiscovery.indexOf("const hotelIdsUnidad = [");
      const idxFin = fuenteDiscovery.indexOf("];", idxDecl);
      assert.notEqual(idxDecl, -1);
      const bloque = fuenteDiscovery.slice(idxDecl, idxFin);
      assert.match(bloque, /\.filter\(\(f\) => tipoCompatible\(f\.paquete_id\)\)/);
    });

    test("el loop final de construcción de `hoteles` también descarta (continue) cualquier fila de paquete dinamico/servicios — defensa en profundidad, no solo en hotelIdsUnidad", () => {
      const idxLoop = fuenteDiscovery.indexOf("const hoteles: HotelBernaloDescubierto[] = [];");
      const idxCheckTipo = fuenteDiscovery.indexOf("if (!tipoCompatible(f.paquete_id)) continue;", idxLoop);
      const idxPush = fuenteDiscovery.indexOf("hoteles.push({", idxLoop);
      assert.notEqual(idxCheckTipo, -1);
      assert.notEqual(idxPush, -1);
      assert.ok(idxCheckTipo < idxPush, "el chequeo de tipo compatible debe ocurrir ANTES de exponer la oferta");
    });

    test("no se implementa salidas_dinamicas en el motor Bernalo — computarReservaBernaloWiring no debe ganar soporte nuevo para 'dinamico' en esta tarea", () => {
      const computo = readFileSync(join(raiz, "lib/reservar/computoReservaBernalo.ts"), "utf8");
      assert.doesNotMatch(computo, /salidas_dinamicas/);
    });
  });

  // P2 (hallazgo confirmado): la tarjeta de un hotel unidad mostraba "Sin
  // foto" fijo y nunca leía estrellas/descripción/Adults Only/Pet friendly
  // reales, aunque el hotel SÍ los tuviera — porque `fotosPorHotel`/
  // `infoPorHotel` solo se armaban desde los hotelId de `filasVisibles`
  // (hoteles persona).
  describe("P2 — cargarInfoHotelesBernalo: foto/metadata REALES para hoteles por unidad", () => {
    test("consulta hotel_fotos y hoteles (estrellas/clasificacion/descripcion/ubicacion/adults_only/pet_friendly/etc.) por los hotelId de unidad", () => {
      assert.match(codigoDiscovery, /export async function cargarInfoHotelesBernalo/);
      assert.match(codigoDiscovery, /\.from\("hotel_fotos"\)/);
      assert.match(codigoDiscovery, /\.from\("hoteles"\)/);
      assert.match(codigoDiscovery, /adults_only, pet_friendly, pet_costo_neto, pet_costo_desc, pet_nota/);
    });

    test("la foto de PORTADA (es_portada) gana sobre cualquier otra foto del hotel — nunca la primera por orden a secas", () => {
      const cuerpo = fuenteDiscovery.slice(
        fuenteDiscovery.indexOf("export async function cargarInfoHotelesBernalo"),
        fuenteDiscovery.length
      );
      assert.match(cuerpo, /if \(f\.es_portada\) fotosPorHotel\[f\.hotel_id\] = f\.url;/);
    });

    test("con 0 hotelIds, responde con mapas vacíos y sin error SIN llamar a Supabase (nunca una consulta con .in(\"id\", []) que fallaría o traería todo)", () => {
      assert.match(codigoDiscovery, /if \(!hotelIds\.length\) return \{ fotosPorHotel: \{\}, infoPorHotel: \{\}, errorFotos: null, errorInfo: null \};/);
    });

    test("adultsOnly/petFriendly se leen de las columnas REALES del hotel (hoteles.adults_only/pet_friendly) — nunca hardcodeados a false salvo cuando la columna es null", () => {
      assert.match(codigoDiscovery, /adultsOnly: h\.adults_only \?\? false,/);
      assert.match(codigoDiscovery, /petFriendly: h\.pet_friendly \?\? false,/);
    });

    // P5 (hallazgo confirmado, validación final): antes un error en
    // CUALQUIERA de las dos consultas devolvía `ok:false` y el llamador
    // descartaba TODO el resultado — un fallo puntual en `hotel_fotos`
    // también borraba estrellas/Adults Only/Pet friendly que sí se habían
    // resuelto bien, y viceversa. Ahora cada consulta es independiente
    // (mismo criterio best-effort que `lib/tarifario/resumen.ts`): el bloque
    // de cada pieza solo se llena si SU PROPIA consulta no falló, y el error
    // de cada una viaja en su propio canal (`errorFotos`/`errorInfo`) —
    // nunca colapsa a `ok:false` global ni descarta la otra pieza.
    test("un error técnico en `hotel_fotos` NO borra infoPorHotel (metadata) — cada consulta es independiente, nunca ok:false global", () => {
      assert.doesNotMatch(codigoDiscovery, /if \(eFotos\) return/);
      assert.doesNotMatch(codigoDiscovery, /if \(eHoteles\) return/);
      const cuerpo = fuenteDiscovery.slice(
        fuenteDiscovery.indexOf("export async function cargarInfoHotelesBernalo"),
        fuenteDiscovery.length
      );
      // El bloque de fotos solo se llena si NO hubo error de fotos...
      const idxFotos = cuerpo.indexOf("const fotosPorHotel");
      const idxInfo = cuerpo.indexOf("const infoPorHotel");
      assert.notEqual(idxFotos, -1);
      assert.notEqual(idxInfo, -1);
      const bloqueFotos = cuerpo.slice(idxFotos, idxInfo);
      assert.match(bloqueFotos, /if \(!eFotos\) \{/, "fotosPorHotel debe llenarse solo si su propia consulta no falló");
      // ...y el bloque de metadata solo se llena si NO hubo error de hoteles —
      // cada uno gateado por SU error, nunca por el de la otra consulta.
      const idxReturn = cuerpo.indexOf("return { fotosPorHotel, infoPorHotel", idxInfo);
      assert.notEqual(idxReturn, -1);
      const bloqueInfo = cuerpo.slice(idxInfo, idxReturn);
      assert.match(bloqueInfo, /if \(!eHoteles\) \{/, "infoPorHotel debe llenarse solo si su propia consulta no falló");
      assert.doesNotMatch(bloqueFotos, /eHoteles/, "el bloque de fotos nunca debe depender del error de hoteles");
      assert.doesNotMatch(bloqueInfo, /eFotos/, "el bloque de metadata nunca debe depender del error de fotos");
    });

    test("el resultado final SIEMPRE reporta errorFotos/errorInfo por separado (ninguno colapsa al otro)", () => {
      assert.match(codigoDiscovery, /return \{ fotosPorHotel, infoPorHotel, errorFotos: eFotos\?\.message \?\? null, errorInfo: eHoteles\?\.message \?\? null \};/);
    });
  });
});
