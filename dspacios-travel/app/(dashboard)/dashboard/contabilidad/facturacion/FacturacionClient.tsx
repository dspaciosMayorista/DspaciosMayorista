"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMoneda } from "@/lib/utils";
import { liquidarFacturacion } from "@/lib/contabilidad/facturacion";
import { guardarFacturacion, quitarFacturacion, marcarDian } from "./actions";
import { useRouter } from "next/navigation";

export type FactRow = {
  numero_contrato: string;
  cliente: string | null;
  destino: string | null;
  mes: string;
  precio_venta: number;     // en COP (USD ya convertido a su TRM)
  moneda: string;           // siempre "COP" para facturar
  monedaOrig: string;       // moneda original del contrato (USD/COP)
  trm: number | null;       // TRM usada si el contrato era USD
  estado: string;
  irtProveedores: number;
  dianEmitida: boolean;
  cfg: { irt: number; ingresoExento: number; tipoExento: "exento" | "excluido" | null; observacion: string } | null;
};

type Filtro = "sin_configurar" | "configurados" | "todos";

export function FacturacionClient({ rows, ivaPct }: { rows: FactRow[]; ivaPct: number }) {
  const [vista, setVista] = useState<"config" | "dian">("config");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {([["config", "Configuración"], ["dian", "DIAN"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setVista(k)} className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
            style={vista === k ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "#6b7280" }}>
            {label}
          </button>
        ))}
      </div>
      {vista === "config" ? <Configuracion rows={rows} ivaPct={ivaPct} /> : <DianTab rows={rows} />}
    </div>
  );
}

function Configuracion({ rows, ivaPct }: { rows: FactRow[]; ivaPct: number }) {
  const [filtro, setFiltro] = useState<Filtro>("sin_configurar");
  const [q, setQ] = useState("");

  const visibles = useMemo(() => {
    return rows.filter((r) => {
      if (filtro === "sin_configurar" && r.cfg) return false;
      if (filtro === "configurados" && !r.cfg) return false;
      if (q.trim()) {
        const t = `${r.numero_contrato} ${r.cliente ?? ""} ${r.destino ?? ""}`.toLowerCase();
        if (!t.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, filtro, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {(["sin_configurar", "configurados", "todos"] as Filtro[]).map((f) => (
            <button key={f} onClick={() => setFiltro(f)}
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              style={filtro === f ? { backgroundColor: "white", color: "var(--brand-primary)", boxShadow: "0 1px 2px rgba(0,0,0,.06)" } : { color: "#6b7280" }}>
              {f === "sin_configurar" ? "Sin configurar" : f === "configurados" ? "Configurados" : "Todos"}
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contrato, cliente o destino…" className="w-72" />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Contrato</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 text-right">PVP</th>
              <th className="px-4 py-3 text-right">IRT</th>
              <th className="px-4 py-3 text-right">Ingreso propio</th>
              <th className="px-4 py-3 text-center">Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Sin contratos en este filtro.</td></tr>
            ) : (
              visibles.map((r) => <Fila key={r.numero_contrato} row={r} ivaPct={ivaPct} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DianTab({ rows }: { rows: FactRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const fil = (r: FactRow) => !q.trim() || `${r.numero_contrato} ${r.cliente ?? ""}`.toLowerCase().includes(q.toLowerCase());
  const sinFacturar = rows.filter((r) => !r.dianEmitida && fil(r));
  const facturados = rows.filter((r) => r.dianEmitida && fil(r));
  const toggle = (nc: string, emitida: boolean) => start(async () => { await marcarDian(nc, emitida); router.refresh(); });

  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contrato o cliente…" className="w-72" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Columna titulo={`Sin facturar a la DIAN (${sinFacturar.length})`} tono="#C0392B">
          {sinFacturar.length === 0 ? <ColVacia>Todo facturado.</ColVacia> : sinFacturar.map((r) => (
            <DianFila key={r.numero_contrato} row={r} marcado={false} disabled={pending} onToggle={() => toggle(r.numero_contrato, true)} />
          ))}
        </Columna>
        <Columna titulo={`Facturados / emitidos (${facturados.length})`} tono="var(--brand-success)">
          {facturados.length === 0 ? <ColVacia>Aún no marcas ninguno.</ColVacia> : facturados.map((r) => (
            <DianFila key={r.numero_contrato} row={r} marcado disabled={pending} onToggle={() => toggle(r.numero_contrato, false)} />
          ))}
        </Columna>
      </div>
    </div>
  );
}
function Columna({ titulo, tono, children }: { titulo: string; tono: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: tono }}>{titulo}</div>
      <div className="max-h-[32rem] space-y-1 overflow-y-auto p-2">{children}</div>
    </div>
  );
}
function ColVacia({ children }: { children: React.ReactNode }) { return <p className="px-3 py-6 text-center text-sm text-gray-400">{children}</p>; }
function DianFila({ row, marcado, disabled, onToggle }: { row: FactRow; marcado: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm hover:bg-gray-50">
      <input type="checkbox" checked={marcado} disabled={disabled} onChange={onToggle} className="h-4 w-4" />
      <span className="font-mono text-[#1D7C9A]">{row.numero_contrato}</span>
      <span className="flex-1 truncate text-gray-700">{row.cliente ?? "—"}</span>
      <span className="shrink-0 tabular-nums text-gray-500">{formatMoneda(row.precio_venta, row.moneda)}</span>
    </label>
  );
}

function Fila({ row, ivaPct }: { row: FactRow; ivaPct: number }) {
  const [abierto, setAbierto] = useState(false);
  const liq = row.cfg ? liquidarFacturacion({ pvp: row.precio_venta, irt: row.irtProveedores, ingresoExento: row.cfg.ingresoExento }, ivaPct) : null;
  const fmt = (n: number) => formatMoneda(n, row.moneda);

  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50">
        <td className="px-4 py-2.5">
          <button onClick={() => setAbierto((v) => !v)} className="mr-1 text-gray-400 hover:text-gray-700">{abierto ? "▾" : "▸"}</button>
          <Link href={`/dashboard/contratos/${encodeURIComponent(row.numero_contrato)}`} className="font-mono font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
            {row.numero_contrato}
          </Link>
        </td>
        <td className="px-4 py-2.5 text-gray-700">{row.cliente ?? "—"}</td>
        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.precio_venta)}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{liq ? fmt(liq.irt) : "—"}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{liq ? fmt(liq.ingresoPropio) : "—"}</td>
        <td className="px-4 py-2.5 text-center">
          {row.cfg ? (
            <span className="rounded-full bg-[#66B596]/15 px-2 py-0.5 text-xs font-medium text-[#3f7d63]">Configurado</span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Por defecto</span>
          )}
        </td>
      </tr>
      {abierto && (
        <tr className="border-b border-gray-100 bg-gray-50/60">
          <td colSpan={6} className="px-4 py-4">
            <Editor row={row} ivaPct={ivaPct} />
          </td>
        </tr>
      )}
    </>
  );
}

function Editor({ row, ivaPct }: { row: FactRow; ivaPct: number }) {
  const router = useRouter();
  // El IRT se toma AUTOMÁTICAMENTE de los proveedores marcados IRT del contrato.
  const irt = row.irtProveedores;
  const [exento, setExento] = useState(String(row.cfg?.ingresoExento ?? 0));
  const [tipoExento, setTipoExento] = useState<"exento" | "excluido">(row.cfg?.tipoExento ?? "exento");
  const [obs, setObs] = useState(row.cfg?.observacion ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const fmt = (n: number) => formatMoneda(n, row.moneda);

  const liq = liquidarFacturacion({ pvp: row.precio_venta, irt, ingresoExento: Number(exento) || 0 }, ivaPct);
  const excede = irt + (Number(exento) || 0) > row.precio_venta + 0.5;

  function guardar() {
    setError(null); setOk(false);
    start(async () => {
      const r = await guardarFacturacion({
        numeroContrato: row.numero_contrato,
        pvp: row.precio_venta,
        irt,
        ingresoExento: Number(exento) || 0,
        tipoExento,
        observacion: obs,
      });
      if (!r.ok) setError(r.error); else { setOk(true); router.refresh(); }
    });
  }
  function quitar() {
    start(async () => { await quitarFacturacion(row.numero_contrato); router.refresh(); });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Configuración</p>
        <div className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-sm">
          <span className="text-gray-500">PVP del contrato{row.monedaOrig === "USD" && row.trm ? <span className="ml-1 text-[11px] text-gray-400">(USD → COP a TRM {formatMoneda(row.trm, "COP")})</span> : null}</span>
          <b className="tabular-nums text-gray-800">{fmt(row.precio_venta)}</b>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">IRT (automático · de proveedores)</label>
            <div className="flex h-[38px] items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "var(--brand-accent)" }} />
              <b className="tabular-nums text-gray-700">{fmt(irt)}</b>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Ingreso exento / excluido</label>
            <Input type="number" min={0} value={exento} onChange={(e) => setExento(e.target.value)} />
          </div>
        </div>
        <p className="text-[11px] text-gray-400">
          El IRT es la suma de las CxP marcadas <b>IRT</b> del contrato (lo que cobran los terceros). Configúralas en
          <b> Finanzas → Proveedores</b>. El ingreso propio = PVP − IRT se calcula solo.
        </p>
        <div className="flex items-center gap-4 text-sm text-gray-700">
          <span className="text-xs text-gray-500">El ingreso exento/excluido es:</span>
          {(["exento", "excluido"] as const).map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name={`tipo-${row.numero_contrato}`} checked={tipoExento === t} onChange={() => setTipoExento(t)} />
              <span className="capitalize">{t}</span>
            </label>
          ))}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Observación</label>
          <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Nota tributaria (opcional)" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
          {ok && <span className="text-xs text-[#3d7a63]">Guardado ✓</span>}
          {row.cfg && (
            <button type="button" onClick={quitar} disabled={pending} className="text-xs font-medium text-red-500 hover:underline disabled:opacity-50">
              Quitar (volver al por defecto)
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Liquidación</p>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-gray-50"><td className="py-1.5 text-gray-500">IRT (no provisiona)</td><td className="py-1.5 text-right tabular-nums">{fmt(liq.irt)}</td></tr>
            <tr className="border-b border-gray-50"><td className="py-1.5 font-medium text-gray-700">Ingreso propio (PVP − IRT)</td><td className="py-1.5 text-right font-medium tabular-nums">{fmt(liq.ingresoPropio)}</td></tr>
            <tr className="border-b border-gray-50"><td className="py-1.5 pl-3 text-gray-500">› Base gravable (lleva IVA)</td><td className="py-1.5 text-right tabular-nums text-gray-600">{fmt(liq.baseGravable)}</td></tr>
            <tr className="border-b border-gray-50"><td className="py-1.5 pl-3 text-gray-500">› {tipoExento === "excluido" ? "Excluido" : "Exento"} (sin IVA)</td><td className="py-1.5 text-right tabular-nums text-gray-600">{fmt(liq.ingresoExento)}</td></tr>
            <tr className="border-b border-gray-50"><td className="py-1.5 pl-3 text-gray-500">› Base sin IVA</td><td className="py-1.5 text-right tabular-nums text-gray-500">{fmt(liq.baseNeta)}</td></tr>
            <tr className="font-semibold"><td className="py-1.5">IVA generado ({(ivaPct * 100).toFixed(0)}%)</td><td className="py-1.5 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(liq.ivaGenerado)}</td></tr>
          </tbody>
        </table>
        {excede && (
          <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">
            IRT + exento/excluido supera el PVP del contrato ({fmt(row.precio_venta)}).
          </p>
        )}
        <p className="text-[11px] text-gray-400">Las provisiones de rentabilidad se calculan sobre el ingreso propio.</p>
      </div>
    </div>
  );
}
