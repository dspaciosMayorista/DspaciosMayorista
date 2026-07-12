"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Trash2, Link2, Undo2, Sparkles } from "lucide-react";
import { formatCOP } from "@/lib/utils";
import { importarExtracto, cruzar, deshacerCruce, eliminarLineaExtracto, eliminarLineasExtracto } from "./actions";

export type ExtractoItem = { id: number; fecha: string; descripcion: string; valor: number; periodo: string };
export type SistemaItem = { ref: string; tipo: string; descripcion: string; fecha: string | null; valor: number; numeroContrato: string | null; categoria: "cartera" | "proveedor" };
export type Cruce = { id: number; total: number; nota: string; fecha: string; extracto: ExtractoItem[]; sistema: SistemaItem[] };

const abs = (n: number) => Math.abs(n);
const TOL = 1;

// El orden siempre compara la fecha ISO completa (YYYY-MM-DD), así que ya
// tiene en cuenta el año — pero mostrar solo "MM-DD" (sin año) hacía parecer
// que el orden estaba mal cuando en realidad cruzaba de un año a otro
// (datos históricos de varios años). Se muestra completa como DD/MM/AA.
function fechaCorta(fecha: string | null): string {
  if (!fecha) return "—";
  const [y, m, d] = fecha.split("-");
  if (!y || !m || !d) return fecha;
  return `${d}/${m}/${y.slice(2)}`;
}

type Orden = { campo: "fecha" | "valor"; dir: "asc" | "desc" };
const ORDEN_DEFAULT: Orden = { campo: "fecha", dir: "asc" };

type Sugerencia<T> = { ids: T[]; ambiguo: boolean };

// Busca, entre candidatos no seleccionados, TODOS los que cuadran (en valor
// absoluto) con el objetivo — como una búsqueda por valor, no "el primero que
// aparezca". Si hay varios ítems sueltos con el mismo valor (ej. 7 pagos
// iguales), se marcan los 7 como sugeridos y el usuario elige cuál es el
// correcto (`ambiguo: true` — no se auto-selecciona). Si hay un solo ítem
// suelto que cuadra, o (a falta de sueltos) un par cuya suma cuadra, se puede
// auto-seleccionar de una (`ambiguo: false`). Los pares están acotados a listas
// de hasta 200 para no explotar.
function buscarSugerencia<T>(candidatos: { id: T; valor: number }[], objetivo: number): Sugerencia<T> | null {
  if (objetivo <= 0 || !candidatos.length) return null;
  const sueltos = candidatos.filter((c) => Math.abs(abs(c.valor) - objetivo) <= TOL).map((c) => c.id);
  if (sueltos.length === 1) return { ids: sueltos, ambiguo: false };
  if (sueltos.length > 1) return { ids: sueltos, ambiguo: true };
  if (candidatos.length <= 200) {
    for (let i = 0; i < candidatos.length; i++) {
      for (let j = i + 1; j < candidatos.length; j++) {
        const suma = abs(candidatos[i].valor) + abs(candidatos[j].valor);
        if (Math.abs(suma - objetivo) <= TOL) return { ids: [candidatos[i].id, candidatos[j].id], ambiguo: false };
      }
    }
  }
  return null;
}

export function ConciliacionesClient({ extracto, sistema, cruces }: { extracto: ExtractoItem[]; sistema: SistemaItem[]; cruces: Cruce[] }) {
  const router = useRouter();
  const [selExt, setSelExt] = useState<Set<number>>(new Set());
  const [selSis, setSelSis] = useState<Set<string>>(new Set());
  const [modo, setModo] = useState<"cartera" | "proveedor">("cartera");
  const [mes, setMes] = useState("");
  const [nota, setNota] = useState("");
  const [diferenciaCaja, setDiferenciaCaja] = useState(false);
  // Filtros y orden INDEPENDIENTES por columna (día preciso + valor + orden).
  const [extDesde, setExtDesde] = useState("");
  const [extHasta, setExtHasta] = useState("");
  const [extValorMin, setExtValorMin] = useState("");
  const [extValorMax, setExtValorMax] = useState("");
  const [ordenExt, setOrdenExt] = useState<Orden>(ORDEN_DEFAULT);
  const [sisDesde, setSisDesde] = useState("");
  const [sisHasta, setSisHasta] = useState("");
  const [sisValorMin, setSisValorMin] = useState("");
  const [sisValorMax, setSisValorMax] = useState("");
  const [ordenSis, setOrdenSis] = useState<Orden>(ORDEN_DEFAULT);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [verConciliados, setVerConciliados] = useState(false);

  function cambiarModo(m: "cartera" | "proveedor") {
    setModo(m);
    setSelExt(new Set());
    setSelSis(new Set());
    setDiferenciaCaja(false);
    setError(null);
    setAviso(null);
  }

  const meses = useMemo(() => Array.from(new Set(extracto.map((e) => e.periodo))).sort().reverse(), [extracto]);

  const enMes = (fecha: string | null) => {
    if (!mes) return true;
    if (!fecha) return false;
    return fecha.slice(0, 7) === mes;
  };
  function ordenar<T>(items: T[], orden: Orden, getFecha: (t: T) => string | null, getValor: (t: T) => number): T[] {
    const arr = [...items];
    arr.sort((a, b) => {
      let cmp: number;
      if (orden.campo === "fecha") {
        const fa = getFecha(a) ?? "";
        const fb = getFecha(b) ?? "";
        cmp = fa < fb ? -1 : fa > fb ? 1 : 0;
      } else {
        cmp = abs(getValor(a)) - abs(getValor(b));
      }
      return orden.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }

  // Cartera = valores positivos (abonos/ingresos) · Proveedores = negativos
  // (pagos/egresos, incluidos los saldos pendientes sugeridos). Cada columna
  // tiene su propio filtro de día/valor y su propio orden, independientes.
  const extVis = useMemo(() => {
    const filtrados = extracto.filter((e) =>
      enMes(e.fecha) &&
      (modo === "cartera" ? e.valor > 0 : e.valor < 0) &&
      (!extDesde || e.fecha >= extDesde) &&
      (!extHasta || e.fecha <= extHasta) &&
      (!extValorMin || abs(e.valor) >= Number(extValorMin)) &&
      (!extValorMax || abs(e.valor) <= Number(extValorMax))
    );
    return ordenar(filtrados, ordenExt, (e) => e.fecha, (e) => e.valor);
  }, [extracto, mes, modo, extDesde, extHasta, extValorMin, extValorMax, ordenExt]);

  const sisVis = useMemo(() => {
    const filtrados = sistema.filter((s) =>
      enMes(s.fecha) &&
      s.categoria === modo &&
      (!sisDesde || (s.fecha ?? "") >= sisDesde) &&
      (!sisHasta || (s.fecha ?? "") <= sisHasta) &&
      (!sisValorMin || abs(s.valor) >= Number(sisValorMin)) &&
      (!sisValorMax || abs(s.valor) <= Number(sisValorMax))
    );
    return ordenar(filtrados, ordenSis, (s) => s.fecha, (s) => s.valor);
  }, [sistema, mes, modo, sisDesde, sisHasta, sisValorMin, sisValorMax, ordenSis]);

  const totExt = extracto.filter((e) => selExt.has(e.id)).reduce((a, e) => a + abs(e.valor), 0);
  const totSis = sistema.filter((s) => selSis.has(s.ref)).reduce((a, s) => a + abs(s.valor), 0);
  const haySeleccion = selExt.size > 0 && selSis.size > 0;
  const sumasCuadran = haySeleccion && abs(totExt - totSis) <= 1;
  const dif = totExt - totSis;
  // Diferencia justificada: el sobrante/faltante quedó en efectivo (caja),
  // nunca pasa por el banco (ej. un abono en efectivo del que solo parte se
  // consignó). Requiere marcar la casilla Y dejar una nota — se permite
  // cruzar aunque las sumas no coincidan.
  const puedeForzarDiferencia = haySeleccion && !sumasCuadran;
  const cuadra = sumasCuadran || (puedeForzarDiferencia && diferenciaCaja && nota.trim() !== "");

  // Sugerencia automática: si solo hay selección de UN lado, busca en el otro
  // lado TODOS los ítems cuyo valor cuadre con el total ya seleccionado.
  const sugerenciaExt = useMemo(() => {
    if (!(selSis.size > 0 && selExt.size === 0)) return null;
    const candidatos = extVis.filter((e) => !selExt.has(e.id)).map((e) => ({ id: e.id, valor: e.valor }));
    return buscarSugerencia(candidatos, totSis);
  }, [selSis, selExt, extVis, totSis]);
  const sugerenciaSis = useMemo(() => {
    if (!(selExt.size > 0 && selSis.size === 0)) return null;
    const candidatos = sisVis.filter((s) => !selSis.has(s.ref)).map((s) => ({ id: s.ref, valor: s.valor }));
    return buscarSugerencia(candidatos, totExt);
  }, [selExt, selSis, sisVis, totExt]);
  const sugIdsExt = useMemo(() => new Set(sugerenciaExt?.ids ?? []), [sugerenciaExt]);
  const sugIdsSis = useMemo(() => new Set(sugerenciaSis?.ids ?? []), [sugerenciaSis]);

  function usarSugerencia() {
    if (sugerenciaExt && !sugerenciaExt.ambiguo) setSelExt((p) => { const n = new Set(p); sugerenciaExt.ids.forEach((id) => n.add(id)); return n; });
    if (sugerenciaSis && !sugerenciaSis.ambiguo) setSelSis((p) => { const n = new Set(p); sugerenciaSis.ids.forEach((ref) => n.add(ref)); return n; });
  }

  function toggleExt(id: number) { setSelExt((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleSis(ref: string) { setSelSis((p) => { const n = new Set(p); n.has(ref) ? n.delete(ref) : n.add(ref); return n; }); }

  const todoExtVisibleSel = extVis.length > 0 && extVis.every((e) => selExt.has(e.id));
  function toggleTodoExtVisible() {
    setSelExt((p) => {
      const n = new Set(p);
      if (todoExtVisibleSel) extVis.forEach((e) => n.delete(e.id));
      else extVis.forEach((e) => n.add(e.id));
      return n;
    });
  }
  function eliminarSeleccionadasExt() {
    const ids = extVis.filter((e) => selExt.has(e.id)).map((e) => e.id);
    if (!ids.length) return;
    if (!window.confirm(`¿Eliminar ${ids.length} línea(s) del extracto? Esto no se puede deshacer.`)) return;
    start(async () => {
      const r = await eliminarLineasExtracto(ids);
      if (!r.ok) { setError(r.error); return; }
      setSelExt((p) => { const n = new Set(p); ids.forEach((id) => n.delete(id)); return n; });
      router.refresh();
    });
  }

  function hacerCruce() {
    setError(null);
    setAviso(null);
    const items = sistema.filter((s) => selSis.has(s.ref)).map((s) => ({ ref: s.ref, descripcion: `${s.tipo}: ${s.descripcion}`, fecha: s.fecha, valor: s.valor, numeroContrato: s.numeroContrato }));
    start(async () => {
      const r = await cruzar({ extractoIds: [...selExt], sistema: items, nota, diferenciaCaja: !sumasCuadran && diferenciaCaja });
      if (!r.ok) { setError(r.error); return; }
      if (r.aviso) setAviso(r.aviso);
      setSelExt(new Set()); setSelSis(new Set()); setNota(""); setDiferenciaCaja(false); router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <Importador />

      {/* Cartera (positivos) vs Proveedores (negativos) */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => cambiarModo("cartera")}
          className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors"
          style={modo === "cartera" ? { backgroundColor: "var(--brand-primary)", color: "white" } : { backgroundColor: "#f3f4f6", color: "#374151" }}
        >
          Cartera (+)
        </button>
        <button
          type="button"
          onClick={() => cambiarModo("proveedor")}
          className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors"
          style={modo === "proveedor" ? { backgroundColor: "var(--brand-primary)", color: "white" } : { backgroundColor: "#f3f4f6", color: "#374151" }}
        >
          Proveedores (−)
        </button>
      </div>

      {/* Filtro general de mes — el de día/valor va dentro de cada columna */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Mes</label>
          <select value={mes} onChange={(e) => setMes(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
            <option value="">Todos</option>
            {meses.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {mes && <button onClick={() => setMes("")} className="pb-1.5 text-xs text-gray-500 hover:underline">Limpiar</button>}
      </div>

      {/* Barra de cruce */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 bg-white p-3 shadow-sm" style={{ borderColor: cuadra ? "var(--brand-success)" : "#e5e7eb" }}>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span>Extracto: <b className="tabular-nums">{formatCOP(totExt)}</b> ({selExt.size})</span>
          <span>Sistema: <b className="tabular-nums">{formatCOP(totSis)}</b> ({selSis.size})</span>
          <span className={abs(dif) <= 1 ? "text-[#3d7a63]" : "text-amber-600"}>Diferencia: <b className="tabular-nums">{formatCOP(dif)}</b></span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder={diferenciaCaja ? "Nota (obligatoria: explica la diferencia)" : "Nota (opcional)"}
            className="w-56"
          />
          <Button onClick={hacerCruce} disabled={!cuadra || pending} style={{ backgroundColor: cuadra ? (sumasCuadran ? "var(--brand-primary)" : "#b45309") : "#9ca3af" }}>
            <Link2 size={15} className="mr-1 inline" /> {pending ? "Cruzando…" : sumasCuadran ? "Cruzar" : "Cruzar con diferencia"}
          </Button>
        </div>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {aviso && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{aviso}</p>}
      {puedeForzarDiferencia && (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" checked={diferenciaCaja} onChange={(e) => setDiferenciaCaja(e.target.checked)} className="mt-0.5" />
            <span>
              La diferencia de <b className="tabular-nums">{formatCOP(abs(dif))}</b> no es un error: quedó (o salió) en <b>efectivo, en caja</b>, nunca pasó por el banco
              (ej. un abono en efectivo del que solo parte se consignó). Marca esto y escribe la nota para poder cruzar igual — el movimiento del sistema
              queda conciliado por su valor completo.
            </span>
          </label>
          {!diferenciaCaja && (
            <p className="mt-1 text-gray-500">O ajusta la selección: puedes elegir varios ítems de un lado (ej. una línea de 1.000 contra 700 + 300).</p>
          )}
        </div>
      )}
      {(sugerenciaExt || sugerenciaSis) && (() => {
        const s = (sugerenciaExt ?? sugerenciaSis)!;
        return (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2 text-sm" style={{ borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.08)" }}>
            <span className="inline-flex items-center gap-1.5" style={{ color: "var(--brand-primary)" }}>
              <Sparkles size={14} />
              {s.ambiguo
                ? `Encontramos ${s.ids.length} valores iguales que cuadran con el total — elige el correcto abajo.`
                : `Encontramos ${s.ids.length === 1 ? "un ítem que" : "una combinación que"} cuadra con el total seleccionado.`}
            </span>
            {!s.ambiguo && (
              <button onClick={usarSugerencia} className="font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>Usar sugerencia</button>
            )}
          </div>
        );
      })()}

      {/* Dos columnas */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Columna titulo={`Extracto del banco · ${modo === "cartera" ? "abonos" : "pagos"} (${extVis.length})`}>
          <FiltrosColumna
            desde={extDesde} setDesde={setExtDesde} hasta={extHasta} setHasta={setExtHasta}
            valorMin={extValorMin} setValorMin={setExtValorMin} valorMax={extValorMax} setValorMax={setExtValorMax}
            orden={ordenExt} setOrden={setOrdenExt}
          />
          {extVis.length > 0 && (
            <div className="mb-1 flex items-center justify-between gap-2 px-1 py-1 text-xs">
              <button onClick={toggleTodoExtVisible} className="text-gray-500 hover:underline">
                {todoExtVisibleSel ? "Deseleccionar todo" : "Seleccionar todo (visible)"}
              </button>
              {selExt.size > 0 && (
                <button onClick={eliminarSeleccionadasExt} disabled={pending} className="inline-flex items-center gap-1 font-medium text-red-500 hover:underline disabled:opacity-50">
                  <Trash2 size={12} /> Eliminar seleccionadas ({[...selExt].filter((id) => extVis.some((e) => e.id === id)).length})
                </button>
              )}
            </div>
          )}
          {extVis.length === 0 ? <Vacio>Sin líneas para estos filtros.</Vacio> : extVis.map((e) => (
            <ItemFila key={e.id} sel={selExt.has(e.id)} sugerido={sugIdsExt.has(e.id)} onClick={() => toggleExt(e.id)} fecha={e.fecha} desc={e.descripcion} valor={e.valor}
              onDel={() => start(async () => { await eliminarLineaExtracto(e.id); router.refresh(); })} />
          ))}
        </Columna>
        <Columna titulo={`${modo === "cartera" ? "Cartera" : "Proveedores"} (${sisVis.length})`}>
          <FiltrosColumna
            desde={sisDesde} setDesde={setSisDesde} hasta={sisHasta} setHasta={setSisHasta}
            valorMin={sisValorMin} setValorMin={setSisValorMin} valorMax={sisValorMax} setValorMax={setSisValorMax}
            orden={ordenSis} setOrden={setOrdenSis}
          />
          {sisVis.length === 0 ? <Vacio>Sin movimientos para estos filtros.</Vacio> : sisVis.map((s) => (
            <ItemFila key={s.ref} sel={selSis.has(s.ref)} sugerido={sugIdsSis.has(s.ref)} onClick={() => toggleSis(s.ref)} fecha={s.fecha} desc={`${s.tipo} · ${s.descripcion}`} valor={s.valor} contrato={s.numeroContrato} />
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
            {cruces.length === 0 ? <Vacio>Aún no hay cruces.</Vacio> : cruces.map((c) => {
              const sumSistema = c.sistema.reduce((a, s) => a + abs(s.valor), 0);
              const difCaja = c.total - sumSistema;
              return (
              <div key={c.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-700">
                    {c.fecha} · {formatCOP(c.total)}
                    {abs(difCaja) > 1 && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        Diferencia en caja: {formatCOP(abs(difCaja))}
                      </span>
                    )}
                    {c.nota && <span className="text-gray-400"> · {c.nota}</span>}
                  </span>
                  <button onClick={() => start(async () => { await deshacerCruce(c.id); router.refresh(); })} className="inline-flex items-center gap-1 text-xs text-red-500 hover:underline">
                    <Undo2 size={13} /> Deshacer
                  </button>
                </div>
                <div className="mt-1 grid grid-cols-1 gap-1 text-xs text-gray-500 sm:grid-cols-2">
                  <div>{c.extracto.map((e) => <div key={e.id}>↤ {e.fecha} {e.descripcion} · {formatCOP(e.valor)}</div>)}</div>
                  <div>{c.sistema.map((s, i) => (
                    <div key={i}>
                      ↦ {s.descripcion} · {formatCOP(s.valor)}
                      {s.numeroContrato && (
                        <Link href={`/dashboard/contratos/${encodeURIComponent(s.numeroContrato)}`} className="ml-1 font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
                          · {s.numeroContrato}
                        </Link>
                      )}
                    </div>
                  ))}</div>
                </div>
              </div>
              );
            })}
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
      else { setMsg(r.aviso ?? `Importadas ${r.n} líneas.`); setTexto(""); router.refresh(); }
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

// Filtro por día + valor y orden (fecha/valor, asc/desc) — independiente
// por columna (Extracto y Cartera/Proveedores tienen cada uno el suyo).
function FiltrosColumna({
  desde, setDesde, hasta, setHasta, valorMin, setValorMin, valorMax, setValorMax, orden, setOrden,
}: {
  desde: string; setDesde: (v: string) => void;
  hasta: string; setHasta: (v: string) => void;
  valorMin: string; setValorMin: (v: string) => void;
  valorMax: string; setValorMax: (v: string) => void;
  orden: Orden; setOrden: (o: Orden) => void;
}) {
  function toggleOrden(campo: Orden["campo"]) {
    setOrden(orden.campo === campo ? { campo, dir: orden.dir === "asc" ? "desc" : "asc" } : { campo, dir: "asc" });
  }
  const hayFiltro = desde || hasta || valorMin || valorMax;
  const btnOrden = (campo: Orden["campo"], label: string) => (
    <button
      type="button"
      onClick={() => toggleOrden(campo)}
      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={orden.campo === campo ? { backgroundColor: "var(--brand-primary)", color: "white" } : { backgroundColor: "#f3f4f6", color: "#6b7280" }}
    >
      {label} {orden.campo === campo ? (orden.dir === "asc" ? "↑" : "↓") : ""}
    </button>
  );
  return (
    <div className="mb-2 space-y-1.5 rounded-lg border border-gray-100 bg-gray-50/60 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-7 w-[8.5rem] text-xs" title="Desde (día)" />
        <span className="text-xs text-gray-300">–</span>
        <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="h-7 w-[8.5rem] text-xs" title="Hasta (día)" />
        <Input value={valorMin} onChange={(e) => setValorMin(e.target.value)} placeholder="Valor mín" inputMode="numeric" className="h-7 w-20 text-xs" />
        <Input value={valorMax} onChange={(e) => setValorMax(e.target.value)} placeholder="Valor máx" inputMode="numeric" className="h-7 w-20 text-xs" />
        {hayFiltro && (
          <button type="button" onClick={() => { setDesde(""); setHasta(""); setValorMin(""); setValorMax(""); }} className="text-xs text-gray-400 hover:underline">
            Limpiar
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-gray-400">Ordenar:</span>
        {btnOrden("fecha", "Fecha")}
        {btnOrden("valor", "Valor")}
      </div>
    </div>
  );
}
function ItemFila({ sel, sugerido, onClick, fecha, desc, valor, contrato, onDel }: { sel: boolean; sugerido?: boolean; onClick: () => void; fecha: string | null; desc: string; valor: number; contrato?: string | null; onDel?: () => void }) {
  return (
    <div onClick={onClick} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
      style={sel
        ? { borderColor: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.06)" }
        : sugerido
        ? { borderColor: "var(--brand-accent)", borderStyle: "dashed", backgroundColor: "rgba(38,187,217,0.06)" }
        : { borderColor: "transparent" }}>
      <input type="checkbox" checked={sel} readOnly className="pointer-events-none" />
      <span className="w-16 shrink-0 text-xs text-gray-400">{fechaCorta(fecha)}</span>
      <span className="flex-1 truncate text-gray-700" title={desc}>{desc}</span>
      {contrato && (
        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500" title={`Contrato ${contrato}`}>{contrato}</span>
      )}
      {sugerido && !sel && (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold" style={{ color: "var(--brand-accent)" }}><Sparkles size={11} /> Sugerido</span>
      )}
      <span className="shrink-0 tabular-nums font-medium" style={{ color: valor < 0 ? "#C0392B" : "var(--brand-success)" }}>{formatCOP(valor)}</span>
      {onDel && <button onClick={(e) => { e.stopPropagation(); onDel(); }} className="text-gray-300 hover:text-red-500" title="Eliminar línea"><Trash2 size={13} /></button>}
    </div>
  );
}
function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-6 text-center text-sm text-gray-400">{children}</p>;
}
