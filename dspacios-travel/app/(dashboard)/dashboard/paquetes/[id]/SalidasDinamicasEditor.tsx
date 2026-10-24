"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { MonedaTarifas, etiquetasSospechosas } from "@/components/vuelos/MonedaTarifas";
import { mensajeValorSospechoso } from "@/lib/vuelos/monedaSospechosa";
import {
  crearSalidaDinamica, actualizarSalidaDinamica, eliminarSalidaDinamica,
  listarEmpaquetadosParaSalidas63, vincularSalidasEmpaquetados63, actualizarSalidaDesdeFuente63,
  type SalidaDinamicaInput, type CandidatoSalida63,
} from "../actions";

export type SalidaDinamica = {
  id: number; aerolinea: string | null; ruta: string | null; origen: string | null;
  fecha_ida: string; fecha_regreso: string | null;
  hora_salida_ida: string | null; hora_llegada_ida: string | null; hora_salida_reg: string | null; hora_llegada_reg: string | null;
  valor_tiquete: number; aplica_mk: boolean; ta: number; fee_infante: number;
  compra_inicio: string | null; compra_fin: string | null; notas: string | null;
  // #63 (migración 227): vuelo de Empaquetados sin record del que se copian los datos (null = salida manual) y
  // moneda acreditada de una salida MANUAL en modo COP con TRM.
  empaquetado_id?: number | null;
  moneda?: string | null;
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";

// 230: en el modo COP con TRM la salida manual lleva su moneda. COP con un valor menor a 1.000 es casi seguro USD: no se guarda.
function sospechososSalida(v: SalidaDinamicaInput, modo63: boolean): string[] {
  if (!modo63) return [];
  return etiquetasSospechosas(v.moneda === "USD" ? "USD" : "COP", [
    { etiqueta: "El valor del tiquete", valor: v.valorTiquete },
    { etiqueta: "La TA", valor: v.ta },
    { etiqueta: "El fee de infante", valor: v.feeInfante },
  ]);
}

function vacia(): SalidaDinamicaInput {
  return {
    aerolinea: "", ruta: "", origen: "", fechaIda: "", fechaRegreso: "",
    horaSalidaIda: "", horaLlegadaIda: "", horaSalidaReg: "", horaLlegadaReg: "",
    valorTiquete: 0, aplicaMk: true, ta: 0, feeInfante: 0, compraInicio: "", compraFin: "", notas: "",
  };
}
function aInput(s: SalidaDinamica): SalidaDinamicaInput {
  return {
    aerolinea: s.aerolinea ?? "", ruta: s.ruta ?? "", origen: s.origen ?? "",
    fechaIda: s.fecha_ida ?? "", fechaRegreso: s.fecha_regreso ?? "",
    horaSalidaIda: s.hora_salida_ida ?? "", horaLlegadaIda: s.hora_llegada_ida ?? "",
    horaSalidaReg: s.hora_salida_reg ?? "", horaLlegadaReg: s.hora_llegada_reg ?? "",
    valorTiquete: s.valor_tiquete ?? 0, aplicaMk: s.aplica_mk, ta: s.ta ?? 0, feeInfante: s.fee_infante ?? 0,
    compraInicio: s.compra_inicio ?? "", compraFin: s.compra_fin ?? "", notas: s.notas ?? "",
    moneda: s.moneda === "USD" ? "USD" : "COP",
  };
}

export function SalidasDinamicasEditor({
  paqueteId, salidas, moneda, modo63 = false, trm = null,
}: { paqueteId: number; salidas: SalidaDinamica[]; moneda: string; modo63?: boolean; trm?: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nueva, setNueva] = useState<SalidaDinamicaInput>(vacia());
  const [err, setErr] = useState("");
  const vinculadas = salidas.filter((s) => s.empaquetado_id != null);
  const manuales = salidas.filter((s) => s.empaquetado_id == null);

  function agregar() {
    if (!nueva.fechaIda) { setErr("Pon al menos la fecha de ida."); return; }
    const sosp = sospechososSalida(nueva, modo63);
    if (sosp.length) { setErr(mensajeValorSospechoso(sosp)); return; }
    setErr("");
    start(async () => {
      const r = await crearSalidaDinamica(paqueteId, nueva);
      if (r.ok) { setNueva(vacia()); router.refresh(); } else setErr(r.error);
    });
  }

  return (
    <div className="space-y-4">
      {modo63 ? (
        <VinculadasEmpaquetados
          paqueteId={paqueteId}
          vinculadas={vinculadas}
          trm={trm}
          onChanged={() => router.refresh()}
          setErr={setErr}
        />
      ) : (
        <p className="text-[11px] text-gray-500" data-testid="aviso-modo-63">
          Para vincular vuelos de Empaquetados sin record como salidas, activa el modo COP con TRM en la configuración del paquete.
        </p>
      )}

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Salidas manuales</h3>
        <p className="text-[11px] text-gray-500">
          Cada salida manual es un vuelo por sistema (sin record) que escribes a mano: su ruta, fecha e info, y el valor del tiquete.
          El hotel se liquidará por las noches de cada salida. Moneda del paquete: <b>{moneda}</b>.
          {modo63 && " En modo COP, el tiquete, la TA y el fee conservan la moneda que elijas en cada salida y se convierten con la TRM del paquete."}
        </p>

        <div className="space-y-2">
          {manuales.map((s) => <SalidaFila key={s.id} s={s} moneda={moneda} modo63={modo63} onChanged={() => router.refresh()} setErr={setErr} />)}
        </div>

        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3">
          <p className="mb-2 text-xs font-medium text-gray-600">+ Agregar salida manual</p>
          <CamposSalida value={nueva} onChange={setNueva} modo63={modo63} />
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" variant="outline" onClick={agregar} disabled={pending}>Agregar salida</Button>
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Salidas vinculadas a vuelos de Empaquetados SIN record (#63) ─────────────
// Lista MÚLTIPLE de los vuelos elegibles (sin record, activos, vigentes y con destino aéreo permitido por el paquete):
// los nuevos aparecen como PENDIENTES y no se incorporan solos — se eligen y se agregan a propósito, y el tarifario se
// regenera. Los datos copiados de la fuente no se editan aquí: si la fuente cambió, la salida queda marcada para revisar.
function VinculadasEmpaquetados({
  paqueteId, vinculadas, trm, onChanged, setErr,
}: { paqueteId: number; vinculadas: SalidaDinamica[]; trm: number | null; onChanged: () => void; setErr: (m: string) => void }) {
  const [pending, start] = useTransition();
  const [candidatos, setCandidatos] = useState<CandidatoSalida63[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errLista, setErrLista] = useState("");
  const [elegidos, setElegidos] = useState<number[]>([]);
  const [aviso, setAviso] = useState("");
  // Cada cambio de `version` (o de la cantidad de vinculadas) vuelve a pedir la lista al servidor.
  const [version, setVersion] = useState(0);
  const recargar = () => { setCargando(true); setVersion((v) => v + 1); };

  useEffect(() => {
    let vigente = true;
    listarEmpaquetadosParaSalidas63(paqueteId).then((r) => {
      if (!vigente) return;
      setCargando(false);
      if (r.ok) { setCandidatos(r.candidatos); setErrLista(""); } else { setCandidatos([]); setErrLista(r.error); }
    });
    return () => { vigente = false; };
  }, [paqueteId, version, vinculadas.length]);

  const pendientes = candidatos.filter((c) => !c.vinculado);
  const porFuente = new Map(candidatos.map((c) => [c.id, c]));
  const alternar = (id: number) => setElegidos((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  function agregar() {
    if (!elegidos.length) { setErr("Elige al menos un vuelo."); return; }
    setErr(""); setAviso("");
    start(async () => {
      const r = await vincularSalidasEmpaquetados63(paqueteId, elegidos);
      if (r.ok) { setElegidos([]); if (r.aviso) setAviso(r.aviso); onChanged(); recargar(); } else setErr(r.error);
    });
  }
  function actualizar(salidaId: number) {
    setErr(""); setAviso("");
    start(async () => {
      const r = await actualizarSalidaDesdeFuente63(salidaId);
      if (r.ok) { if (r.aviso) setAviso(r.aviso); onChanged(); recargar(); } else setErr(r.error);
    });
  }
  function desvincular(salidaId: number) {
    if (!confirm("¿Desvincular esta salida? Se elimina la salida del paquete (el vuelo de Empaquetados no se toca).")) return;
    start(async () => {
      const r = await eliminarSalidaDinamica(salidaId);
      if (r.ok) { onChanged(); recargar(); } else setErr(r.error);
    });
  }

  return (
    <div className="space-y-3" data-testid="salidas-vinculadas-63">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Salidas vinculadas a Empaquetados (sin record)</h3>
      <p className="text-[11px] text-gray-500">
        Cada salida toma de un vuelo de Empaquetados sin record sus fechas, ruta y tarifas: el precio del aéreo entra tal cual (sin markup ni TA) y el
        fee de infante se suma exacto. Se cotizan y reservan sin consultar cupos de Bloqueo. Cada vuelo conserva su moneda (COP o USD): si es USD se convierte con la TRM del paquete{trm ? <> (TRM: <b>{formatMoneda(trm, "COP")}</b>)</> : null}, una sola vez, y el tarifario se publica en COP.
      </p>

      {vinculadas.length > 0 && (
        <ul className="space-y-2">
          {vinculadas.map((s) => {
            const cand = porFuente.get(s.empaquetado_id as number);
            const revisar = !!cand?.desactualizado || (!cargando && !errLista && !cand);
            return (
              <li key={s.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm" data-testid="salida-vinculada">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                    <Link2 className="h-3.5 w-3.5 text-[var(--brand-accent)]" aria-hidden />
                    {s.ruta || "—"} {s.aerolinea ? `· ${s.aerolinea}` : ""}
                  </span>
                  <span className="text-xs text-gray-500">{s.fecha_ida} → {s.fecha_regreso || "—"}</span>
                  <span className="tabular-nums text-gray-700">
                    Aéreo {formatMoneda(Number(s.valor_tiquete), s.moneda === "USD" ? "USD" : "COP")}
                    {Number(s.fee_infante) > 0 ? ` · inf ${formatMoneda(Number(s.fee_infante), s.moneda === "USD" ? "USD" : "COP")}` : ""}
                  </span>
                  <span className="flex items-center gap-3">
                    <button type="button" disabled={pending} onClick={() => actualizar(s.id)} className="inline-flex items-center gap-1 text-xs text-[var(--brand-accent)] hover:underline">
                      <RefreshCw className="h-3 w-3" aria-hidden /> Actualizar desde la fuente
                    </button>
                    <button type="button" disabled={pending} onClick={() => desvincular(s.id)} className="text-xs text-gray-400 hover:text-red-500">Desvincular</button>
                  </span>
                </div>
                {revisar && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700" data-testid="salida-vinculada-revisar">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    Revisar: el vuelo de Empaquetados cambió o ya no es elegible (con record, vencido, desactivado o fuera de los destinos del paquete). No se publica hasta actualizarla.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-600">
            Vuelos de Empaquetados sin record {cargando ? "" : `· ${pendientes.length} pendiente${pendientes.length === 1 ? "" : "s"}`}
          </p>
          <button type="button" onClick={recargar} disabled={cargando} className="text-xs text-[var(--brand-accent)] hover:underline">Actualizar lista</button>
        </div>
        {errLista && <p className="text-xs text-red-600">{errLista}</p>}
        {!errLista && !cargando && pendientes.length === 0 && (
          <p className="text-xs text-gray-400">No hay vuelos de Empaquetados sin record pendientes de vincular para los destinos aéreos de este paquete.</p>
        )}
        {pendientes.length > 0 && (
          <ul className="max-h-64 space-y-1 overflow-auto">
            {pendientes.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={elegidos.includes(c.id)} onChange={() => alternar(c.id)} aria-label={`Vincular ${c.ruta ?? "vuelo"} ${c.fechaIda}`} />
                  <span className="font-medium">{c.ruta || "—"}</span>
                  <span className="text-xs text-gray-500">{c.aerolinea ?? ""} · {c.fechaIda} → {c.fechaRegreso}</span>
                  <span className="ml-auto tabular-nums text-xs text-gray-600">{formatMoneda(c.tarifaParaEmpaquetar, c.moneda)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center gap-2">
          <Button type="button" variant="outline" onClick={agregar} disabled={pending || !elegidos.length}>
            Agregar {elegidos.length > 1 ? `${elegidos.length} salidas` : "salida"} y regenerar
          </Button>
          {aviso && <span className="text-xs text-gray-600">{aviso}</span>}
        </div>
      </div>
    </div>
  );
}

function SalidaFila({ s, moneda, modo63, onChanged, setErr }: { s: SalidaDinamica; moneda: string; modo63: boolean; onChanged: () => void; setErr: (m: string) => void }) {
  const [pending, start] = useTransition();
  const [v, setV] = useState<SalidaDinamicaInput>(aInput(s));
  const [editando, setEditando] = useState(false);
  // En modo COP cada salida manual muestra sus valores en la moneda que acreditó.
  const monedaFila = modo63 ? (s.moneda === "USD" ? "USD" : "COP") : moneda;

  function guardar() {
    const sosp = sospechososSalida(v, modo63);
    if (sosp.length) { setErr(mensajeValorSospechoso(sosp)); return; }
    start(async () => {
      const r = await actualizarSalidaDinamica(s.id, v);
      if (r.ok) { setEditando(false); onChanged(); } else setErr(r.error);
    });
  }
  function borrar() {
    if (!confirm("¿Eliminar esta salida?")) return;
    start(async () => { const r = await eliminarSalidaDinamica(s.id); if (r.ok) onChanged(); else setErr(r.error); });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      {!editando ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium text-gray-700">{s.ruta || "—"} {s.aerolinea ? `· ${s.aerolinea}` : ""}</span>
          <span className="text-xs text-gray-500">{s.fecha_ida} → {s.fecha_regreso || "—"}</span>
          <span className="tabular-nums text-gray-700">
            Tiquete {formatMoneda(Number(s.valor_tiquete), monedaFila)} {s.aplica_mk ? "(mk)" : `(+TA ${formatMoneda(Number(s.ta), monedaFila)})`}
            {Number(s.fee_infante) > 0 ? ` · inf ${formatMoneda(Number(s.fee_infante), monedaFila)}` : ""}
          </span>
          <span className="flex gap-3">
            <button type="button" onClick={() => setEditando(true)} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
            <button type="button" disabled={pending} onClick={borrar} className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
          </span>
        </div>
      ) : (
        <>
          <CamposSalida value={v} onChange={setV} modo63={modo63} />
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>Guardar</Button>
            <button type="button" onClick={() => { setEditando(false); setV(aInput(s)); }} className="text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}

function CamposSalida({ value, onChange, modo63 = false }: { value: SalidaDinamicaInput; onChange: (v: SalidaDinamicaInput) => void; modo63?: boolean }) {
  const set = (k: keyof SalidaDinamicaInput, val: string | number | boolean) => onChange({ ...value, [k]: val });
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div><label className={lbl}>Aerolínea</label><Input value={value.aerolinea} onChange={(e) => set("aerolinea", e.target.value)} placeholder="JetSMART, Avianca…" /></div>
        <div><label className={lbl}>Ruta (IATA)</label><Input value={value.ruta} onChange={(e) => set("ruta", e.target.value)} placeholder="MDE - MIA - MDE" /></div>
        <div><label className={lbl}>Origen (IATA)</label><Input value={value.origen} onChange={(e) => set("origen", e.target.value)} placeholder="MDE" /></div>
        <div></div>
        <div><label className={lbl}>Fecha ida *</label><DateInput aria-label="Fecha ida" type="date" value={value.fechaIda} onValueChange={(dateValue) => set("fechaIda", dateValue)} /></div>
        <div><label className={lbl}>Fecha regreso</label><DateInput aria-label="Fecha regreso" type="date" value={value.fechaRegreso} onValueChange={(dateValue) => set("fechaRegreso", dateValue)} /></div>
        <div><label className={lbl}>Hora salida ida</label><Input value={value.horaSalidaIda} onChange={(e) => set("horaSalidaIda", e.target.value)} placeholder="08:30" /></div>
        <div><label className={lbl}>Hora llegada ida</label><Input value={value.horaLlegadaIda} onChange={(e) => set("horaLlegadaIda", e.target.value)} placeholder="11:00" /></div>
        <div><label className={lbl}>Hora salida regreso</label><Input value={value.horaSalidaReg} onChange={(e) => set("horaSalidaReg", e.target.value)} placeholder="18:00" /></div>
        <div><label className={lbl}>Hora llegada regreso</label><Input value={value.horaLlegadaReg} onChange={(e) => set("horaLlegadaReg", e.target.value)} placeholder="20:30" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2 md:grid-cols-4">
        {modo63 && (
          <div className="col-span-2 md:col-span-4">
            <MonedaTarifas
              moneda={value.moneda === "USD" ? "USD" : "COP"}
              onChange={(m) => onChange({ ...value, moneda: m })}
              campos={[
                { etiqueta: "El valor del tiquete", valor: value.valorTiquete },
                { etiqueta: "La TA", valor: value.ta },
                { etiqueta: "El fee de infante", valor: value.feeInfante },
              ]}
              ayuda="USD se convierte con la TRM del paquete."
            />
          </div>
        )}
        <div><label className={lbl}>Valor tiquete (adulto 2+)</label><Input type="number" min={0} value={value.valorTiquete || ""} onChange={(e) => set("valorTiquete", Number(e.target.value) || 0)} placeholder="—" /></div>
        <div>
          <label className={lbl}>Montaje del vuelo</label>
          <select value={value.aplicaMk ? "mk" : "ta"} onChange={(e) => set("aplicaMk", e.target.value === "mk")} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="mk">Markup del paquete</option>
            <option value="ta">TA (tarifa administrativa)</option>
          </select>
        </div>
        {!value.aplicaMk && (
          <div><label className={lbl}>TA por pax</label><Input type="number" min={0} value={value.ta || ""} onChange={(e) => set("ta", Number(e.target.value) || 0)} placeholder="—" /></div>
        )}
        <div><label className={lbl}>Fee infante (0–1.99)</label><Input type="number" min={0} step="0.01" value={value.feeInfante || ""} onChange={(e) => set("feeInfante", Number(e.target.value) || 0)} placeholder="0" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div><label className={lbl}>Vigencia compra desde</label><DateInput aria-label="Vigencia compra desde" type="date" value={value.compraInicio} onValueChange={(dateValue) => set("compraInicio", dateValue)} /></div>
        <div><label className={lbl}>Vigencia compra hasta</label><DateInput aria-label="Vigencia compra hasta" type="date" value={value.compraFin} onValueChange={(dateValue) => set("compraFin", dateValue)} /></div>
        <div className="md:col-span-2"><label className={lbl}>Notas</label><Input value={value.notas} onChange={(e) => set("notas", e.target.value)} /></div>
      </div>
    </div>
  );
}
