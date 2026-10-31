"use client";

// Tipo de receptivo, combo y precios PROPIOS por trayecto / ida y regreso (migración 262 + 263, PROVISIONALES). Cuando las migraciones no están aplicadas
// (`disponible: false`) los editores lo dicen y no escriben. GENERAL es histórico y no vendible: no admite precios por trayecto.
import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Info } from "lucide-react";
import {
  ALCANCES_COMBO, ROTULO_TIPO_RECEPTIVO, TIPOS_RECEPTIVO, llevaTraslado, validarClasificacion, validarPreciosAlcance,
  type AlcanceCombo, type ClasificacionServicio, type FilaPrecioAlcance, type TipoReceptivo,
} from "@/lib/calc/servicioAlcance";
import { guardarClasificacionServicio, guardarPreciosAlcanceVigencia } from "./actions";

export type Datos262 = {
  /** false = falta aplicar la 262 (no hay columnas ni tabla): los editores lo avisan y no escriben. */
  disponible: boolean;
  clasif: Record<number, ClasificacionServicio>;
  /** Precios por trayecto de cada vigencia (clave: servicio_temporadas.id). */
  precios: Record<number, FilaPrecioAlcance[]>;
};
const Ctx = createContext<Datos262>({ disponible: false, clasif: {}, precios: {} });
export function Alcance262Provider({ value, children }: { value: Datos262; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAlcance262 = () => useContext(Ctx);

const selCls = "h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm";
const ROTULO_ALCANCE_COMBO: Record<AlcanceCombo, string> = { trayecto_llegada: "Un trayecto: llegada", trayecto_salida: "Un trayecto: salida", ida_regreso: "Ida y regreso" };

function NoDisponible() {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700" role="status">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> El tipo de receptivo y los precios por trayecto todavía no están habilitados en la base de datos (falta aplicar las migraciones 262 y 263).
    </p>
  );
}

/** Tipo de receptivo (tour / traslado / asistencia médica / combo) y, si es combo, si incluye traslado y cómo se cobra. «Sin clasificar» = legado. */
export function ClasificacionServicioEditor({ servicioId }: { servicioId: number }) {
  const router = useRouter();
  const { disponible, clasif } = useAlcance262();
  const actual = clasif[servicioId] ?? { tipo_receptivo: null };
  const [v, setV] = useState<ClasificacionServicio>(actual);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  if (!disponible) return <NoDisponible />;

  const errores = validarClasificacion(v);
  const esCombo = v.tipo_receptivo === "combo";
  const set = (p: Partial<ClasificacionServicio>) => { setMsg(""); setV((x) => ({ ...x, ...p })); };
  function guardar() {
    if (errores.length) { setMsg(errores[0]); return; }
    start(async () => { const r = await guardarClasificacionServicio(servicioId, v); if (r.ok) { setMsg("Guardado."); router.refresh(); } else setMsg(r.error); });
  }
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3" data-testid="clasificacion-servicio">
      <p className="mb-2 text-sm font-semibold text-gray-700">Tipo de receptivo</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[11px] text-gray-500">Tipo
          <select className={selCls} value={v.tipo_receptivo ?? ""} onChange={(e) => {
            const t = (e.target.value || null) as TipoReceptivo | null;
            set({ tipo_receptivo: t, combo_incluye_traslado: t === "combo" ? v.combo_incluye_traslado ?? null : null, combo_traslado_alcance: t === "combo" ? v.combo_traslado_alcance ?? null : null });
          }}>
            <option value="">Sin clasificar</option>
            {TIPOS_RECEPTIVO.map((t) => <option key={t} value={t}>{ROTULO_TIPO_RECEPTIVO[t]}</option>)}
          </select>
        </label>
        {esCombo && (
          <label className="text-[11px] text-gray-500">¿El combo incluye traslado?
            <select className={selCls} value={v.combo_incluye_traslado == null ? "" : v.combo_incluye_traslado ? "si" : "no"} onChange={(e) => {
              const x = e.target.value === "" ? null : e.target.value === "si";
              set({ combo_incluye_traslado: x, combo_traslado_alcance: x ? v.combo_traslado_alcance ?? null : null });
            }}>
              <option value="">Debe declararlo</option><option value="si">Sí, incluye traslado</option><option value="no">No incluye traslado</option>
            </select>
          </label>
        )}
        {esCombo && v.combo_incluye_traslado && (
          <label className="text-[11px] text-gray-500">¿Cómo se cobra el traslado?
            <select className={selCls} value={v.combo_traslado_alcance ?? ""} onChange={(e) => set({ combo_traslado_alcance: (e.target.value || null) as AlcanceCombo | null })}>
              <option value="">Debe elegirlo</option>
              {ALCANCES_COMBO.map((a) => <option key={a} value={a}>{ROTULO_ALCANCE_COMBO[a]}</option>)}
            </select>
          </label>
        )}
      </div>
      {v.tipo_receptivo == null && <p className="mt-2 text-[11px] text-gray-500">Sin clasificar: el sistema no supone si es un traslado. Clasifícalo para poder cargar precios por trayecto.</p>}
      <div className="mt-2 flex items-center gap-2">
        <Button type="button" variant="outline" onClick={guardar} disabled={pending}>Guardar tipo</Button>
        {(msg || errores[0]) && <span className={`text-xs ${msg === "Guardado." ? "text-green-700" : "text-red-600"}`} role="status">{msg || errores[0]}</span>}
      </div>
    </div>
  );
}

type FilaForm = { alcance: "trayecto" | "ida_regreso"; paxDesde: string; paxHasta: string; precio: string };
const aForm = (f: FilaPrecioAlcance): FilaForm => ({ alcance: f.alcance, paxDesde: f.pax_desde == null ? "" : String(f.pax_desde), paxHasta: f.pax_hasta == null ? "" : String(f.pax_hasta), precio: String(f.precio) });
function aFila(f: FilaForm): FilaPrecioAlcance {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return { alcance: f.alcance, pax_desde: num(f.paxDesde), pax_hasta: num(f.paxHasta), precio: f.precio.trim() === "" ? Number.NaN : Number(f.precio) };
}

/** Tarifa que la vigencia ya tiene (la de siempre): es el precio de «ida y regreso» mientras no se defina uno propio. */
export type TarifaVigente = { persona: number | null; grupos: readonly { precio: number }[] };
const tarifaValida = (n: number | null | undefined): boolean => n != null && Number.isFinite(Number(n)) && Number(n) >= 0; // 0 es una tarifa válida; NULL/ausente/inválida = sin tarifa
export const hayTarifaVigente = (t: TarifaVigente | undefined): boolean => !!t && (tarifaValida(t.persona) || t.grupos.some((g) => tarifaValida(g.precio)));
export const MENSAJE_IDA_REGRESO_USA_TARIFA = "Ida y regreso: usa las tarifas de esta vigencia; puedes definir un precio propio para reemplazarlas.";

/**
 * Precios propios de UNA vigencia. «Un trayecto» (llegada o salida) exige un precio propio, con su rango de pasajeros si el cobro es por grupo, y NUNCA se calcula a partir de
 * ida y regreso. «Ida y regreso» usa las tarifas que la vigencia ya tiene y solo necesita un precio propio si se quiere reemplazarlas. Solo para servicios que llevan traslado;
 * GENERAL no admite precios.
 */
export function PreciosAlcanceEditor({ servicioId, temporadaId, nombre, tarifaVigente }: { servicioId: number; temporadaId: number; nombre: string; tarifaVigente?: TarifaVigente }) {
  const router = useRouter();
  const { disponible, clasif, precios } = useAlcance262();
  const [filas, setFilas] = useState<FilaForm[]>((precios[temporadaId] ?? []).map(aForm));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  if (!disponible) return null; // el aviso ya lo da el editor de tipo
  const lleva = llevaTraslado(clasif[servicioId] ?? { tipo_receptivo: null });
  if (lleva !== true) return null;
  if (nombre.trim().toUpperCase() === "GENERAL") {
    return <p className="mt-2 text-[11px] text-gray-500">GENERAL es la tarifa histórica y no se vende: los precios por trayecto se cargan en una vigencia con fechas.</p>;
  }
  const errores = validarPreciosAlcance(filas.map(aFila));
  const usaTarifa = hayTarifaVigente(tarifaVigente);
  const propioTrayecto = filas.some((f) => f.alcance === "trayecto");
  const propioIdaRegreso = filas.some((f) => f.alcance === "ida_regreso");
  const set = (i: number, p: Partial<FilaForm>) => { setMsg(""); setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f))); };
  function guardar() {
    if (errores.length) { setMsg(errores[0]); return; }
    start(async () => { const r = await guardarPreciosAlcanceVigencia(temporadaId, filas.map(aFila)); if (r.ok) { setMsg("Guardado."); router.refresh(); } else setMsg(r.error); });
  }
  return (
    <div className="mt-3 border-t border-gray-100 pt-2" data-testid={`precios-alcance-${temporadaId}`}>
      <p className="text-xs font-medium text-[var(--brand-primary)]">Precios por trayecto</p>
      <p className="mb-2 text-[11px] text-gray-500">
        «Un trayecto» (llegada o salida) exige un precio <b>propio</b>: no se calcula a partir de ida y regreso. Sin rango de pasajeros = precio por persona; con
        rango = precio del grupo completo.
      </p>
      {usaTarifa
        ? <p className="mb-2 rounded bg-sky-50 px-2 py-1 text-[11px] text-sky-800" data-testid={`ida-regreso-tarifa-${temporadaId}`}>{MENSAJE_IDA_REGRESO_USA_TARIFA}</p>
        : !propioIdaRegreso && <p className="mb-2 text-[11px] text-amber-700" data-testid={`ida-regreso-sin-tarifa-${temporadaId}`}>Ida y regreso: esta vigencia no tiene tarifa; define un precio propio para poder venderlo.</p>}
      {!propioTrayecto && <p className="mb-2 text-[11px] text-amber-700" data-testid={`trayecto-sin-precio-${temporadaId}`}>Un trayecto: sin precio propio no se podrá vender un solo trayecto en esta vigencia.</p>}
      <div className="space-y-2">
        {filas.map((f, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
            <label className="text-[11px] text-gray-500">Alcance
              <select className={selCls} aria-label="Alcance del precio" value={f.alcance} onChange={(e) => set(i, { alcance: e.target.value as FilaForm["alcance"] })}>
                <option value="trayecto">Un trayecto</option><option value="ida_regreso">Ida y regreso</option>
              </select>
            </label>
            <label className="text-[11px] text-gray-500">Pasajeros desde<Input aria-label="Pasajeros desde" type="number" min={1} value={f.paxDesde} placeholder="por persona" onChange={(e) => set(i, { paxDesde: e.target.value })} /></label>
            <label className="text-[11px] text-gray-500">Pasajeros hasta<Input aria-label="Pasajeros hasta" type="number" min={1} value={f.paxHasta} onChange={(e) => set(i, { paxHasta: e.target.value })} /></label>
            <label className="text-[11px] text-gray-500">Precio neto<Input aria-label="Precio neto" type="number" min={0} step="any" value={f.precio} onChange={(e) => set(i, { precio: e.target.value })} /></label>
            <button type="button" onClick={() => { setMsg(""); setFilas((fs) => fs.filter((_, j) => j !== i)); }} className="h-9 text-xs text-gray-400 hover:text-red-500">Quitar</button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => setFilas((fs) => [...fs, { alcance: "trayecto", paxDesde: "", paxHasta: "", precio: "" }])}>Agregar precio</Button>
        <Button type="button" onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>Guardar precios</Button>
        {(msg || errores[0]) && <span className={`text-xs ${msg === "Guardado." ? "text-green-700" : "text-red-600"}`} role="status">{msg || errores[0]}</span>}
      </div>
    </div>
  );
}
