"use client";
// Paquete dinámico (#82): una fila COMPACTA por vuelo y su detalle editable en una ventana emergente (mismo patrón que `HotelFilaDin`).
// La fila resume lo que identifica el vuelo (manual o vinculado, aerolínea, ruta, fechas, proveedor, importes) y muestra los avisos que no pueden pasar inadvertidos
// (destino fuera del paquete, destino principal sin IATA). La ventana edita una COPIA: «Guardar cambios» la aplica; «Cancelar», Escape, clic fuera y la X la descartan.
// Las reglas (ruta derivada, noches, IATA, destino) siguen en el servidor y en `ruta.ts`/`entrada.ts`; aquí solo se reorganiza la edición.
import { useState } from "react";
import { Pencil, Plane, Trash2 } from "lucide-react";
import { DateInput } from "@/components/ui/DateInput";
import { Input } from "@/components/ui/input";
import { pvpDeNeto } from "@/lib/paqueteDinamico/calculo";
import type { EntradaVuelo } from "@/lib/paqueteDinamico/entrada";
import { derivarRutaManual, iataDeDestino } from "@/lib/paqueteDinamico/ruta";
import { ComboIata } from "./ComboIata";
import { Ventana, lbl, n, sel } from "./editorUi";

type DestinoVuelo = { id: number; nombre: string; codigo_iata?: string | null };
export type ContextoVueloDin = {
  neta: boolean; general: boolean; pctMkPct: number; moneda: string;
  multidestino: boolean; destinoId: number | null; destinosExtra: number[]; destinos: DestinoVuelo[];
  /** IATA del destino principal según el catálogo de destinos ("" = no tiene: no se inventa) y su nombre. */
  iataPrincipal: string; nombrePrincipal: string;
};

const fechaCorta = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);

/** El importe del vuelo es por pasajero para TODO el recorrido: «ida» si es solo ida, «ida y regreso» si lleva regreso (por fecha o, en un vinculado, por su ruta real). */
export function tramosVuelo(v: Pick<EntradaVuelo, "fechaRegreso" | "ruta" | "empaquetadoId">): "ida" | "ida y regreso" {
  if (v.fechaRegreso) return "ida y regreso";
  if (v.empaquetadoId != null && v.ruta.split(/[^A-Za-z]+/).filter(Boolean).length >= 3) return "ida y regreso";
  return "ida";
}

const rutaDe = (v: EntradaVuelo, ctx: ContextoVueloDin) =>
  v.empaquetadoId != null ? v.ruta : (derivarRutaManual(v.origenIata, ctx.multidestino ? v.destinoIata : ctx.iataPrincipal, !!v.fechaRegreso) ?? "");

function DetalleVuelo({ v, ctx, abierta, onCerrar, onAplicar }: { v: EntradaVuelo; ctx: ContextoVueloDin; abierta: boolean; onCerrar: () => void; onAplicar: (p: EntradaVuelo) => void }) {
  const [d, setD] = useState<EntradaVuelo>(v);
  const upd = (p: Partial<EntradaVuelo>) => setD((x) => ({ ...x, ...p }));
  const etq = ctx.neta ? "Neto" : "PVP";
  const pvpPrev = (neto: number | null | undefined) => (ctx.neta && neto != null ? pvpDeNeto(neto, ctx.pctMkPct / 100, ctx.moneda) : NaN);
  const tramos = tramosVuelo(d);
  return (
    <Ventana abierta={abierta} testid="ventana-vuelo" titulo={d.empaquetadoId ? `Vuelo vinculado a Empaquetados #${d.empaquetadoId}` : "Vuelo manual"}
      descripcion={d.empaquetadoId ? "Los valores se copiaron del empaquetado; edítalos aquí. La ruta es la real del empaquetado." : "Origen, fechas, proveedor e importes del vuelo."}
      onCancelar={onCerrar} onGuardar={() => { onAplicar(d); onCerrar(); }}>
      {d.empaquetadoId == null && !ctx.multidestino && ctx.destinoId != null && ctx.iataPrincipal && (
        <p className="text-xs text-gray-500" data-testid="destino-del-vuelo-auto">Llega a {ctx.nombrePrincipal} ({ctx.iataPrincipal}): el destino principal del paquete.</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0"><label className={lbl}>Aerolínea</label><Input aria-label="Aerolínea" value={d.aerolinea} onChange={(x) => upd({ aerolinea: x.target.value })} /></div>
        {d.empaquetadoId != null ? (
          <div className="min-w-0"><label className={lbl}>Ruta (del empaquetado)</label><Input aria-label="Ruta" readOnly value={d.ruta} /></div>
        ) : (
          <>
            <div className="min-w-0"><label className={lbl}>Origen (IATA)</label><ComboIata etiqueta="Origen IATA" value={d.origenIata} onChange={(c) => upd({ origenIata: c })} /></div>
            {ctx.multidestino && (
              <div className="min-w-0"><label className={lbl}>Destino (IATA)</label><ComboIata etiqueta="Destino IATA" value={d.destinoIata} onChange={(c) => upd({ destinoIata: c })} /></div>
            )}
            <div className="min-w-0"><label className={lbl}>Ruta (se calcula)</label><Input aria-label="Ruta" readOnly value={rutaDe(d, ctx)} /></div>
          </>
        )}
        <div className="min-w-0"><label className={lbl}>Ida</label><DateInput aria-label="Ida" type="date" value={d.fechaIda} onValueChange={(f) => upd({ fechaIda: f })} /></div>
        <div className="min-w-0"><label className={lbl}>Regreso</label><DateInput aria-label="Regreso" type="date" value={d.fechaRegreso} onValueChange={(f) => upd({ fechaRegreso: f })} /></div>
        <div className="min-w-0"><label className={lbl}>Proveedor</label><Input aria-label="Proveedor del vuelo" value={d.proveedor} onChange={(x) => upd({ proveedor: x.target.value })} /></div>
        {ctx.multidestino && (
          <div className="min-w-0"><label className={lbl}>Destino del vuelo</label>
            <select aria-label="Destino del vuelo" className={sel} value={d.destinoId ?? ctx.destinoId ?? ""}
              onChange={(x) => { const id = x.target.value ? Number(x.target.value) : ctx.destinoId; upd({ destinoId: id, ...(d.empaquetadoId == null ? { destinoIata: iataDeDestino(ctx.destinos, id) } : {}) }); }}>
              {ctx.destinos.filter((x) => x.id === ctx.destinoId || ctx.destinosExtra.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.id === ctx.destinoId ? " (principal)" : ""}</option>)}
            </select></div>
        )}
      </div>
      {!ctx.general && (
        <div className="rounded-lg bg-gray-50 p-3" data-testid="precios-vuelo">
          <p className="mb-1 text-xs font-medium text-gray-700" data-testid="unidad-vuelo">Importe <b>completo por pasajero</b> ({tramos}).</p>
          <p className="mb-3 text-xs text-gray-600">Regla de reservas: el <b>menor de 2 años</b> paga solo el fee de infante y <b>no ocupa silla</b>; <b>desde los 2 años</b> paga la tarifa de adulto y <b>ocupa silla</b>. Se aplica por la edad declarada, no por las categorías Niño 1 / Niño 2 del hotel, y no hay tarifa aérea de «niño».</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["adulto", "adulto y menor desde 2 años", "Ocupa silla.", "Vuelo adulto"], ["infante", "infante (menor de 2 años)", "Sin silla. Escribe 0 si va gratis.", "Vuelo infante"]] as const).map(([k, nombre, ayuda, aria]) => (
              <div key={k} className="min-w-0">
                <label className={lbl}>{etq} · {nombre}</label>
                <Input aria-label={`${etq} ${aria}`} inputMode="numeric" value={(ctx.neta ? d.neto[k] : d.pvp[k]) == null ? "" : String(ctx.neta ? d.neto[k] : d.pvp[k])}
                  onChange={(x) => upd(ctx.neta ? { neto: { ...d.neto, [k]: n(x.target.value) } } : { pvp: { ...d.pvp, [k]: n(x.target.value) } })} />
                <span className="mt-1 block text-xs text-gray-500">{ayuda} Por pasajero, {tramos}.{ctx.neta && d.neto[k] != null ? ` PVP ${pvpPrev(d.neto[k])}.` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Ventana>
  );
}

export function VueloFilaDin({ v, ctx, onChange, onQuitar }: { v: EntradaVuelo; ctx: ContextoVueloDin; onChange: (p: Partial<EntradaVuelo>) => void; onQuitar: () => void }) {
  const [abierta, setAbierta] = useState(false);
  // La ventana sigue montada (el foco vuelve al botón que la abrió); `apertura` cambia en cada apertura para que el borrador parta de una copia fresca.
  const [apertura, setApertura] = useState(0);
  const abrir = () => { setApertura((x) => x + 1); setAbierta(true); };
  const ruta = rutaDe(v, ctx);
  const etq = ctx.neta ? "Neto" : "PVP";
  const dest = v.destinoId != null && v.destinoId !== ctx.destinoId && !ctx.destinosExtra.includes(v.destinoId);
  const importes = ctx.general ? "precio general del paquete" : `${etq} adulto ${(ctx.neta ? v.neto.adulto : v.pvp.adulto) ?? "—"} · infante ${(ctx.neta ? v.neto.infante : v.pvp.infante) ?? "—"}`;
  const fechas = v.fechaIda ? `${fechaCorta(v.fechaIda)}${v.fechaRegreso ? ` → ${fechaCorta(v.fechaRegreso)}` : " (solo ida)"}` : "Sin fechas";
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3" data-testid="fila-vuelo">
      <div className="flex items-start gap-2">
        <button type="button" onClick={abrir} aria-haspopup="dialog" aria-label={`Editar vuelo ${ruta || v.aerolinea || ""}`.trim()}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md p-1 text-left hover:bg-gray-50">
          <Plane className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-gray-900 [overflow-wrap:anywhere]" data-testid="vuelo-titulo">{v.aerolinea || "Vuelo sin aerolínea"}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600" data-testid="tipo-vuelo">{v.empaquetadoId ? `Vinculado #${v.empaquetadoId}` : "Manual"}</span>
            </span>
            <span className="mt-0.5 block text-xs text-gray-500 [overflow-wrap:anywhere]" data-testid="resumen-vuelo">
              {ruta || "Ruta sin definir"} · {fechas}{v.proveedor ? ` · ${v.proveedor}` : ""} · {importes}
            </span>
          </span>
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--brand-primary)]"><Pencil className="h-3.5 w-3.5" /> Editar</span>
        </button>
        <button type="button" aria-label="Quitar vuelo" className="shrink-0 rounded p-1.5 hover:bg-red-50" onClick={onQuitar}><Trash2 className="h-4 w-4 text-red-500" /></button>
      </div>
      {dest && (
        <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700" data-testid="vuelo-destino-incompatible">Este vuelo es de un destino que ya no está en el paquete ({ctx.destinos.find((d) => d.id === v.destinoId)?.nombre ?? v.destinoId}). Quítalo, actívalo de nuevo como destino adicional o cambia el destino principal: no se reasigna solo.</p>
      )}
      {v.empaquetadoId == null && !ctx.multidestino && ctx.destinoId != null && !ctx.iataPrincipal && (
        <p role="alert" className="rounded-md bg-amber-50 p-2 text-xs text-amber-900" data-testid="destino-sin-iata">El destino «{ctx.nombrePrincipal}» no tiene código IATA. Créalo o complétalo en Producto → Destinos para armar la ruta: un vuelo manual usa el aeropuerto del destino y no se inventa un código.</p>
      )}
      <DetalleVuelo key={`v${apertura}`} v={v} ctx={ctx} abierta={abierta} onCerrar={() => setAbierta(false)} onAplicar={(p) => onChange(p)} />
    </div>
  );
}
