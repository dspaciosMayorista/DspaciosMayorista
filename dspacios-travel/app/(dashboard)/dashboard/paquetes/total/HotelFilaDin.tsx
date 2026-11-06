"use client";
// Paquete dinámico (#82): una fila COMPACTA por hotel + dos ventanas emergentes. «Información del hotel» (nombre, foto, estrellas, descripción, ubicación) y
// «Tarifas y configuración» (categoría de habitación, alimentación, capacidad y edades de menores, proveedor y tarifas por acomodación según el esquema).
// Cada ventana edita una COPIA: «Guardar cambios» la aplica al formulario, «Cancelar», Escape o clic fuera la descartan. Las validaciones y el guardado del paquete
// no cambian (siguen en `guardarPaqueteTotal`); aquí solo se reorganiza la edición.
import { useId, useState } from "react";
import { Building2, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Categoria } from "@/app/tarifario/tarjetaHotelCompartida";
import { ACOMS_DIN, pvpDeNeto } from "@/lib/paqueteDinamico/calculo";
import type { EntradaHotel } from "@/lib/paqueteDinamico/entrada";
import { CAPACIDAD_NINOS_MAX } from "@/lib/paqueteDinamico/menores";
import { normalizarOpcionHotel, opcionesOfrecidas } from "@/lib/paqueteDinamico/opcionesHotel";
import { ComboCreable } from "./ComboCreable";
import { ACOMS_SOLO_ADULTOS, ETQ, GridAcom, Ventana, lbl, n, sel } from "./editorUi";

/** Lo que el montaje sabe de la ficha vinculada (null = hotel manual). */
export type FichaHotelDin = {
  categorias: string[]; regimenes: string[]; reglasTexto: string | null;
  estrellas: number | null; descripcionFicha: string; ubicacionFicha: string;
  /** La ficha es solo para adultos: prevalece sobre las edades configuradas (no se piden ni se muestran importes de niño, niño 2 ni infante). */
  adultsOnly?: boolean;
};
export type ContextoTarifasDin = { neta: boolean; general: boolean; pctMkPct: number; moneda: string; /** Noches del paquete: los importes del hotel son por persona por TODA la estadía. */ noches: number };

const SIN_DATO = "Sin dato";

/** Texto corto de las estrellas del HOTEL (no de la categoría de habitación). */
export const etiquetaEstrellas = (e: number | null) => (e ? `${e} estrella${e === 1 ? "" : "s"}` : SIN_DATO);

function InformacionHotel({ h, ficha, abierta, onCerrar, onAplicar }: { h: EntradaHotel; ficha: FichaHotelDin | null; abierta: boolean; onCerrar: () => void; onAplicar: (p: Partial<EntradaHotel>) => void }) {
  const id = useId();
  // Con ficha, lo que ella tiene manda (así un paquete guardado antes de esta función muestra lo que se copiará al guardar).
  const [d, setD] = useState({ nombre: h.nombre, fotoUrl: h.fotoUrl, estrellas: ficha?.estrellas ?? h.estrellas, descripcion: ficha?.descripcionFicha || h.descripcion, ubicacion: ficha?.ubicacionFicha || h.ubicacion });
  const deFicha = { estrellas: ficha?.estrellas != null, descripcion: !!ficha?.descripcionFicha, ubicacion: !!ficha?.ubicacionFicha };
  return (
    <Ventana abierta={abierta} titulo="Información del hotel" descripcion={ficha ? "Estrellas, descripción y ubicación se copian de la ficha del hotel cuando ella los tiene." : "Estos datos se muestran en la tarjeta pública del hotel. Déjalos vacíos si no los tienes: no se inventan."}
      onCancelar={onCerrar} onGuardar={() => { onAplicar(d); onCerrar(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2"><label className={lbl} htmlFor={`${id}-nombre`}>Nombre</label><Input id={`${id}-nombre`} value={d.nombre} onChange={(x) => setD({ ...d, nombre: x.target.value })} /></div>
        <div className="min-w-0 sm:col-span-2"><label className={lbl} htmlFor={`${id}-foto`}>Foto (URL; vacía = foto predeterminada)</label><Input id={`${id}-foto`} inputMode="url" value={d.fotoUrl} onChange={(x) => setD({ ...d, fotoUrl: x.target.value })} /></div>
        <div className="min-w-0">
          <label className={lbl} htmlFor={`${id}-estrellas`}>Estrellas del hotel</label>
          <select id={`${id}-estrellas`} className={sel} disabled={deFicha.estrellas} value={d.estrellas ?? ""} onChange={(x) => setD({ ...d, estrellas: x.target.value === "" ? null : Number(x.target.value) })}>
            <option value="">{SIN_DATO}</option>{[1, 2, 3, 4, 5].map((k) => <option key={k} value={k}>{etiquetaEstrellas(k)}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-500">{deFicha.estrellas ? "Copiado de la ficha." : "No es la categoría de la habitación (esa va en «Tarifas y configuración»)."}</p>
        </div>
        <div className="min-w-0 sm:col-span-2"><label className={lbl} htmlFor={`${id}-desc`}>Descripción</label>
          <textarea id={`${id}-desc`} rows={4} disabled={deFicha.descripcion} className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm disabled:bg-gray-50" value={d.descripcion} onChange={(x) => setD({ ...d, descripcion: x.target.value })} />
          {deFicha.descripcion && <p className="mt-1 text-xs text-gray-500">Copiada de la ficha.</p>}</div>
        <div className="min-w-0 sm:col-span-2"><label className={lbl} htmlFor={`${id}-ubic`}>Ubicación (dirección o lugar para el mapa)</label>
          <Input id={`${id}-ubic`} maxLength={500} disabled={deFicha.ubicacion} value={d.ubicacion} onChange={(x) => setD({ ...d, ubicacion: x.target.value })} />
          <p className="mt-1 text-xs text-gray-500">{deFicha.ubicacion ? "Copiada de la ficha." : "Sin ubicación no se muestra el mapa."}</p></div>
      </div>
    </Ventana>
  );
}

function TarifasHotel({ h, ficha, ctx, abierta, onCerrar, onAplicar, catalogo }: {
  h: EntradaHotel; ficha: FichaHotelDin | null; ctx: ContextoTarifasDin; abierta: boolean; onCerrar: () => void; onAplicar: (p: Partial<EntradaHotel>) => void;
  catalogo: { categorias: string[]; regimenes: string[] };
}) {
  const id = useId();
  const [d, setD] = useState<EntradaHotel>(h);
  // Sugerencias: las de la ficha (si la hay), las del catálogo y la que ya tiene el hotel; además se puede escribir cualquiera.
  const cats = opcionesOfrecidas(ficha?.categorias ?? [], catalogo.categorias, [h.categoria]);
  const regs = opcionesOfrecidas(ficha?.regimenes ?? [], catalogo.regimenes, [h.regimen]);
  const pvpPrev = (neto: number | null | undefined) => (ctx.neta && neto != null ? pvpDeNeto(neto, ctx.pctMkPct / 100, ctx.moneda) : NaN);
  // Solo adultos (ficha): los importes de menores no se piden ni se muestran; los que ya existieran se CONSERVAN (no se borran) pero no se usan.
  const sinMenores = ficha?.adultsOnly === true;
  const acomsEd = sinMenores ? ACOMS_SOLO_ADULTOS : ACOMS_DIN;
  return (
    <Ventana abierta={abierta} titulo="Tarifas y configuración" descripcion={`${d.nombre || "Hotel"}: habitación, alimentación, menores, proveedor y precios por acomodación.`}
      onCancelar={onCerrar}
      onGuardar={() => { onAplicar({ categoria: normalizarOpcionHotel(d.categoria, cats), regimen: normalizarOpcionHotel(d.regimen, regs), proveedor: d.proveedor, neto: d.neto, pvp: d.pvp, capacidadNinos: d.capacidadNinos, edadInfanteMax: d.edadInfanteMax, edadNinoMax: d.edadNinoMax }); onCerrar(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0"><label className={lbl} htmlFor={`${id}-cat`}>Categoría de habitación</label>
          <ComboCreable etiqueta="Categoría de habitación" opciones={cats} value={d.categoria} onChange={(v) => setD((x) => ({ ...x, categoria: v }))} placeholder="Busca o escribe una nueva" />
          <p className="mt-1 text-xs text-gray-500">Elige una existente o escribe otra: la nueva vale solo para este paquete.</p></div>
        <div className="min-w-0"><label className={lbl} htmlFor={`${id}-reg`}>Plan de alimentación</label>
          <ComboCreable etiqueta="Plan de alimentación" opciones={regs} value={d.regimen} onChange={(v) => setD((x) => ({ ...x, regimen: v }))} placeholder="Busca o escribe uno nuevo" />
          <p className="mt-1 text-xs text-gray-500">Elige uno existente o escribe otro: el nuevo vale solo para este paquete.</p></div>
        <div className="min-w-0 sm:col-span-2"><label className={lbl} htmlFor={`${id}-prov`}>Proveedor</label><Input id={`${id}-prov`} value={d.proveedor} onChange={(x) => setD({ ...d, proveedor: x.target.value })} /></div>
        {h.hotelId == null ? (
          <div className="grid min-w-0 gap-2 rounded-lg bg-gray-50 p-3 sm:col-span-2 sm:grid-cols-3" data-testid="menores-manual">
            <div className="min-w-0"><label className={lbl}>Capacidad máx. de niños por habitación *</label>
              <select aria-label="Capacidad de niños por habitación" className={sel} value={d.capacidadNinos ?? ""} onChange={(x) => setD({ ...d, capacidadNinos: x.target.value === "" ? null : Number(x.target.value) })}>
                <option value="">Elige…</option>{Array.from({ length: CAPACIDAD_NINOS_MAX + 1 }, (_, k) => <option key={k} value={k}>{k === 0 ? "0 (no admite niños)" : k}</option>)}
              </select></div>
            <div className="min-w-0"><label className={lbl}>Infante hasta (años) *</label><Input aria-label="Infante hasta" inputMode="numeric" value={d.edadInfanteMax == null ? "" : String(d.edadInfanteMax)} onChange={(x) => setD({ ...d, edadInfanteMax: n(x.target.value) })} /></div>
            <div className="min-w-0"><label className={lbl}>Niño hasta (años) *</label><Input aria-label="Niño hasta" inputMode="numeric" value={d.edadNinoMax == null ? "" : String(d.edadNinoMax)} onChange={(x) => setD({ ...d, edadNinoMax: n(x.target.value) })} /></div>
            <p className="text-xs text-gray-500 sm:col-span-3">La capacidad se aplica igual a todas las acomodaciones de este hotel. Niño 1 y Niño 2 son las dos tarifas de niño de cada habitación (no rangos de edad); desde la edad siguiente a «niño hasta» se cuenta como adulto.</p>
          </div>
        ) : (
          <p className="text-xs text-gray-500 sm:col-span-2" data-testid="menores-ficha">{ficha?.reglasTexto ?? "Las reglas de menores (edades, capacidad, solo adultos) se leen de la ficha del hotel."} Se conservan las de la ficha; aquí no se configuran otra vez.</p>
        )}
      </div>
      {sinMenores && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900" data-testid="solo-adultos">Hotel solo para adultos (según su ficha): no se piden importes de niño, niño 2 ni infante y no se pueden cotizar menores en este hotel.</p>
      )}
      {!ctx.general && (
        <p className="text-xs text-gray-600" data-testid="unidad-hotel">Importes <b>por persona según la acomodación</b>, por el <b>total de la estadía de {ctx.noches} {ctx.noches === 1 ? "noche" : "noches"}</b> (no por noche).</p>
      )}
      {!ctx.general && <GridAcom etiqueta={ctx.neta ? "Neto" : "PVP"} valor={ctx.neta ? d.neto : d.pvp} solo={acomsEd} onChange={(v) => setD({ ...d, ...(ctx.neta ? { neto: v } : { pvp: v }) })} />}
      {ctx.neta && <p className="text-xs text-gray-500">PVP (con {ctx.pctMkPct}%): {acomsEd.map((a) => `${ETQ[a]} ${Number.isFinite(pvpPrev(d.neto[a])) ? pvpPrev(d.neto[a]) : "—"}`).join(" · ")}</p>}
      {ctx.general && <p className="text-xs text-gray-500">En precio general el precio se define en Configuración; aquí solo van los datos del hotel.</p>}
    </Ventana>
  );
}

export function HotelFilaDin({ h, ficha, ctx, catalogo, onChange, onQuitar }: {
  h: EntradaHotel; ficha: FichaHotelDin | null; ctx: ContextoTarifasDin; catalogo: { categorias: string[]; regimenes: string[] };
  onChange: (p: Partial<EntradaHotel>) => void; onQuitar: () => void;
}) {
  const [ventana, setVentana] = useState<"info" | "tarifas" | null>(null);
  // Las ventanas siguen montadas (así el foco vuelve al botón que las abrió); `apertura` cambia en cada apertura para que el borrador parta de una copia fresca.
  const [apertura, setApertura] = useState(0);
  const abrir = (v: "info" | "tarifas") => { setApertura((x) => x + 1); setVentana(v); };
  const cerrar = () => setVentana(null);
  const acomsFila = ficha?.adultsOnly ? ACOMS_SOLO_ADULTOS : ACOMS_DIN;
  const precios = ctx.general ? null : acomsFila.filter((a) => (ctx.neta ? h.neto : h.pvp)[a] != null).length;
  const datos = [h.categoria && `Habitación: ${h.categoria}`, h.regimen && `Alimentación: ${h.regimen}`, h.proveedor && `Proveedor: ${h.proveedor}`].filter(Boolean) as string[];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="fila-hotel">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-semibold text-gray-900">{h.nombre || "Hotel sin nombre"}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600" data-testid="tipo-hotel">{h.hotelId ? `Ficha #${h.hotelId}` : "Manual"}</span>
          <Categoria estrellas={ficha?.estrellas ?? h.estrellas} clasificacion={null} />
          {ficha?.adultsOnly && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900" data-testid="badge-solo-adultos">Solo adultos</span>}
        </div>
        <p className="mt-0.5 text-xs text-gray-500 [overflow-wrap:anywhere]" data-testid="resumen-hotel">
          {datos.length ? datos.join(" · ") : "Falta categoría, alimentación y proveedor"}
          {precios != null && ` · ${precios} de ${acomsFila.length} precios`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => abrir("info")}><Building2 className="h-4 w-4" /> Información del hotel</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => abrir("tarifas")}><SlidersHorizontal className="h-4 w-4" /> Tarifas y configuración</Button>
        <button type="button" aria-label="Quitar hotel" className="rounded p-1.5 hover:bg-red-50" onClick={onQuitar}><Trash2 className="h-4 w-4 text-red-500" /></button>
      </div>
      <InformacionHotel key={`i${apertura}`} h={h} ficha={ficha} abierta={ventana === "info"} onCerrar={cerrar} onAplicar={onChange} />
      <TarifasHotel key={`t${apertura}`} h={h} ficha={ficha} ctx={ctx} abierta={ventana === "tarifas"} onCerrar={cerrar} onAplicar={onChange} catalogo={catalogo} />
    </div>
  );
}
