"use client";
// Paquete 100 % dinámico (#82) en la ficha de la cotización: valores por componente (editables con
// motivo → versión nueva), costos reales (obligatorios en solo PVP antes de convertir) y versiones
// mostradas al cliente. Sustituye a los editores de la cotización manual, que recalculan el valor
// desde el costo y no sirven para líneas solo-PVP.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, History, Pencil, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { editarCotizacionDin, marcarVersionMostrada, registrarCostosCotizacionDin } from "../din-actions";

export type ComponenteFicha = { orden: number; nombre: string; valor: number; costo: number; proveedor: string; exigeCosto: boolean };
export type VersionFicha = { version: number; motivo: string; precio: number; creadaEn: string; mostradaEn: string | null };

const fecha = (iso: string) => new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });

export function PanelDinamico({ id, moneda, revEsperada, puedeEditar, puedeCostos, componentes, versiones }: {
  id: number; moneda: string; revEsperada: number; puedeEditar: boolean; puedeCostos: boolean;
  componentes: ComponenteFicha[]; versiones: VersionFicha[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [valores, setValores] = useState(() => Object.fromEntries(componentes.map((c) => [c.orden, String(c.valor)])));
  const [costos, setCostos] = useState(() => Object.fromEntries(componentes.map((c) => [c.orden, { costo: c.costo ? String(c.costo) : "", proveedor: c.proveedor }])));
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const fmt = (n: number) => formatMoneda(n, moneda);
  const num = (s: string) => Number(String(s).replace(/[^\d.-]/g, "")) || 0;

  const total = componentes.reduce((s, c) => s + num(valores[c.orden] ?? "0"), 0);
  const totalGuardado = componentes.reduce((s, c) => s + c.valor, 0);
  const pendientes = componentes.filter((c) => c.exigeCosto && !(c.costo > 0 && c.proveedor.trim()));
  const mostrada = versiones.filter((v) => v.mostradaEn).sort((a, b) => b.version - a.version)[0];
  const actual = versiones[0]?.version;

  const guardarValores = () => start(async () => {
    setMsg(null);
    const r = await editarCotizacionDin(id, {
      revEsperada, motivo,
      componentes: componentes.map((c) => ({ orden: c.orden, valor: num(valores[c.orden] ?? "0") })),
    });
    if (!r.ok) return setMsg({ ok: false, t: r.error });
    setMotivo("");
    setMsg({ ok: true, t: `Guardado como versión ${r.version}.` });
    router.refresh();
  });

  const guardarCostos = () => start(async () => {
    setMsg(null);
    const filas = componentes.filter((c) => (costos[c.orden]?.costo ?? "") !== "").map((c) => ({ orden: c.orden, costoNeto: num(costos[c.orden].costo), proveedor: costos[c.orden].proveedor }));
    if (!filas.length) return setMsg({ ok: false, t: "Escribe al menos un costo." });
    const r = await registrarCostosCotizacionDin(id, filas);
    if (!r.ok) return setMsg({ ok: false, t: r.error });
    setMsg({ ok: true, t: r.pendientes.length ? `Faltan costos de: ${r.pendientes.join(", ")}.` : "Costos completos: ya se puede convertir en contrato." });
    router.refresh();
  });

  const marcar = (v: number) => start(async () => {
    const r = await marcarVersionMostrada(id, v);
    setMsg(r.ok ? { ok: true, t: `Versión ${v} marcada como mostrada al cliente.` } : { ok: false, t: r.error });
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800"><Pencil className="h-4 w-4" /> Valores por componente (lo que paga el cliente)</h3>
        <div className="space-y-2">
          {componentes.map((c) => (
            <div key={c.orden} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{c.nombre}</span>
              <Input aria-label={`Valor de ${c.nombre}`} className="w-40 text-right" inputMode="numeric" disabled={!puedeEditar || pending}
                value={valores[c.orden] ?? ""} onChange={(e) => setValores({ ...valores, [c.orden]: e.target.value })} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-sm text-gray-600">Total: <b>{fmt(total)}</b>{total !== totalGuardado && <span className="text-amber-700"> (guardado: {fmt(totalGuardado)})</span>}</p>
        {puedeEditar ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input aria-label="Motivo del cambio" placeholder="Motivo del cambio (obligatorio)" className="min-w-[14rem] flex-1" value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={pending} />
            <Button onClick={guardarValores} disabled={pending || total === totalGuardado || !motivo.trim()} style={{ backgroundColor: "var(--brand-primary)" }}>Guardar nueva versión</Button>
          </div>
        ) : <p className="mt-2 text-xs text-gray-500">Esta cotización ya no admite cambios de valor (vencida, con pagos o sin autorización).</p>}
        {mostrada && actual && mostrada.version !== actual && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            El cliente vio la versión {mostrada.version} por {fmt(mostrada.precio)}; la vigente es la {actual}.
          </p>
        )}
      </section>

      {puedeCostos && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-800"><Wallet className="h-4 w-4" /> Costos reales y proveedor</h3>
          <p className="mb-2 text-xs text-gray-500">
            {pendientes.length
              ? `Faltan ${pendientes.length} componente(s): no se puede convertir en contrato hasta registrar su costo real y proveedor.`
              : "No hay costos pendientes."}
          </p>
          <div className="space-y-2">
            {componentes.map((c) => (
              <div key={c.orden} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{c.nombre}{c.exigeCosto && !(c.costo > 0 && c.proveedor.trim()) && <span className="ml-1 text-xs text-amber-700">(pendiente)</span>}</span>
                <Input aria-label={`Costo de ${c.nombre}`} className="w-32 text-right" inputMode="numeric" placeholder="Costo" disabled={pending}
                  value={costos[c.orden]?.costo ?? ""} onChange={(e) => setCostos({ ...costos, [c.orden]: { ...costos[c.orden], costo: e.target.value } })} />
                <Input aria-label={`Proveedor de ${c.nombre}`} className="w-44" placeholder="Proveedor" disabled={pending}
                  value={costos[c.orden]?.proveedor ?? ""} onChange={(e) => setCostos({ ...costos, [c.orden]: { ...costos[c.orden], proveedor: e.target.value } })} />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">Los costos van en {moneda}, la misma moneda de la cotización. Nunca se calculan a partir del precio de venta.</p>
          <Button className="mt-3" onClick={guardarCostos} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>Guardar costos</Button>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800"><History className="h-4 w-4" /> Versiones</h3>
        <ul className="divide-y divide-gray-100 text-sm">
          {versiones.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><b>v{v.version}</b> · {fmt(v.precio)} · {v.motivo} <span className="text-xs text-gray-400">({fecha(v.creadaEn)})</span></span>
              {v.mostradaEn
                ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><Check className="h-3.5 w-3.5" /> Mostrada {fecha(v.mostradaEn)}</span>
                : <Button variant="outline" size="sm" disabled={pending} onClick={() => marcar(v.version)}>Marcar como mostrada al cliente</Button>}
            </li>
          ))}
        </ul>
      </section>

      {msg && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.t}</p>}
    </div>
  );
}
