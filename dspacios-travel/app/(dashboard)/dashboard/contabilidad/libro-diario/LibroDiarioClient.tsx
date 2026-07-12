"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { formatCOP } from "@/lib/utils";
import { crearAsiento, eliminarAsiento, type Asiento } from "./actions";

type CuentaOpt = { id: number; codigo: string; nombre: string };
type Linea = { cuentaTexto: string; tercero: string; descripcion: string; debe: string; haber: string };
const LINEA_VACIA: Linea = { cuentaTexto: "", tercero: "", descripcion: "", debe: "", haber: "" };

const hoy = () => new Date().toISOString().slice(0, 10);

export function LibroDiarioClient({ asientosIniciales, cuentas }: { asientosIniciales: Asiento[]; cuentas: CuentaOpt[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");

  const cuentaPorLabel = useMemo(() => {
    const m = new Map<string, CuentaOpt>();
    for (const c of cuentas) m.set(`${c.codigo} · ${c.nombre}`, c);
    return m;
  }, [cuentas]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setAbierto((v) => !v)} style={{ backgroundColor: "var(--brand-primary)" }}>
          <Plus size={15} className="mr-1 inline" /> {abierto ? "Cancelar" : "Nuevo asiento"}
        </Button>
      </div>
      {abierto && (
        <NuevoAsientoForm
          cuentas={cuentas}
          cuentaPorLabel={cuentaPorLabel}
          onDone={() => { setAbierto(false); router.refresh(); }}
        />
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="space-y-2">
        {asientosIniciales.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white px-3 py-8 text-center text-sm text-gray-400">Aún no hay asientos.</p>
        ) : asientosIniciales.map((a) => <FilaAsiento key={a.id} a={a} onError={setError} />)}
      </div>
    </div>
  );
}

function FilaAsiento({ a, onError }: { a: Asiento; onError: (e: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const totalDebe = a.lineas.reduce((s, l) => s + l.debe, 0);
  const totalHaber = a.lineas.reduce((s, l) => s + l.haber, 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-gray-700">
          #{a.numero} · {a.fecha} · {a.descripcion}
          {a.origen !== "manual" && (
            <span className="ml-2 rounded-full bg-[var(--brand-accent)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--brand-primary)]">
              Automático · {a.origen}
            </span>
          )}
          {a.referencia && <span className="ml-2 text-xs text-gray-400">Ref: {a.referencia}</span>}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm(`¿Eliminar el asiento #${a.numero}?`)) return;
            start(async () => { const r = await eliminarAsiento(a.id); if (!r.ok) { onError(r.error); return; } router.refresh(); });
          }}
          className="inline-flex items-center gap-1 text-xs text-red-500 hover:underline disabled:opacity-50"
        >
          <Undo2 size={13} /> Eliminar
        </button>
      </div>
      <div className="mt-2 overflow-hidden rounded-lg border border-gray-100">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-gray-400">
            <tr><th className="px-2 py-1">Cuenta</th><th className="px-2 py-1">Tercero</th><th className="px-2 py-1 text-right">Débito</th><th className="px-2 py-1 text-right">Crédito</th></tr>
          </thead>
          <tbody>
            {a.lineas.map((l) => (
              <tr key={l.id} className="border-t border-gray-50">
                <td className="px-2 py-1 text-gray-700">{l.cuenta_codigo} · {l.cuenta_nombre}{l.descripcion ? ` — ${l.descripcion}` : ""}</td>
                <td className="px-2 py-1 text-gray-500">{l.tercero ?? "—"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.debe > 0 ? formatCOP(l.debe) : ""}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.haber > 0 ? formatCOP(l.haber) : ""}</td>
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-medium text-gray-700">
              <td className="px-2 py-1" colSpan={2}>Total</td>
              <td className="px-2 py-1 text-right tabular-nums">{formatCOP(totalDebe)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{formatCOP(totalHaber)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NuevoAsientoForm({
  cuentas, cuentaPorLabel, onDone,
}: { cuentas: CuentaOpt[]; cuentaPorLabel: Map<string, CuentaOpt>; onDone: () => void }) {
  const [fecha, setFecha] = useState(hoy());
  const [descripcion, setDescripcion] = useState("");
  const [referencia, setReferencia] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([{ ...LINEA_VACIA }, { ...LINEA_VACIA }]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function setLinea(i: number, patch: Partial<Linea>) {
    setLineas((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  }
  function agregarLinea() { setLineas((ls) => [...ls, { ...LINEA_VACIA }]); }
  function quitarLinea(i: number) { setLineas((ls) => (ls.length > 2 ? ls.filter((_, n) => n !== i) : ls)); }

  const totalDebe = lineas.reduce((s, l) => s + (Number(l.debe) || 0), 0);
  const totalHaber = lineas.reduce((s, l) => s + (Number(l.haber) || 0), 0);
  const cuadra = totalDebe > 0 && Math.abs(totalDebe - totalHaber) <= 1;

  function guardar() {
    setError("");
    const resueltas = lineas.map((l) => ({ l, cuenta: cuentaPorLabel.get(l.cuentaTexto.trim()) }));
    const faltante = resueltas.find((r) => (Number(r.l.debe) || 0) + (Number(r.l.haber) || 0) > 0 && !r.cuenta);
    if (faltante) { setError(`Elige una cuenta válida de la lista para: "${faltante.l.cuentaTexto}".`); return; }
    const activas = resueltas.filter((r) => r.cuenta);
    if (activas.length < 2) { setError("Completa al menos 2 líneas con cuenta y valor."); return; }
    start(async () => {
      const r = await crearAsiento({
        fecha, descripcion, referencia,
        lineas: activas.map(({ l, cuenta }) => ({
          cuentaId: cuenta!.id, tercero: l.tercero, descripcion: l.descripcion,
          debe: Number(l.debe) || 0, haber: Number(l.haber) || 0,
        })),
      });
      if (!r.ok) { setError(r.error); return; }
      onDone();
    });
  }

  return (
    <div className="rounded-xl border-2 bg-white p-3" style={{ borderColor: "var(--brand-accent)" }}>
      <datalist id="cuentas-libro-diario">
        {cuentas.map((c) => <option key={c.id} value={`${c.codigo} · ${c.nombre}`} />)}
      </datalist>
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="block text-[11px] text-gray-500">Fecha</label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-40" /></div>
        <div className="flex-1 min-w-[220px]"><label className="block text-[11px] text-gray-500">Descripción del asiento</label><Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="ej. Depósito parcial de abono en efectivo" /></div>
        <div><label className="block text-[11px] text-gray-500">Referencia (opcional)</label><Input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="N° contrato, etc." className="w-40" /></div>
      </div>

      <div className="mt-3 space-y-2">
        {lineas.map((l, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <label className="block text-[11px] text-gray-500">Cuenta</label>
              <Input list="cuentas-libro-diario" value={l.cuentaTexto} onChange={(e) => setLinea(i, { cuentaTexto: e.target.value })} placeholder="Busca por código o nombre…" />
            </div>
            <div className="w-36"><label className="block text-[11px] text-gray-500">Tercero</label><Input value={l.tercero} onChange={(e) => setLinea(i, { tercero: e.target.value })} placeholder="Opcional" /></div>
            <div className="w-40"><label className="block text-[11px] text-gray-500">Detalle</label><Input value={l.descripcion} onChange={(e) => setLinea(i, { descripcion: e.target.value })} placeholder="Opcional" /></div>
            <div className="w-32"><label className="block text-[11px] text-gray-500">Débito</label><Input value={l.debe} onChange={(e) => setLinea(i, { debe: e.target.value, haber: e.target.value ? "" : l.haber })} inputMode="numeric" placeholder="0" /></div>
            <div className="w-32"><label className="block text-[11px] text-gray-500">Crédito</label><Input value={l.haber} onChange={(e) => setLinea(i, { haber: e.target.value, debe: e.target.value ? "" : l.debe })} inputMode="numeric" placeholder="0" /></div>
            {lineas.length > 2 && (
              <button type="button" onClick={() => quitarLinea(i)} className="mb-2 text-gray-300 hover:text-red-500" title="Quitar línea"><Trash2 size={14} /></button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={agregarLinea} className="mt-2 text-xs font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>+ Agregar línea</button>

      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3 text-sm">
        <span>Débito: <b className="tabular-nums">{formatCOP(totalDebe)}</b></span>
        <span>Crédito: <b className="tabular-nums">{formatCOP(totalHaber)}</b></span>
        <span className={cuadra ? "text-[#3d7a63]" : "text-amber-600"}>Diferencia: <b className="tabular-nums">{formatCOP(totalDebe - totalHaber)}</b></span>
        <Button onClick={guardar} disabled={pending || !cuadra || !descripcion.trim()} className="ml-auto" style={{ backgroundColor: cuadra ? "var(--brand-primary)" : "#9ca3af" }}>
          {pending ? "Guardando…" : "Registrar asiento"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
