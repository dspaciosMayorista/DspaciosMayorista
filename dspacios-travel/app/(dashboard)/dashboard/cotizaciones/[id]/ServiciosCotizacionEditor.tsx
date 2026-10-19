"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plane, Hotel, Car, HeartPulse, Plus, Trash2, Pencil, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { liquidarServicios, serviciosConContenido, valorServicio, type ServicioManual } from "@/lib/cotizacion/liquidacionManual";
import { diffServicios, hayCambios } from "@/lib/cotizacion/edicionServiciosManual";
import { editarServiciosCotizacionManual } from "../manual-actions";

const TIPOS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "aereo", label: "Aéreo", icon: Plane },
  { value: "hotel", label: "Hotel", icon: Hotel },
  { value: "traslado", label: "Traslado", icon: Car },
  { value: "asistencia", label: "Asistencia médica", icon: HeartPulse },
  { value: "otro", label: "Otro", icon: Plus },
];

const lbl = "mb-1 block text-xs font-medium text-gray-600";

type Fila = ServicioManual & { _id: number };

// El modo TA solo aplica al aéreo (igual que en el servidor).
const efModo = (f: ServicioManual): "mk" | "ta" => (f.tipo === "aereo" && f.modo === "ta" ? "ta" : "mk");
const valor = (f: ServicioManual) => valorServicio(f.costoNeto, efModo(f), f.pctMarkup, f.ta);

// Editor de los SERVICIOS de una cotización dinámica (#39 fase 1). La ficha solo
// lo muestra en una manual simple abierta que nunca tuvo pago y vigente, con la
// edición habilitada; `venta`, solo en las que creó. Recalcula el total
// conservando niños y recobro (`extrasTotal`), y guarda con la revisión que leyó
// la ficha y con motivo obligatorio: si la cotización cambió entre medio, la
// base rechaza y pide recargar.
export function ServiciosCotizacionEditor({
  id, moneda, revEsperada, extrasTotal, inicial,
}: {
  id: number;
  moneda: string;
  revEsperada: number;
  extrasTotal: number;
  inicial: ServicioManual[];
}) {
  const router = useRouter();
  const semilla = useMemo(() => inicial.map((s, i) => ({ ...s, _id: i + 1 })), [inicial]);
  const [editando, setEditando] = useState(false);
  const [filas, setFilas] = useState<Fila[]>(semilla);
  const [seq, setSeq] = useState(semilla.length + 1);
  const [motivo, setMotivo] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  const fmt = (n: number) => formatMoneda(n, moneda);

  const totalAntes = useMemo(() => inicial.reduce((s, f) => s + valor(f), 0), [inicial]);
  const totalNuevo = useMemo(() => filas.reduce((s, f) => s + valor(f), 0), [filas]);
  const cambios = useMemo(
    () => diffServicios(liquidarServicios(serviciosConContenido(inicial)), liquidarServicios(serviciosConContenido(filas))),
    [inicial, filas],
  );
  const conContenido = serviciosConContenido(filas).length;

  function set<K extends keyof ServicioManual>(fid: number, k: K, v: ServicioManual[K]) {
    setFilas((fs) => fs.map((f) => (f._id === fid ? { ...f, [k]: v } : f)));
  }
  function agregar(tipo: string) {
    setFilas((fs) => [...fs, { _id: seq, tipo, plataforma: "", nombre: "", proveedor: "", costoNeto: 0, modo: "mk", pctMarkup: 20, ta: 0 }]);
    setSeq((n) => n + 1);
  }
  function quitar(fid: number) {
    setFilas((fs) => fs.filter((f) => f._id !== fid));
  }
  function cancelar() {
    setFilas(semilla);
    setMotivo("");
    setErr("");
    setEditando(false);
  }

  function guardar() {
    setErr(""); setOk(false);
    if (!conContenido) { setErr("La cotización debe conservar al menos un servicio."); return; }
    if (!hayCambios(cambios)) { setErr("No hay cambios que guardar."); return; }
    if (!motivo.trim()) { setErr("Indica el motivo del cambio."); return; }
    start(async () => {
      const r = await editarServiciosCotizacionManual(id, {
        revEsperada,
        motivo: motivo.trim(),
        servicios: filas.map(({ _id, ...s }) => { void _id; return s; }),
      });
      if (r.ok) { setOk(true); setEditando(false); setMotivo(""); router.refresh(); }
      else setErr(r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5" aria-label="Editar servicios cotizados">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Editar servicios</h2>
        {!editando && (
          <button type="button" onClick={() => { setOk(false); setEditando(true); }}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#1D7C9A] hover:underline">
            <Pencil size={13} aria-hidden /> Editar
          </button>
        )}
      </div>

      {!editando ? (
        <p className="text-sm text-gray-500">
          Puedes modificar, quitar o agregar servicios mientras la cotización siga abierta y sin pagos. El total se
          recalcula conservando niños y recobro.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {TIPOS.map((t) => (
              <button key={t.value} type="button" onClick={() => agregar(t.value)}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
                <t.icon size={14} aria-hidden /> {t.label}
              </button>
            ))}
          </div>

          {filas.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">Sin servicios: agrega al menos uno.</p>
          ) : (
            <div className="space-y-3">
              {filas.map((f) => {
                const esAereo = f.tipo === "aereo";
                const modoTa = esAereo && f.modo === "ta";
                return (
                  <div key={f._id} className="rounded-lg border border-gray-200 p-3" data-servicio={f._id}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <select aria-label="Tipo de servicio" value={f.tipo} onChange={(e) => set(f._id, "tipo", e.target.value)}
                        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold">
                        {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      {esAereo && (
                        <div className="flex overflow-hidden rounded-md border border-gray-300 text-[11px] font-medium">
                          {(["mk", "ta"] as const).map((m) => (
                            <button key={m} type="button" onClick={() => set(f._id, "modo", m)}
                              className="px-2.5 py-1 transition-colors"
                              style={f.modo === m ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "#6b7280" }}>
                              {m === "mk" ? "Markup" : "TA (fijo)"}
                            </button>
                          ))}
                        </div>
                      )}
                      <button type="button" aria-label="Quitar servicio" onClick={() => quitar(f._id)} className="ml-auto text-gray-400 hover:text-red-500">
                        <Trash2 size={15} aria-hidden />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                      <div><label className={lbl}>Plataforma</label><Input value={f.plataforma} onChange={(e) => set(f._id, "plataforma", e.target.value)} /></div>
                      <div><label className={lbl}>Nombre del servicio</label><Input value={f.nombre} onChange={(e) => set(f._id, "nombre", e.target.value)} /></div>
                      <div><label className={lbl}>Proveedor</label><Input value={f.proveedor} onChange={(e) => set(f._id, "proveedor", e.target.value)} /></div>
                      <div><label className={lbl}>Costo neto</label><Input type="number" min={0} value={f.costoNeto || ""} onChange={(e) => set(f._id, "costoNeto", Number(e.target.value))} /></div>
                      {modoTa ? (
                        <div><label className={lbl}>TA (valor fijo)</label><Input type="number" min={0} value={f.ta || ""} onChange={(e) => set(f._id, "ta", Number(e.target.value))} /></div>
                      ) : (
                        <div><label className={lbl}>Markup %</label><Input type="number" min={0} value={f.pctMarkup} onChange={(e) => set(f._id, "pctMarkup", Number(e.target.value))} /></div>
                      )}
                      <div>
                        <label className={lbl}>Valor</label>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(valor(f))}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600" data-resumen-edicion>
            <div className="flex items-center justify-between"><span>Servicios (antes → ahora)</span><span className="tabular-nums">{fmt(totalAntes)} → {fmt(totalNuevo)}</span></div>
            <div className="flex items-center justify-between font-medium text-gray-800">
              <span>Total de la cotización</span>
              <span className="tabular-nums" data-total-nuevo>{fmt(totalNuevo + extrasTotal)}</span>
            </div>
            <div className="text-xs text-gray-500">
              {cambios.agregados.length} agregado(s) · {cambios.quitados.length} quitado(s) · {cambios.modificados.length} modificado(s)
            </div>
          </div>

          <div className="mt-3">
            <label className={lbl} htmlFor={`motivo-servicios-${id}`}>Motivo del cambio (obligatorio)</label>
            <textarea
              id={`motivo-servicios-${id}`}
              value={motivo}
              maxLength={500}
              rows={2}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
              placeholder="Ej.: el cliente cambió de hotel"
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar servicios"}</Button>
            <button type="button" onClick={cancelar} className="text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
          </div>
        </>
      )}
      {err && <p className="mt-2 text-xs text-red-600" role="alert">{err}</p>}
      {ok && <p className="mt-2 text-xs text-green-600">Servicios actualizados.</p>}
    </section>
  );
}
