// #36 — Estado de PUBLICACIÓN de un paquete en el listado, separado del check «Activo». Módulo PURO (sin I/O): lo usan el listado de Paquetes y las pruebas.
//
// «Activo» solo dice que el paquete puede venderse; NO dice que haya algo publicado. La verdad sale de lo que la base ya guarda:
//   · armado_paquetes.tarifario_estado / tarifario_error / tarifario_diagnostico / tarifario_snapshot_publicable / tarifario_generacion_publicada (migraciones 181/256),
//     el MISMO estado que ya rotula la pantalla de armado (`estadoTarifarioVista`, lib/paquetes/armadoPestanas.ts) — aquí solo se traduce a las etiquetas del listado;
//   · combinaciones realmente publicadas (filas de `tarifario_resumen`, generación publicada);
//   · oferta por UNIDAD (hotel Bernalo) y hoteles BAJO SOLICITUD descubiertos por los mismos cargadores públicos que alimentan el tarifario
//     (cargarHotelesBernaloDescubiertos / cargarHotelesBajoSolicitud): no tienen filas de precio por persona y antes se rotulaban «Sin publicar» aunque sí se ofrecían.
// OJO: el conteo sale de la vista publicable, que SOLO muestra paquetes activos con el snapshot publicable (tarifario_snapshot_publicable): un paquete inactivo o bloqueado por un cambio de fuentes
// cuenta 0 aunque su última generación fue exitosa. Por eso 'listo' + 0 combinaciones + (inactivo o no publicable) se rotula «Publicado, no visible», nunca «Sin publicar» ni «sin oferta».
// Nunca se afirma «publicado» sin evidencia: un estado desconocido cuenta como pendiente, y un conteo > 0 con el estado distinto de 'listo' se rotula «Desactualizado».
import { estadoTarifarioVista } from "./armadoPestanas.ts";

export type ClavePublicacion = "error" | "generando" | "pendiente" | "desactualizado" | "publicado" | "publicado_avisos" | "publicado_oculto" | "cotizacion_unidad" | "bajo_solicitud" | "sin_oferta" | "oferta_sin_verificar";
export type TonoPublicacion = "ok" | "aviso" | "error";

export type EntradaPublicacion = {
  activo: boolean;
  estado: string | null | undefined;
  error: string | null | undefined;
  diagnostico: string | null | undefined;
  generacionPublicada: number | null | undefined;
  snapshotPublicable: boolean | null | undefined;
  /** Combinaciones publicadas por persona (filas de tarifario_resumen del paquete). */
  combinaciones: number;
  /** Hoteles por unidad (Bernalo) del paquete que el tarifario público realmente ofrece para cotizar. */
  hotelesUnidad: number;
  /** Hoteles «bajo solicitud» del paquete que el tarifario público realmente ofrece. */
  hotelesSolicitud: number;
  /** ¿Se pudo comprobar la oferta por unidad / bajo solicitud? `false` = la lectura falló: esos conteos son DESCONOCIDOS, no cero. Por omisión true. */
  unidadVerificada?: boolean;
  solicitudVerificada?: boolean;
};

export type PublicacionPaquete = {
  clave: ClavePublicacion;
  etiqueta: string;
  detalle: string | null;
  tono: TonoPublicacion;
  /** Otras ofertas reales del paquete que no son la principal (p. ej. cotización por unidad junto a tarifas por persona). */
  secundarias: string[];
};

const ETIQUETA_UNIDAD = "Cotización por unidad";
const ETIQUETA_SOLICITUD = "Bajo solicitud";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function estadoPublicacionPaquete(e: EntradaPublicacion): PublicacionPaquete {
  const combos = Math.max(0, Math.floor(Number.isFinite(e.combinaciones) ? e.combinaciones : 0));
  const unidad = e.hotelesUnidad > 0;
  const solicitud = e.hotelesSolicitud > 0;
  const estado = (e.estado ?? "").trim();
  const vista = estadoTarifarioVista(estado, e.error, e.snapshotPublicable, e.diagnostico);
  const inactivo = e.activo ? null : "No visible mientras el paquete esté inactivo.";
  // Solo un paquete ACTIVO puede tener oferta por unidad/solicitud (el descubrimiento público excluye los inactivos): para uno inactivo la verificación no aplica.
  const sinUnidad = e.activo && e.unidadVerificada === false;
  const sinSolicitud = e.activo && e.solicitudVerificada === false;
  const unir = (...t: (string | null | undefined)[]) => t.filter((x): x is string => !!x).join(" ") || null;

  const extras = (principal: "unidad" | "solicitud" | null): string[] => {
    const s: string[] = [];
    if (unidad && principal !== "unidad") s.push(ETIQUETA_UNIDAD);
    if (solicitud && principal !== "solicitud") s.push(ETIQUETA_SOLICITUD);
    // Lo que no se pudo comprobar se dice; la evidencia conocida (arriba) se conserva.
    if (sinUnidad && !unidad) s.push("Unidad sin verificar");
    if (sinSolicitud && !solicitud) s.push("Solicitud sin verificar");
    return s;
  };

  if (estado === "fallido") {
    return { clave: "error", etiqueta: "Error de generación", tono: "error", secundarias: extras(null),
      detalle: unir(vista.detalle, combos > 0 ? `Se conserva la última publicación (${plural(combos, "combinación", "combinaciones")}).` : null, inactivo) };
  }
  if (estado === "recalculando") {
    return { clave: "generando", etiqueta: "Generando tarifario", tono: "aviso", secundarias: extras(null), detalle: unir("Hay una generación en curso.", inactivo) };
  }
  if (estado === "listo") {
    if (combos > 0) {
      const conAvisos = vista.etiqueta === "Publicado con avisos";
      return { clave: conAvisos ? "publicado_avisos" : "publicado", etiqueta: conAvisos ? "Tarifas publicadas con avisos" : "Tarifas publicadas", tono: conAvisos ? "aviso" : "ok",
        secundarias: extras(null), detalle: unir(`${plural(combos, "combinación publicada", "combinaciones publicadas")}.`, inactivo) };
    }
    if (!e.activo || e.snapshotPublicable === false) {
      return { clave: "publicado_oculto", etiqueta: "Publicado, no visible", tono: "aviso", secundarias: extras(null),
        detalle: !e.activo ? "El paquete está inactivo: sus tarifas no se muestran en el tarifario ni en Reservar hasta activarlo." : "Las tarifas están ocultas hasta que se regenere el tarifario." };
    }
    if (unidad) return { clave: "cotizacion_unidad", etiqueta: ETIQUETA_UNIDAD, tono: "ok", secundarias: extras("unidad"), detalle: unir("Se cotiza por unidad; no hay tarifas por persona.", inactivo) };
    if (solicitud) return { clave: "bajo_solicitud", etiqueta: ETIQUETA_SOLICITUD, tono: "ok", secundarias: extras("solicitud"), detalle: unir("Tarifa y disponibilidad bajo solicitud; no hay tarifas por persona.", inactivo) };
    if (sinUnidad || sinSolicitud) {
      const que = sinUnidad && sinSolicitud ? "la cotización por unidad ni la de bajo solicitud" : sinUnidad ? "la cotización por unidad" : "la oferta bajo solicitud";
      return { clave: "oferta_sin_verificar", etiqueta: "Oferta sin verificar", tono: "aviso", secundarias: extras(null),
        detalle: "No se pudo comprobar " + que + " de este paquete; no hay tarifas por persona publicadas, así que no se puede afirmar que no tenga oferta vendible." };
    }
    return { clave: "sin_oferta", etiqueta: "Publicado sin oferta vendible", tono: "aviso", secundarias: [], detalle: unir(vista.avisos ?? "La generación terminó pero no dejó combinaciones vendibles.", inactivo) };
  }
  // 'pendiente' y cualquier valor desconocido: nunca se afirma publicado.
  if (e.generacionPublicada == null && combos === 0) {
    return { clave: "pendiente", etiqueta: "Pendiente de generar", tono: "aviso", secundarias: extras(null), detalle: unir("Aún no se ha publicado el tarifario de este paquete.", inactivo) };
  }
  return { clave: "desactualizado", etiqueta: "Desactualizado", tono: "aviso", secundarias: extras(null),
    detalle: unir("Cambiaron las fuentes: genera el tarifario de nuevo.", combos > 0 ? `${plural(combos, "combinación publicada", "combinaciones publicadas")} de la generación anterior.` : null, inactivo) };
}
