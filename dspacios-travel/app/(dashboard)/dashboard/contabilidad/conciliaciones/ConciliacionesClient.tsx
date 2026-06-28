"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Link2, Undo2 } from "lucide-react";
import { formatCOP } from "@/lib/utils";
import { importarExtracto, cruzar, deshacerCruce, eliminarLineaExtracto } from "./actions";

export type ExtractoItem = { id: number; fecha: string; descripcion: string; valor: number; periodo: string };
export type SistemaItem = { ref: string; tipo: string; descripcion: string; fecha: string | null; valor: number };
export type Cruce = { id: number; total: number; nota: string; fecha: string; extracto: ExtractoItem[]; sistema: SistemaItem[] };

const abs = (n: number) => Math.abs(n);

export function ConciliacionesClient({ extracto, sistema, cruces }: { extracto: ExtractoItem[]; sistema: SistemaItem[]; cruces: Cruce[] }) {
  const router = useRouter();
  const [selExt, setSelExt] = useState<Set<number>>(new Set());
  const [selSis, setSelSis] = useState<Set<string>>(new Set());
  const [mes, setMes] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [verConciliados, setVerConciliados] = useState(false);

  const meses = useMemo(() => Array.from(new Set(extracto.map((e) => e.periodo))).sort().reverse(), [extracto]);

  const enRango = (fecha: string | null) => {
    if (!fecha) return !mes && !desde && !hasta;
    if (mes && fecha.slice(0, 7) !== mes) return false;
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    return true;
  };
  const extVis = useMemo(() => extracto.filter((e) => enRango(e.fecha)), [extracto, mes, desde, hasta]);
  const sisVis = useMemo(() => sistema.filter((s) => enRango(s.fecha)), [sistema, mes, desde, hasta]);

  const totExt = extracto.filter((e) => selExt.has(e.id)).reduce((a, e) => a + abs(e.valor), 0);
  const totSis = sistema.filter((s) => selSis.has(s.ref)).reduce((a, s) => a + abs(s.valor), 0);
  const cuadra = selExt.size > 0 && selSis.size > 0 && abs(totExt - totSis) <= 1;
  const dif = totExt - totSis;

  function toggleExt(id: number) { setSelExt((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleSis(ref: string) { setSelSis((p) => { const n = new Set(p); n.has(ref) ? n.delete(ref) : n.add(ref); return n; }); }

  function hacerCruce() {
    setError(null);
    const items = sistema.filter((s) => selSis.has(s.ref)).map((s) => ({ ref: s.ref, descripcion: `${s.tipo}: ${s.descripcion}`, fecha: s.fecha, valor: s.valor }));
    start(async () => {
      const r = await cruzar({ extractoIds: [...selExt], sistema: items, nota });
      if (!r.ok) { setError(r.error); return; }
      setSelExt(new Set()); setSelSis(new Set()); setNota(""); router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <Importador />

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Mes</label>
          <select value={mes} onChange={(e) => setMes(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
            <option value="">Todos</option>
            {meses.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div><label className="mb-1 block text-xs font-medium text-gray-600">Desde</label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" /></div>
        <div><label className="mb-1 block text-xs font-medium text-gray-600">Hasta</label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" /></div>
        {(mes || desde || hasta) && <button onClick={() => { setMes(""); setDesde(""); setHasta(""); }} className="pb-1.5 text-xs text-gray-500 hover:underline">Limpiar</button>}
      </div>

      {/* Barra de cruce */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 bg-white p-3 shadow-sm" style={{ borderColor: cuadra ? "var(--brand-success)" : "#e5e7eb" }}>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span>Extracto: <b className="tabular-nums">{formatCOP(totExt)}</b> ({selExt.size})</span>
          <span>Sistema: <b className="tabular-nums">{formatCOP(totSis)}</b> ({selSis.size})</span>
          <span className={abs(dif) <= 1 ? "text-[#3d7a63]" : "text-amber-600"}>Diferencia: <b className="tabular-nums">{formatCOP(dif)}</b></span>
        </div>
        <div className="flex items-center gap-2">
          <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional)" className="w-48" />
          <Button onClick={hacerCruce} disabled={!cuadra || pending} style={{ backgroundColor: cuadra ? "var(--brand-primary)" : "#9ca3af" }}>
            <Link2 size={15} className="mr-1 inline" /> {pending ? "Cruzando…" : "Cruzar"}
          </Button>
        </div>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {!cuadra && selExt.size + selSis.size > 0 && (
        <p className="text-xs text-amber-600">Las sumas deben coincidir para cruzar. Puedes seleccionar varios de un lado (ej. una línea de 1.000 contra 700 + 300).</p>
      )}

      {/* Dos columnas */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Columna titulo={`Extracto del banco (${extVis.length})`}>
          {extVis.length === 0 ? <Vacio>Sin líneas. Importa el extracto arriba.</Vacio> : extVis.map((e) => (
            <ItemFila key={e.id} sel={selExt.has(e.id)} onClick={() => toggleExt(e.id)} fecha={e.fecha} desc={e.descripcion} valor={e.valor}
              onDel={() => start(async () => { await eliminarLineaExtracto(e.id); router.refresh(); })} />
          ))}
        </Columna>
        <Columna titulo={`Movimientos del sistema (${sisVis.length})`}>
          {sisVis.length === 0 ? <Vacio>Sin movimientos sin conciliar en este rango.</Vacio> : sisVis.map((s) => (
            <ItemFila key={s.ref} sel={selSis.has(s.ref)} onClick={() => toggleSis(s.ref)} fecha={s.fecha} desc={`${s.tipo} · ${s.descripcion}`} valor={s.valor} />
          ))}
        </Columna>
      </div>

      {/* Conciliados */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <button onClick={() => setVerConciliados((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700">
          <span>Conciliados ({cruces.length})</span>
          <span className="text-gray-400">{verConciliados ? "▾" : "▸"}</span>
        </button>
        {verConciliados && (
          <div className="space-y-2 border-t border-gray-100 p-4">
            {cruces.length === 0 ? <Vacio>Aún no hay cruces.</Vacio> : cruces.map((c) => (
              <div key={c.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-700">{c.fecha} · {formatCOP(c.total)} {c.nota && <span className="text-gray-400">· {c.nota}</span>}</span>
                  <button onClick={() => start(async () => { await deshacerCruce(c.id); router.refresh(); })} className="inline-flex items-center gap-1 text-xs text-red-500 hover:underline">
                    <Undo2 size={13} /> Deshacer
                  </button>
                </div>
                <div className="mt-1 grid grid-cols-1 gap-1 text-xs text-gray-500 sm:grid-cols-2">
                  <div>{c.extracto.map((e) => <div key={e.id}>↤ {e.fecha} {e.descripcion} · {formatCOP(e.valor)}</div>)}</div>
                  <div>{c.sistema.map((s, i) => <div key={i}>↦ {s.descripcion} · {formatCOP(s.valor)}</div>)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Importador() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [cuenta, setCuenta] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function importar() {
    setMsg(null);
    start(async () => {
      const r = await importarExtracto(texto, Number(anio) || undefined, cuenta);
      if (!r.ok) setMsg(r.error);
      else { setMsg(`Importadas ${r.n} líneas.`); setTexto(""); router.refresh(); }
    });
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <button onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>
        <span>Importar extracto (pegar del Excel)</span><span className="text-gray-400">{abierto ? "▾" : "▸"}</span>
      </button>
      {abierto && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-gray-500">Copia las filas de movimientos del Excel del banco (fecha, descripción, valor, saldo) y pégalas aquí.</p>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} placeholder={"2/03\tCONSIGNACION CORRESPONSAL CB\t\t2,300,000.00\t12,136,942.85"}
            className="w-full rounded-lg border border-gray-300 p-2 font-mono text-xs" />
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="mb-1 block text-xs font-medium text-gray-600">Año</label><Input type="number" value={anio} onChange={(e) => setAnio(e.target.value)} className="w-24" /></div>
            <div><label className="mb-1 block text-xs font-medium text-gray-600">Cuenta (opcional)</label><Input value={cuenta} onChange={(e) => setCuenta(e.target.value)} placeholder="Bancolombia 277…" className="w-48" /></div>
            <Button onClick={importar} disabled={pending || !texto.trim()} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Importando…" : "Importar"}</Button>
            {msg && <span className="text-sm text-gray-600">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Columna({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{titulo}</div>
      <div className="max-h-[28rem] space-y-1 overflow-y-auto p-2">{children}</div>
    </div>
  );
}
function ItemFila({ sel, onClick, fecha, desc, valor, onDel }: { sel: boolean; onClick: () => void; fecha: string | null; desc: string; valor: number; onDel?: () => void }) {
  return (
    <div onClick={onClick} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
      style={sel ? { borderColor: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.06)" } : { borderColor: "transparent" }}>
      <input type="checkbox" checked={sel} readOnly className="pointer-events-none" />
      <span className="w-14 shrink-0 text-xs text-gray-400">{fecha?.slice(5) ?? "—"}</span>
      <span className="flex-1 truncate text-gray-700" title={desc}>{desc}</span>
      <span className="shrink-0 tabular-nums font-medium" style={{ color: valor < 0 ? "#C0392B" : "var(--brand-success)" }}>{formatCOP(valor)}</span>
      {onDel && <button onClick={(e) => { e.stopPropagation(); onDel(); }} className="text-gray-300 hover:text-red-500" title="Eliminar línea"><Trash2 size={13} /></button>}
    </div>
  );
}
function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-6 text-center text-sm text-gray-400">{children}</p>;
}
