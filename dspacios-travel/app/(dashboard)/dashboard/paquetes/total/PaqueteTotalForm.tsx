"use client";
// Paquete 100 % dinámico (#82): montaje. Los checks de vuelo / hotel / servicios habilitan SOLO sus pestañas.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hotel, Plane, Plus, Settings2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/DateInput";
import { pvpDeNeto } from "@/lib/paqueteDinamico/calculo";
import type { EntradaHotel, EntradaPaqueteTotal, EntradaServicio, EntradaVuelo } from "@/lib/paqueteDinamico/entrada";
import { ajenosAlPrincipal, derivarRutaManual, iataDeDestino, mensajeSinProveedor, paisComparable, seguirDestinoPrincipal } from "@/lib/paqueteDinamico/ruta";
import { ComboHotel } from "@/components/ComboHotel";
import { ComboIata } from "./ComboIata";
import { EDADES_MANUAL_POR_DEFECTO } from "@/lib/paqueteDinamico/menores";
import { guardarPaqueteTotal } from "./actions";
import { GridAcom, lbl, n, sel } from "./editorUi";
import { HotelFilaDin } from "./HotelFilaDin";

type Opt = { id: number; nombre: string; destino_id: number | null; moneda?: string };
type HotelOpt = Opt & { categorias: string[]; regimenes: string[]; reglasTexto: string | null; estrellas: number | null; descripcionFicha: string; ubicacionFicha: string };
type ServicioOpt = Opt & { moneda: string; proveedorId: number | null; proveedor: string; cobro: string | null; noSoportado: string | null; modo: "persona" | "grupo" | null; cobraInfante: boolean };
type CatalogoHotel = { categorias: string[]; regimenes: string[] };
type DestinoOpt = { id: number; nombre: string; pais: string | null; codigo_iata?: string | null };
export type EmpaquetadoOpt = { id: number; aerolinea: string | null; ruta: string | null; fecha_ida: string; fecha_regreso: string | null; destino_id: number | null; tarifa_proveedor: number; fee_infante: number };

export const ENTRADA_VACIA: EntradaPaqueteTotal = {
  nombre: "", destinoId: null, multidestino: false, destinosExtra: [], moneda: "COP", esquema: "neta_markup", pvpModo: null, pctMkPct: 20,
  usaVuelo: false, usaHotel: true, usaServicios: false, noches: 3, compraInicio: "", compraFin: "", viajeInicio: "", viajeFin: "",
  pvpGeneral: null, totalDeclarado: null, descripcion: "", incluye: "", noIncluye: "", vuelos: [], hoteles: [], servicios: [],
};

export function PaqueteTotalForm({ inicial, destinos, hoteles, servicios, empaquetados, catalogoHotel, fichasActivas }: {
  inicial: EntradaPaqueteTotal; destinos: DestinoOpt[]; hoteles: HotelOpt[]; servicios: ServicioOpt[]; empaquetados: EmpaquetadoOpt[]; catalogoHotel: CatalogoHotel;
  /** Total de fichas de hotel activas en la base (para avisar si el selector ofrece menos: falta aplicar la migración 280). */
  fichasActivas?: number;
}) {
  const router = useRouter();
  const [e, setE] = useState<EntradaPaqueteTotal>(inicial);
  const [tab, setTab] = useState<"config" | "vuelo" | "hotel" | "servicios">("config");
  const [pending, start] = useTransition();
  // El mensaje pertenece al estado del formulario en que se generó (`base`): al seguir editando deja de mostrarse.
  const [msg, setMsg] = useState<{ ok: boolean; t: string; base: EntradaPaqueteTotal } | null>(null);
  const set = (p: Partial<EntradaPaqueteTotal>) => setE((x) => ({ ...x, ...p }));
  // Aviso de por qué NO se pudo desactivar Multidestino (vuelos/servicios de destinos adicionales): nunca se cambian en silencio de destino.
  const [avisoMulti, setAvisoMulti] = useState<string | null>(null);
  // Lo escrito en el buscador de fichas: si no existe, «Hotel manual» lo toma como nombre (nunca vincula una ficha).
  const [busquedaFicha, setBusquedaFicha] = useState("");
  // Sin Multidestino el destino de todo vuelo es el principal: al cambiar el principal, los vuelos que seguían al anterior (o sin destino) lo siguen; los demás se señalan.
  const cambiarPrincipal = (nuevo: number | null) => setE((x) => ({ ...x, destinoId: nuevo, destinosExtra: [], vuelos: seguirDestinoPrincipal(x.vuelos, x.destinoId, nuevo, iataDeDestino(destinos, nuevo)) }));
  const alternarMultidestino = (activo: boolean) => {
    // Al activarlo, los vuelos manuales pasan a pedir su Destino IATA: se precarga con el del destino que ya tenían (si el catálogo lo tiene).
    if (activo) { setAvisoMulti(null); set({ multidestino: true, vuelos: e.vuelos.map((v) => (v.empaquetadoId == null && !v.destinoIata ? { ...v, destinoIata: iataDeDestino(destinos, v.destinoId ?? e.destinoId) } : v)) }); return; }
    const aj = ajenosAlPrincipal(e), total = aj.vuelos + aj.servicios;
    if (total) { setAvisoMulti(`No se puede desactivar Multidestino: ${total} ${total === 1 ? "vuelo o servicio usa" : "vuelos o servicios usan"} un destino adicional (${aj.vuelos} vuelo${aj.vuelos === 1 ? "" : "s"}, ${aj.servicios} servicio${aj.servicios === 1 ? "" : "s"}). Quítalos o cámbiales el destino primero; no se reasignan solos.`); return; }
    setAvisoMulti(null); set({ multidestino: false, destinosExtra: [] });
  };
  // Aeropuerto del destino principal según el catálogo de destinos ("" = no tiene: no se inventa).
  const iataPrincipal = iataDeDestino(destinos, e.destinoId);
  const nombrePrincipal = destinos.find((d) => d.id === e.destinoId)?.nombre ?? "";
  const neta = e.esquema === "neta_markup";
  const porComp = e.esquema === "solo_pvp" && e.pvpModo === "por_componente";
  const general = e.esquema === "solo_pvp" && e.pvpModo === "general";

  const tabs = useMemo(() => [
    { k: "config" as const, t: "Configuración", i: Settings2, on: true },
    { k: "vuelo" as const, t: "Vuelo", i: Plane, on: e.usaVuelo },
    { k: "hotel" as const, t: "Hotel", i: Hotel, on: e.usaHotel },
    { k: "servicios" as const, t: "Servicios", i: Sparkles, on: e.usaServicios },
  ], [e.usaVuelo, e.usaHotel, e.usaServicios]);
  const tabActiva = tabs.find((x) => x.k === tab)?.on ? tab : "config";

  // Sin multidestino activo solo cuenta el destino principal; activo, los adicionales del MISMO país (la base lo vuelve a exigir).
  const destinosPermitidos = new Set<number | null>([e.destinoId, ...(e.multidestino ? e.destinosExtra : [])]);
  const paisPrincipal = paisComparable(destinos.find((d) => d.id === e.destinoId)?.pais);
  const adicionalesOfrecidos = destinos.filter((d) => d.id !== e.destinoId && paisPrincipal != null && paisComparable(d.pais) === paisPrincipal);
  // Solo las fichas del destino principal (sin destino elegido no se ofrece ninguna); todas las activas, sin mirar tarifas, vigencias, moneda ni calculadora.
  const hotelesDest = hoteles.filter((h) => e.destinoId != null && h.destino_id === e.destinoId);
  const serviciosDest = servicios.filter((s) => (s.destino_id == null || destinosPermitidos.has(s.destino_id)) && s.moneda === e.moneda && !s.noSoportado);
  const empDest = empaquetados.filter((x) => x.destino_id == null || destinosPermitidos.has(x.destino_id));

  const upd = <K extends "vuelos" | "hoteles" | "servicios">(k: K, i: number, p: Partial<EntradaPaqueteTotal[K][number]>) =>
    setE((x) => ({ ...x, [k]: (x[k] as object[]).map((r, j) => (j === i ? { ...r, ...p } : r)) }) as EntradaPaqueteTotal);
  const del = (k: "vuelos" | "hoteles" | "servicios", i: number) => setE((x) => ({ ...x, [k]: (x[k] as object[]).filter((_, j) => j !== i) }) as EntradaPaqueteTotal);

  // Hotel con ficha: categoría y plan salen de lo configurado en su ficha (si solo hay uno, ya viene elegido). Manual: edades por defecto del sistema; la capacidad de niños se pide.
  const nuevoHotel = (h?: HotelOpt): EntradaHotel => ({
    hotelId: h?.id ?? null, nombre: h?.nombre ?? "", categoria: h && h.categorias.length === 1 ? h.categorias[0] : "", regimen: h && h.regimenes.length === 1 ? h.regimenes[0] : "",
    descripcion: h?.descripcionFicha ?? "", fotoUrl: "", proveedor: "", estrellas: h?.estrellas ?? null, ubicacion: h?.ubicacionFicha ?? "", neto: {}, pvp: {}, pvpGeneral: null,
    capacidadNinos: null, edadInfanteMax: h ? null : EDADES_MANUAL_POR_DEFECTO.infanteMax, edadNinoMax: h ? null : EDADES_MANUAL_POR_DEFECTO.ninoMax,
  });
  const nuevoVuelo = (x?: EmpaquetadoOpt): EntradaVuelo => ({
    empaquetadoId: x?.id ?? null, destinoId: e.multidestino ? (x?.destino_id ?? e.destinoId) : e.destinoId, aerolinea: x?.aerolinea ?? "", ruta: x?.ruta ?? "", origenIata: "", destinoIata: x ? "" : iataDeDestino(destinos, e.destinoId), fechaIda: x?.fecha_ida ?? "", fechaRegreso: x?.fecha_regreso ?? "",
    proveedor: x?.aerolinea ?? "", neto: x ? { adulto: x.tarifa_proveedor, infante: x.fee_infante } : {}, pvp: {},
  });
  const nuevoServicio = (s?: ServicioOpt): EntradaServicio => ({ servicioId: s?.id ?? null, destinoId: s?.destino_id ?? null, nombre: s?.nombre ?? "", proveedor: s?.proveedor ?? "", proveedorId: s?.proveedorId ?? null, neto: null, pvp: null, pvpInfante: null });

  // Al cambiar de esquema o de modalidad de PVP se limpian los campos de la modalidad que queda inactiva (el servidor los ignora también).
  const cambiarModalidad = (p: Partial<EntradaPaqueteTotal>) => setE((x) => {
    const n = { ...x, ...p, totalDeclarado: null };
    const net = n.esquema === "neta_markup", gen = n.esquema === "solo_pvp" && n.pvpModo === "general", comp = n.esquema === "solo_pvp" && n.pvpModo === "por_componente";
    return {
      ...n, pvpGeneral: gen ? n.pvpGeneral : null,
      vuelos: n.vuelos.map((v) => ({ ...v, neto: net ? v.neto : {}, pvp: comp ? v.pvp : {} })),
      hoteles: n.hoteles.map((h) => ({ ...h, neto: net ? h.neto : {}, pvp: comp ? h.pvp : {}, pvpGeneral: gen ? h.pvpGeneral : null })),
      servicios: n.servicios.map((v) => ({ ...v, neto: net ? v.neto : null, pvp: comp ? v.pvp : null })),
    };
  });

  const guardar = () => start(async () => {
    setMsg(null);
    // Sin Multidestino el aeropuerto de destino del vuelo manual es el del destino principal (el servidor lo vuelve a leer del catálogo).
    const aEnviar = e.multidestino ? e : { ...e, vuelos: e.vuelos.map((v) => (v.empaquetadoId == null ? { ...v, destinoIata: iataPrincipal } : v)) };
    const r = await guardarPaqueteTotal(aEnviar);
    if (!r.ok) return setMsg({ ok: false, t: r.error, base: e });
    setMsg({ ok: true, t: r.avisos?.[0] ?? "Paquete guardado.", base: e });
    if (!e.id) router.replace(`/dashboard/paquetes/total/${r.id}`);
    else router.refresh();
  });

  const serviciosFicha = (id: number | null) => servicios.find((q) => q.id === id);
  const pvpPrev = (neto: number | null | undefined) => (neta && neto != null ? pvpDeNeto(neto, e.pctMkPct / 100, e.moneda) : NaN);

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map((x) => (
          <button key={x.k} type="button" role="tab" aria-selected={tabActiva === x.k} disabled={!x.on} onClick={() => setTab(x.k)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold ${tabActiva === x.k ? "border-[var(--brand-success)] bg-[var(--brand-success-bg)] text-[var(--brand-success-dark)]" : "border-gray-200 bg-white text-gray-600"} disabled:cursor-not-allowed disabled:opacity-40`}>
            <x.i className="h-4 w-4" /> {x.t}
          </button>
        ))}
      </div>

      {tabActiva === "config" && (
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={lbl}>Nombre</label><Input value={e.nombre} onChange={(x) => set({ nombre: x.target.value })} /></div>
            <div><label className={lbl}>Destino principal</label>
              <select className={sel} value={e.destinoId ?? ""} onChange={(x) => { setAvisoMulti(null); cambiarPrincipal(x.target.value ? Number(x.target.value) : null); }}>
                <option value="">Elige…</option>{destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select></div>
            <div><label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700"><input type="checkbox" checked={e.multidestino} onChange={(x) => alternarMultidestino(x.target.checked)} /> Multidestino</label>
              {avisoMulti && <p role="alert" className="mt-1 text-xs text-red-600" data-testid="aviso-multidestino">{avisoMulti}</p>}
              {e.multidestino ? (
                <>
                  <select aria-label="Destinos adicionales" multiple className={`${sel} mt-1 h-24`} value={e.destinosExtra.map(String)} onChange={(x) => set({ destinosExtra: Array.from(x.target.selectedOptions).map((o) => Number(o.value)) })}>
                    {adicionalesOfrecidos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">{e.destinoId == null ? "Elige primero el destino principal." : paisPrincipal == null ? "El destino principal no tiene país cargado: complétalo en su ficha." : "Solo destinos del mismo país que el principal. Permite escoger vuelos y servicios de esos destinos."}</p>
                </>
              ) : <p className="mt-1 text-xs text-gray-500">Actívalo para sumar destinos del mismo país.</p>}</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Moneda</label><select className={sel} value={e.moneda} onChange={(x) => set({ moneda: x.target.value as "COP" | "USD" })}><option>COP</option><option>USD</option></select></div>
              <div><label className={lbl}>Noches</label><Input inputMode="numeric" value={String(e.noches)} onChange={(x) => set({ noches: Number(x.target.value) || 0 })} /></div>
            </div>
          </div>

          <fieldset className="rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-xs font-semibold text-gray-600">Componentes del paquete</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {([["usaVuelo", "Vuelo"], ["usaHotel", "Hotel"], ["usaServicios", "Servicios"]] as const).map(([k, t]) => (
                <label key={k} className="inline-flex items-center gap-2"><input type="checkbox" checked={e[k]} onChange={(x) => set({ [k]: x.target.checked })} /> {t}</label>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-xs font-semibold text-gray-600">Esquema de precios</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2"><input type="radio" name="esq" checked={neta} onChange={() => cambiarModalidad({ esquema: "neta_markup", pvpModo: null })} /> Netas + markup</label>
              <label className="inline-flex items-center gap-2"><input type="radio" name="esq" checked={!neta} onChange={() => cambiarModalidad({ esquema: "solo_pvp", pvpModo: e.pvpModo ?? "por_componente" })} /> Solo PVP</label>
            </div>
            {neta && <div className="mt-3 max-w-[10rem]"><label className={lbl}>Markup (% de margen)</label><Input inputMode="decimal" value={String(e.pctMkPct)} onChange={(x) => set({ pctMkPct: Number(x.target.value.replace(",", ".")) || 0 })} /></div>}
            {!neta && (
              <div className="mt-3 space-y-2 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="modo" checked={general} onChange={() => cambiarModalidad({ pvpModo: "general" })} /> Precio general del paquete (por acomodación)</label>
                <label className="flex items-center gap-2"><input type="radio" name="modo" checked={porComp} onChange={() => cambiarModalidad({ pvpModo: "por_componente" })} /> PVP separado por componente</label>
                <p className="text-xs text-gray-500">En solo PVP no se inventan costos: antes de convertir la cotización en contrato se exige el costo real y el proveedor de cada componente.</p>
              </div>
            )}
          </fieldset>

          {general && (
            <div><h4 className="mb-1 text-sm font-semibold text-gray-700">Precio general por persona (toda la estadía)</h4>
              <GridAcom etiqueta="PVP" valor={e.pvpGeneral ?? {}} onChange={(v) => set({ pvpGeneral: v })} /></div>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <div><label className={lbl}>Compra desde</label><DateInput aria-label="Compra desde" type="date" value={e.compraInicio} onValueChange={(d) => set({ compraInicio: d })} /></div>
            <div><label className={lbl}>Compra hasta</label><DateInput aria-label="Compra hasta" type="date" value={e.compraFin} onValueChange={(d) => set({ compraFin: d })} /></div>
            <div><label className={lbl}>Viaje desde</label><DateInput aria-label="Viaje desde" type="date" value={e.viajeInicio} onValueChange={(d) => set({ viajeInicio: d })} /></div>
            <div><label className={lbl}>Viaje hasta</label><DateInput aria-label="Viaje hasta" type="date" value={e.viajeFin} onValueChange={(d) => set({ viajeFin: d })} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className={lbl}>Descripción</label><textarea className="min-h-20 w-full rounded-md border border-gray-200 p-2 text-sm" value={e.descripcion} onChange={(x) => set({ descripcion: x.target.value })} /></div>
            <div><label className={lbl}>Incluye (uno por línea)</label><textarea className="min-h-20 w-full rounded-md border border-gray-200 p-2 text-sm" value={e.incluye} onChange={(x) => set({ incluye: x.target.value })} /></div>
            <div><label className={lbl}>No incluye</label><textarea className="min-h-20 w-full rounded-md border border-gray-200 p-2 text-sm" value={e.noIncluye} onChange={(x) => set({ noIncluye: x.target.value })} /></div>
          </div>
        </section>
      )}

      {tabActiva === "vuelo" && (
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${sel} max-w-sm`} value="" onChange={(x) => { const em = empaquetados.find((q) => q.id === Number(x.target.value)); if (em) set({ vuelos: [...e.vuelos, nuevoVuelo(em)] }); }}>
              <option value="">Vincular vuelo de Empaquetados…</option>
              {empDest.map((q) => <option key={q.id} value={q.id}>{q.aerolinea ?? "—"} · {q.ruta ?? "—"} · {q.fecha_ida}</option>)}
            </select>
            <Button type="button" variant="outline" onClick={() => set({ vuelos: [...e.vuelos, nuevoVuelo()] })}><Plus className="h-4 w-4" /> Vuelo manual</Button>
          </div>
          {e.vuelos.map((v, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between text-xs text-gray-500"><span>{v.empaquetadoId ? `Vinculado a Empaquetados #${v.empaquetadoId} (valores copiados; edítalos aquí)` : "Vuelo manual"}</span>
                <button type="button" aria-label="Quitar vuelo" onClick={() => del("vuelos", i)}><Trash2 className="h-4 w-4 text-red-500" /></button></div>
              {v.destinoId != null && !destinosPermitidos.has(v.destinoId) && (
                <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700" data-testid="vuelo-destino-incompatible">Este vuelo es de un destino que ya no está en el paquete ({destinos.find((d) => d.id === v.destinoId)?.nombre ?? v.destinoId}). Quítalo, actívalo de nuevo como destino adicional o cambia el destino principal: no se reasigna solo.</p>
              )}
              {v.empaquetadoId == null && !e.multidestino && e.destinoId != null && (iataPrincipal ? (
                <p className="text-xs text-gray-500" data-testid="destino-del-vuelo-auto">Llega a {nombrePrincipal} ({iataPrincipal}): el destino principal del paquete.</p>
              ) : (
                <p role="alert" className="rounded-md bg-amber-50 p-2 text-xs text-amber-900" data-testid="destino-sin-iata">El destino «{nombrePrincipal}» no tiene código IATA. Créalo o complétalo en Producto → Destinos para armar la ruta: un vuelo manual usa el aeropuerto del destino y no se inventa un código.</p>
              ))}
              <div className="grid gap-2 sm:grid-cols-4">
                <div><label className={lbl}>Aerolínea</label><Input value={v.aerolinea} onChange={(x) => upd("vuelos", i, { aerolinea: x.target.value })} /></div>
                {v.empaquetadoId != null ? (
                  <div><label className={lbl}>Ruta (del empaquetado)</label><Input aria-label="Ruta" readOnly value={v.ruta} /></div>
                ) : (
                  <>
                    <div><label className={lbl}>Origen (IATA)</label><ComboIata etiqueta="Origen IATA" value={v.origenIata} onChange={(c) => upd("vuelos", i, { origenIata: c })} /></div>
                    {e.multidestino && (
                      <div><label className={lbl}>Destino (IATA)</label><ComboIata etiqueta="Destino IATA" value={v.destinoIata} onChange={(c) => upd("vuelos", i, { destinoIata: c })} /></div>
                    )}
                    <div><label className={lbl}>Ruta (se calcula)</label><Input aria-label="Ruta" readOnly value={derivarRutaManual(v.origenIata, e.multidestino ? v.destinoIata : iataPrincipal, !!v.fechaRegreso) ?? ""} /></div>
                  </>
                )}
                <div><label className={lbl}>Ida</label><DateInput aria-label="Ida" type="date" value={v.fechaIda} onValueChange={(d) => upd("vuelos", i, { fechaIda: d })} /></div>
                <div><label className={lbl}>Regreso</label><DateInput aria-label="Regreso" type="date" value={v.fechaRegreso} onValueChange={(d) => upd("vuelos", i, { fechaRegreso: d })} /></div>
                <div><label className={lbl}>Proveedor</label><Input value={v.proveedor} onChange={(x) => upd("vuelos", i, { proveedor: x.target.value })} /></div>
                {e.multidestino && (
                  <div><label className={lbl}>Destino del vuelo</label>
                    <select aria-label="Destino del vuelo" className={sel} value={v.destinoId ?? e.destinoId ?? ""} onChange={(x) => { const id = x.target.value ? Number(x.target.value) : e.destinoId; upd("vuelos", i, { destinoId: id, ...(v.empaquetadoId == null ? { destinoIata: iataDeDestino(destinos, id) } : {}) }); }}>
                      {destinos.filter((d) => d.id === e.destinoId || e.destinosExtra.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.nombre}{d.id === e.destinoId ? " (principal)" : ""}</option>)}
                    </select></div>
                )}
              </div>
              {!general && (
                <div className="rounded-lg bg-gray-50 p-3" data-testid="precios-vuelo">
                  <p className="mb-3 text-xs text-gray-600">Regla de reservas: el <b>menor de 2 años</b> paga solo el fee de infante y <b>no ocupa silla</b>; <b>desde los 2 años</b> paga la tarifa de adulto y <b>ocupa silla</b>. Se aplica por la edad declarada, no por las categorías Niño 1 / Niño 2 del hotel, y no hay tarifa aérea de «niño».</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {([["adulto", "adulto y menor desde 2 años", "Ocupa silla.", "Vuelo adulto"], ["infante", "infante (menor de 2 años)", "Sin silla. Escribe 0 si va gratis.", "Vuelo infante"]] as const).map(([k, nombre, ayuda, aria]) => (
                      <div key={k} className="min-w-0">
                        <label className={lbl}>{neta ? "Neto" : "PVP"} · {nombre}</label>
                        <Input aria-label={`${neta ? "Neto" : "PVP"} ${aria}`} inputMode="numeric" value={(neta ? v.neto[k] : v.pvp[k]) == null ? "" : String(neta ? v.neto[k] : v.pvp[k])}
                          onChange={(x) => upd("vuelos", i, neta ? { neto: { ...v.neto, [k]: n(x.target.value) } } : { pvp: { ...v.pvp, [k]: n(x.target.value) } })} />
                        <span className="mt-1 block text-xs text-gray-500">{ayuda}{neta && v.neto[k] != null ? ` PVP ${pvpPrev(v.neto[k])}.` : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {!e.vuelos.length && <p className="text-sm text-gray-500">Vincula un vuelo de Empaquetados o crea uno manual.</p>}
        </section>
      )}

      {tabActiva === "hotel" && (
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full max-w-sm" data-testid="selector-fichas">
              <ComboHotel hoteles={hotelesDest.map((h) => ({ id: h.id, nombre: h.nombre }))} value="" max={500}
                placeholder={e.destinoId == null ? "Elige primero el destino principal" : "Buscar ficha de hotel por nombre…"} onBusqueda={setBusquedaFicha}
                onChange={(id) => { const h = hoteles.find((q) => q.id === id); if (h) set({ hoteles: [...e.hoteles, nuevoHotel(h)] }); }} />
            </div>
            <Button type="button" variant="outline" onClick={() => { set({ hoteles: [...e.hoteles, { ...nuevoHotel(), nombre: busquedaFicha.trim() }] }); setBusquedaFicha(""); }}><Plus className="h-4 w-4" /> Hotel manual</Button>
          </div>
          <p className="text-xs text-gray-500" data-testid="conteo-fichas">{e.destinoId == null ? "Elige el destino principal para ver sus fichas de hotel." : `${hotelesDest.length} ${hotelesDest.length === 1 ? "ficha activa" : "fichas activas"} en ${destinos.find((d) => d.id === e.destinoId)?.nombre ?? "el destino"}. La ficha aporta solo la información general; las tarifas se cargan aquí.`}</p>
          {busquedaFicha.trim() !== "" && (
            <p className="text-xs text-gray-600" data-testid="pasar-a-manual">¿No está «{busquedaFicha.trim()}»? Usa <b>Hotel manual</b> y se crea con ese nombre.</p>
          )}
          {fichasActivas != null && hoteles.length < fichasActivas && (
            <p role="alert" className="rounded-md bg-amber-50 p-2 text-xs text-amber-900" data-testid="aviso-fichas-faltantes">La base solo ofrece {hoteles.length} de {fichasActivas} fichas activas: falta aplicar la migración 280 (paquete_dinamico_ficha_sin_tarifario). Hasta entonces las fichas con tarifario no aparecen ni se pueden guardar.</p>
          )}
          {e.hoteles.map((h, i) => {
            const f = h.hotelId == null ? undefined : hoteles.find((q) => q.id === h.hotelId);
            return (
              <HotelFilaDin key={i} h={h} ctx={{ neta, general, pctMkPct: e.pctMkPct, moneda: e.moneda }} catalogo={catalogoHotel}
                ficha={h.hotelId == null ? null : { categorias: f?.categorias ?? [], regimenes: f?.regimenes ?? [], reglasTexto: f?.reglasTexto ?? null, estrellas: f?.estrellas ?? null, descripcionFicha: f?.descripcionFicha ?? "", ubicacionFicha: f?.ubicacionFicha ?? "" }}
                onChange={(p) => upd("hoteles", i, p)} onQuitar={() => del("hoteles", i)} />
            );
          })}
          {!e.hoteles.length && <p className="text-sm text-gray-500">Agrega una ficha existente o un hotel manual.</p>}
        </section>
      )}

      {tabActiva === "servicios" && (
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${sel} max-w-sm`} value="" onChange={(x) => { const s = servicios.find((q) => q.id === Number(x.target.value)); if (s) set({ servicios: [...e.servicios, nuevoServicio(s)] }); }}>
              <option value="">Vincular servicio existente…</option>
              {serviciosDest.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <Button type="button" variant="outline" onClick={() => set({ servicios: [...e.servicios, nuevoServicio()] })}><Plus className="h-4 w-4" /> Servicio manual</Button>
          </div>
          {e.servicios.map((s, i) => {
            const ficha = s.servicioId != null ? serviciosFicha(s.servicioId) : undefined;
            const vinculado = s.servicioId != null;
            const esGrupo = ficha?.modo === "grupo";
            const etq = neta ? "Neto" : "PVP";
            return (
              <div key={i} className="rounded-lg border border-gray-200 p-3" data-testid="ficha-servicio">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <label className={lbl}>Servicio <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-normal text-gray-600">{vinculado ? `Ficha #${s.servicioId}` : "Manual"}</span></label>
                    <Input aria-label="Nombre del servicio" value={s.nombre} onChange={(x) => upd("servicios", i, { nombre: x.target.value })} />
                  </div>
                  <button type="button" aria-label="Quitar servicio" onClick={() => del("servicios", i)} className="mt-6 shrink-0 rounded-md p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="mt-3 grid items-start gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className={lbl}>{vinculado ? "Proveedor (de la ficha)" : "Proveedor"}</label>
                    {vinculado
                      ? <Input aria-label="Proveedor de la ficha" readOnly value={s.proveedor} placeholder="Sin proveedor en la ficha" />
                      : <Input value={s.proveedor} onChange={(x) => upd("servicios", i, { proveedor: x.target.value })} />}
                    {vinculado && s.proveedorId == null && <p role="alert" className="mt-1 text-xs text-red-600">{mensajeSinProveedor([s.nombre])}</p>}
                  </div>
                  {!general && !(neta && vinculado) && (
                    <div className="min-w-0">
                      <label className={lbl}>{etq} {esGrupo ? "por grupo (una vez)" : "por persona"}</label>
                      <Input inputMode="numeric" value={(neta ? s.neto : s.pvp) == null ? "" : String(neta ? s.neto : s.pvp)} onChange={(x) => upd("servicios", i, neta ? { neto: n(x.target.value) } : { pvp: n(x.target.value) })} />
                      {esGrupo && <span className="mt-1 block text-xs text-gray-500">Se cobra una sola vez dentro del rango de la ficha.</span>}
                    </div>
                  )}
                  {porComp && vinculado && ficha?.modo === "persona" && (
                    <div className="min-w-0">
                      <label className={lbl}>PVP infante{ficha.cobraInfante ? " *" : ""}</label>
                      <Input aria-label="PVP infante" inputMode="numeric" placeholder={ficha.cobraInfante ? "0 = gratis" : "0"} value={s.pvpInfante == null ? "" : String(s.pvpInfante)} onChange={(x) => upd("servicios", i, { pvpInfante: n(x.target.value) })} />
                      <span className="mt-1 block text-xs text-gray-500">{ficha.cobraInfante ? "Menor de 2 años: la ficha lo cobra, defínelo (0 si va gratis)." : "Menor de 2 años: la ficha no lo cobra, queda en 0."}</span>
                    </div>
                  )}
                </div>
                {vinculado && ficha?.cobro && (
                  <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600" data-testid="cobro-ficha">
                    <p className="font-medium text-gray-700">Cobro de la ficha</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      <li>{ficha.cobro}</li>
                      <li>{neta ? "El precio se calcula con la ficha (vigencia, grupo y menores) al cotizar." : esGrupo ? "Escribe el PVP del GRUPO: se cobra una vez mientras el grupo esté dentro del rango." : "Escribe el PVP por persona y, si la ficha cobra al infante, el del menor de 2 años."}</li>
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
          {!e.servicios.length && <p className="text-sm text-gray-500">Agrega servicios existentes o manuales. En los manuales el precio es por persona (el infante no paga); los vinculados se cobran como dice su ficha.</p>}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar paquete"}</Button>
        {msg && msg.base === e && <p role="status" className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.t}</p>}
      </div>
    </div>
  );
}
