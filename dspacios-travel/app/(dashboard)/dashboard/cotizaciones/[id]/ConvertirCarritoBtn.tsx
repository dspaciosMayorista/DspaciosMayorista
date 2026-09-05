"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calcularEdad } from "@/lib/utils";
import { convertirCotizacionCarrito } from "../../reservar/actions";
import { type PasajeroReserva } from "@/lib/reservar/computo";
import { esInfantePorEdad } from "@/lib/reservar/pasajeros";
import { recalcularVinculosPorEdadPorFila } from "@/lib/reservar/pasajerosFilas";
import {
  agruparIndicesPorDestino,
  agregarPosicionAUniverso,
  quitarPosicionDeUniverso,
  posicionesSinAsignar,
  fechaReferenciaPorPasajero,
  comparteGrupo,
} from "@/lib/reservar/carritoAsignaciones";

type ClientePrefill = { nombres: string; apellidos: string; numeroDoc: string };
type ItemCarritoUI = { hotelNombre: string; destino: string | null; pax: number; fechaIda: string | null };

const TIPOS_DOC = ["CC", "TI", "CE", "PAS", "RC"];

// Conversión de una cotización COMBINADA del carrito (Fase 3): captura
// pasajeros (igual que CotizacionAcciones) y, si el carrito trae 2+ destinos
// distintos, deja elegir 1 contrato para todo o 1 contrato por destino.
export function ConvertirCarritoBtn({
  id, pax, items, destinos, cliente, esSuperadmin, asesores, miNombre, miRolVenta,
}: {
  id: number; pax: number; items: ItemCarritoUI[]; destinos: string[]; cliente: ClientePrefill; esSuperadmin: boolean;
  asesores: { nombre: string; email: string | null }[];
  miNombre: string; miRolVenta: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [capturando, setCapturando] = useState(false);
  const [agrupar, setAgrupar] = useState<"todo" | "por_destino">("todo");
  const [asesorSel, setAsesorSel] = useState(miRolVenta ? miNombre : "");
  const asesorBloqueado = miRolVenta && !esSuperadmin;

  // Universo de pasajeros del carrito — B12 (ronda 5). Antes se derivaba
  // como `Math.max(...item.pax)` (prop `pax`, calculado en page.tsx), que NO
  // puede representar subconjuntos independientes (ítem A pax=2 + ítem B
  // pax=2 con 4 viajeros distintos necesita 4 filas, no 2) ni solapamientos
  // parciales. Ahora es solo el punto de partida: el número real de filas es
  // `paxRows.length`, y queda editable con los botones +/- de abajo — NUNCA
  // se sustituye el máximo por la suma como supuesto silencioso, ambos
  // serían adivinar; lo correcto es que quien convierte declare el universo
  // real.
  const totalInicial = Math.max(1, pax || 1);
  const [paxRows, setPaxRows] = useState<PasajeroReserva[]>(() =>
    Array.from({ length: totalInicial }, (_, i) => ({
      nombres: i === 0 ? cliente.nombres : "",
      apellidos: i === 0 ? cliente.apellidos : "",
      tipoDoc: "CC",
      numeroDoc: i === 0 ? cliente.numeroDoc : "",
      fechaNacimiento: "",
      nacionalidad: "Colombiana",
      esInfante: false,
    }))
  );

  // Asignación EXPLÍCITA de pasajeros por ítem — revisión de alto riesgo,
  // ronda 3 (B11): el carrito (lib/cart/CartContext.tsx) agrega cada ítem de
  // forma independiente, con su propio `pax` — dos ítems pueden representar
  // grupos de viajeros distintos o parcialmente distintos, nunca se puede
  // asumir que comparten el mismo prefijo de la lista de pasajeros. El
  // default (los primeros `item.pax` pasajeros marcados) cubre el caso más
  // común (todos viajan en todos los ítems) sin fricción, pero queda
  // SIEMPRE visible y editable — nunca es un supuesto silencioso.
  const [asignaciones, setAsignaciones] = useState<boolean[][]>(() =>
    items.map((it) => Array.from({ length: totalInicial }, (_, i) => i < it.pax))
  );

  // Fallback de fecha cuando un pasajero todavía no está asignado a ningún
  // ítem (a mitad de edición) o el carrito es solo de tours (sin ítems
  // contra los cuales resolver una fecha por-pasajero) — la más temprana de
  // TODO el carrito, igual que la única referencia que existía antes de B13.
  const fechaMasTemprana = items.map((i) => i.fechaIda).filter((f): f is string => !!f).sort()[0] ?? null;

  // Agrupación de ÍTEMS (no de tours, que no participan en `asignaciones`)
  // según el modo vigente — mismo criterio EXACTO que usa el servidor para
  // repartir en contratos (`convertirCotizacionCarrito`). Se usa para saber
  // qué pasajeros van a terminar en el MISMO contrato (`comparteGrupo`) y
  // para acotar la fecha de referencia de cada uno a sus propios ítems.
  const gruposIndicesItems = agruparIndicesPorDestino(items.map((it) => it.destino), agrupar);
  // Posiciones (1-based) asignadas a cada ítem — mismo formato que
  // `opts.asignaciones` del servidor.
  const asignacionesPorItemPos = asignaciones.map((fila) => fila.map((v, i) => (v ? i + 1 : null)).filter((v): v is number => v != null));
  // Fecha de referencia POR PASAJERO — revisión de B10 bajo el modelo de
  // B13 (ronda 5): antes se usaba `fechaMasTemprana` para TODOS, una
  // aproximación conservadora necesaria porque cada pasajero se insertaba
  // en TODOS los contratos. Desde B13, cada contrato solo recibe la unión
  // de SUS ítems — así que la referencia correcta para cada pasajero es la
  // fecha más temprana ENTRE LOS ÍTEMS A LOS QUE ESTÁ REALMENTE ASIGNADO
  // (nunca un ítem donde no viaja, que podría bloquear injustamente una
  // clasificación válida).
  const fechasReferenciaPorFila = paxRows.map((_, i) =>
    fechaReferenciaPorPasajero(i + 1, asignacionesPorItemPos, items.map((it) => it.fechaIda), fechaMasTemprana)
  );

  const agregarPasajero = () => {
    const { filas, asignacionesPorItem } = agregarPosicionAUniverso<PasajeroReserva>(paxRows, asignaciones, {
      nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", fechaNacimiento: "", nacionalidad: "Colombiana", esInfante: false,
    });
    setPaxRows(filas);
    setAsignaciones(asignacionesPorItem);
  };
  const quitarPasajero = (idx: number) => {
    if (paxRows.length <= 1) return;
    const { filas, asignacionesPorItem } = quitarPosicionDeUniverso(paxRows, asignaciones, idx);
    setPaxRows(filas);
    setAsignaciones(asignacionesPorItem);
  };

  const setRow = (i: number, k: keyof PasajeroReserva, v: string) =>
    setPaxRows((rows) => {
      const next = rows.map((r, n) => (n === i ? { ...r, [k]: v } : r));
      return k === "fechaNacimiento" ? recalcularVinculosPorEdadPorFila(next, fechasReferenciaPorFila) : next;
    });
  const setResponsable = (i: number, responsableIndex: number | null) =>
    setPaxRows((rows) => rows.map((r, n) => (n === i ? { ...r, responsableIndex } : r)));

  const toggleAsignacion = (itemIdx: number, paxIdx: number) => {
    const nextAsignaciones = asignaciones.map((fila, i) => (i === itemIdx ? fila.map((v, j) => (j === paxIdx ? !v : v)) : fila));
    setAsignaciones(nextAsignaciones);
    // Cambiar a qué ítem(s) queda expuesto un pasajero puede cambiar SU
    // fecha de referencia (B13 revisita B10) — se recalcula con la
    // asignación NUEVA para no dejar vivo un vínculo que ya no aplica (o
    // para no perder uno que ahora sí aplica, aunque esta función solo
    // limpia, nunca agrega — ver `recalcularVinculosPorEdadPorFila`).
    const posPorItemNueva = nextAsignaciones.map((fila) => fila.map((v, i) => (v ? i + 1 : null)).filter((v): v is number => v != null));
    const fechasRefNuevas = paxRows.map((_, i) => fechaReferenciaPorPasajero(i + 1, posPorItemNueva, items.map((it) => it.fechaIda), fechaMasTemprana));
    setPaxRows((rows) => recalcularVinculosPorEdadPorFila(rows, fechasRefNuevas));
  };

  function generar() {
    const falta = paxRows.findIndex((p) => !p.nombres.trim() || !p.apellidos.trim());
    if (falta >= 0) { setErr(`Pasajero ${falta + 1}: nombres y apellidos son obligatorios.`); return; }
    const menorConCC = paxRows.findIndex((p, i) => {
      const edad = calcularEdad(p.fechaNacimiento, fechasReferenciaPorFila[i]);
      return edad != null && edad < 18 && p.tipoDoc === "CC";
    });
    if (menorConCC >= 0) { setErr(`Pasajero ${menorConCC + 1}: un menor de edad no puede tener CC; usa RC o TI.`); return; }
    if (!asesorSel && !esSuperadmin) { setErr("Elige el asesor interno que gestiona esta reserva."); return; }
    for (let i = 0; i < items.length; i++) {
      const marcados = asignaciones[i].filter(Boolean).length;
      if (marcados !== items[i].pax) {
        setErr(`${items[i].hotelNombre}: marca exactamente ${items[i].pax} pasajero(s) para este ítem (tienes ${marcados}).`);
        return;
      }
    }
    // Ningún pasajero del universo declarado puede quedar sin viajar en
    // NINGÚN ítem (B12) — mismo chequeo que hace el servidor, adelantado
    // aquí solo para dar un mensaje inmediato; el servidor sigue siendo la
    // autoridad real. Un carrito de solo tours no tiene ítems contra los
    // cuales validar esto.
    if (items.length) {
      const sinAsignar = posicionesSinAsignar(asignacionesPorItemPos, paxRows.length);
      if (sinAsignar.length) {
        setErr(`El pasajero ${sinAsignar[0]} no está asignado a ningún ítem. Márcalo en al menos uno o quítalo del listado.`);
        return;
      }
    }
    setErr("");
    start(async () => {
      const r = await convertirCotizacionCarrito(id, { agrupar, pasajeros: paxRows, asesorInterno: asesorSel, asignaciones: asignacionesPorItemPos });
      if (r.ok) router.push(`/dashboard/contratos/${r.numeros[0]}`);
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setCapturando((v) => !v)} disabled={pending} style={{ backgroundColor: "var(--brand-success)" }}>
          {pending ? "Procesando…" : "Confirmar → generar contrato(s)"}
        </Button>
      </div>

      {capturando && (
        <div className="space-y-4 rounded-xl border border-gray-200 p-4">
          {destinos.length > 1 && (
            <div>
              <p className="mb-1 text-sm font-medium text-gray-700">Este carrito tiene {destinos.length} destinos ({destinos.join(", ")}).</p>
              <div className="flex flex-wrap gap-2">
                {([["todo", "1 solo contrato con todo"], ["por_destino", "1 contrato por destino"]] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setAgrupar(v)}
                    className="rounded-lg border px-3 py-2 text-sm font-medium transition-all"
                    style={agrupar === v
                      ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" }
                      : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="max-w-xs">
            <label className="text-[11px] text-gray-500">Asesor interno que gestiona{esSuperadmin ? " (opcional)" : " *"}</label>
            <select value={asesorSel} onChange={(e) => setAsesorSel(e.target.value)} disabled={asesorBloqueado}
              className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500">
              <option value="">{esSuperadmin ? "— Sin asesor —" : "— Elegir asesor —"}</option>
              {asesores.map((a) => <option key={a.email ?? a.nombre} value={a.nombre}>{a.nombre}</option>)}
              {asesorSel && !asesores.some((a) => a.nombre === asesorSel) && <option value={asesorSel}>{asesorSel}</option>}
            </select>
            {asesorBloqueado && <p className="mt-0.5 text-[10px] text-gray-400">Te asigna automáticamente; solo un superadmin puede cambiarlo.</p>}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Datos de los pasajeros ({paxRows.length})</p>
              <p className="text-xs text-gray-400">
                Ya tienes al titular; completa el resto. Sin pasajeros no pasa a contrato. Ajusta el total si el
                carrito tiene viajeros que no comparten todos los ítems (B12): agrega o quita filas — no se asume
                que el total es el máximo ni la suma de los ítems.
              </p>
            </div>
            <Button type="button" onClick={agregarPasajero} disabled={pending} className="shrink-0" style={{ backgroundColor: "var(--brand-accent)" }}>
              + Agregar pasajero
            </Button>
          </div>
          {(() => {
            // Edad REAL por fecha de nacimiento — cada fila contra SU PROPIA
            // fecha de referencia (`fechasReferenciaPorFila`, B13 revisita
            // B10: la fecha más temprana ENTRE LOS ÍTEMS a los que esa
            // persona está realmente asignada, nunca la del carrito
            // completo). Ya no hay un checkbox "Infante" editable (revisión
            // de alto riesgo, ronda 3 — B9): el servidor SIEMPRE lo ignoró y
            // recalculó por fecha — solo queda el criterio derivado, real.
            const edadesReales = paxRows.map((p, i) => calcularEdad(p.fechaNacimiento, fechasReferenciaPorFila[i]));
            const esInfanteRealRow = paxRows.map((p, i) => esInfantePorEdad(p.fechaNacimiento, fechasReferenciaPorFila[i]));
            return paxRows.map((p, i) => (
              <div key={i} className="rounded-lg bg-gray-50 p-2">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-32"><label className="text-[11px] text-gray-500">Nombres</label><Input value={p.nombres} onChange={(e) => setRow(i, "nombres", e.target.value)} /></div>
                  <div className="w-32"><label className="text-[11px] text-gray-500">Apellidos</label><Input value={p.apellidos} onChange={(e) => setRow(i, "apellidos", e.target.value)} /></div>
                  <div className="w-24">
                    <label className="text-[11px] text-gray-500">Tipo doc</label>
                    <select value={p.tipoDoc} onChange={(e) => setRow(i, "tipoDoc", e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
                      {TIPOS_DOC.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="w-28"><label className="text-[11px] text-gray-500">N° doc</label><Input value={p.numeroDoc} onChange={(e) => setRow(i, "numeroDoc", e.target.value)} /></div>
                  <div className="w-44"><label className="text-[11px] text-gray-500">Nacimiento</label><Input type="date" className="w-full" value={p.fechaNacimiento} onChange={(e) => setRow(i, "fechaNacimiento", e.target.value)} /></div>
                  <div className="w-32"><label className="text-[11px] text-gray-500">Nacionalidad</label><Input value={p.nacionalidad} onChange={(e) => setRow(i, "nacionalidad", e.target.value)} /></div>
                  <span className="pb-2 text-[11px] text-gray-400">
                    {edadesReales[i] == null ? "—" : `${esInfanteRealRow[i] ? "Infante" : edadesReales[i]! < 12 ? "Niño" : "Adulto"} · ${edadesReales[i]}a`}
                  </span>
                  <button type="button" onClick={() => quitarPasajero(i)} disabled={paxRows.length <= 1}
                    className="pb-2 text-[11px] font-medium text-red-500 disabled:cursor-not-allowed disabled:text-gray-300">
                    Quitar
                  </button>
                </div>
                {esInfanteRealRow[i] && (
                  <div className="mt-2 max-w-xs">
                    <label className="text-[11px] text-gray-500">Adulto responsable *</label>
                    <select
                      value={p.responsableIndex ?? ""}
                      onChange={(e) => setResponsable(i, e.target.value === "" ? null : Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm"
                    >
                      <option value="">Sin vincular (se rechazará al generar)</option>
                      {paxRows.map((otro, j) => {
                        if (j === i) return null;
                        const edadOtro = edadesReales[j];
                        if (edadOtro == null || edadOtro < 18) return null;
                        // El responsable debe terminar en el MISMO
                        // contrato/grupo que el infante (B13 punto 5) — no
                        // necesariamente el mismo ítem/bloqueo (ver
                        // `reindexarGrupoLocal` en carritoAsignaciones.ts).
                        // Sin ítems (carrito de solo tours) no hay grupos
                        // que comparar — todo el mundo termina en el único
                        // contrato, así que no se filtra.
                        if (items.length && !comparteGrupo(i + 1, j + 1, gruposIndicesItems, asignacionesPorItemPos)) return null;
                        const nombre = `${otro.nombres} ${otro.apellidos}`.trim() || `Pasajero ${j + 1}`;
                        return <option key={j} value={j}>{nombre}</option>;
                      })}
                    </select>
                    <p className="mt-1 text-xs text-gray-400">Todo infante debe quedar vinculado a un adulto (18+ años) del mismo contrato.</p>
                  </div>
                )}
              </div>
            ));
          })()}

          {items.length > 1 && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-gray-700">¿Quién viaja en cada ítem?</p>
              <p className="text-xs text-gray-500">
                Este carrito tiene {items.length} ítems agregados por separado — marca exactamente quiénes viajan en cada uno (no se asume que son los mismos).
              </p>
              {items.map((it, itemIdx) => {
                const marcados = asignaciones[itemIdx]?.filter(Boolean).length ?? 0;
                return (
                  <div key={itemIdx} className="rounded-lg bg-white p-2">
                    <p className="text-xs font-semibold text-gray-700">
                      {it.hotelNombre}{it.destino ? ` — ${it.destino}` : ""} · requiere {it.pax} pasajero(s)
                      {marcados !== it.pax && <span className="ml-1 text-red-500">(marcados: {marcados})</span>}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {paxRows.map((p, paxIdx) => (
                        <label key={paxIdx} className="flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={asignaciones[itemIdx]?.[paxIdx] ?? false}
                            onChange={() => toggleAsignacion(itemIdx, paxIdx)}
                          />
                          {`${p.nombres} ${p.apellidos}`.trim() || `Pasajero ${paxIdx + 1}`}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Button onClick={generar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Generando…" : "Generar contrato(s)"}
          </Button>
        </div>
      )}

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <p className="text-xs text-gray-400">
        Al confirmar se genera el número de contrato (uno por grupo si elegiste &quot;por destino&quot;), se descuentan las sillas de los vuelos incluidos y se crean las cuentas por pagar.
      </p>
    </div>
  );
}
