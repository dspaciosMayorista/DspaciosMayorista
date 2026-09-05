"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calcularEdad } from "@/lib/utils";
import { convertirCotizacionCarrito } from "../../reservar/actions";
import { type PasajeroReserva } from "@/lib/reservar/computo";
import { esInfantePorEdad } from "@/lib/reservar/pasajeros";
import { recalcularVinculosPorEdad } from "@/lib/reservar/pasajerosFilas";

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

  const total = Math.max(1, pax || 1);
  const [paxRows, setPaxRows] = useState<PasajeroReserva[]>(() =>
    Array.from({ length: total }, (_, i) => ({
      nombres: i === 0 ? cliente.nombres : "",
      apellidos: i === 0 ? cliente.apellidos : "",
      tipoDoc: "CC",
      numeroDoc: i === 0 ? cliente.numeroDoc : "",
      fechaNacimiento: "",
      nacionalidad: "Colombiana",
      esInfante: false,
    }))
  );

  // Fecha de referencia para clasificar edades en esta pantalla — revisión
  // de alto riesgo, ronda 3 (B10): antes se usaba `null` (hoy), pero el
  // servidor SIEMPRE recalcula contra la fecha real de CADA grupo/contrato
  // (`fechasIda[0]` de ESE grupo, que puede ser distinta entre destinos si
  // se elige "1 contrato por destino"). Usar "hoy" podía: (a) mostrar como
  // Infante a alguien que ya será Niño para la fecha real del viaje —
  // capturar un vínculo que el servidor luego rechazaría con "solo un
  // infante puede tener responsable" (por eso, además, el servidor
  // normaliza esto de nuevo por grupo antes de generar — ver
  // `normalizarResponsablesPorGrupo` en `convertirCotizacionCarrito`); o
  // (b) descartar como candidato a un adulto que hoy es menor pero para el
  // viaje ya será mayor de edad.
  //
  // Como TODOS los pasajeros de este arreglo se insertan en TODOS los
  // contratos que se generen (el carrito no reparte personas por grupo —
  // ver convertirCotizacionCarrito), la fecha más temprana de TODO el
  // carrito es la única referencia SEGURA para esta pantalla única: es
  // monótona — si alguien YA NO es infante contra la fecha más temprana,
  // tampoco lo será contra ninguna fecha real posterior (la edad solo
  // avanza); y si alguien YA es mayor de edad contra la fecha más temprana,
  // seguirá siendo mayor de edad contra cualquier fecha real posterior. La
  // dirección que queda conservadora (nunca insegura, solo más estricta de
  // lo necesario) es: alguien que hoy es menor pero será mayor DESPUÉS de
  // la fecha más temprana del carrito no aparece todavía como candidato a
  // responsable en esta pantalla — se resuelve editando pasajeros del
  // contrato ya generado, igual que cualquier otro caso límite de INF/CHD.
  const fechaMasTemprana = items.map((i) => i.fechaIda).filter((f): f is string => !!f).sort()[0] ?? null;

  const setRow = (i: number, k: keyof PasajeroReserva, v: string) =>
    setPaxRows((rows) => {
      const next = rows.map((r, n) => (n === i ? { ...r, [k]: v } : r));
      return k === "fechaNacimiento" ? recalcularVinculosPorEdad(next, fechaMasTemprana) : next;
    });
  const setResponsable = (i: number, responsableIndex: number | null) =>
    setPaxRows((rows) => rows.map((r, n) => (n === i ? { ...r, responsableIndex } : r)));

  // Asignación EXPLÍCITA de pasajeros por ítem — revisión de alto riesgo,
  // ronda 3 (B11): el carrito (lib/cart/CartContext.tsx) agrega cada ítem de
  // forma independiente, con su propio `pax` — dos ítems pueden representar
  // grupos de viajeros distintos o parcialmente distintos, nunca se puede
  // asumir que comparten el mismo prefijo de la lista de pasajeros. El
  // default (los primeros `item.pax` pasajeros marcados) cubre el caso más
  // común (todos viajan en todos los ítems) sin fricción, pero queda
  // SIEMPRE visible y editable — nunca es un supuesto silencioso.
  const [asignaciones, setAsignaciones] = useState<boolean[][]>(() =>
    items.map((it) => Array.from({ length: total }, (_, i) => i < it.pax))
  );
  const toggleAsignacion = (itemIdx: number, paxIdx: number) =>
    setAsignaciones((prev) => prev.map((fila, i) => (i === itemIdx ? fila.map((v, j) => (j === paxIdx ? !v : v)) : fila)));

  function generar() {
    const falta = paxRows.findIndex((p) => !p.nombres.trim() || !p.apellidos.trim());
    if (falta >= 0) { setErr(`Pasajero ${falta + 1}: nombres y apellidos son obligatorios.`); return; }
    const menorConCC = paxRows.findIndex((p) => {
      const edad = calcularEdad(p.fechaNacimiento, fechaMasTemprana);
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
    setErr("");
    start(async () => {
      const asignacionesRpc = asignaciones.map((fila) => fila.map((v, i) => (v ? i + 1 : null)).filter((v): v is number => v != null));
      const r = await convertirCotizacionCarrito(id, { agrupar, pasajeros: paxRows, asesorInterno: asesorSel, asignaciones: asignacionesRpc });
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

          <div>
            <p className="text-sm font-medium text-gray-700">Datos de los pasajeros ({total})</p>
            <p className="text-xs text-gray-400">Ya tienes al titular; completa el resto. Sin pasajeros no pasa a contrato.</p>
          </div>
          {(() => {
            // Edad REAL por fecha de nacimiento contra la fecha más temprana
            // del carrito (ver comentario de `fechaMasTemprana` arriba). Ya
            // no hay un checkbox "Infante" editable (revisión de alto
            // riesgo, ronda 3 — B9): el servidor SIEMPRE lo ignoró y
            // recalculó por fecha — solo queda el criterio derivado, real.
            const edadesReales = paxRows.map((p) => calcularEdad(p.fechaNacimiento, fechaMasTemprana));
            const esInfanteRealRow = paxRows.map((p) => esInfantePorEdad(p.fechaNacimiento, fechaMasTemprana));
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
