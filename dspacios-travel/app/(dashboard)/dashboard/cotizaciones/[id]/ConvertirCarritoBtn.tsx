"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calcularEdad } from "@/lib/utils";
import { convertirCotizacionCarrito } from "../../reservar/actions";
import { type PasajeroReserva } from "@/lib/reservar/computo";

type ClientePrefill = { nombres: string; apellidos: string; numeroDoc: string };

const TIPOS_DOC = ["CC", "TI", "CE", "PAS", "RC"];

// Conversión de una cotización COMBINADA del carrito (Fase 3): captura
// pasajeros (igual que CotizacionAcciones) y, si el carrito trae 2+ destinos
// distintos, deja elegir 1 contrato para todo o 1 contrato por destino.
export function ConvertirCarritoBtn({
  id, pax, destinos, cliente, esSuperadmin, asesores, miNombre, miRolVenta,
}: {
  id: number; pax: number; destinos: string[]; cliente: ClientePrefill; esSuperadmin: boolean;
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

  const setRow = (i: number, k: keyof PasajeroReserva, v: string) =>
    setPaxRows((rows) => rows.map((r, n) => (n === i ? { ...r, [k]: v } : r)));

  function generar() {
    const falta = paxRows.findIndex((p) => !p.nombres.trim() || !p.apellidos.trim());
    if (falta >= 0) { setErr(`Pasajero ${falta + 1}: nombres y apellidos son obligatorios.`); return; }
    const menorConCC = paxRows.findIndex((p) => {
      const edad = calcularEdad(p.fechaNacimiento, null);
      return edad != null && edad < 18 && p.tipoDoc === "CC";
    });
    if (menorConCC >= 0) { setErr(`Pasajero ${menorConCC + 1}: un menor de edad no puede tener CC; usa RC o TI.`); return; }
    if (!asesorSel && !esSuperadmin) { setErr("Elige el asesor interno que gestiona esta reserva."); return; }
    setErr("");
    start(async () => {
      const r = await convertirCotizacionCarrito(id, { agrupar, pasajeros: paxRows, asesorInterno: asesorSel });
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
          {paxRows.map((p, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
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
              <label className="mb-2 flex items-center gap-1 text-[11px] text-gray-500">
                <input type="checkbox" checked={p.esInfante} onChange={(e) => setPaxRows((rows) => rows.map((r, n) => (n === i ? { ...r, esInfante: e.target.checked } : r)))} />
                Infante
              </label>
            </div>
          ))}
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
