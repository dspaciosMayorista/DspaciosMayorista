"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckCircle2, Pencil, Plus, Trash2, X } from "lucide-react";
import { DateInput } from "@/components/ui/DateInput";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { fechaNegocio } from "@/lib/fechaNegocio";
import {
  PERIODICIDADES, REGLAS_DIGITOS, ETIQUETA_ESTADO, etiquetaPeriodo, periodosPorAnio, digitosDeRegla, digitosNit,
  type Obligacion, type Vencimiento, type Cumplimiento, type ItemCalendario, type EstadoVencimiento,
  type Periodicidad, type ReglaDigitos,
} from "@/lib/contabilidad/calendarioTributario";
import { guardarObligacion, eliminarObligacion, guardarFechas, registrarCumplimiento } from "./actions";

type Pestana = "vencimientos" | "obligaciones" | "fechas";
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MESES[Number(m) - 1] ?? m} ${y}`;
};
const lbl = "mb-1 block text-xs font-medium text-gray-600";

const ESTILO_ESTADO: Record<EstadoVencimiento, string> = {
  vencida: "bg-red-50 text-red-700 border-red-200",
  falta_pago: "bg-amber-50 text-amber-800 border-amber-200",
  proxima: "bg-amber-50 text-amber-800 border-amber-200",
  futura: "bg-gray-50 text-gray-600 border-gray-200",
  cumplida: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function CalendarioTributarioClient(props: {
  hoy: string;
  anio: number;
  nit: string | null;
  obligaciones: Obligacion[];
  notas: Record<number, string>;
  vencimientos: Vencimiento[];
  cumplimientos: Cumplimiento[];
  items: ItemCalendario[];
  sinResolver: { obligacionId: number; obligacion: string; motivo: string }[];
}) {
  const [pestana, setPestana] = useState<Pestana>(props.obligaciones.length ? "vencimientos" : "obligaciones");
  const pestanas: { id: Pestana; etiqueta: string }[] = [
    { id: "vencimientos", etiqueta: "Vencimientos" },
    { id: "obligaciones", etiqueta: "Obligaciones" },
    { id: "fechas", etiqueta: "Fechas por año" },
  ];
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Calendario tributario" className="flex flex-wrap gap-1 border-b border-gray-200">
        {pestanas.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={pestana === p.id}
            onClick={() => setPestana(p.id)}
            className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-medium ${pestana === p.id ? "border-[var(--brand-primary)] text-[var(--brand-primary)]" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>
      {pestana === "vencimientos" && <Vencimientos {...props} />}
      {pestana === "obligaciones" && <Obligaciones obligaciones={props.obligaciones} notas={props.notas} />}
      {pestana === "fechas" && <Fechas obligaciones={props.obligaciones} vencimientos={props.vencimientos} anio={props.anio} nit={props.nit} />}
    </div>
  );
}

// ── Vencimientos ───────────────────────────────────────────────────────────
function Vencimientos({ items, sinResolver, cumplimientos, obligaciones }: {
  items: ItemCalendario[]; sinResolver: { obligacionId: number; obligacion: string; motivo: string }[];
  cumplimientos: Cumplimiento[]; obligaciones: Obligacion[];
}) {
  const [verTodo, setVerTodo] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const visibles = verTodo ? items : items.filter((i) => i.estado !== "cumplida" && (i.estado !== "futura" || i.diasRestantes <= 60));
  const cuenta = (e: EstadoVencimiento) => items.filter((i) => i.estado === e).length;
  const notaDe = (i: ItemCalendario) => cumplimientos.find((c) => c.obligacionId === i.obligacionId && c.anio === i.anio && c.periodo === i.periodo)?.nota ?? "";

  if (!obligaciones.length) {
    return <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">Aún no hay obligaciones. Créalas en la pestaña Obligaciones y luego carga sus fechas.</p>;
  }
  return (
    <div className="space-y-3">
      {sinResolver.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle size={16} aria-hidden /> Obligaciones sin fecha para esta agencia</p>
          <ul className="mt-1 list-disc pl-6">
            {sinResolver.map((s) => <li key={s.obligacionId}><b>{s.obligacion}:</b> {s.motivo}</li>)}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-full border px-3 py-1 ${ESTILO_ESTADO.vencida}`}>Vencidas: <b>{cuenta("vencida")}</b></span>
        <span className={`rounded-full border px-3 py-1 ${ESTILO_ESTADO.falta_pago}`}>Falta pago: <b>{cuenta("falta_pago")}</b></span>
        <span className={`rounded-full border px-3 py-1 ${ESTILO_ESTADO.proxima}`}>Próximas: <b>{cuenta("proxima")}</b></span>
        <label className="ml-auto flex min-h-11 items-center gap-2 text-gray-600">
          <input type="checkbox" checked={verTodo} onChange={(e) => setVerTodo(e.target.checked)} />
          Ver también cumplidas y lejanas
        </label>
      </div>
      {visibles.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          <CheckCircle2 size={18} className="mr-1 inline text-emerald-600" aria-hidden /> No hay vencimientos pendientes en los próximos 60 días.
        </p>
      ) : (
        <ResponsiveTableShell minWidth={760} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Vence</th><th className="px-3 py-2">Obligación</th><th className="px-3 py-2">Periodo</th>
              <th className="px-3 py-2">Estado</th><th className="px-3 py-2">Constancia</th><th className="px-3 py-2"><span className="sr-only">Acciones</span></th>
            </tr></thead>
            <tbody>
              {visibles.map((i) => {
                const clave = `${i.obligacionId}|${i.anio}|${i.periodo}`;
                return (
                  <FilaVencimiento key={clave} item={i} nota={notaDe(i)} abierta={editando === clave}
                    onAbrir={() => setEditando(editando === clave ? null : clave)} onCerrar={() => setEditando(null)} />
                );
              })}
            </tbody>
          </table>
        </ResponsiveTableShell>
      )}
    </div>
  );
}

function FilaVencimiento({ item: i, nota, abierta, onAbrir, onCerrar }: {
  item: ItemCalendario; nota: string; abierta: boolean; onAbrir: () => void; onCerrar: () => void;
}) {
  const dias = i.diasRestantes;
  const cuando = dias === 0 ? "hoy" : dias > 0 ? `en ${dias} día${dias === 1 ? "" : "s"}` : `hace ${-dias} día${dias === -1 ? "" : "s"}`;
  return (
    <>
      <tr className="border-t border-gray-100 align-top">
        <td className="px-3 py-2 whitespace-nowrap" data-label="Vence">
          <div className="font-medium text-gray-800">{fechaCorta(i.fecha)}</div>
          <div className="text-xs text-gray-500">{cuando}</div>
        </td>
        <td className="px-3 py-2 text-gray-800" data-label="Obligación">{i.obligacion}</td>
        <td className="px-3 py-2 text-gray-600" data-label="Periodo">{i.etiqueta}</td>
        <td className="px-3 py-2" data-label="Estado">
          <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${ESTILO_ESTADO[i.estado]}`}>{ETIQUETA_ESTADO[i.estado]}</span>
        </td>
        <td className="px-3 py-2 text-xs text-gray-600" data-label="Constancia">
          <div>Presentada: {fechaCorta(i.presentadaEn)}</div>
          {i.requierePago ? <div>Pagada: {fechaCorta(i.pagadaEn)}</div> : <div className="text-gray-400">No requiere pago</div>}
        </td>
        <td className="px-2 py-1 text-right" data-label="Acciones">
          <button type="button" onClick={onAbrir} aria-expanded={abierta}
            aria-label={`Registrar presentación o pago: ${i.obligacion}, ${i.etiqueta}`}
            className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-xs font-medium text-[var(--brand-accent)] hover:bg-gray-100">
            <CalendarClock size={15} aria-hidden /> Registrar
          </button>
        </td>
      </tr>
      {abierta && (
        <tr className="border-t border-gray-100 bg-gray-50/60">
          <td colSpan={6} className="px-3 py-3">
            <EditorConstancia item={i} nota={nota} onCerrar={onCerrar} />
          </td>
        </tr>
      )}
    </>
  );
}

function EditorConstancia({ item, nota: notaInicial, onCerrar }: { item: ItemCalendario; nota: string; onCerrar: () => void }) {
  const router = useRouter();
  const [presentada, setPresentada] = useState(item.presentadaEn ?? "");
  const [pagada, setPagada] = useState(item.pagadaEn ?? "");
  const [nota, setNota] = useState(notaInicial);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  function guardar() {
    setError("");
    start(async () => {
      const r = await registrarCumplimiento({
        obligacionId: item.obligacionId, anio: item.anio, periodo: item.periodo,
        presentadaEn: presentada || null, pagadaEn: item.requierePago ? pagada || null : null, nota,
      });
      if (!r.ok) { setError(r.error); return; }
      onCerrar();
      router.refresh();
    });
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className={lbl}>Presentada el</label>
        <div className="flex items-center gap-1">
          <DateInput aria-label="Fecha de presentación" type="date" value={presentada} onValueChange={setPresentada} className="w-40" />
          {!presentada && <button type="button" className="text-xs text-[var(--brand-accent)]" onClick={() => setPresentada(fechaNegocio())}>Hoy</button>}
        </div>
      </div>
      {item.requierePago && (
        <div>
          <label className={lbl}>Pagada el</label>
          <div className="flex items-center gap-1">
            <DateInput aria-label="Fecha de pago" type="date" value={pagada} onValueChange={setPagada} className="w-40" />
            {!pagada && <button type="button" className="text-xs text-[var(--brand-accent)]" onClick={() => setPagada(fechaNegocio())}>Hoy</button>}
          </div>
        </div>
      )}
      <div className="min-w-[200px] flex-1">
        <label className={lbl}>Nota (opcional)</label>
        <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="ej. N° de formulario o recibo" />
      </div>
      <div className="flex gap-2">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</Button>
        <Button variant="outline" onClick={onCerrar} disabled={pending}>Cancelar</Button>
      </div>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ── Obligaciones ───────────────────────────────────────────────────────────
type Borrador = { id?: number; nombre: string; periodicidad: Periodicidad; reglaDigitos: ReglaDigitos; diasAviso: string; requierePago: boolean; activa: boolean; notas: string };
const BORRADOR: Borrador = { nombre: "", periodicidad: "mensual", reglaDigitos: 1, diasAviso: "10", requierePago: true, activa: true, notas: "" };

function Obligaciones({ obligaciones, notas }: { obligaciones: Obligacion[]; notas: Record<number, string> }) {
  const router = useRouter();
  const [b, setB] = useState<Borrador>(BORRADOR);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  function guardar() {
    setError("");
    start(async () => {
      const r = await guardarObligacion({ ...b, diasAviso: Number(b.diasAviso) });
      if (!r.ok) { setError(r.error); return; }
      setB(BORRADOR);
      router.refresh();
    });
  }
  function editar(o: Obligacion) {
    setError("");
    setB({ id: o.id, nombre: o.nombre, periodicidad: o.periodicidad, reglaDigitos: o.reglaDigitos, diasAviso: String(o.diasAviso), requierePago: o.requierePago, activa: o.activa, notas: notas[o.id] ?? "" });
  }
  function eliminar(o: Obligacion) {
    if (!confirm(`¿Eliminar "${o.nombre}"? Se borran también sus fechas y constancias registradas.`)) return;
    start(async () => {
      const r = await eliminarObligacion(o.id);
      if (!r.ok) { setError(r.error); return; }
      if (b.id === o.id) setB(BORRADOR);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">{b.id ? "Editar obligación" : "Nueva obligación"}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-3">
            <label className={lbl} htmlFor="ob-nombre">Nombre</label>
            <Input id="ob-nombre" value={b.nombre} onChange={(e) => setB({ ...b, nombre: e.target.value })} placeholder="ej. Retención en la fuente (formulario 350)" />
          </div>
          <div>
            <label className={lbl} htmlFor="ob-periodicidad">Periodicidad</label>
            <select id="ob-periodicidad" className={sel} value={b.periodicidad} onChange={(e) => setB({ ...b, periodicidad: e.target.value as Periodicidad })}>
              {PERIODICIDADES.map((p) => <option key={p.valor} value={p.valor}>{p.etiqueta}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="ob-regla">La fecha depende de</label>
            <select id="ob-regla" className={sel} value={b.reglaDigitos} onChange={(e) => setB({ ...b, reglaDigitos: Number(e.target.value) as ReglaDigitos })}>
              {REGLAS_DIGITOS.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="ob-aviso">Avisar con (días)</label>
            <Input id="ob-aviso" inputMode="numeric" value={b.diasAviso} onChange={(e) => setB({ ...b, diasAviso: e.target.value.replace(/\D/g, "") })} />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={b.requierePago} onChange={(e) => setB({ ...b, requierePago: e.target.checked })} />
            Requiere pago (si no, se cumple al presentarla)
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={b.activa} onChange={(e) => setB({ ...b, activa: e.target.checked })} />
            Activa
          </label>
          <div className="md:col-span-3">
            <label className={lbl} htmlFor="ob-notas">Notas (opcional)</label>
            <Input id="ob-notas" value={b.notas} onChange={(e) => setB({ ...b, notas: e.target.value })} placeholder="ej. Se presenta por MUISCA; responsable: contador" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            <Plus size={15} className="mr-1 inline" aria-hidden /> {pending ? "Guardando…" : b.id ? "Guardar cambios" : "Agregar obligación"}
          </Button>
          {b.id && <Button variant="outline" onClick={() => setB(BORRADOR)} disabled={pending}><X size={15} className="mr-1 inline" aria-hidden /> Cancelar</Button>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>

      {obligaciones.length > 0 && (
        <ResponsiveTableShell minWidth={640} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Obligación</th><th className="px-3 py-2">Periodicidad</th><th className="px-3 py-2">Fecha según</th>
              <th className="px-3 py-2">Aviso</th><th className="px-3 py-2"><span className="sr-only">Acciones</span></th>
            </tr></thead>
            <tbody>
              {obligaciones.map((o) => (
                <tr key={o.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-800" data-label="Obligación">
                    {o.nombre}
                    {!o.activa && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase text-gray-500">Inactiva</span>}
                    {!o.requierePago && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase text-gray-500">Sin pago</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600" data-label="Periodicidad">{PERIODICIDADES.find((p) => p.valor === o.periodicidad)?.etiqueta}</td>
                  <td className="px-3 py-2 text-gray-600" data-label="Fecha según">{REGLAS_DIGITOS.find((r) => r.valor === o.reglaDigitos)?.etiqueta}</td>
                  <td className="px-3 py-2 text-gray-600" data-label="Aviso">{o.diasAviso} días</td>
                  <td className="px-1 py-1 text-right" data-label="Acciones">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => editar(o)} aria-label={`Editar ${o.nombre}`} title="Editar" className="grid h-10 w-10 place-items-center rounded-lg text-[var(--brand-accent)] hover:bg-gray-100"><Pencil size={16} aria-hidden /></button>
                      <button type="button" onClick={() => eliminar(o)} disabled={pending} aria-label={`Eliminar ${o.nombre}`} title="Eliminar" className="grid h-10 w-10 place-items-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"><Trash2 size={16} aria-hidden /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableShell>
      )}
    </div>
  );
}

// ── Fechas por año ─────────────────────────────────────────────────────────
function Fechas({ obligaciones, vencimientos, anio, nit }: { obligaciones: Obligacion[]; vencimientos: Vencimiento[]; anio: number; nit: string | null }) {
  const [obId, setObId] = useState<number | null>(obligaciones[0]?.id ?? null);
  const [anioSel, setAnioSel] = useState(anio);
  const ob = obligaciones.find((o) => o.id === obId) ?? null;
  const sel = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
  if (!obligaciones.length) {
    return <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">Primero crea una obligación en la pestaña Obligaciones.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={lbl} htmlFor="f-obligacion">Obligación</label>
          <select id="f-obligacion" className={sel} value={obId ?? ""} onChange={(e) => setObId(Number(e.target.value))}>
            {obligaciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl} htmlFor="f-anio">Año</label>
          <select id="f-anio" className={sel} value={anioSel} onChange={(e) => setAnioSel(Number(e.target.value))}>
            {[anio - 1, anio, anio + 1].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      {ob && (
        <GrillaFechas key={`${ob.id}-${anioSel}`} ob={ob} anio={anioSel} nit={nit}
          iniciales={vencimientos.filter((v) => v.obligacionId === ob.id && v.anio === anioSel)} />
      )}
    </div>
  );
}

function GrillaFechas({ ob, anio, nit, iniciales }: { ob: Obligacion; anio: number; nit: string | null; iniciales: Vencimiento[] }) {
  const router = useRouter();
  const clave = (p: number, d: string) => `${p}|${d}`;
  const original = useMemo(() => new Map(iniciales.map((v) => [clave(v.periodo, v.digitos), v.fecha])), [iniciales]);
  const [valores, setValores] = useState<Map<string, string>>(() => new Map(original));
  const [extra, setExtra] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const propio = digitosNit(nit, ob.reglaDigitos);
  const periodos = Array.from({ length: periodosPorAnio(ob.periodicidad) }, (_, i) => i + 1);

  const digitosDe = (p: number): string[] => {
    if (ob.reglaDigitos !== 2) return digitosDeRegla(ob.reglaDigitos);
    // Dos dígitos: 100 combinaciones; se listan solo las cargadas y las agregadas.
    return Array.from(new Set([...valores.keys()].filter((k) => k.startsWith(`${p}|`)).map((k) => k.split("|")[1]))).sort();
  };
  const cambios = [...new Set([...original.keys(), ...valores.keys()])]
    .filter((k) => (original.get(k) ?? "") !== (valores.get(k) ?? ""));

  function set(p: number, d: string, v: string) {
    setOk(false);
    setValores((m) => { const n = new Map(m); n.set(clave(p, d), v); return n; });
  }
  function guardar() {
    setError("");
    start(async () => {
      const filas = cambios.map((k) => { const [p, d] = k.split("|"); return { periodo: Number(p), digitos: d, fecha: valores.get(k) || null }; });
      const r = await guardarFechas(ob.id, anio, filas);
      if (!r.ok) { setError(r.error); return; }
      setOk(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {ob.reglaDigitos !== 0 && (
        <p className="text-xs text-gray-500">
          {propio ? <>El NIT de esta agencia termina en <b>{propio}</b>: esa columna es la que genera las alertas.</> : "Carga el NIT en Datos de la agencia para saber qué fecha aplica."}
        </p>
      )}
      {periodos.map((p) => (
        <fieldset key={p} className="rounded-xl border border-gray-200 bg-white p-3">
          <legend className="px-1 text-sm font-semibold text-gray-700">{etiquetaPeriodo(ob.periodicidad, p, anio)}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            {digitosDe(p).map((d) => (
              <div key={d} className={d === propio ? "rounded-lg ring-2 ring-[var(--brand-accent)] ring-offset-1" : ""}>
                <label className="mb-0.5 block text-[11px] text-gray-500" htmlFor={`f-${p}-${d}`}>
                  {d === "*" ? "Todos" : `Dígito${d.length === 2 ? "s" : ""} ${d}`}{d === propio ? " · su NIT" : ""}
                </label>
                <DateInput id={`f-${p}-${d}`} aria-label={`${etiquetaPeriodo(ob.periodicidad, p, anio)}, ${d === "*" ? "todos" : `dígito ${d}`}`}
                  type="date" value={valores.get(clave(p, d)) ?? ""} onValueChange={(v) => set(p, d, v)} />
              </div>
            ))}
          </div>
          {ob.reglaDigitos === 2 && (
            <div className="mt-2 flex items-end gap-2">
              <div className="w-28">
                <label className="mb-0.5 block text-[11px] text-gray-500" htmlFor={`f-${p}-nuevo`}>Dos dígitos</label>
                <Input id={`f-${p}-nuevo`} inputMode="numeric" maxLength={2} value={extra[p] ?? ""} onChange={(e) => setExtra({ ...extra, [p]: e.target.value.replace(/\D/g, "") })} placeholder="ej. 57" />
              </div>
              <Button variant="outline" disabled={(extra[p] ?? "").length !== 2} onClick={() => { set(p, extra[p]!, valores.get(clave(p, extra[p]!)) ?? ""); setExtra({ ...extra, [p]: "" }); }}>
                <Plus size={15} className="mr-1 inline" aria-hidden /> Agregar
              </Button>
            </div>
          )}
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={guardar} disabled={pending || cambios.length === 0} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : `Guardar fechas${cambios.length ? ` (${cambios.length})` : ""}`}
        </Button>
        {ok && !cambios.length && <span className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 size={15} aria-hidden /> Guardado</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
