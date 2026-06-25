"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatCOP } from "@/lib/utils";
import { guardarMovimiento, eliminarMovimiento } from "./actions";

export type MovRow = {
  id: number; fecha: string; tipo: "ingreso" | "egreso"; concepto: string;
  tercero: string; categoria: string; medioPago: string; valor: number;
  comprobante: string; observacion: string;
};
type Filtro = "todos" | "ingreso" | "egreso";

export function MovimientosClient({ rows }: { rows: MovRow[] }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [mes, setMes] = useState("");
  const [q, setQ] = useState("");
  const [editor, setEditor] = useState<MovRow | "nuevo" | null>(null);

  const meses = useMemo(() => Array.from(new Set(rows.map((r) => r.fecha.slice(0, 7)))).sort().reverse(), [rows]);
  const visibles = useMemo(() => rows.filter((r) => {
    if (filtro !== "todos" && r.tipo !== filtro) return false;
    if (mes && r.fecha.slice(0, 7) !== mes) return false;
    if (q.trim()) {
      const t = `${r.concepto} ${r.tercero} ${r.categoria}`.toLowerCase();
      if (!t.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [rows, filtro, mes, q]);

  const ingresos = visibles.filter((r) => r.tipo === "ingreso").reduce((a, r) => a + r.valor, 0);
  const egresos = visibles.filter((r) => r.tipo === "egreso").reduce((a, r) => a + r.valor, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Tarjeta titulo="Ingresos" valor={ingresos} color="var(--brand-success)" />
        <Tarjeta titulo="Egresos" valor={egresos} color="#C0392B" />
        <Tarjeta titulo="Neto" valor={ingresos - egresos} color="var(--brand-primary)" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {(["todos", "ingreso", "egreso"] as Filtro[]).map((f) => (
            <button key={f} onClick={() => setFiltro(f)} className="rounded-md px-3 py-1.5 text-sm font-medium capitalize"
              style={filtro === f ? { backgroundColor: "white", color: "var(--brand-primary)", boxShadow: "0 1px 2px rgba(0,0,0,.06)" } : { color: "#6b7280" }}>
              {f === "todos" ? "Todos" : f === "ingreso" ? "Ingresos" : "Egresos"}
            </button>
          ))}
        </div>
        <select value={mes} onChange={(e) => setMes(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">Todos los meses</option>
          {meses.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar concepto, tercero o categoría…" className="w-64" />
        <Button onClick={() => setEditor("nuevo")} style={{ backgroundColor: "var(--brand-primary)" }} className="ml-auto">+ Agregar</Button>
      </div>

      {editor && <Editor row={editor === "nuevo" ? null : editor} onClose={() => setEditor(null)} />}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Concepto</th>
              <th className="px-3 py-2">Tercero</th><th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Medio</th><th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2 text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Sin movimientos en este filtro.</td></tr>
            ) : visibles.map((r) => <Fila key={r.id} r={r} onEdit={() => setEditor(r)} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Fila({ r, onEdit }: { r: MovRow; onEdit: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const esIng = r.tipo === "ingreso";
  return (
    <tr className="border-b border-gray-50">
      <td className="px-3 py-2.5 text-gray-500">{r.fecha}</td>
      <td className="px-3 py-2.5 font-medium text-gray-800">
        <span className="mr-1 inline-flex align-middle" style={{ color: esIng ? "var(--brand-success)" : "#C0392B" }}>
          {esIng ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
        </span>
        {r.concepto}
      </td>
      <td className="px-3 py-2.5 text-gray-500">{r.tercero || "—"}</td>
      <td className="px-3 py-2.5 text-gray-500">{r.categoria || "—"}</td>
      <td className="px-3 py-2.5 text-gray-500">{r.medioPago || "—"}</td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: esIng ? "var(--brand-success)" : "#C0392B" }}>
        {esIng ? "+" : "−"} {formatCOP(r.valor)}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-center gap-2">
          <button onClick={onEdit} className="text-gray-400 hover:text-gray-700" title="Editar"><Pencil size={15} /></button>
          <button disabled={pending} onClick={() => start(async () => { await eliminarMovimiento(r.id); router.refresh(); })} className="text-gray-400 hover:text-red-500" title="Eliminar"><Trash2 size={15} /></button>
        </div>
      </td>
    </tr>
  );
}

function Editor({ row, onClose }: { row: MovRow | null; onClose: () => void }) {
  const router = useRouter();
  const [fecha, setFecha] = useState(row?.fecha ?? new Date().toISOString().slice(0, 10));
  const [tipo, setTipo] = useState<"ingreso" | "egreso">(row?.tipo ?? "egreso");
  const [concepto, setConcepto] = useState(row?.concepto ?? "");
  const [tercero, setTercero] = useState(row?.tercero ?? "");
  const [categoria, setCategoria] = useState(row?.categoria ?? "");
  const [medioPago, setMedioPago] = useState(row?.medioPago ?? "");
  const [valor, setValor] = useState(String(row?.valor ?? ""));
  const [comprobante, setComprobante] = useState(row?.comprobante ?? "");
  const [observacion, setObservacion] = useState(row?.observacion ?? "");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function guardar() {
    setErr("");
    start(async () => {
      const r = await guardarMovimiento({ id: row?.id, fecha, tipo, concepto, tercero, categoria, medioPago, valor: Number(valor) || 0, comprobante, observacion });
      if (r.ok) { onClose(); router.refresh(); } else setErr(r.error);
    });
  }
  const lbl = "mb-1 block text-xs font-medium text-gray-600";
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><label className={lbl}>Fecha</label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div>
          <label className={lbl}>Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "ingreso" | "egreso")} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="egreso">Egreso (compra / pago)</option><option value="ingreso">Ingreso</option>
          </select>
        </div>
        <div className="col-span-2"><label className={lbl}>Concepto</label><Input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Arriendo, papelería, reintegro…" /></div>
        <div><label className={lbl}>Tercero</label><Input value={tercero} onChange={(e) => setTercero(e.target.value)} placeholder="Proveedor / beneficiario" /></div>
        <div><label className={lbl}>Categoría</label><Input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Servicios, oficina…" /></div>
        <div><label className={lbl}>Medio de pago</label><Input value={medioPago} onChange={(e) => setMedioPago(e.target.value)} placeholder="Transferencia, efectivo…" /></div>
        <div><label className={lbl}>Valor</label><Input type="number" min={0} value={valor} onChange={(e) => setValor(e.target.value)} className="text-right" /></div>
        <div><label className={lbl}>Comprobante</label><Input value={comprobante} onChange={(e) => setComprobante(e.target.value)} placeholder="N° / referencia" /></div>
        <div className="col-span-2 md:col-span-3"><label className={lbl}>Observación</label><Input value={observacion} onChange={(e) => setObservacion(e.target.value)} /></div>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</Button>
        <button onClick={onClose} className="text-sm text-gray-500 hover:underline">Cancelar</button>
      </div>
    </div>
  );
}

function Tarjeta({ titulo, valor, color }: { titulo: string; valor: number; color: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{titulo}</div>
      <div className="mt-1 text-xl font-bold tabular-nums" style={{ color }}>{formatCOP(valor)}</div>
    </div>
  );
}
