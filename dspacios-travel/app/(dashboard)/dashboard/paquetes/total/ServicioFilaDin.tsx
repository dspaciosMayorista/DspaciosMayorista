"use client";
// Paquete dinámico (#82): una fila COMPACTA por servicio y su detalle editable en una ventana emergente (mismo patrón que `HotelFilaDin`).
// La fila resume qué servicio es (manual o de una ficha), su proveedor, la UNIDAD REAL de cobro y el importe; el aviso de «ficha sin proveedor» queda visible en la fila.
// La ventana edita una COPIA: «Guardar cambios» la aplica; «Cancelar», Escape, clic fuera y la X la descartan. El cálculo y las validaciones no cambian.
import { useState } from "react";
import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { EntradaServicio } from "@/lib/paqueteDinamico/entrada";
import { mensajeSinProveedor } from "@/lib/paqueteDinamico/ruta";
import { Ventana, lbl, n } from "./editorUi";

/** Lo que el montaje sabe de la ficha del servicio vinculado (null = servicio manual). */
export type FichaServicioUI = { modo: "persona" | "grupo" | null; cobraInfante: boolean; cobro: string | null };
export type ContextoServicioDin = { neta: boolean; general: boolean; porComp: boolean };

/** Unidad real de cobro: la de la ficha (por persona / por grupo con su rango) o, en un servicio manual, por persona (adultos y niños; el infante no paga). */
export function unidadServicio(s: Pick<EntradaServicio, "servicioId">, ficha: FichaServicioUI | undefined): string {
  if (s.servicioId == null) return "por persona (adultos y niños; el infante no paga)";
  if (ficha?.cobro) return ficha.cobro;
  return ficha?.modo === "grupo" ? "por grupo (una sola vez dentro del rango de la ficha)" : "por persona";
}
/** Versión corta para la fila: la unidad sin el detalle de la ficha (el detalle completo está en la ventana). */
export function unidadServicioCorta(s: Pick<EntradaServicio, "servicioId">, ficha: FichaServicioUI | undefined): string {
  if (s.servicioId == null) return "por persona (el infante no paga)";
  return ficha?.modo === "grupo" ? "por grupo (una sola vez)" : "por persona";
}

function DetalleServicio({ s, ficha, ctx, abierta, onCerrar, onAplicar }: { s: EntradaServicio; ficha?: FichaServicioUI; ctx: ContextoServicioDin; abierta: boolean; onCerrar: () => void; onAplicar: (p: EntradaServicio) => void }) {
  const [d, setD] = useState<EntradaServicio>(s);
  const upd = (p: Partial<EntradaServicio>) => setD((x) => ({ ...x, ...p }));
  const vinculado = d.servicioId != null;
  const esGrupo = ficha?.modo === "grupo";
  const etq = ctx.neta ? "Neto" : "PVP";
  const unidad = unidadServicio(d, ficha);
  return (
    <Ventana abierta={abierta} testid="ventana-servicio" titulo={vinculado ? `Servicio de la ficha #${d.servicioId}` : "Servicio manual"}
      descripcion={vinculado ? "Se cobra como dice su ficha; el proveedor sale de la ficha." : "Nombre, proveedor e importe del servicio."}
      onCancelar={onCerrar} onGuardar={() => { onAplicar(d); onCerrar(); }}>
      <div className="min-w-0"><label className={lbl}>Servicio <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-normal text-gray-600">{vinculado ? `Ficha #${d.servicioId}` : "Manual"}</span></label>
        <Input aria-label="Nombre del servicio" value={d.nombre} onChange={(x) => upd({ nombre: x.target.value })} /></div>
      <p className="text-xs text-gray-600" data-testid="unidad-servicio">Unidad de cobro: <b>{unidad.replace(/[.]$/, "")}</b>.</p>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label className={lbl}>{vinculado ? "Proveedor (de la ficha)" : "Proveedor"}</label>
          {vinculado
            ? <Input aria-label="Proveedor de la ficha" readOnly value={d.proveedor} placeholder="Sin proveedor en la ficha" />
            : <Input aria-label="Proveedor del servicio" value={d.proveedor} onChange={(x) => upd({ proveedor: x.target.value })} />}
          {vinculado && d.proveedorId == null && <p role="alert" className="mt-1 text-xs text-red-600">{mensajeSinProveedor([d.nombre])}</p>}
        </div>
        {!ctx.general && !(ctx.neta && vinculado) && (
          <div className="min-w-0">
            <label className={lbl}>{etq} {esGrupo ? "por grupo (una vez)" : "por persona"}</label>
            <Input aria-label={`${etq} del servicio`} inputMode="numeric" value={(ctx.neta ? d.neto : d.pvp) == null ? "" : String(ctx.neta ? d.neto : d.pvp)} onChange={(x) => upd(ctx.neta ? { neto: n(x.target.value) } : { pvp: n(x.target.value) })} />
          </div>
        )}
        {ctx.porComp && vinculado && ficha?.modo === "persona" && (
          <div className="min-w-0">
            <label className={lbl}>PVP infante{ficha.cobraInfante ? " *" : ""}</label>
            <Input aria-label="PVP infante" inputMode="numeric" placeholder={ficha.cobraInfante ? "0 = gratis" : "0"} value={d.pvpInfante == null ? "" : String(d.pvpInfante)} onChange={(x) => upd({ pvpInfante: n(x.target.value) })} />
            <span className="mt-1 block text-xs text-gray-500">{ficha.cobraInfante ? "Menor de 2 años: la ficha lo cobra, defínelo (0 si va gratis)." : "Menor de 2 años: la ficha no lo cobra, queda en 0."}</span>
          </div>
        )}
      </div>
      {vinculado && ficha?.cobro && (
        <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600" data-testid="cobro-ficha">
          <p className="font-medium text-gray-700">Cobro de la ficha</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>{ficha.cobro}</li>
            <li>{ctx.neta ? "El precio se calcula con la ficha (vigencia, grupo y menores) al cotizar." : esGrupo ? "Escribe el PVP del GRUPO: se cobra una vez mientras el grupo esté dentro del rango." : "Escribe el PVP por persona y, si la ficha cobra al infante, el del menor de 2 años."}</li>
          </ul>
        </div>
      )}
    </Ventana>
  );
}

export function ServicioFilaDin({ s, ficha, ctx, onChange, onQuitar }: { s: EntradaServicio; ficha?: FichaServicioUI; ctx: ContextoServicioDin; onChange: (p: Partial<EntradaServicio>) => void; onQuitar: () => void }) {
  const [abierta, setAbierta] = useState(false);
  const [apertura, setApertura] = useState(0);
  const abrir = () => { setApertura((x) => x + 1); setAbierta(true); };
  const vinculado = s.servicioId != null;
  const etq = ctx.neta ? "Neto" : "PVP";
  const valor = ctx.neta ? s.neto : s.pvp;
  const importe = ctx.general ? "precio general del paquete" : ctx.neta && vinculado ? "se calcula con la ficha al cotizar" : `${etq} ${valor ?? "—"}`;
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3" data-testid="ficha-servicio">
      <div className="flex items-start gap-2">
        <button type="button" onClick={abrir} aria-haspopup="dialog" aria-label={`Editar servicio ${s.nombre || ""}`.trim()}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md p-1 text-left hover:bg-gray-50">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-gray-900 [overflow-wrap:anywhere]" data-testid="servicio-titulo">{s.nombre || "Servicio sin nombre"}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600" data-testid="tipo-servicio">{vinculado ? `Ficha #${s.servicioId}` : "Manual"}</span>
            </span>
            <span className="mt-0.5 block text-xs text-gray-500 [overflow-wrap:anywhere]" data-testid="resumen-servicio">
              {s.proveedor ? `Proveedor: ${s.proveedor} · ` : ""}Cobro {unidadServicioCorta(s, ficha)} · {importe}
            </span>
          </span>
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--brand-primary)]"><Pencil className="h-3.5 w-3.5" /> Editar</span>
        </button>
        <button type="button" aria-label="Quitar servicio" className="shrink-0 rounded p-1.5 hover:bg-red-50" onClick={onQuitar}><Trash2 className="h-4 w-4 text-red-500" /></button>
      </div>
      {vinculado && s.proveedorId == null && <p role="alert" className="text-xs text-red-600" data-testid="servicio-sin-proveedor">{mensajeSinProveedor([s.nombre])}</p>}
      <DetalleServicio key={`s${apertura}`} s={s} ficha={ficha} ctx={ctx} abierta={abierta} onCerrar={() => setAbierta(false)} onAplicar={(p) => onChange(p)} />
    </div>
  );
}
