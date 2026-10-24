"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Briefcase, Building2, CheckCircle2, ChevronDown, ChevronRight, Plane, RefreshCw, Settings, Table2, X, XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogoConfirmar } from "@/components/ui/DialogoConfirmar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { estadoSeleccionTodos, mensajeLote } from "@/lib/paquetes/seleccionMasiva";
import { agruparPorCategoriaVigenciaRegimen, type FilaDetalle, type GrupoTarifa } from "@/lib/paquetes/tarifarioGrupos";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { filasUnidades, resumenUnidades, ROL_NETA_BLOQUEO, ROL_REVENTA_BLOQUEO, type EntradaUnidad, type MonedaMontaje, type PublicacionMontaje } from "@/lib/paquetes/unidadesMontaje";
import { ConfigForm } from "../ConfigForm";
import { SalidasDinamicasEditor, type SalidaDinamica } from "./SalidasDinamicasEditor";
import {
  setVuelo, setTodosVuelos, setHotel, setTodosHoteles, setServicio, setServicios, generarTarifario,
  getTarifasHotel, setHotelFiltros, setHotelPrioridad, type TarifaHotelPreview, type TarifaUnidadPreview,
} from "../actions";
import { setEmpaquetado } from "../../vuelos/empaquetados-actions";
import {
  conPrioridadOptimista, sinPrioridadOptimista, reconciliarPrioridades, prioridadEfectivaDe, prioridadesOcupadasDe,
} from "@/lib/tarifario/prioridadOptimista";
import {
  ETIQUETA_PESTANA, agruparPorHotel, estadoTarifarioVista, normalizarPestana, pestanasVisibles, servicioSeleccionable,
  type ClaveEstadoTarifario, type PestanaId,
} from "@/lib/paquetes/armadoPestanas";

type Opt = { id: number; nombre: string; codigo_iata?: string | null };
type Vuelo = {
  id: number; record: string | null; ruta: string | null; aerolinea: string | null;
  fecha_ida: string | null; fecha_regreso: string | null; tarifa_para_empaquetar: number; destino_id: number | null;
  // #90 A: la neta es el COSTO (y la CxP) a la aerolínea; la de reventa (tarifa_para_empaquetar) arma el precio al cliente.
  // `moneda` null = Bloqueo sin acreditar (no se presenta como COP).
  tarifa_neta?: number | null; moneda?: string | null;
};
// Vuelos por Sistema (Empaquetados, migración 156) — mismo patrón que Vuelo,
// pero record puede ser null (PNR opcional, se agrega al comprar/emitir).
type Empaquetado = {
  id: number; record: string | null; ruta: string | null; aerolinea: string | null;
  fecha_ida: string | null; fecha_regreso: string | null; tarifa_para_empaquetar: number; destino_id: number | null;
  // 230: moneda de la tarifa (COP o USD); ausente = COP.
  moneda?: string | null;
};
type Hotel = { id: number; nombre: string; zona: string | null; destino_id: number | null; moneda?: string | null };
type Servicio = { id: number; nombre: string; precio_persona: number | null; destino_id: number | null; moneda?: string | null; servicio_tarifa_pax: { pax_desde: number }[] };
type SelServicio = { servicio_id: number; modo: string; incluido: boolean };
type SelVuelo = { bloqueo_id: number; aplica_mk: boolean; ta: number };
type SelEmpaquetado = { empaquetado_id: number; aplica_mk: boolean; ta: number };
type SelHotel = { hotel_id: number; categorias: string[] | null; regimenes: string[] | null; prioridad: number | null };
type Resultado = {
  id: number; modulo: string; bloqueo_label: string | null; hotel_nombre: string | null;
  servicio_nombre: string | null; tipo_tarifa: string | null; pax_desde: number | null; pax_hasta: number | null;
  categoria: string | null; regimen: string | null; acomodacion: string | null; noches: number | null;
  base_comisionable: number; impuesto: number; precio_pvp: number;
  // Migración 180 — procedencia REAL del precio (ver
  // lib/tarifario/procedenciaTarifario.ts::columnasProcedencia, que las
  // escribe). NUNCA se deduce por precio/nombre/notas: `temporada_ganadora`/
  // `es_promocion`/`procedencia_mixta` null+false = fila histórica generada
  // ANTES de que estas columnas existieran (sin procedencia calculada).
  temporada_ganadora: string | null;
  es_promocion: boolean | null;
  precio_final_autoritativo: boolean | null;
  procedencia_temporadas: unknown;
  procedencia_mixta: boolean;
  // #101b — datos de la salida para rotular el detalle con ruta + fechas.
  fecha_ida?: string | null; fecha_regreso?: string | null; salida_id?: number | null;
  bloqueo_id?: number | null; empaquetado_id?: number | null; moneda?: string | null;
};

const ACOM_LBL: Record<string, string> = {
  sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple", nino: "Niño", nino2: "Niño 2", infante: "Infante",
};

const ICONO_PESTANA: Record<PestanaId, LucideIcon> = {
  config: Settings, vuelos: Plane, hoteles: Building2, servicios: Briefcase, tarifario: Table2,
};

function EstadoIcono({ clave }: { clave: ClaveEstadoTarifario }) {
  if (clave === "publicado") return <CheckCircle2 className="h-4 w-4" style={{ color: "var(--brand-success)" }} aria-hidden="true" />;
  if (clave === "fallido") return <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />;
  return <RefreshCw className="h-4 w-4 text-amber-600" aria-hidden="true" />;
}

export function ArmadoClient(props: {
  paqueteId: number;
  destinos: Opt[];
  config: Parameters<typeof ConfigForm>[0]["initial"];
  tieneDestino: boolean;
  vuelosDisp: Vuelo[];
  empaquetadosDisp: Empaquetado[];
  hotelesDisp: Hotel[];
  serviciosDisp: Servicio[];
  selVuelos: SelVuelo[];
  selEmpaquetados: SelEmpaquetado[];
  selHoteles: SelHotel[];
  selServicios: SelServicio[];
  resultado: Resultado[];
  salidas?: SalidaDinamica[];
  moneda?: string;
  // #90 A — publicación de la SELECCIÓN actual (page.tsx). Sin ella (pruebas antiguas) se usa `moneda`.
  publicacionMontaje?: PublicacionMontaje;
  // #93 — estado de la TRM del modo COP evaluado sobre las fuentes guardadas ("No requiere conversión" / "Falta la TRM…" / "TRM x").
  textoTrmMontaje?: string;
  // #67 — error técnico al leer los destinos aéreos del paquete (distinto de "no hay vuelos").
  destinosAereosError?: string | null;
  // #101 — pestaña inicial (`?tab=`) y estado del tarifario (armado_paquetes.tarifario_estado / tarifario_error /
  // tarifario_snapshot_publicable). Opcionales: sin ellos se deduce de si hay filas publicadas.
  pestanaInicial?: string | null;
  tarifarioEstado?: string | null;
  tarifarioError?: string | null;
  tarifarioPublicable?: boolean | null;
}) {
  const router = useRouter();
  const tipo = (props.config?.tipo ?? "bloqueo") as "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  // Errores de vincular/desvincular vuelos (#67): el servidor y la base pueden
  // rechazar un vuelo cuyo destino no está permitido; se muestran junto a los vuelos.
  const [errVinculo, setErrVinculo] = useState("");

  // Etiqueta del destino de LLEGADA de cada vuelo ("Punta Cana (PUJ)"): se muestra
  // cuando difiere del destino comercial; nunca se inventa un aeropuerto.
  const destinoPorId = new Map(props.destinos.map((d) => [d.id, d]));
  const etiquetaAerea = (destinoId: number | null): string | null => {
    if (destinoId == null || destinoId === props.config?.destinoId) return null;
    const d = destinoPorId.get(destinoId);
    return d ? `${d.nombre}${d.codigo_iata ? ` (${d.codigo_iata})` : ""}` : null;
  };
  const vueloSel = new Map(props.selVuelos.map((v) => [v.bloqueo_id, v]));
  const hotelSel = new Map(props.selHoteles.map((h) => [h.hotel_id, h]));
  const servSel = new Map(props.selServicios.map((s) => [s.servicio_id, s]));
  // #90 A — unidades de cada componente SELECCIONADO frente a la moneda de publicación. Solo informa: no convierte ni supone TRM.
  const publicacion: PublicacionMontaje = props.publicacionMontaje ?? { estado: "publicable", moneda: props.moneda === "USD" ? "USD" : "COP" };
  const monedaPublicacion: MonedaMontaje | null = publicacion.estado === "publicable" ? publicacion.moneda : null;
  const entradasUnidades: EntradaUnidad[] = [
    ...props.vuelosDisp.filter((v) => vueloSel.has(v.id)).map((v): EntradaUnidad => ({
      tipo: "bloqueo", nombre: v.record || v.ruta || `Bloqueo #${v.id}`, moneda: v.moneda,
      importes: [{ rol: ROL_NETA_BLOQUEO, valor: v.tarifa_neta }, { rol: ROL_REVENTA_BLOQUEO, valor: v.tarifa_para_empaquetar }],
    })),
    ...props.empaquetadosDisp.filter((e) => props.selEmpaquetados.some((x) => x.empaquetado_id === e.id)).map((e): EntradaUnidad => ({
      tipo: "empaquetado", nombre: e.record || e.ruta || `Empaquetado #${e.id}`, moneda: e.moneda,
      importes: [{ rol: "Tarifa a empaquetar", valor: e.tarifa_para_empaquetar }],
    })),
    ...props.hotelesDisp.filter((h) => hotelSel.has(h.id)).map((h): EntradaUnidad => ({ tipo: "hotel", nombre: h.nombre, moneda: h.moneda })),
    ...props.serviciosDisp.filter((sv) => servSel.has(sv.id)).map((sv): EntradaUnidad => ({
      tipo: "servicio", nombre: sv.nombre, moneda: sv.moneda, importes: [{ rol: "Por persona", valor: sv.precio_persona }],
    })),
  ];
  const filasUnid = filasUnidades(entradasUnidades, monedaPublicacion);
  const resumenUnid = resumenUnidades(filasUnid);
  // Autosave OPTIMISTA de prioridad (defecto 4): `hotelId -> prioridad` recién
  // elegida, aplicada POR ENCIMA de lo que trajo el servidor. Un guardado
  // exitoso de prioridad NO recarga el editor (`router.refresh()` re-renderiza
  // todo el paquete y tardaba varios segundos); este mapa es lo que mantiene el
  // número elegido visible sin recarga. Sobrevive a los `router.refresh()` de
  // las DEMÁS operaciones del editor (activar/desactivar un hotel, generar
  // tarifario…), que siguen refrescando como siempre.
  //
  // La reconciliación vive en `lib/tarifario/prioridadOptimista.ts` (puro y
  // probado): un override se descarta en cuanto el servidor trae ESE valor
  // (reconocido) o en cuanto la fila desaparece de las props (hotel
  // desasociado). Así el mapa no acumula overrides viejos para siempre, el
  // dato fresco del servidor vuelve a mandar, y volver a asociar un hotel no
  // resucita una prioridad local anterior.
  const [prioridadesOptimistas, setPrioridadesOptimistas] = useState<Map<number, number | null>>(new Map());
  const filasServidorPrioridad = useMemo(
    () => props.selHoteles.map((h) => ({ hotel_id: h.hotel_id, prioridad: h.prioridad })),
    [props.selHoteles]
  );
  // Reconciliación SIN efectos: patrón oficial de React ("ajustar estado cuando
  // cambian las props"). Se compara la identidad del arreglo derivado de las
  // props — cambia exactamente cuando el servidor entrega datos nuevos — y, si
  // cambió, se reconcilia DURANTE el render. React re-ejecuta el render de
  // inmediato sin pintar el intermedio, así que no hay parpadeo, y NO se usa
  // `useEffect` (la regla `react-hooks/set-state-in-effect` lo prohíbe, y con
  // razón: un efecto acá provocaría un segundo render con estado viejo).
  const [generacionPrioridad, setGeneracionPrioridad] = useState(filasServidorPrioridad);
  if (generacionPrioridad !== filasServidorPrioridad) {
    setGeneracionPrioridad(filasServidorPrioridad);
    setPrioridadesOptimistas((prev) => reconciliarPrioridades(prev, filasServidorPrioridad));
  }
  const prioridadEfectiva = (hotelId: number): number | null =>
    prioridadEfectivaDe(prioridadesOptimistas, hotelId, hotelSel.get(hotelId)?.prioridad ?? null);
  const setPrioridadOptimista = (hotelId: number, prioridad: number | null) =>
    setPrioridadesOptimistas((prev) => conPrioridadOptimista(prev, hotelId, prioridad));
  // Camino de FALLO: se ELIMINA el override (nunca se deja uno con el valor
  // "de reversión"), para que el dato autoritativo del servidor no quede tapado.
  const descartarPrioridadOptimista = (hotelId: number) =>
    setPrioridadesOptimistas((prev) => sinPrioridadOptimista(prev, hotelId));
  // Prioridades 1-6 YA tomadas por otros hoteles de ESTE paquete — para
  // deshabilitar esas opciones en el selector de cada hotel (mensaje
  // comprensible ANTES de guardar; el CHECK/índice único de la base es la
  // garantía real, esto es solo UX). Se calcula con los valores EFECTIVOS, así
  // que la prioridad recién elegida en una fila queda ocupada de inmediato en
  // las demás sin esperar a un refresh. `hotel_id -> prioridad` completo (no
  // excluye ninguno todavía); cada `HotelRow` excluye la SUYA propia al armar
  // sus opciones disponibles.
  const prioridadesOcupadas = prioridadesOcupadasDe(prioridadesOptimistas, filasServidorPrioridad);

  function refrescar() {
    router.refresh();
  }

  function generar() {
    setMsg("");
    start(async () => {
      const r = await generarTarifario(props.paqueteId);
      if (r.ok) setMsg(`Tarifario generado: ${r.id ?? 0} tarifas publicadas.${r.aviso ? ` ${r.aviso}` : ""}`);
      else setMsg(`Error: ${r.error}`);
      refrescar();
    });
  }

  // ── Pestañas (#101) ──────────────────────────────────────────────────────
  // La pestaña activa vive en el estado (sobrevive a `router.refresh()` al regenerar) y se refleja en `?tab=` con
  // `history.replaceState` (sin navegar ni volver a pedir la página), así un F5 o un enlace compartido vuelven a ella.
  // `pestanaInicial` la entrega `page.tsx` leyendo `searchParams`.
  const visibles = pestanasVisibles(tipo);
  const [pestana, setPestana] = useState<PestanaId>(() => normalizarPestana(props.pestanaInicial, tipo));
  const activa = normalizarPestana(pestana, tipo);
  function cambiarPestana(id: PestanaId) {
    setPestana(id);
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", id);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* sin historial disponible: la pestaña vive solo en el estado */
    }
  }
  function teclaPestana(e: React.KeyboardEvent, idx: number) {
    const salto = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!salto) return;
    e.preventDefault();
    const siguiente = visibles[(idx + salto + visibles.length) % visibles.length];
    cambiarPestana(siguiente);
    document.getElementById(`tab-armado-${siguiente}`)?.focus();
  }

  // Servicios: selección en bloque (#98). Solo entran los que tienen alguna tarifa; cada uno se guarda con la acción de
  // siempre (`setServicio`), uno tras otro, y al final se refresca UNA vez.
  const [guardandoServicios, startServicios] = useTransition();
  const [errServicios, setErrServicios] = useState("");
  const serviciosSeleccionables = props.serviciosDisp.filter(servicioSeleccionable);
  const nSeleccionablesMarcados = serviciosSeleccionables.filter((s) => servSel.has(s.id)).length;
  // UNA acción de servidor para todo el lote (antes: una por servicio, en serie) y UN refresh al final.
  const [avisoServicios, setAvisoServicios] = useState<{ tono: "ok" | "aviso"; texto: string } | null>(null);
  function marcarTodosServicios(marcar: boolean) {
    setErrServicios("");
    setAvisoServicios(null);
    startServicios(async () => {
      const objetivo = marcar
        ? serviciosSeleccionables.filter((s) => !servSel.has(s.id))
        : props.serviciosDisp.filter((s) => servSel.has(s.id));
      if (!objetivo.length) return;
      const items = objetivo.map((s) => ({
        servicioId: s.id,
        modo: ((servSel.get(s.id)?.modo as "persona" | "grupo" | undefined) ?? (s.precio_persona != null ? "persona" : "grupo")) as "persona" | "grupo",
        incluido: servSel.get(s.id)?.incluido ?? false,
      }));
      const r = await setServicios(props.paqueteId, items, marcar);
      const m = mensajeLote(r, { singular: "servicio", plural: "servicios", accion: marcar ? "agregó" : "quitó" });
      if (m.tono === "error") setErrServicios(m.texto);
      else setAvisoServicios({ tono: m.tono, texto: m.texto });
      refrescar();
    });
  }

  // Hoteles: lote ya existente (setTodosHoteles); ahora se muestra su error y quitar todos pide confirmación porque
  // borra también las categorías/regímenes y la prioridad que se hubieran afinado por hotel.
  const [errHoteles, setErrHoteles] = useState("");
  const [confirmarQuitarHoteles, setConfirmarQuitarHoteles] = useState(false);
  async function aplicarTodosHoteles(marcar: boolean): Promise<{ ok: boolean; error?: string }> {
    setErrHoteles("");
    const r = await setTodosHoteles(props.paqueteId, props.hotelesDisp.map((h) => h.id), marcar);
    if (!r.ok) setErrHoteles(r.error);
    refrescar();
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  if (!props.tieneDestino) {
    return (
      <div className="space-y-4">
        <Section title="Configuración inicial">
          <ConfigForm destinos={props.destinos} id={props.paqueteId} initial={props.config} />
        </Section>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Asigna un <b>destino</b> en la configuración para ver los vuelos, hoteles y servicios disponibles.
        </p>
      </div>
    );
  }

  // Empaquetados (vuelos por Sistema): ya no se gestionan en un paquete de Bloqueo ni en uno Dinámico. Los que SIGUEN
  // vinculados siguen entrando al tarifario, así que se muestran en solo lectura con aviso hasta que el dueño decida.
  const empaquetadosVinculados = tipo === "bloqueo" || tipo === "dinamico" ? props.selEmpaquetados : [];
  const etiquetaTipoVinculados = tipo === "dinamico" ? "Dinámico" : "de Bloqueo";
  const empaquetadoDisp = new Map(props.empaquetadosDisp.map((e) => [e.id, e]));

  const estadoTarifario = estadoTarifarioVista(
    props.tarifarioEstado ?? (props.resultado.length ? "listo" : "pendiente"),
    props.tarifarioError,
    props.tarifarioPublicable
  );

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Secciones del paquete" className="flex flex-wrap gap-1 border-b border-gray-200">
        {visibles.map((id, idx) => {
          const Icono = ICONO_PESTANA[id];
          const esActiva = id === activa;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-armado-${id}`}
              aria-selected={esActiva}
              aria-controls={`panel-armado-${id}`}
              tabIndex={esActiva ? 0 : -1}
              onClick={() => cambiarPestana(id)}
              onKeyDown={(e) => teclaPestana(e, idx)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                esActiva ? "text-[var(--brand-primary)]" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
              style={esActiva ? { borderColor: "var(--brand-accent)" } : undefined}
            >
              <Icono className="h-4 w-4" aria-hidden="true" />
              {ETIQUETA_PESTANA[id]}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-armado-${activa}`} aria-labelledby={`tab-armado-${activa}`} className="space-y-4">
        {/* Configuración */}
        {activa === "config" && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <ConfigForm destinos={props.destinos} id={props.paqueteId} initial={props.config} />
          </div>
        )}

        {/* Vuelos */}
        {activa === "vuelos" && (
          <>
            {tipo === "bloqueo" && props.destinosAereosError && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{props.destinosAereosError}</p>
            )}
            {tipo === "bloqueo" && errVinculo && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{errVinculo}</p>
            )}

            {tipo === "bloqueo" && (
              <Section title={`Adición de vuelos (${vueloSel.size} de ${props.vuelosDisp.length})`}>
                {!props.vuelosDisp.length ? (
                  <Empty>{props.destinosAereosError ? "No se pudieron cargar los vuelos." : "No hay ciclos aéreos de los destinos permitidos en el rango de viaje."}</Empty>
                ) : (
                  <>
                    <label className="mb-1 flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={vueloSel.size === props.vuelosDisp.length && props.vuelosDisp.length > 0}
                        ref={(el) => {
                          if (el) el.indeterminate = vueloSel.size > 0 && vueloSel.size < props.vuelosDisp.length;
                        }}
                        onChange={(e) =>
                          start(async () => {
                            const r = await setTodosVuelos(
                              props.paqueteId,
                              props.vuelosDisp.map((v) => v.id),
                              e.target.checked
                            );
                            setErrVinculo(r.ok ? "" : r.error);
                            refrescar();
                          })
                        }
                      />
                      {estadoSeleccionTodos(props.vuelosDisp.length, vueloSel.size).etiqueta}
                    </label>
                    <ul className="divide-y divide-gray-100">
                      {props.vuelosDisp.map((v) => (
                        <VueloRow
                          key={v.id}
                          v={v}
                          destinoAereo={etiquetaAerea(v.destino_id)}
                          sel={vueloSel.get(v.id)}
                          paqueteId={props.paqueteId}
                          onError={setErrVinculo}
                          onDone={refrescar}
                        />
                      ))}
                    </ul>
                  </>
                )}
              </Section>
            )}

            {/* Vuelos por SISTEMA (Empaquetados, migración 156): ya no se ofrecen en Bloqueo. Solo se muestran, en
                lectura, los que quedaron vinculados (siguen alimentando el tarifario) hasta que se decida su destino. */}
            {empaquetadosVinculados.length > 0 && (
              <Section title={`Vinculados en un paquete ${etiquetaTipoVinculados}: revisar (${empaquetadosVinculados.length})`}>
                <p className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Estos vuelos por Sistema siguen vinculados a este paquete {etiquetaTipoVinculados} y
                    siguen entrando al tarifario. Aquí solo se muestran: no se pueden cambiar desde esta pantalla.
                  </span>
                </p>
                <ul className="divide-y divide-gray-100">
                  {empaquetadosVinculados.map((s) => {
                    const e = empaquetadoDisp.get(s.empaquetado_id);
                    return e ? (
                      <EmpaquetadoRow
                        key={e.id}
                        e={e}
                        destinoAereo={etiquetaAerea(e.destino_id)}
                        sel={s}
                        paqueteId={props.paqueteId}
                        onError={setErrVinculo}
                        onDone={refrescar}
                        soloLectura
                      />
                    ) : (
                      <li key={s.empaquetado_id} className="py-3 text-sm text-gray-600">
                        Empaquetado #{s.empaquetado_id} <span className="text-gray-400">· fuera del rango de viaje o inactivo</span>
                        <span className="ml-2 text-xs text-gray-500">{s.aplica_mk ? "mk del paquete" : `TA ${Number(s.ta).toLocaleString("es-CO")} (moneda no disponible)`}</span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}

            {/* Salidas dinámicas (vuelo por sistema) */}
            {tipo === "dinamico" && (
              <Section title={`Salidas dinámicas (${props.salidas?.length ?? 0})`}>
                <SalidasDinamicasEditor
                  paqueteId={props.paqueteId}
                  salidas={props.salidas ?? []}
                  moneda={props.moneda ?? "COP"}
                  modo63={props.config?.modoOferta === "cop_trm_63"}
                  trm={props.config?.trmOferta ?? null}
                />
              </Section>
            )}
          </>
        )}

        {/* Hoteles */}
        {activa === "hoteles" && (
          <Section title={`Adición de hoteles (${hotelSel.size} de ${props.hotelesDisp.length})`}>
            {!props.hotelesDisp.length ? (
              <Empty>No hay hoteles del destino.</Empty>
            ) : (
              <>
                <label className="mb-1 flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={hotelSel.size === props.hotelesDisp.length && props.hotelesDisp.length > 0}
                    ref={(el) => {
                      if (el) el.indeterminate = hotelSel.size > 0 && hotelSel.size < props.hotelesDisp.length;
                    }}
                    onChange={(e) => {
                      if (!e.target.checked) { setConfirmarQuitarHoteles(true); return; }
                      start(async () => { await aplicarTodosHoteles(true); });
                    }}
                  />
                  {estadoSeleccionTodos(props.hotelesDisp.length, hotelSel.size).etiqueta}
                </label>
                {errHoteles && (
                  <p className="mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{errHoteles}</p>
                )}
                <DialogoConfirmar
                  open={confirmarQuitarHoteles}
                  onOpenChange={setConfirmarQuitarHoteles}
                  titulo="¿Quitar todos los hoteles del paquete?"
                  descripcion="Se quitan los hoteles seleccionados junto con sus categorías, regímenes y prioridad. El tarifario se actualiza al generarlo de nuevo."
                  etiquetaConfirmar="Quitar todos"
                  destructivo
                  onConfirmar={() => aplicarTodosHoteles(false)}
                />
                <ul className="divide-y divide-gray-100">
                  {props.hotelesDisp.map((h) => (
                    <HotelRow
                      key={h.id}
                      hotel={h}
                      sel={hotelSel.get(h.id)}
                      paqueteId={props.paqueteId}
                      prioridad={prioridadEfectiva(h.id)}
                      prioridadesOcupadas={prioridadesOcupadas}
                      onPrioridadLocal={setPrioridadOptimista}
                      onPrioridadDescartar={descartarPrioridadOptimista}
                      onDone={refrescar}
                    />
                  ))}
                </ul>
              </>
            )}
          </Section>
        )}

        {/* Servicios */}
        {activa === "servicios" && (
          <Section title={`Adición de servicios (${servSel.size} de ${props.serviciosDisp.length})`}>
            {!props.serviciosDisp.length ? (
              <Empty>No hay servicios del destino.</Empty>
            ) : (
              <>
                {errServicios && (
                  <p className="mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{errServicios}</p>
                )}
                {avisoServicios && (
                  <p
                    role="status"
                    className={`mb-2 rounded-lg border p-3 text-sm ${avisoServicios.tono === "aviso" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-green-200 bg-green-50 text-green-800"}`}
                  >
                    {avisoServicios.texto}
                  </p>
                )}
                <label className="mb-1 flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    disabled={guardandoServicios || serviciosSeleccionables.length === 0}
                    checked={serviciosSeleccionables.length > 0 && nSeleccionablesMarcados === serviciosSeleccionables.length}
                    ref={(el) => {
                      if (el) el.indeterminate = nSeleccionablesMarcados > 0 && nSeleccionablesMarcados < serviciosSeleccionables.length;
                    }}
                    onChange={(e) => marcarTodosServicios(e.target.checked)}
                  />
                  {estadoSeleccionTodos(serviciosSeleccionables.length, nSeleccionablesMarcados).etiqueta}
                  {guardandoServicios && <span className="text-xs font-normal text-gray-500">Guardando…</span>}
                </label>
                <ul className="divide-y divide-gray-100">
                  {props.serviciosDisp.map((s) => (
                    <ServicioRow
                      key={s.id}
                      s={s}
                      sel={servSel.get(s.id)}
                      paqueteId={props.paqueteId}
                      onDone={refrescar}
                    />
                  ))}
                </ul>
              </>
            )}
          </Section>
        )}

        {/* Generar + resultado */}
        {activa === "tarifario" && (
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="sticky top-0 z-10 rounded-t-xl border-b border-gray-100 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0" data-testid="estado-tarifario" data-estado={estadoTarifario.clave}>
                  <p className="flex items-center gap-2 font-semibold text-gray-800">
                    <EstadoIcono clave={estadoTarifario.clave} />
                    Tarifario: {estadoTarifario.etiqueta}
                  </p>
                  {estadoTarifario.detalle && (
                    <p className={`mt-0.5 text-xs ${estadoTarifario.clave === "fallido" ? "text-red-700" : "text-gray-500"}`}>{estadoTarifario.detalle}</p>
                  )}
                  <p className="text-xs text-gray-500">Liquida el paquete y publica las tarifas por persona.</p>
                </div>
                <Button onClick={generar} disabled={pending} style={{ backgroundColor: "var(--brand-accent)" }}>
                  {pending ? "Generando…" : "Generar tarifario"}
                </Button>
              </div>
              {msg && <p className="mt-2 text-sm text-gray-600">{msg}</p>}
            </div>
            <div className="p-4 pt-0">
              <UnidadesMontaje
                publicacion={monedaPublicacion}
                rechazo={publicacion.estado === "rechazado" ? publicacion.motivo : null}
                modo63={props.config?.modoOferta === "cop_trm_63"}
                trm={props.config?.trmOferta ?? null}
                textoTrm={props.textoTrmMontaje}
                filas={filasUnid}
                resumen={resumenUnid}
              />
              <ResultadoTabla filas={props.resultado} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VueloRow({
  v, destinoAereo, sel, paqueteId, onError, onDone,
}: {
  v: Vuelo; destinoAereo: string | null; sel: SelVuelo | undefined; paqueteId: number; onError: (m: string) => void; onDone: () => void;
}) {
  const [, start] = useTransition();
  const checked = !!sel;
  const [aplicaMk, setAplicaMk] = useState(sel?.aplica_mk ?? true);
  const [ta, setTa] = useState(sel ? String(sel.ta) : "");

  function save(nextChecked: boolean, nextMk = aplicaMk, nextTa = ta) {
    start(async () => {
      const r = await setVuelo(paqueteId, v.id, nextChecked, nextMk, Number(nextTa) || 0);
      onError(r.ok ? "" : r.error);
      onDone();
    });
  }

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          onChange={(e) => save(e.target.checked)}
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800">
            {v.record} <span className="text-gray-400">·</span> {v.ruta ?? ""}{" "}
            {v.aerolinea ? <span className="text-gray-400">· {v.aerolinea}</span> : null}
          </p>
          <p className="text-xs text-gray-500">
            {v.fecha_ida} → {v.fecha_regreso}
          </p>
          <p className="text-xs text-gray-500" data-testid="vuelo-unidades">
            {v.moneda ? (
              <>
                Neta (costo y CxP) {v.tarifa_neta != null ? formatMoneda(v.tarifa_neta, v.moneda) : "sin neta"} · Reventa (precio al cliente) {formatMoneda(v.tarifa_para_empaquetar, v.moneda)}
                <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{v.moneda}</span>
              </>
            ) : (
              <>
                Neta (costo y CxP) {v.tarifa_neta != null ? Number(v.tarifa_neta).toLocaleString("es-CO") : "sin neta"} · Reventa (precio al cliente) {Number(v.tarifa_para_empaquetar).toLocaleString("es-CO")}
                <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Moneda sin acreditar</span>
              </>
            )}
          </p>
          {destinoAereo && (
            <p className="text-xs text-teal-700">Destino aéreo: {destinoAereo} · el hotel sigue siendo del destino comercial (sin traslado incluido)</p>
          )}

          {checked && (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 p-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  checked={aplicaMk}
                  onChange={() => { setAplicaMk(true); save(true, true, ta); }}
                />
                Aplicar mk del paquete
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  checked={!aplicaMk}
                  onChange={() => { setAplicaMk(false); save(true, false, ta); }}
                />
                Sumar TA
              </label>
              {!aplicaMk && (
                <span className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">TA</span>
                  <Input
                    type="number"
                    min={0}
                    value={ta}
                    onChange={(e) => setTa(e.target.value)}
                    onBlur={() => save(true, false, ta)}
                    className="h-7 w-28"
                    placeholder="0"
                  />
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// Mismo patrón que VueloRow, sobre `empaquetados`/`armado_empaquetados` en
// vez de `bloqueos_vuelo`/`armado_vuelos`. `e.record` puede ser null (un
// empaquetado puede no tener PNR todavía) — se muestra "Sin record", nunca
// como si faltara un dato obligatorio.
function EmpaquetadoRow({
  e, destinoAereo, sel, paqueteId, onError, onDone, soloLectura = false,
}: {
  e: Empaquetado; destinoAereo: string | null; sel: SelEmpaquetado | undefined; paqueteId: number; onError: (m: string) => void; onDone: () => void;
  /** #101: en un paquete de Bloqueo o Dinámico los vinculados se muestran sin poder cambiarse. */
  soloLectura?: boolean;
}) {
  const [, start] = useTransition();
  const checked = !!sel;
  const [aplicaMk, setAplicaMk] = useState(sel?.aplica_mk ?? true);
  const [ta, setTa] = useState(sel ? String(sel.ta) : "");

  function save(nextChecked: boolean, nextMk = aplicaMk, nextTa = ta) {
    start(async () => {
      const r = await setEmpaquetado(paqueteId, e.id, nextChecked, nextMk, Number(nextTa) || 0);
      onError(r.ok ? "" : r.error);
      onDone();
    });
  }

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          disabled={soloLectura}
          onChange={(ev) => save(ev.target.checked)}
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800">
            {e.record ?? "Sin record"} <span className="text-gray-400">·</span> {e.ruta ?? ""}{" "}
            {e.aerolinea ? <span className="text-gray-400">· {e.aerolinea}</span> : null}
            <span className="ml-1 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">Sistema</span>
          </p>
          <p className="text-xs text-gray-500">
            {e.fecha_ida} → {e.fecha_regreso} · tarifa empaquetar {formatMoneda(e.tarifa_para_empaquetar, e.moneda)}
          </p>
          {destinoAereo && (
            <p className="text-xs text-teal-700">Destino aéreo: {destinoAereo} · el hotel sigue siendo del destino comercial (sin traslado incluido)</p>
          )}

          {checked && (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 p-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  checked={aplicaMk}
                  disabled={soloLectura}
                  onChange={() => { setAplicaMk(true); save(true, true, ta); }}
                />
                Aplicar mk del paquete
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  checked={!aplicaMk}
                  disabled={soloLectura}
                  onChange={() => { setAplicaMk(false); save(true, false, ta); }}
                />
                Sumar TA
              </label>
              {!aplicaMk && (
                <span className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">TA</span>
                  <Input
                    type="number"
                    min={0}
                    value={ta}
                    disabled={soloLectura}
                    onChange={(ev) => setTa(ev.target.value)}
                    onBlur={() => save(true, false, ta)}
                    className="h-7 w-28"
                    placeholder="0"
                  />
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

const PRIORIDADES = [1, 2, 3, 4, 5, 6] as const;

function HotelRow({
  hotel, sel, paqueteId, prioridad, prioridadesOcupadas, onPrioridadLocal, onPrioridadDescartar, onDone,
}: {
  hotel: Hotel; sel: SelHotel | undefined; paqueteId: number;
  /** Prioridad EFECTIVA (servidor u optimista) de este hotel en este paquete. */
  prioridad: number | null;
  prioridadesOcupadas: Map<number, number>;
  /** Aplica el valor optimista en el padre — sin recargar el editor. */
  onPrioridadLocal: (hotelId: number, prioridad: number | null) => void;
  /** ELIMINA el override del hotel (camino de fallo), sin recargar. */
  onPrioridadDescartar: (hotelId: number) => void;
  onDone: () => void;
}) {
  const [, start] = useTransition();
  const [openModal, setOpenModal] = useState(false);
  const [errPrioridad, setErrPrioridad] = useState("");
  // Petición de prioridad EN VUELO para ESTA fila: bloquea envíos concurrentes
  // (defecto 4) sin bloquear las demás filas.
  const [guardandoPrioridad, setGuardandoPrioridad] = useState(false);
  const checked = !!sel;

  const resumen = !checked
    ? null
    : sel!.categorias?.length || sel!.regimenes?.length
      ? `${sel!.categorias?.length ?? "todas las"} categorías · ${sel!.regimenes?.length ?? "todos los"} regímenes`
      : "todas las categorías y regímenes";

  // Prioridades tomadas por OTROS hoteles de este paquete (excluye la propia,
  // si tiene una) — se muestran deshabilitadas en el selector, con mensaje
  // comprensible en vez de dejar que el usuario intente y solo vea el error
  // de la base después de guardar.
  const ocupadasPorOtros = new Set(
    [...prioridadesOcupadas.entries()].filter(([hId]) => hId !== hotel.id).map(([, p]) => p)
  );

  // Autosave OPTIMISTA (defecto 4): el número elegido se refleja al instante —
  // el padre guarda el valor local y lo muestra esta misma fila — y la opción
  // queda ocupada de inmediato en los demás hoteles del paquete. Si el guardado
  // FALLA, se ELIMINA el override y se pide el dato autoritativo al servidor
  // (`onDone()`); nunca se deja un valor local "de reversión", porque un
  // override con el valor viejo es indistinguible de un guardado en vuelo y
  // podría tapar el dato fresco de forma indefinida. Sigue siendo autosave (no
  // hay botón Guardar) y el camino EXITOSO no llama a `onDone()`: recargar todo
  // el editor era justamente lo que tardaba varios segundos, y no hace falta —
  // el estado optimista ya es el correcto.
  async function cambiarPrioridad(valor: string) {
    if (guardandoPrioridad) return; // petición en vuelo de esta fila: no encimar otra
    const elegida = valor === "" ? null : Number(valor);
    if (elegida === prioridad) return; // elegir el mismo valor no dispara nada
    setErrPrioridad("");
    setGuardandoPrioridad(true);
    onPrioridadLocal(hotel.id, elegida); // optimista
    let r: { ok: boolean; error?: string };
    try {
      r = await setHotelPrioridad(paqueteId, hotel.id, elegida);
    } catch {
      r = { ok: false, error: "No fue posible guardar la prioridad. Intenta de nuevo." };
    }
    setGuardandoPrioridad(false);
    if (!r.ok) {
      setErrPrioridad(r.error ?? "No fue posible guardar la prioridad. Intenta de nuevo.");
      onPrioridadDescartar(hotel.id); // se elimina el override
      onDone();                       // y se recupera la fuente autoritativa
    }
  }

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) =>
            start(async () => {
              await setHotel(paqueteId, hotel.id, e.target.checked);
              onDone();
            })
          }
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpenModal(true)}
            className="text-left text-sm font-medium text-[var(--brand-primary)] hover:underline"
          >
            {hotel.nombre}
          </button>
          <p className="text-xs text-gray-500">
            {hotel.zona ? `${hotel.zona} · ` : ""}
            {checked ? resumen : "clic en el nombre para ver tarifas y elegir categorías/regímenes"}
          </p>
        </div>
        {checked && (
          <div className="flex flex-col items-end gap-1">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              Recomendado
              <select
                value={prioridad ?? ""}
                onChange={(e) => cambiarPrioridad(e.target.value)}
                disabled={guardandoPrioridad}
                className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs disabled:cursor-wait disabled:opacity-60"
                aria-label={`Prioridad de recomendación de ${hotel.nombre} en este paquete`}
              >
                <option value="">No recomendado</option>
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p} disabled={ocupadasPorOtros.has(p)}>
                    {p}{ocupadasPorOtros.has(p) ? " (ocupada)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {errPrioridad && <p className="max-w-[220px] text-right text-[11px] text-red-600">{errPrioridad}</p>}
          </div>
        )}
      </div>
      {openModal && (
        <HotelModal
          hotel={hotel}
          sel={sel}
          paqueteId={paqueteId}
          onClose={() => setOpenModal(false)}
          onDone={onDone}
        />
      )}
    </li>
  );
}

// Etiqueta legible de `unidadCobro` (payload de `hotel_tarifas_unidad`) —
// nunca se muestra el valor crudo del enum del motor tal cual.
const UNIDAD_COBRO_LBL: Record<string, string> = {
  persona: "Por persona",
  pareja: "Por pareja",
  habitacion: "Por habitación",
  apartamento: "Por apartamento",
};

function HotelModal({
  hotel, sel, paqueteId, onClose, onDone,
}: {
  hotel: Hotel; sel: SelHotel | undefined; paqueteId: number; onClose: () => void; onDone: () => void;
}) {
  const [loading, setLoading] = useState(true);
  // "persona" es el default seguro mientras carga: evita que, por un
  // instante, el modal trate un hotel Bernalo como si "todas" (arreglo
  // vacío) fuera válido antes de que responda `getTarifasHotel`.
  const [modelo, setModelo] = useState<"persona" | "unidad">("persona");
  const [cats, setCats] = useState<string[]>([]);
  const [regs, setRegs] = useState<string[]>([]);
  const [tarifasPersona, setTarifasPersona] = useState<TarifaHotelPreview[]>([]);
  const [tarifasUnidad, setTarifasUnidad] = useState<TarifaUnidadPreview[]>([]);
  const [selCats, setSelCats] = useState<Set<string>>(new Set());
  const [selRegs, setSelRegs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Error de CARGA (`getTarifasHotel` respondió `ok:false` — Supabase falló,
  // el hotel no existe, o `modelo_tarifario` trae un valor desconocido).
  // Separado de `error` (el de `guardar()`/`setHotelFiltros`) a propósito:
  // ante un error de carga nunca hay `categorias`/`regimenes`/`tarifas` que
  // leer (el resultado no los trae en esa rama), así que ni siquiera se
  // intenta — el modal se queda solo con el mensaje y sin forma de guardar.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  useEffect(() => {
    void (async () => {
      // P2-2 (DeepSeek): `getTarifasHotel` es una Server Action — su promesa
      // SÍ puede rechazar (red caída, el propio framework serializando un
      // error no controlado, etc.), no solo resolver con `{ ok: false }`. Sin
      // este `try/catch`, un rechazo dejaba el modal en "Cargando…" para
      // siempre: `loading` nunca bajaba a `false` porque nada después del
      // `await` llegaba a ejecutarse.
      try {
        const r = await getTarifasHotel(hotel.id);
        if (!r.ok) {
          // Fail-closed: nunca se leen r.modelo/r.categorias/r.regimenes/r.tarifas
          // (no existen en esta rama del tipo) ni se permite guardar.
          setLoadError(r.error);
          setLoading(false);
          return;
        }
        setLoadError(null);
        setModelo(r.modelo);
        setCats(r.categorias);
        setRegs(r.regimenes);
        if (r.modelo === "unidad") {
          setTarifasPersona([]);
          setTarifasUnidad(r.tarifas);
        } else {
          setTarifasUnidad([]);
          setTarifasPersona(r.tarifas);
        }
        // Selección inicial: lo guardado, o todo si era "todas" (null/persona)
        // o simplemente todo lo publicado (unidad, donde nunca hubo sentinela
        // null). P2-1 (DeepSeek): lo guardado se RECONCILIA contra las
        // opciones disponibles AHORA (`.filter(...)`) — una categoría o
        // alimentación que se guardó cuando existía, pero que el hotel ya no
        // tiene (se despublicó su tarifa, o para persona ya no aparece en
        // `tarifa_hotel`), queda huérfana en el Set de selección: no se
        // muestra ningún checkbox para ella (no está en `cats`/`regs`), pero
        // sí cuenta para `selCats.size` — eso rompía el cálculo de "todas
        // seleccionadas" y, para unidad, podía viajar tal cual a
        // `setHotelFiltros` (que la rechaza, pero sin que el usuario
        // entendiera por qué). `null` (sentinela histórico de "todas" en
        // persona) sigue sin filtrarse: no hay nada guardado que reconciliar.
        const catsGuardadas = sel?.categorias;
        const regsGuardadas = sel?.regimenes;
        setSelCats(new Set(catsGuardadas ? catsGuardadas.filter((c) => r.categorias.includes(c)) : r.categorias));
        setSelRegs(new Set(regsGuardadas ? regsGuardadas.filter((rg) => r.regimenes.includes(rg)) : r.regimenes));
        setError(null);
        setLoading(false);
      } catch {
        setLoadError("No se pudieron cargar las tarifas del hotel. Cierra esta ventana e inténtalo de nuevo.");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotel.id]);

  const tarifas = modelo === "unidad" ? tarifasUnidad : tarifasPersona;

  function toggle(set: Set<string>, val: string, setter: (s: Set<string>) => void) {
    const n = new Set(set);
    if (n.has(val)) n.delete(val);
    else n.add(val);
    setter(n);
  }

  function guardar() {
    // Defensa en profundidad: el botón de guardar no se renderiza mientras
    // haya un error de carga (ver el `return` temprano de abajo), pero
    // `guardar` no depende de eso para negarse — nunca se guarda nada si
    // `getTarifasHotel` falló.
    if (loadError) return;
    setError(null);

    // P2-1 (DeepSeek), defensa adicional: vuelve a filtrar contra `cats`/
    // `regs` (las opciones REALMENTE disponibles ahora) justo antes de armar
    // lo que se envía — nunca confía en que `selCats`/`selRegs` sigan siendo
    // un subconjunto válido (la reconciliación al cargar cubre el caso
    // normal, pero este filtro es la última puerta antes de la red).
    const selCatsVigentes = [...selCats].filter((c) => cats.includes(c));
    const selRegsVigentes = [...selRegs].filter((r) => regs.includes(r));

    // Unidad (Bernalo): si tras reconciliar/filtrar no queda NINGUNA
    // categoría o alimentación vigente, no hay nada válido que guardar —
    // nunca se descarta la configuración en silencio ni se cierra el modal:
    // se explica y se corta acá, antes de tocar la red.
    if (modelo === "unidad" && (!selCatsVigentes.length || !selRegsVigentes.length)) {
      setError(
        "Las categorías o alimentaciones guardadas para este hotel ya no están disponibles. Selecciona opciones vigentes antes de guardar."
      );
      return;
    }

    // Unidad (Bernalo): NUNCA se envía un arreglo vacío como sentinela de
    // "todas" — `armado_hoteles.categorias/regimenes = null` es justo lo que
    // deja a `computarReservaBernalo` viendo "configuración incompleta". Se
    // manda siempre la selección explícita (aunque sea el 100% de lo publicado).
    // Persona: comportamiento de siempre — "todas seleccionadas" se guarda
    // como arreglo vacío (sentinela histórico).
    const catsArr = modelo === "unidad" ? selCatsVigentes : selCatsVigentes.length === cats.length ? [] : selCatsVigentes;
    const regsArr = modelo === "unidad" ? selRegsVigentes : selRegsVigentes.length === regs.length ? [] : selRegsVigentes;
    start(async () => {
      const r = await setHotelFiltros(paqueteId, hotel.id, catsArr, regsArr);
      if (!r.ok) {
        // No cerrar el modal ni avisar éxito ante un error del servidor — el
        // hallazgo confirmado era exactamente que este resultado se ignoraba.
        setError(r.error);
        return;
      }
      onDone();
      onClose();
    });
  }

  // Unidad sin ninguna tarifa PUBLICADA válida: no hay nada que seleccionar
  // ni que guardar (guardar "todas" como vacío está prohibido para este
  // modelo) — se explica y se deshabilita, en vez de dejar guardar un
  // filtro vacío que rompería la reserva más adelante.
  const sinTarifaPublicadaUnidad = modelo === "unidad" && tarifas.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{hotel.nombre}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">Cargando tarifas…</p>
        ) : loadError ? (
          <>
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cerrar</Button>
            </div>
          </>
        ) : sinTarifaPublicadaUnidad ? (
          <p className="py-8 text-center text-sm text-gray-400">
            Este hotel usa el modelo tarifario Bernalo por unidad y no tiene ninguna tarifa <strong>publicada</strong> en
            {" "}Producto → Tarifas por unidad. Publica al menos una tarifa antes de agregarlo a este paquete.
          </p>
        ) : !tarifas.length ? (
          <p className="py-8 text-center text-sm text-gray-400">Este hotel no tiene tarifas cargadas en Producto.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PickBox
                titulo="Categorías de habitación"
                items={cats}
                sel={selCats}
                onToggle={(v) => toggle(selCats, v, setSelCats)}
                onAll={() => setSelCats(new Set(selCats.size === cats.length ? [] : cats))}
                allChecked={selCats.size === cats.length}
              />
              <PickBox
                titulo="Regímenes de alimentación"
                items={regs}
                sel={selRegs}
                onToggle={(v) => toggle(selRegs, v, setSelRegs)}
                onAll={() => setSelRegs(new Set(selRegs.size === regs.length ? [] : regs))}
                allChecked={selRegs.size === regs.length}
              />
            </div>

            {modelo === "unidad" && (!selCats.size || !selRegs.size) && (
              // P2-1 (DeepSeek): mensaje PERSISTENTE, no solo el error tras
              // intentar guardar — cubre tanto "la reconciliación al cargar
              // dejó todo huérfano" como "el usuario desmarcó todo a mano".
              // El botón de guardar ya queda deshabilitado (ver más abajo);
              // esto explica POR QUÉ, en vez de dejarlo deshabilitado en
              // silencio.
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Selecciona al menos una categoría y una alimentación vigentes para este hotel — las opciones guardadas
                anteriormente ya no están disponibles o fueron desmarcadas.
              </p>
            )}

            {modelo === "unidad" ? (
              <>
                <p className="mb-1 mt-4 text-xs font-medium text-gray-500">
                  Tarifas Bernalo publicadas (referencia — valor bruto/comisionable por unidad, no un valor per-cápita)
                </p>
                <div className="overflow-x-auto rounded-lg border border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500">
                      <tr className="border-b border-gray-100">
                        <th className="px-2 py-1 text-left">Categoría</th>
                        <th className="px-2 py-1 text-left">Alimentación</th>
                        <th className="px-2 py-1 text-left">Temp.</th>
                        <th className="px-2 py-1 text-left">Unidad de cobro</th>
                        <th className="px-2 py-1 text-right">Valor base (bruto)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tarifasUnidad.map((t, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="px-2 py-1">{t.categoria}</td>
                          <td className="px-2 py-1">{t.alimentacion}</td>
                          <td className="px-2 py-1">{t.temporada}</td>
                          <td className="px-2 py-1">{UNIDAD_COBRO_LBL[t.unidadCobro] ?? t.unidadCobro ?? "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {t.valorBaseBruto ? formatMoneda(t.valorBaseBruto, hotel.moneda) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <p className="mb-1 mt-4 text-xs font-medium text-gray-500">Tarifas netas cargadas (referencia interna)</p>
                <div className="overflow-x-auto rounded-lg border border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500">
                      <tr className="border-b border-gray-100">
                        <th className="px-2 py-1 text-left">Categoría</th>
                        <th className="px-2 py-1 text-left">Régimen</th>
                        <th className="px-2 py-1 text-left">Temp.</th>
                        <th className="px-2 py-1 text-right">Doble</th>
                        <th className="px-2 py-1 text-right">Triple</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tarifasPersona.map((t, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="px-2 py-1">{t.categoria}</td>
                          <td className="px-2 py-1">{t.regimen}</td>
                          <td className="px-2 py-1">{t.temporada}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{t.neto_doble ? formatMoneda(t.neto_doble, hotel.moneda) : "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{t.neto_triple ? formatMoneda(t.neto_triple, hotel.moneda) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {error && (
              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button
                onClick={guardar}
                disabled={saving || (modelo === "unidad" && (!selCats.size || !selRegs.size))}
                style={{ backgroundColor: "var(--brand-primary)" }}
              >
                {saving ? "Guardando…" : "Guardar y agregar hotel"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PickBox({
  titulo, items, sel, onToggle, onAll, allChecked,
}: {
  titulo: string; items: string[]; sel: Set<string>; onToggle: (v: string) => void; onAll: () => void; allChecked: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <label className="flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-medium text-gray-700">
        <input type="checkbox" checked={allChecked} onChange={onAll} />
        {titulo} (todas)
      </label>
      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {items.map((it) => (
          <li key={it}>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={sel.has(it)} onChange={() => onToggle(it)} />
              {it}
            </label>
          </li>
        ))}
        {!items.length && <li className="text-xs text-gray-400">Sin datos.</li>}
      </ul>
    </div>
  );
}

function ServicioRow({
  s, sel, paqueteId, onDone,
}: {
  s: Servicio; sel: SelServicio | undefined; paqueteId: number; onDone: () => void;
}) {
  const [, start] = useTransition();
  const checked = sel !== undefined;
  const modo = sel?.modo;
  const incluido = sel?.incluido ?? false;
  const tienePersona = s.precio_persona != null;
  const tieneGrupo = (s.servicio_tarifa_pax ?? []).length > 0;

  function save(nextChecked: boolean, nextModo: "persona" | "grupo", nextIncluido: boolean) {
    start(async () => {
      await setServicio(paqueteId, s.id, nextChecked, nextModo, nextIncluido);
      onDone();
    });
  }

  function toggle(c: boolean) {
    const def: "persona" | "grupo" = tienePersona ? "persona" : "grupo";
    save(c, (modo as "persona" | "grupo") ?? def, incluido);
  }

  const m: "persona" | "grupo" = (modo as "persona" | "grupo") ?? (tienePersona ? "persona" : "grupo");

  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => toggle(e.target.checked)} />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800">{s.nombre}</p>
          <p className="text-xs text-gray-500">
            {tienePersona ? `Persona: ${formatMoneda(s.precio_persona!, s.moneda)}` : ""}
            {tienePersona ? <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{(s.moneda ?? "COP").toUpperCase()}</span> : null}
            {tienePersona && tieneGrupo ? " · " : ""}
            {tieneGrupo ? "Grupo: por rangos de pax" : ""}
            {!servicioSeleccionable(s) && (
              <span className="text-amber-700">Sin tarifa configurada: no entra en «Seleccionar todos»</span>
            )}
          </p>
          {checked && (
            <div className="mt-2 space-y-2 rounded-lg bg-gray-50 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-gray-500">Cobro:</span>
                <label className="flex items-center gap-1" style={{ opacity: tienePersona ? 1 : 0.4 }}>
                  <input type="radio" disabled={!tienePersona} checked={m === "persona"} onChange={() => save(true, "persona", incluido)} />
                  Por persona
                </label>
                <label className="flex items-center gap-1" style={{ opacity: tieneGrupo ? 1 : 0.4 }}>
                  <input type="radio" disabled={!tieneGrupo} checked={m === "grupo"} onChange={() => save(true, "grupo", incluido)} />
                  Por grupo
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-gray-500">En el paquete:</span>
                <label className="flex items-center gap-1">
                  <input type="radio" checked={incluido} onChange={() => save(true, m, true)} />
                  Incluido (todo junto)
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" checked={!incluido} onChange={() => save(true, m, false)} />
                  Opcional (add-on)
                </label>
              </div>
              {incluido && m === "grupo" && (
                <p className="text-amber-600">“Incluido” se hornea por persona; para grupo conviene dejarlo Opcional.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// #101b — una línea compacta por categoría × vigencia × régimen; al pulsarla se abre una ventana flotante con el detalle.
function GrupoTarifaLinea({ hotel, grupo }: { hotel: string; grupo: GrupoTarifa }) {
  const [abierto, setAbierto] = useState(false);
  const moneda = grupo.moneda;
  return (
    <li>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
      >
        <span className="min-w-0 text-gray-700">
          <span className="font-medium">{grupo.categoria}</span>
          <span className="text-gray-300"> · </span>{grupo.vigencia}
          <span className="text-gray-300"> · </span>{grupo.regimen}
        </span>
        <span className="text-xs text-gray-500">
          {grupo.dobleDesde != null ? (
            <>Doble desde <b className="tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatMoneda(grupo.dobleDesde, moneda)}</b></>
          ) : "Sin tarifa doble"}
          {grupo.variaPorSalida && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">Varía por salida</span>}
        </span>
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{hotel}</DialogTitle>
            <DialogDescription>
              {grupo.categoria} · {grupo.vigencia} · {grupo.regimen}
              {grupo.variaPorSalida ? " — el precio cambia según la salida." : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {grupo.bloques.map((bl, idx) => (
              <div key={idx} className="rounded-lg border border-gray-100">
                {grupo.variaPorSalida && (
                  <p className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600" data-testid="salidas-del-bloque">
                    {bl.salidas.join(" · ")}
                  </p>
                )}
                {!grupo.variaPorSalida && grupo.nSalidas > 1 && (
                  <p className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">Mismo precio en las {grupo.nSalidas} salidas.</p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500">
                      <tr className="border-b border-gray-100">
                        <th className="px-3 py-1.5 text-left">Acomodación</th>
                        <th className="px-3 py-1.5 text-right">Noches</th>
                        <th className="px-3 py-1.5 text-right">Base com.</th>
                        <th className="px-3 py-1.5 text-right">Impuesto</th>
                        <th className="px-3 py-1.5 text-right">PVP /pax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bl.lineas.map((l, i) => (
                        <tr key={i} className="border-t border-gray-50">
                          <td className="px-3 py-1.5">{ACOM_LBL[l.acomodacion ?? ""] ?? l.acomodacion}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{l.noches}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatMoneda(l.base, moneda)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatMoneda(l.impuesto, moneda)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(l.pvp, moneda)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function ResultadoTabla({ filas }: { filas: Resultado[] }) {
  if (!filas.length) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
        Aún no hay tarifas. Selecciona vuelos/hoteles y genera el tarifario.
      </p>
    );
  }

  // Servicios (módulo servicios) aparte; las tarifas de hotel se agrupan por hotel (plegadas por defecto).
  const servicios = filas.filter((f) => f.modulo === "servicios");
  const grupos = agruparPorHotel(filas);

  return (
    <div className="mt-4 space-y-3">
      {grupos.map((g) => (
        <Section
          key={g.hotel}
          title={g.hotel}
          defaultOpen={false}
          meta={
            <span className="text-xs font-normal text-gray-500">
              {g.filas.length} {g.filas.length === 1 ? "fila" : "filas"} ·{" "}
              {g.dobleDesde != null ? (
                <>Doble desde <b className="tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatMoneda(g.dobleDesde, g.filas[0]?.moneda)}</b></>
              ) : (
                "Sin tarifa doble"
              )}
            </span>
          }
        >
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100" data-testid="grupos-tarifa">
            {agruparPorCategoriaVigenciaRegimen(g.filas as unknown as FilaDetalle[]).map((gr) => (
              <GrupoTarifaLinea key={gr.clave} hotel={g.hotel} grupo={gr} />
            ))}
          </ul>
        </Section>
      ))}

      {servicios.length > 0 && (
        <Section title={`Servicios opcionales (${servicios.length})`} defaultOpen={false}>
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500">
                <tr className="border-b border-gray-100">
                  <th className="px-3 py-1.5 text-left">Servicio</th>
                  <th className="px-3 py-1.5 text-left">Tipo</th>
                  <th className="px-3 py-1.5 text-right">Tarifa</th>
                </tr>
              </thead>
              <tbody>
                {servicios.map((r) => {
                  const esGrupo = (r.tipo_tarifa ?? "persona") === "grupo";
                  return (
                    <tr key={r.id} className="border-t border-gray-50">
                      <td className="px-3 py-1.5">{r.servicio_nombre ?? "—"}</td>
                      <td className="px-3 py-1.5 text-gray-500">{esGrupo ? `Por grupo (${r.pax_desde}–${r.pax_hasta} pax)` : "Por persona"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: "var(--brand-primary)" }}>
                        {formatMoneda(r.precio_pvp, r.moneda)} <span className="text-xs font-normal text-gray-400">{esGrupo ? "/grupo" : "/persona"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

// Sección plegable. Sin open/onToggle es no controlada (arranca según defaultOpen); con ellos, controlada.
// meta es un resumen a la derecha de la cabecera (visible aun plegada).
const ETIQUETA_TIPO_UNIDAD = { bloqueo: "Bloqueo", empaquetado: "Empaquetado", hotel: "Hotel", servicio: "Servicio" } as const;

/** #90 A — moneda real de cada componente elegido, rol de sus importes y si encajan con la moneda de publicación. No convierte. */
function UnidadesMontaje({ publicacion, rechazo, modo63, trm, textoTrm, filas, resumen }: {
  publicacion: MonedaMontaje | null; rechazo: string | null; modo63: boolean; trm: number | null; textoTrm?: string;
  filas: ReturnType<typeof filasUnidades>; resumen: ReturnType<typeof resumenUnidades>;
}) {
  // Un rechazo se muestra aunque ningún componente del vínculo aparezca en las listas del editor (p. ej. un Bloqueo fuera del rango).
  if (!filas.length && !rechazo) return null;
  return (
    <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600" data-testid="unidades-montaje">
      <p className="font-semibold text-gray-700">
        Unidades del montaje · {publicacion ? `se publica en ${publicacion}` : "sin moneda publicable con esta selección"}
        {publicacion && modo63 ? ` · modo con conversión por TRM · ${textoTrm ?? (trm ? trm.toLocaleString("es-CO") : "sin definir")}` : ""}
      </p>
      <ul className="mt-2 divide-y divide-gray-200">
        {filas.map((f, i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-1">
            <span><b>{ETIQUETA_TIPO_UNIDAD[f.tipo]}</b> · {f.nombre}</span>
            <span className="text-gray-500">
              {f.importes.map((im) => `${im.rol}: ${f.moneda ? formatMoneda(im.valor, f.moneda) : im.valor.toLocaleString("es-CO")}`).join(" · ")}
              {" "}
              <span className={f.conversion === "coincide" ? "font-semibold text-gray-700" : "font-semibold text-amber-700"}>
                {f.moneda ?? "Moneda sin acreditar"}
                {f.conversion === "requiere_trm" ? " · requiere TRM explícita" : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {rechazo && (
        <p className="mt-2 text-red-700" data-testid="unidades-rechazo">
          El generador rechazaría esta selección: {rechazo}
        </p>
      )}
      {(resumen.requierenTrm > 0 || resumen.sinAcreditar > 0) && (
        <p className="mt-2 text-amber-700">
          {resumen.requierenTrm > 0 ? `${resumen.requierenTrm} componente(s) están en otra moneda que la de publicación y solo se convertirán con una TRM explícita. ` : ""}
          {resumen.sinAcreditar > 0 ? `${resumen.sinAcreditar} sin moneda acreditada: no se convierten ni se suponen en COP. ` : ""}
          Hoy el generador rechaza la mezcla fuera del modo con conversión por TRM; el importe de cada componente se conserva en su unidad.
        </p>
      )}
    </div>
  );
}

function Section({
  title, meta, open, onToggle, defaultOpen = true, children,
}: {
  title: string; meta?: React.ReactNode; open?: boolean; onToggle?: () => void; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [interno, setInterno] = useState(defaultOpen);
  const controlada = open !== undefined;
  const abierta = controlada ? open : interno;
  const Chevron = abierta ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        aria-expanded={abierta}
        onClick={() => (controlada ? onToggle?.() : setInterno((o) => !o))}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="font-semibold text-gray-800">{title}</span>
        <span className="flex items-center gap-3">
          {meta}
          <Chevron className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
        </span>
      </button>
      {abierta && <div className="border-t border-gray-100 p-4">{children}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-gray-400">{children}</p>;
}
