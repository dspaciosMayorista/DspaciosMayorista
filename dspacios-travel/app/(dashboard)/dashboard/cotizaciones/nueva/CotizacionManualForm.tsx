"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { Plane, Hotel, Car, HeartPulse, Plus, Trash2, type LucideIcon } from "lucide-react";
import { crearCotizacionManual, type ServicioManual } from "../manual-actions";
import { sugerirIncluye, NO_INCLUYE_DEFAULT } from "@/lib/cotizacion/incluye";

type Asesor = { nombre: string | null; email: string };
type Aliado = { id: number; nombre: string; tipo: string | null };

const TIPOS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "aereo", label: "Aéreo", icon: Plane },
  { value: "hotel", label: "Hotel", icon: Hotel },
  { value: "traslado", label: "Traslado", icon: Car },
  { value: "asistencia", label: "Asistencia médica", icon: HeartPulse },
  { value: "otro", label: "Otro", icon: Plus },
];

type Fila = ServicioManual & { _id: number };
let _seq = 1;

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const hoy = new Date().toISOString().slice(0, 10);
const masDias = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function valor(f: { costoNeto: number; modo: "mk" | "ta"; pctMarkup: number; ta: number }): number {
  const c = Number(f.costoNeto) || 0;
  if (f.modo === "ta") return Math.round(Math.max(0, c) + (Number(f.ta) || 0));
  const m = (Number(f.pctMarkup) || 0) / 100;
  if (c <= 0 || m >= 1) return 0;
  return Math.round(c / (1 - m));
}

export function CotizacionManualForm({ asesores, aliados, miNombre, miRolVenta }: {
  asesores: Asesor[]; aliados: Aliado[]; miNombre: string; miRolVenta: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  // Cliente / cabecera
  const [cli, setCli] = useState({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "", nacimiento: "" });
  const [destino, setDestino] = useState("");
  const [fechaIda, setFechaIda] = useState("");
  const [fechaRegreso, setFechaRegreso] = useState("");
  const [pax, setPax] = useState("1");
  const [moneda, setMoneda] = useState("COP");
  const [plazo, setPlazo] = useState("");
  const [vigencia, setVigencia] = useState(masDias(3));
  const [observaciones, setObservaciones] = useState("");
  const [incluye, setIncluye] = useState("");
  const [noIncluye, setNoIncluye] = useState("");

  // Canal
  const [tipoAsesor, setTipoAsesor] = useState<"interno" | "agencia" | "freelance">("interno");
  const [asesorInterno, setAsesorInterno] = useState(miRolVenta ? miNombre : "");
  const [aliadoNombre, setAliadoNombre] = useState("");

  // Markup general + servicios
  const [markupGeneral, setMarkupGeneral] = useState("20");
  const [filas, setFilas] = useState<Fila[]>([]);

  // El modo TA solo aplica al aéreo (igual que en el servidor).
  const efModo = (f: Fila): "mk" | "ta" => (f.tipo === "aereo" && f.modo === "ta" ? "ta" : "mk");
  const total = useMemo(() => filas.reduce((s, f) => s + valor({ ...f, modo: efModo(f) }), 0), [filas]);
  const fmt = (n: number) => formatMoneda(n, moneda);

  function agregar(tipo: string) {
    setFilas((f) => [...f, { _id: _seq++, tipo, plataforma: "", nombre: "", proveedor: "", costoNeto: 0, modo: "mk", pctMarkup: Number(markupGeneral) || 0, ta: 0 }]);
  }
  function set(id: number, k: keyof ServicioManual, v: string | number) {
    setFilas((f) => f.map((x) => (x._id === id ? { ...x, [k]: v } : x)));
  }
  function quitar(id: number) {
    setFilas((f) => f.filter((x) => x._id !== id));
  }

  function guardar() {
    setErr("");
    if (!`${cli.nombres}${cli.apellidos}`.trim()) { setErr("El nombre del cliente es obligatorio."); return; }
    if (!filas.length) { setErr("Agrega al menos un servicio."); return; }
    start(async () => {
      const r = await crearCotizacionManual({
        cliente: cli, destino, fechaIda, fechaRegreso, pax: Number(pax) || 0, moneda,
        tipoAsesor,
        asesorInterno: tipoAsesor === "interno" ? asesorInterno : "",
        agenciaNombre: tipoAsesor === "agencia" ? aliadoNombre : "",
        freelanceNombre: tipoAsesor === "freelance" ? aliadoNombre : "",
        plazo, vigenciaHasta: vigencia, observaciones, incluye, noIncluye,
        servicios: filas.map(({ tipo, plataforma, nombre, proveedor, costoNeto, modo, pctMarkup, ta }) => ({ tipo, plataforma, nombre, proveedor, costoNeto: Number(costoNeto) || 0, modo, pctMarkup: Number(pctMarkup) || 0, ta: Number(ta) || 0 })),
      });
      if (r.ok) router.push(`/dashboard/cotizaciones/${r.id}`);
      else setErr(r.error);
    });
  }

  const aliadosFiltrados = aliados.filter((a) => tipoAsesor === "agencia" ? (a.tipo ?? "").toLowerCase().includes("agencia") : tipoAsesor === "freelance" ? (a.tipo ?? "").toLowerCase().includes("free") : true);

  return (
    <div className="space-y-6">
      {/* Cliente */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Cliente</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div><label className={lbl}>Nombres</label><Input value={cli.nombres} onChange={(e) => setCli({ ...cli, nombres: e.target.value })} /></div>
          <div><label className={lbl}>Apellidos</label><Input value={cli.apellidos} onChange={(e) => setCli({ ...cli, apellidos: e.target.value })} /></div>
          <div>
            <label className={lbl}>Tipo doc</label>
            <select value={cli.tipoDoc} onChange={(e) => setCli({ ...cli, tipoDoc: e.target.value })} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {["CC", "CE", "PAS", "NIT", "TI"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label className={lbl}>N° documento</label><Input value={cli.numeroDoc} onChange={(e) => setCli({ ...cli, numeroDoc: e.target.value })} /></div>
          <div><label className={lbl}>Fecha de nacimiento</label><Input type="date" value={cli.nacimiento} onChange={(e) => setCli({ ...cli, nacimiento: e.target.value })} /></div>
          <div><label className={lbl}>Teléfono</label><Input value={cli.telefono} onChange={(e) => setCli({ ...cli, telefono: e.target.value })} /></div>
          <div><label className={lbl}>Email</label><Input value={cli.email} onChange={(e) => setCli({ ...cli, email: e.target.value })} /></div>
        </div>
        <p className="mt-2 text-xs text-gray-400">Para generar el contrato se exige nombre, tipo y número de documento y fecha de nacimiento del titular.</p>
      </section>

      {/* Datos del viaje */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Datos del viaje</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2 md:col-span-2"><label className={lbl}>Destino</label><Input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ej. San Andrés" /></div>
          <div><label className={lbl}>Fecha ida</label><Input type="date" value={fechaIda} min={hoy} onChange={(e) => setFechaIda(e.target.value)} /></div>
          <div><label className={lbl}>Fecha regreso</label><Input type="date" value={fechaRegreso} min={fechaIda || hoy} onChange={(e) => setFechaRegreso(e.target.value)} /></div>
          <div><label className={lbl}>Pax</label><Input type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} /></div>
          <div>
            <label className={lbl}>Moneda</label>
            <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {["COP", "USD"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Plazo de pago</label><Input value={plazo} onChange={(e) => setPlazo(e.target.value)} placeholder="Inmediato / 7 días…" /></div>
          <div><label className={lbl}>Vigencia hasta</label><Input type="date" value={vigencia} min={hoy} onChange={(e) => setVigencia(e.target.value)} /></div>
        </div>

        {/* Canal */}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={lbl}>Tipo de venta</label>
            <div className="flex gap-1">
              {(["interno", "agencia", "freelance"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTipoAsesor(t)}
                  className="flex-1 rounded-lg border px-3 py-2 text-xs font-medium capitalize transition-colors"
                  style={tipoAsesor === t ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {tipoAsesor === "interno" ? (
            <div>
              <label className={lbl}>Asesor</label>
              <select value={asesorInterno} onChange={(e) => setAsesorInterno(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Selecciona</option>
                {asesores.map((a) => <option key={a.email} value={a.nombre ?? a.email}>{a.nombre ?? a.email}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className={lbl}>{tipoAsesor === "agencia" ? "Agencia" : "Freelance"}</label>
              <input list="aliados-list" value={aliadoNombre} onChange={(e) => setAliadoNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="Nombre" />
              <datalist id="aliados-list">{aliadosFiltrados.map((a) => <option key={a.id} value={a.nombre} />)}</datalist>
            </div>
          )}
        </div>
      </section>

      {/* Servicios */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Servicios</h2>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Markup general
            <Input type="number" min={0} className="h-8 w-20" value={markupGeneral} onChange={(e) => setMarkupGeneral(e.target.value)} />%
          </label>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TIPOS.map((t) => (
            <button key={t.value} type="button" onClick={() => agregar(t.value)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-[color:var(--brand-primary)] hover:text-[color:var(--brand-primary)]">
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {filas.length === 0 ? (
          <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">Agrega servicios con los botones de arriba.</p>
        ) : (
          <div className="space-y-3">
            {filas.map((f) => {
              const esAereo = f.tipo === "aereo";
              const v = valor({ ...f, modo: efModo(f) });
              const modoTa = esAereo && f.modo === "ta";
              return (
                <div key={f._id} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <select value={f.tipo} onChange={(e) => set(f._id, "tipo", e.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold">
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
                    <button type="button" onClick={() => quitar(f._id)} className="ml-auto text-gray-400 hover:text-red-500"><Trash2 size={15} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    <div><label className={lbl}>Plataforma</label><Input value={f.plataforma} onChange={(e) => set(f._id, "plataforma", e.target.value)} placeholder="Despegar, JetSMART…" /></div>
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
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(v)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="text-sm font-medium text-gray-600">Total cotización</span>
          <span className="text-xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(total)}</span>
        </div>
      </section>

      {/* Incluye / No incluye */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Incluye / No incluye</h2>
          <p className="text-xs text-gray-400">Aparece en la cotización para que el cliente sepa qué cubre. Editable.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={lbl}>Incluye</label>
              <button type="button" onClick={() => setIncluye(sugerirIncluye(filas.map((f) => ({ tipo: f.tipo, nombre: f.nombre }))))}
                className="text-[11px] font-medium text-[#1D7C9A] hover:underline">Generar desde servicios</button>
            </div>
            <textarea value={incluye} onChange={(e) => setIncluye(e.target.value)} rows={5} placeholder="Una línea por ítem…" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={lbl}>No incluye</label>
              <button type="button" onClick={() => setNoIncluye(NO_INCLUYE_DEFAULT)}
                className="text-[11px] font-medium text-[#1D7C9A] hover:underline">Usar texto sugerido</button>
            </div>
            <textarea value={noIncluye} onChange={(e) => setNoIncluye(e.target.value)} rows={5} placeholder="Una línea por ítem…" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
          </div>
        </div>
      </section>

      <div>
        <label className={lbl}>Observaciones</label>
        <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Generar cotización"}
        </Button>
        <span className="text-xs text-gray-400">Se guarda como cotización (estado abierta).</span>
      </div>
    </div>
  );
}
