"use client";

import { DateInput } from "@/components/ui/DateInput";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Download, Plus, Trash2 } from "lucide-react";
import { formatCOP } from "@/lib/utils";
import { fechaNegocio } from "@/lib/fechaNegocio";
import {
  asientosACsv, contratoDeReferencia, etiquetaOrigen, filtrarAsientos, rangoMes, resumenAsientos, totalesAsiento,
  type FiltroLibro,
} from "@/lib/contabilidad/libroDiario";
import { crearAsiento, eliminarAsiento, type Asiento } from "./actions";

type CuentaOpt = { id: number; codigo: string; nombre: string };
type Linea = { cuentaTexto: string; tercero: string; descripcion: string; debe: string; haber: string };
const LINEA_VACIA: Linea = { cuentaTexto: "", tercero: "", descripcion: "", debe: "", haber: "" };

const hoy = () => fechaNegocio();
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MESES[Number(m) - 1] ?? m} ${y}`;
};
const lbl = "mb-1 block text-[11px] font-medium text-gray-500";

export function LibroDiarioClient({ asientosIniciales, errorCarga, cuentas, desde, hasta, hoy: hoyNegocio }: {
  asientosIniciales: Asiento[]; errorCarga: string | null; cuentas: CuentaOpt[]; desde: string; hasta: string; hoy: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");
  const [rango, setRango] = useState({ desde, hasta });
  const [filtro, setFiltro] = useState<FiltroLibro>({});

  const cuentaPorLabel = useMemo(() => {
    const m = new Map<string, CuentaOpt>();
    for (const c of cuentas) m.set(`${c.codigo} · ${c.nombre}`, c);
    return m;
  }, [cuentas]);

  const visibles = useMemo(() => filtrarAsientos(asientosIniciales, filtro), [asientosIniciales, filtro]);
  const resumen = resumenAsientos(visibles);
  const origenes = useMemo(() => [...new Set(asientosIniciales.map((a) => a.origen))].sort(), [asientosIniciales]);
  const hayFiltro = !!(filtro.texto || filtro.cuenta || filtro.tercero || filtro.origen || filtro.soloDescuadrados);

  function irA(r: { desde: string; hasta: string }) {
    router.push(`?desde=${r.desde}&hasta=${r.hasta}`);
  }
  function exportar() {
    const url = URL.createObjectURL(new Blob([asientosACsv(visibles)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `libro-diario_${desde}_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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

      <section aria-label="Periodo y filtros" className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div><label className={lbl}>Desde</label><DateInput aria-label="Desde" type="date" value={rango.desde} onValueChange={(v) => setRango((r) => ({ ...r, desde: v }))} className="w-40" /></div>
          <div><label className={lbl}>Hasta</label><DateInput aria-label="Hasta" type="date" value={rango.hasta} onValueChange={(v) => setRango((r) => ({ ...r, hasta: v }))} className="w-40" /></div>
          <Button variant="outline" disabled={!rango.desde || !rango.hasta} onClick={() => irA(rango)}>Ver periodo</Button>
          <div className="flex flex-wrap gap-1">
            <Button variant="outline" onClick={() => irA(rangoMes(hoyNegocio))}>Este mes</Button>
            <Button variant="outline" onClick={() => irA(rangoMes(desde, -1))}>Mes anterior</Button>
            <Button variant="outline" onClick={() => irA({ desde: `${hoyNegocio.slice(0, 4)}-01-01`, hasta: hoyNegocio })}>Año a la fecha</Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div><label className={lbl} htmlFor="ld-texto">Buscar</label><Input id="ld-texto" value={filtro.texto ?? ""} onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} placeholder="N.º, descripción, referencia…" /></div>
          <div><label className={lbl} htmlFor="ld-cuenta">Cuenta</label><Input id="ld-cuenta" value={filtro.cuenta ?? ""} onChange={(e) => setFiltro({ ...filtro, cuenta: e.target.value })} placeholder="Código o nombre" /></div>
          <div><label className={lbl} htmlFor="ld-tercero">Tercero</label><Input id="ld-tercero" value={filtro.tercero ?? ""} onChange={(e) => setFiltro({ ...filtro, tercero: e.target.value })} placeholder="Cliente, proveedor, contrato…" /></div>
          <div>
            <label className={lbl} htmlFor="ld-origen">Origen</label>
            <select id="ld-origen" value={filtro.origen ?? ""} onChange={(e) => setFiltro({ ...filtro, origen: e.target.value || undefined })} className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm">
              <option value="">Todos</option>
              {origenes.map((o) => <option key={o} value={o}>{etiquetaOrigen(o)}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex min-h-10 items-center gap-2 text-gray-600">
            <input type="checkbox" checked={!!filtro.soloDescuadrados} onChange={(e) => setFiltro({ ...filtro, soloDescuadrados: e.target.checked })} />
            Solo descuadrados
          </label>
          {hayFiltro && <button type="button" onClick={() => setFiltro({})} className="min-h-10 text-xs font-medium text-[var(--brand-accent)] hover:underline">Quitar filtros</button>}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600" aria-live="polite">
        <span><b className="text-gray-800">{resumen.cantidad}</b> asiento{resumen.cantidad === 1 ? "" : "s"} · {fechaCorta(desde)} – {fechaCorta(hasta)}</span>
        <span>Débitos: <b className="tabular-nums text-gray-800">{formatCOP(resumen.debitos)}</b></span>
        <span>Créditos: <b className="tabular-nums text-gray-800">{formatCOP(resumen.creditos)}</b></span>
        {resumen.descuadrados > 0 && (
          <span className="inline-flex items-center gap-1 font-medium text-red-600"><AlertTriangle size={14} aria-hidden /> {resumen.descuadrados} descuadrado{resumen.descuadrados === 1 ? "" : "s"}</span>
        )}
        <Button variant="outline" className="ml-auto" disabled={!visibles.length} onClick={exportar}>
          <Download size={15} className="mr-1 inline" aria-hidden /> Exportar CSV
        </Button>
      </div>

      {errorCarga && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">No se pudo cargar el libro completo: {errorCarga}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="space-y-3">
        {visibles.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white px-3 py-8 text-center text-sm text-gray-400">
            {asientosIniciales.length === 0 ? "No hay asientos en este periodo." : "Ningún asiento coincide con los filtros."}
          </p>
        ) : visibles.map((a) => <FilaAsiento key={a.id} a={a} onError={setError} />)}
      </div>
    </div>
  );
}

function FilaAsiento({ a, onError }: { a: Asiento; onError: (e: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const t = totalesAsiento(a);
  const contrato = contratoDeReferencia(a.referencia);
  const manual = a.origen === "manual";

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white text-sm" aria-label={`Asiento ${a.numero}`}>
      <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">N.º {a.numero}</span>
            <span className="text-xs text-gray-500">{fechaCorta(a.fecha)}</span>
            <span className={manual ? "rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600" : "rounded-full bg-[var(--brand-accent)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--brand-primary)]"}>
              {etiquetaOrigen(a.origen)}
            </span>
            {!t.cuadra && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
                <AlertTriangle size={12} aria-hidden /> Descuadrado
              </span>
            )}
          </div>
          <p className="mt-1 break-words font-medium text-gray-800">{a.descripcion}</p>
          {a.referencia && (
            <p className="text-xs text-gray-500">
              Ref.: {contrato
                ? <Link href={`/dashboard/contratos/${encodeURIComponent(contrato)}`} prefetch={false} className="font-medium text-[var(--brand-accent)] hover:underline">{contrato}</Link>
                : <span className="break-all">{a.referencia}</span>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="text-right">
            <span className="block text-[10px] uppercase tracking-wide text-gray-400">Total</span>
            <b className="tabular-nums text-gray-800">{formatCOP(t.debe)}</b>
          </div>
          {manual && (
            <button
              type="button"
              disabled={pending}
              aria-label={`Eliminar asiento ${a.numero}`}
              title="Eliminar"
              onClick={() => {
                if (!confirm(`¿Eliminar el asiento N.º ${a.numero}?`)) return;
                start(async () => { const r = await eliminarAsiento(a.id); if (!r.ok) { onError(r.error); return; } router.refresh(); });
              }}
              className="grid h-10 w-10 place-items-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
            >
              <Trash2 size={16} aria-hidden />
            </button>
          )}
        </div>
      </header>
      <div role="table" aria-label={`Líneas del asiento ${a.numero}`} className="text-xs">
        <div role="row" className="grid grid-cols-[1fr_5.5rem_5.5rem] sm:grid-cols-[1fr_6.5rem_6.5rem] gap-2 bg-gray-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          <span role="columnheader">Cuenta</span><span role="columnheader" className="text-right">Débito</span><span role="columnheader" className="text-right">Crédito</span>
        </div>
        {a.lineas.map((l) => (
          <div role="row" key={l.id} className="grid grid-cols-[1fr_5.5rem_5.5rem] sm:grid-cols-[1fr_6.5rem_6.5rem] gap-2 border-t border-gray-50 px-3 py-1.5">
            <div role="cell" className="min-w-0">
              <span className="font-mono text-[11px] text-gray-500">{l.cuenta_codigo}</span>{" "}
              <span className="text-gray-800">{l.cuenta_nombre}</span>
              {(l.descripcion || l.tercero) && (
                <span className="block break-words text-[11px] text-gray-500">
                  {[l.descripcion, l.tercero && `Tercero: ${l.tercero}`].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            <span role="cell" className="text-right tabular-nums text-gray-800">{l.debe > 0 ? formatCOP(l.debe) : ""}</span>
            <span role="cell" className="text-right tabular-nums text-gray-800">{l.haber > 0 ? formatCOP(l.haber) : ""}</span>
          </div>
        ))}
        <div role="row" className="grid grid-cols-[1fr_5.5rem_5.5rem] sm:grid-cols-[1fr_6.5rem_6.5rem] gap-2 border-t border-gray-200 px-3 py-1.5 font-medium text-gray-700">
          <span role="cell">Total</span>
          <span role="cell" className="text-right tabular-nums">{formatCOP(t.debe)}</span>
          <span role="cell" className="text-right tabular-nums">{formatCOP(t.haber)}</span>
        </div>
      </div>
    </article>
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
        <div><label className="block text-[11px] text-gray-500">Fecha</label><DateInput aria-label="Fecha" type="date" value={fecha} onValueChange={(dateValue) => setFecha(dateValue)} className="w-40" /></div>
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
