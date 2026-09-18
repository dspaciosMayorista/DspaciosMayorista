// ─────────────────────────────────────────────────────────────────────────
// Fase 3E Bernalo — descubrimiento PARALELO de hoteles Bernalo del catálogo
// público, sin pasar por `tarifario_resultado`/`tarifario_resumen` (regla 6
// de la tarea: esas tablas EXCLUYEN a propósito los hoteles
// `modelo_tarifario = 'unidad'` desde Fase 3, ver `generarTarifario` —
// nunca se les escribe una fila ficticia ahí, regla 7).
//
// Este loader NUNCA calcula ni publica un precio (regla 8): solo lista qué
// hoteles Bernalo pertenecen a paquetes activos, para que la grilla los
// muestre con una acción "Consultar tarifa" — el precio real sale, bajo
// demanda, de `cotizarAlojamientoBernaloPublico`
// (`app/tarifario/cotizacionBernaloActions.ts`).
//
// Corrección (auditoría DeepSeek, hallazgo A1): además del hotel, expone
// las SALIDAS aéreas reales del paquete (id/tipo/fechas/etiqueta — NUNCA
// tarifa ni costo, regla A1.7) para que la UI pueda exigir una selección
// inequívoca cuando hay más de una, en vez de que el servidor "tome la
// primera" en silencio. Mismos filtros EXACTOS que el generador legado
// (`generarTarifario`, `app/(dashboard)/dashboard/paquetes/actions.ts`):
// bloqueo con fechas completas; empaquetado activo + fechas completas +
// `empaquetadoVigente(compra_inicio, compra_fin, hoyBogota(...))`.
//
// Mismo criterio de visibilidad que el tarifario ya usa hoy
// (`armado_paquetes.activo = true`, igual que el filtro
// `.eq("paquete_activo", true)` de `cargarFilasTarifarioPaginado`) y mismo
// cliente (service role, `createAdminClient()`) que ya usan
// `cargarDatosTarifario`/`cargarResumenTarifario` para TODAS sus lecturas
// públicas — no es un patrón nuevo, es el que ya usa el tarifario público.
//
// Import relativo con extensión `.ts` (no `@/lib/...`) a propósito: este
// archivo debe poder ejecutarse bajo `node --test` sin bundler, mismo
// motivo documentado en `lib/tarifario/datos.ts`.
// ─────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "../supabase/admin.ts";
import { empaquetadoVigente, hoyBogota } from "../reservar/origen.ts";
import { construirSetParesPublicados, todosLosParesConfiguradosPublicados } from "../calc/paresPublicadosUnidad.ts";
import { filasArmadoPaqueteADescripcionPorPaquete, type DescripcionPaqueteRaw, type FilaArmadoPaqueteDescripcion } from "./descripcionPaquete.ts";
import { claveOferta } from "./recomendados.ts";

// Identidad discriminada de una salida aérea real — nunca un índice `[0]`.
// El servidor de cotización vuelve a validar que el id/tipo elegido
// pertenece al paquete (ver `cotizacionBernaloActions.ts`); esta lista es
// solo para que la UI sepa qué ofrecer.
export type SalidaAereaBernalo =
  | { tipo: "bloqueo"; id: number; fechaIda: string; fechaRegreso: string; etiqueta: string }
  | { tipo: "empaquetado"; id: number; fechaIda: string; fechaRegreso: string; etiqueta: string };

export type HotelBernaloDescubierto = {
  hotelId: number;
  hotelNombre: string;
  paqueteId: number;
  paqueteNombre: string;
  destinoNombre: string | null;
  /** Tipo del paquete (`armado_paquetes.tipo`) — para que Vista Booking
   * ubique este hotel en la MISMA pestaña (Paquetes/Porción terrestre) que
   * el resto de los hoteles de ese mismo tipo de paquete, en vez de en una
   * sección aparte. Solo identifica el módulo — ver la cabecera del archivo
   * sobre qué campos SÍ/NO expone este descubrimiento. */
  tipo: "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
  /** Categorías habilitadas para este hotel en este paquete (`armado_hoteles.categorias`). */
  categorias: string[];
  /** Alimentaciones/regímenes habilitados (`armado_hoteles.regimenes`). */
  regimenes: string[];
  /** `armado_paquetes.destino_id` real del paquete — identidad ESTABLE del
   * destino (`destinosNombre` puede repetirse o variar por mayúsculas/
   * espacios entre registros distintos de `destinos`; el id nunca). `null`
   * solo si el paquete no tiene destino configurado (mismo caso en que
   * `destinoNombre` es `null`). Cierre del hallazgo de búsqueda unidad: antes
   * la búsqueda por destino solo viajaba como texto y tenía que
   * re-resolverse contra `destinos.nombre` río abajo — ver
   * `OpcionesDescubrimientoBernalo.destinoId`. */
  destinoId: number | null;
  /** `null` = el hotel no tiene moneda configurada — nunca se asume COP (regla A3.13). */
  moneda: "COP" | "USD" | null;
  /** Salidas aéreas válidas del paquete — vacío = porción terrestre (sin vuelo). */
  salidas: SalidaAereaBernalo[];
};

export type ResultadoHotelesBernaloDescubiertos =
  | {
      ok: true;
      hoteles: HotelBernaloDescubierto[];
      // Hallazgo confirmado (validación final): identidad AUTORITATIVA de
      // "este hotel es modelo unidad AHORA MISMO" — TODOS los `hotel_id` con
      // `hoteles.modelo_tarifario === 'unidad'` en algún paquete activo, sin
      // importar si su oferta es publicable/compatible/visible con ningún
      // filtro. `hoteles` (arriba) ya pasó por disponibilidad real (P1-3) y
      // compatibilidad de tipo (P2) — correcto para decidir qué tarjeta
      // UNIDAD mostrar, pero NUNCA debe usarse para decidir qué tarjeta
      // PERSONA excluir: un hotel con `modelo_tarifario = 'unidad'` sin
      // tarifa publicada, o de un paquete "dinamico"/"servicios", sigue
      // siendo unidad — su fila persona en `tarifario_resultado` sigue
      // siendo una CACHÉ OBSOLETA aunque `hoteles` no lo liste. Ver
      // `VistaBooking.tsx` (`idsUnidadAutoritativa`).
      hotelIdsUnidadAutoritativos: number[];
    }
  | { ok: false; error: string };

// Mismo criterio de normalización que el generador legado
// (`app/(dashboard)/dashboard/paquetes/actions.ts`, `monedaDe`) — pero sin
// colapsar la ausencia a COP: un valor `null`/vacío queda `null` (regla
// A3.13). Esta lista es solo informativa (nunca fija el precio); la
// resolución/validación real vive en `lib/calc/pvpAlojamientoBernalo.ts`.
function monedaExplicita(m: string | null | undefined): "COP" | "USD" | null {
  if (m == null || m.trim() === "") return null;
  return m === "USD" ? "USD" : "COP";
}

/**
 * Alcance OPCIONAL del descubrimiento. Sin opciones (o con `destino` vacío)
 * el comportamiento es EXACTAMENTE el de siempre: TODOS los paquetes activos
 * — así el llamador histórico (`app/tarifario/page.tsx`, la vitrina completa)
 * no cambia en nada.
 *
 * `destino` acota el descubrimiento a los paquetes activos cuyo
 * `destinos.nombre` coincide. El recorte se hace EN LA CONSULTA
 * (`destinos.nombre` → `destinos.id` → `armado_paquetes.destino_id IN (…)`),
 * no en JavaScript: antes se traían TODOS los paquetes activos con su join a
 * `destinos` y recién ahí se descartaban los de otros destinos — una
 * búsqueda acotada a un destino pagaba el catálogo completo en cada llamada
 * (ver el informe de la corrección de búsqueda general de Vista Booking). El
 * nombre es la MISMA cadena que ya usan `destinosPorcion`/`destinosBuscador`
 * en `VistaBooking.tsx` (derivadas de
 * `filas[].destino_nombre`/`hotelesBernalo[].destinoNombre`), así que el
 * valor que manda el buscador entra sin traducción.
 *
 * Falla cerrado: si el destino pedido no existe (ningún `destinos.id`) o su
 * consulta falla, se devuelve una lista VACÍA — nunca el catálogo completo,
 * que sería anunciar hoteles de otros destinos como si fueran de este.
 *
 * `destinoId` es la vía PREFERIDA (cierre del hallazgo de búsqueda unidad):
 * cuando el llamador ya conoce el `destinos.id` real (lo conoce siempre que
 * el destino se eligió de una opción que vino de una oferta unidad — ver
 * `lib/tarifario/destinosPorcion.ts`), se usa DIRECTO, sin la consulta
 * `destinos.nombre → id` de abajo. Esa consulta por texto queda como
 * respaldo para cuando solo se tiene el nombre (compatibilidad con el
 * llamador legado y con destinos que solo existen por filas persona, que no
 * traen id). Si se mandan los dos, `destinoId` GANA — nunca se mezclan ni se
 * intersectan.
 */
export type OpcionesDescubrimientoBernalo = { destino?: string | null; destinoId?: number | null };

/**
 * Lista los hoteles con `modelo_tarifario = 'unidad'` de los paquetes
 * activos del catálogo (todos, o solo los de `opciones.destino`) — sin
 * precio, sin tocar `tarifario_resultado` — junto con las salidas aéreas
 * reales (id/tipo/fechas/etiqueta) de cada paquete. Puro I/O: no decide nada,
 * solo consulta y da forma a las filas.
 */
export async function cargarHotelesBernaloDescubiertos(
  opciones?: OpcionesDescubrimientoBernalo
): Promise<ResultadoHotelesBernaloDescubiertos> {
  const admin = createAdminClient();

  // Identidad del destino EN LA BASE. `destinoId` es la vía preferida (ver el
  // comentario de `OpcionesDescubrimientoBernalo`): cuando se conoce, se usa
  // DIRECTO — ni siquiera se consulta `destinos`, así que no hay texto que
  // pueda dejar de coincidir. Solo sin `destinoId` se cae al camino legado
  // por nombre: los nombres de `destinos` pueden repetirse (el catálogo tiene
  // una herramienta de fusión justamente porque existen duplicados), así que
  // se resuelven TODOS los ids con ese nombre — nunca `.maybeSingle()`, que
  // fallaría con el catálogo real. Sin destino pedido no se consulta nada: el
  // comportamiento sin filtro queda intacto.
  const destinoIdPedido = opciones?.destinoId ?? null;
  const destinoPedido = (opciones?.destino ?? "").trim();
  let idsDestino: number[] = [];
  if (destinoIdPedido != null) {
    idsDestino = [destinoIdPedido];
  } else if (destinoPedido) {
    const { data: destinos, error: eDestino } = await admin
      .from("destinos")
      .select("id")
      .eq("nombre", destinoPedido);
    if (eDestino) return { ok: false, error: eDestino.message };
    idsDestino = [...new Set((destinos ?? []).map((d) => d.id as number))];
    // Destino inexistente: se devuelve VACÍO, no el catálogo completo. Sin
    // este corte, `idsDestino` vacío dejaría la consulta sin filtro y el
    // descubrimiento anunciaría hoteles de todos los destinos como si
    // pertenecieran al pedido.
    if (!idsDestino.length) return { ok: true, hoteles: [], hotelIdsUnidadAutoritativos: [] };
  }

  // Un solo armador para las dos ramas (con y sin destino): la consulta es
  // la MISMA, solo cambia el filtro.
  const paquetesBase = () => {
    let q = admin
      .from("armado_paquetes")
      .select("id, nombre, tipo, destino_id, destinos(nombre)")
      .eq("activo", true);
    if (idsDestino.length) q = q.in("destino_id", idsDestino);
    return q;
  };

  const { data: paquetes, error: ePq } = await paquetesBase();
  if (ePq) return { ok: false, error: ePq.message };
  const paquetesActivos = paquetes ?? [];
  if (!paquetesActivos.length) return { ok: true, hoteles: [], hotelIdsUnidadAutoritativos: [] };
  const idsActivos = paquetesActivos.map((p) => p.id);

  const nombrePorPaquete = new Map<number, string>();
  const destinoPorPaquete = new Map<number, string | null>();
  const destinoIdPorPaquete = new Map<number, number | null>();
  const tipoPorPaquete = new Map<number, HotelBernaloDescubierto["tipo"]>();
  for (const p of paquetesActivos) {
    nombrePorPaquete.set(p.id, p.nombre);
    destinoPorPaquete.set(p.id, (p.destinos as unknown as { nombre: string } | null)?.nombre ?? null);
    destinoIdPorPaquete.set(p.id, (p.destino_id as number | null) ?? null);
    tipoPorPaquete.set(p.id, (p.tipo as HotelBernaloDescubierto["tipo"] | null) ?? "bloqueo");
  }

  const [{ data: filas, error: eAh }, { data: vuelosSel, error: eVuelo }, { data: empaquetadosSel, error: eEmp }] = await Promise.all([
    admin
      .from("armado_hoteles")
      .select("paquete_id, hotel_id, categorias, regimenes, hoteles(nombre, moneda, modelo_tarifario)")
      .in("paquete_id", idsActivos),
    admin
      .from("armado_vuelos")
      .select("paquete_id, bloqueo_id, bloqueos_vuelo(id, ruta, fecha_ida, fecha_regreso)")
      .in("paquete_id", idsActivos),
    admin
      .from("armado_empaquetados")
      .select("paquete_id, empaquetado_id, empaquetados(id, ruta, fecha_ida, fecha_regreso, activo, compra_inicio, compra_fin)")
      .in("paquete_id", idsActivos),
  ]);
  if (eAh) return { ok: false, error: eAh.message };
  if (eVuelo) return { ok: false, error: eVuelo.message };
  if (eEmp) return { ok: false, error: eEmp.message };

  // Hallazgo confirmado (validación final, canal separado de identidad):
  // TODOS los `hotel_id` cuyo `hoteles.modelo_tarifario` (columna FRESCA,
  // recién consultada arriba vía el join) es "unidad" — SIN aplicar todavía
  // ningún filtro de tipo de paquete ni de publicación. Antes VistaBooking
  // derivaba esta identidad de `hotelesBernaloFiltrados` (las tarjetas ya
  // filtradas por acomodación/categoría/régimen/texto en TarifarioPublic) —
  // al activar cualquiera de esos filtros, el hotel podía desaparecer de esa
  // lista y su fila persona obsoleta reaparecía. Este `Set` se calcula UNA
  // sola vez, ANTES de `tipoCompatible`/`paresPublicadosPorHotel`, y viaja
  // sin tocar hasta VistaBooking exclusivamente para excluir tarjetas
  // persona obsoletas — nunca se usa para decidir qué tarjeta unidad
  // mostrar (eso lo sigue decidiendo `hoteles`, más abajo).
  const hotelIdsUnidadAutoritativos = [
    ...new Set(
      (filas ?? [])
        .filter((f) => (f.hoteles as unknown as { modelo_tarifario?: string | null } | null)?.modelo_tarifario === "unidad")
        .map((f) => f.hotel_id)
    ),
  ];

  // P1-3 (hallazgo confirmado): antes se publicaba una oferta con solo
  // `armado_hoteles.categorias/regimenes` no vacíos, SIN comprobar que
  // hubiera una tarifa `publicada` (`hotel_tarifas_unidad`) para cada
  // combinación configurada — un hotel con categorías/alimentación
  // configuradas pero sin ninguna tarifa cargada (o con tarifas en
  // `borrador`/`inactiva`) se mostraba como "disponible" y solo fallaba al
  // intentar cotizar. Ahora se cruza con `hotel_tarifas_unidad` ANTES de
  // exponer la oferta — mismo criterio y MISMO helper puro
  // (`lib/calc/paresPublicadosUnidad.ts`) que ya usa `setHotelFiltros`
  // (`app/(dashboard)/dashboard/paquetes/actions.ts`) y `generarTarifario`:
  // el producto cartesiano categorías×alimentaciones CONFIGURADO debe estar
  // COMPLETO en los pares REALES publicados. `categoria`/`alimentacion`
  // salen SIEMPRE de las columnas espejo de `hotel_tarifas_unidad` — nunca
  // del `payload` (el payload no es de fiar para listar/filtrar sin abrir
  // el JSON, ver la migración 173).
  // P2 (hallazgo confirmado, validación final): el motor de cotización
  // Bernalo (`computarReservaBernalo`) no soporta `salidas_dinamicas`
  // todavía, y el tipo "servicios" no tiene concepto de hotel cotizable (es
  // solo add-ons) — Vista Booking no sabe mostrar ni cotizar una oferta
  // unidad de un paquete de esos dos tipos. Se excluyen del catálogo
  // cotizable actual desde ACÁ (el descubrimiento), no solo en el consumidor:
  // así ningún llamador (Vista Booking, el aviso de `generarTarifario`)
  // puede anunciarlas como disponibles por accidente. No se implementa
  // `salidas_dinamicas` en el motor Bernalo en esta tarea — ver el informe.
  const TIPOS_UNIDAD_COMPATIBLES = new Set<HotelBernaloDescubierto["tipo"]>(["bloqueo", "porcion_terrestre"]);
  const tipoCompatible = (paqueteId: number) => TIPOS_UNIDAD_COMPATIBLES.has(tipoPorPaquete.get(paqueteId) ?? "bloqueo");

  const hotelIdsUnidad = [
    ...new Set(
      (filas ?? [])
        .filter((f) => (f.hoteles as unknown as { modelo_tarifario?: string | null } | null)?.modelo_tarifario === "unidad")
        .filter((f) => tipoCompatible(f.paquete_id))
        .map((f) => f.hotel_id)
    ),
  ];
  const paresPublicadosPorHotel = new Map<number, Set<string>>();
  if (hotelIdsUnidad.length) {
    const { data: tarifasPublicadas, error: eTarifas } = await admin
      .from("hotel_tarifas_unidad")
      .select("hotel_id, categoria, alimentacion")
      .in("hotel_id", hotelIdsUnidad)
      .eq("estado", "publicada");
    // Falla cerrado ante un error TÉCNICO de esta consulta — nunca se
    // disfraza de "cero hoteles disponibles" (eso sería un catálogo vacío
    // falso, indistinguible de que en verdad no haya nada publicado). El
    // error se propaga igual que `eAh`/`eVuelo`/`eEmp` arriba, con
    // observabilidad en el llamador (`app/tarifario/page.tsx` ya registra
    // `resultadoBernalo.error` con `registrarErrorTecnico`).
    if (eTarifas) return { ok: false, error: eTarifas.message };
    const filasPorHotel = new Map<number, { categoria: string | null; alimentacion: string | null }[]>();
    for (const t of tarifasPublicadas ?? []) {
      const arr = filasPorHotel.get(t.hotel_id) ?? [];
      arr.push({ categoria: t.categoria, alimentacion: t.alimentacion });
      filasPorHotel.set(t.hotel_id, arr);
    }
    for (const [hotelId, filasPub] of filasPorHotel) {
      paresPublicadosPorHotel.set(hotelId, construirSetParesPublicados(filasPub));
    }
  }

  // ── Salidas por paquete — MISMOS filtros exactos que `generarTarifario`
  // (regla A2.8): bloqueo con fechas completas; empaquetado activo +
  // fechas completas + vigente. Nunca se expone `tarifa_para_empaquetar`.
  const hoy = hoyBogota(new Date());
  const salidasPorPaquete = new Map<number, SalidaAereaBernalo[]>();
  const agregar = (paqueteId: number, salida: SalidaAereaBernalo) => {
    const arr = salidasPorPaquete.get(paqueteId) ?? [];
    arr.push(salida);
    salidasPorPaquete.set(paqueteId, arr);
  };
  for (const v of vuelosSel ?? []) {
    const b = v.bloqueos_vuelo as unknown as { id: number; ruta: string | null; fecha_ida: string | null; fecha_regreso: string | null } | null;
    if (!b || !b.fecha_ida || !b.fecha_regreso) continue;
    agregar(v.paquete_id, { tipo: "bloqueo", id: b.id, fechaIda: b.fecha_ida, fechaRegreso: b.fecha_regreso, etiqueta: b.ruta || "" });
  }
  for (const v of empaquetadosSel ?? []) {
    const e = v.empaquetados as unknown as {
      id: number; ruta: string | null; fecha_ida: string | null; fecha_regreso: string | null;
      activo: boolean; compra_inicio: string | null; compra_fin: string | null;
    } | null;
    if (!e || !e.activo || !e.fecha_ida || !e.fecha_regreso) continue;
    if (!empaquetadoVigente(e.compra_inicio, e.compra_fin, hoy)) continue;
    agregar(v.paquete_id, { tipo: "empaquetado", id: e.id, fechaIda: e.fecha_ida, fechaRegreso: e.fecha_regreso, etiqueta: e.ruta || "" });
  }

  const hoteles: HotelBernaloDescubierto[] = [];
  for (const f of filas ?? []) {
    const hotelMeta = f.hoteles as unknown as { nombre: string; moneda?: string | null; modelo_tarifario?: string | null } | null;
    if (hotelMeta?.modelo_tarifario !== "unidad") continue;
    // P2: paquete "dinamico"/"servicios" — no compatible con el catálogo
    // cotizable actual (ver el comentario junto a `TIPOS_UNIDAD_COMPATIBLES`
    // arriba). Nunca se anuncia como disponible.
    if (!tipoCompatible(f.paquete_id)) continue;
    const categorias = (f.categorias as string[] | null) ?? [];
    const regimenes = (f.regimenes as string[] | null) ?? [];
    // Oferta INVÁLIDA/no disponible (distinto de "error técnico", ya
    // devuelto arriba): sin categorías/regímenes configurados, o con el
    // producto cartesiano configurado incompleto contra lo REALMENTE
    // publicado — nunca se expone como si fuera cotizable.
    const paresPublicados = paresPublicadosPorHotel.get(f.hotel_id) ?? new Set<string>();
    if (!todosLosParesConfiguradosPublicados(categorias, regimenes, paresPublicados)) continue;
    hoteles.push({
      hotelId: f.hotel_id,
      hotelNombre: hotelMeta.nombre,
      paqueteId: f.paquete_id,
      paqueteNombre: nombrePorPaquete.get(f.paquete_id) ?? "",
      destinoNombre: destinoPorPaquete.get(f.paquete_id) ?? null,
      destinoId: destinoIdPorPaquete.get(f.paquete_id) ?? null,
      tipo: tipoPorPaquete.get(f.paquete_id) ?? "bloqueo",
      categorias,
      regimenes,
      moneda: monedaExplicita(hotelMeta.moneda),
      salidas: salidasPorPaquete.get(f.paquete_id) ?? [],
    });
  }
  return { ok: true, hoteles, hotelIdsUnidadAutoritativos };
}

// ── P2 (hallazgo confirmado) ────────────────────────────────────────────
// La tarjeta de un hotel por unidad mostraba "Sin foto" fijo y nunca leía
// estrellas/descripción/ubicación/Adults Only/Pet friendly reales — porque
// `fotosPorHotel`/`infoPorHotel` (ver `lib/tarifario/resumen.ts`) solo se
// construyen a partir de los `hotelId` de `filasVisibles` (hoteles persona,
// de `tarifario_resultado`). Este loader hace el MISMO enriquecimiento
// (mismas columnas de `hoteles`/`hotel_fotos`) pero para los `hotelId` de
// hoteles por unidad — el llamador (`app/tarifario/page.tsx`) mezcla el
// resultado con el de `resumen.ts` antes de pasarlo a `TarifarioPublic`.
// Puro I/O, best-effort (mismo criterio que fotos/planes en `resumen.ts`):
// un fallo acá es decorativo (la tarjeta queda sin foto/badges), nunca debe
// bloquear la página — el llamador decide qué hacer con `ok:false`.
// Mismo shape EXACTO que `InfoHotelDato` (`lib/tarifario/datos.ts`) — no se
// importa (ese archivo depende de `@/app/tarifario/TarifarioPublic` vía
// alias, que no resuelve bajo `node --test` plano; ver la nota de imports
// relativos en la cabecera). Se duplica la FORMA a propósito, nunca la
// lógica: así el resultado de este loader se puede fusionar (spread) con
// `infoPorHotel` de `resumen.ts` sin perder campos ni violar el tipo que ya
// consumen `TarifarioPublic.tsx`/`VistaBooking.tsx`.
export type InfoHotelBernaloDato = {
  estrellas: number | null;
  clasificacion: string | null;
  descripcion: string | null;
  ubicacion: string | null;
  video_url: string | null;
  ninoMin: number | null;
  ninoMax: number | null;
  infMin: number | null;
  infMax: number | null;
  infanteCargo: boolean;
  infanteNota: string | null;
  ninoNota: string | null;
  adultsOnly: boolean;
  petFriendly: boolean;
  petCargo: boolean;
  petCostoDesc: string | null;
  petNota: string | null;
};

// P5 (hallazgo confirmado): antes un error en CUALQUIERA de las dos
// consultas (`hotel_fotos`/`hoteles`) devolvía `ok:false` y el llamador
// descartaba TODO el resultado — así que un fallo puntual en `hotel_fotos`
// (p. ej. throttling) también borraba estrellas/Adults Only/Pet friendly
// que SÍ se habían resuelto bien, y viceversa. El loader legacy
// (`lib/tarifario/resumen.ts`) nunca hace esto: cada consulta auxiliar es
// independiente y best-effort — un error ahí deja esa pieza vacía/parcial
// pero nunca tumba las demás. Este loader replica el mismo criterio: las
// dos consultas se evalúan por separado y cada `errorFotos`/`errorInfo` es
// su propio canal — el llamador decide si registrar observabilidad, pero
// SIEMPRE recibe los datos que sí se pudieron resolver.
export type ResultadoInfoHotelesBernalo = {
  fotosPorHotel: Record<number, string>;
  infoPorHotel: Record<number, InfoHotelBernaloDato>;
  errorFotos: string | null;
  errorInfo: string | null;
};

export async function cargarInfoHotelesBernalo(hotelIds: readonly number[]): Promise<ResultadoInfoHotelesBernalo> {
  if (!hotelIds.length) return { fotosPorHotel: {}, infoPorHotel: {}, errorFotos: null, errorInfo: null };
  const admin = createAdminClient();
  const [{ data: fotos, error: eFotos }, { data: hotelesRows, error: eHoteles }] = await Promise.all([
    admin.from("hotel_fotos").select("hotel_id, url, es_portada, orden").in("hotel_id", hotelIds).order("orden"),
    admin
      .from("hoteles")
      .select(
        "id, estrellas, clasificacion, descripcion, ubicacion, video_url, edad_nino_min, edad_nino_max, edad_infante_min, edad_infante_max, nino_nota, adults_only, pet_friendly, pet_costo_neto, pet_costo_desc, pet_nota"
      )
      .in("id", hotelIds),
  ]);

  // Cada bloque solo se llena si SU consulta tuvo éxito — un fallo en
  // `hotel_fotos` deja `fotosPorHotel` vacío pero no toca `infoPorHotel`
  // (que ya se resolvió con su propia consulta independiente), y viceversa.
  const fotosPorHotel: Record<number, string> = {};
  if (!eFotos) {
    for (const f of fotos ?? []) {
      if (fotosPorHotel[f.hotel_id] == null) fotosPorHotel[f.hotel_id] = f.url;
      if (f.es_portada) fotosPorHotel[f.hotel_id] = f.url;
    }
  }

  const infoPorHotel: Record<number, InfoHotelBernaloDato> = {};
  if (!eHoteles) {
    for (const h of hotelesRows ?? []) {
      infoPorHotel[h.id] = {
        estrellas: h.estrellas,
        clasificacion: h.clasificacion,
        descripcion: h.descripcion,
        ubicacion: h.ubicacion,
        video_url: h.video_url,
        ninoMin: h.edad_nino_min,
        ninoMax: h.edad_nino_max,
        infMin: h.edad_infante_min,
        infMax: h.edad_infante_max,
        // Mismo criterio que `resumen.ts`/`datos.ts`: infanteCargo/infanteNota
        // son del modelo persona (tarifa de infante por acomodación); un
        // hotel unidad no tiene ese concepto, así que quedan en el default
        // neutro (no se inventa un cargo que no existe para este modelo).
        infanteCargo: false,
        infanteNota: null,
        ninoNota: h.nino_nota,
        adultsOnly: h.adults_only ?? false,
        petFriendly: h.pet_friendly ?? false,
        petCargo: (Number(h.pet_costo_neto) || 0) > 0,
        petCostoDesc: h.pet_costo_desc,
        petNota: h.pet_nota,
      };
    }
  }
  return { fotosPorHotel, infoPorHotel, errorFotos: eFotos?.message ?? null, errorInfo: eHoteles?.message ?? null };
}

// ── Hoteles recomendados (migración 183) — prioridades de paquetes UNIDAD ──
// `lib/tarifario/resumen.ts::cargarResumenTarifario` solo consulta
// `armado_hoteles.prioridad` para `paqIdsConHotel` (paquetes con fila
// persona en `tarifario_resumen`) — un paquete cuyo ÚNICO hotel es
// `modelo_tarifario = 'unidad'` nunca aparece ahí (mismo hallazgo que
// `descripcionPorPaquete` arriba), así que sus prioridades quedarían
// invisibles para VistaBooking. Este loader cierra ese hueco: consulta
// `armado_hoteles.prioridad` para los `paqueteId` de `hotelesBernalo`
// (descubrimiento paralelo), y el llamador (`page.tsx`) fusiona el
// resultado con `prioridadesRecomendados` de la carga persona — la MISMA
// clave (`claveOferta`, hotelId+paqueteId) en ambos, así que combinan sin
// colisión (un paquete no puede ser persona Y unidad para el mismo hotel).
// Best-effort: un error acá deja esa parte vacía (los hoteles recomendados
// de paquetes unidad simplemente no aparecen como recomendados esa carga),
// nunca bloquea la página — mismo criterio que el resto de este archivo.
export async function cargarPrioridadesRecomendadosBernalo(
  paqueteIds: readonly number[]
): Promise<{ prioridades: Record<string, number>; error: string | null }> {
  if (!paqueteIds.length) return { prioridades: {}, error: null };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("armado_hoteles")
    .select("paquete_id, hotel_id, prioridad")
    .in("paquete_id", paqueteIds)
    .not("prioridad", "is", null);
  if (error) return { prioridades: {}, error: error.message };
  const prioridades: Record<string, number> = {};
  for (const f of data ?? []) {
    if (f.prioridad != null) prioridades[claveOferta(f.hotel_id, f.paquete_id)] = f.prioridad;
  }
  return { prioridades, error: null };
}

// ── Hallazgo confirmado (auditoría posterior a la tarjeta completa) ────────
// `descripcionPorPaquete` (lib/tarifario/resumen.ts) se carga SOLO para
// `paqIdsConHotel` — paquetes con al menos una fila `bloqueo`/`porcion_
// terrestre` en `tarifario_resumen`. Un paquete cuyo ÚNICO hotel es
// `modelo_tarifario = 'unidad'` nunca genera esas filas (ese modelo no vive
// en `tarifario_resultado`, ver el comentario de `hotelesBernaloExcluidos`
// en `app/(dashboard)/dashboard/paquetes/actions.ts`), así que su
// `paqueteId` puede estar en `hotelesBernalo` sin estar nunca en
// `descripcionPorPaquete` — Incluye/No incluye queda vacío aunque el
// paquete SÍ tenga contenido configurado en `armado_paquetes`.
//
// Este loader completa EXACTAMENTE esos huecos: el llamador (`app/tarifario/
// page.tsx`) calcula qué `paqueteId` de `hotelesBernalo` YA tienen
// descripción cargada por el flujo persona y pasa acá SOLO los que faltan —
// nunca el catálogo completo de paquetes (regla 6 del encargo). Mismas 4
// columnas exactas que ya lee `resumen.ts` (`armado_paquetes.programa_*`),
// mismo shape (`DescripcionPaqueteRaw`), para que el resultado se pueda
// fusionar (spread) sin transformar nada. Puro I/O, best-effort (mismo
// criterio que `cargarInfoHotelesBernalo`): un fallo aquí es puramente
// decorativo (el paquete queda sin Incluye/No incluye, nunca sin precio ni
// disponibilidad) — el llamador decide si registrar observabilidad, pero
// nunca debe bloquear la página ni inventar contenido.
export type ResultadoDescripcionPaquetesBernalo = {
  descripcionPorPaquete: Record<number, DescripcionPaqueteRaw>;
  error: string | null;
};

export async function cargarDescripcionPaquetesBernalo(
  paqueteIds: readonly number[]
): Promise<ResultadoDescripcionPaquetesBernalo> {
  if (!paqueteIds.length) return { descripcionPorPaquete: {}, error: null };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("armado_paquetes")
    .select("id, programa_incluye, programa_no_incluye, programa_tarifas_especiales, programa_condiciones_comerciales")
    .in("id", paqueteIds);
  if (error) return { descripcionPorPaquete: {}, error: error.message };
  // Mapeo delegado al helper PURO compartido (probado con ejecución real en
  // pruebas/descripcionPaquete.test.ts) — este archivo queda como I/O puro:
  // consulta y devuelve, sin repetir la transformación fila→shape.
  return { descripcionPorPaquete: filasArmadoPaqueteADescripcionPorPaquete((data ?? []) as unknown as FilaArmadoPaqueteDescripcion[]), error: null };
}
