"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convertirCotizacion, descartarCotizacion, type PasajeroReserva } from "../../reservar/actions";

type ClientePrefill = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string };

const TIPOS_DOC = ["CC", "TI", "CE", "PAS", "RC"];

export function CotizacionAcciones({
  id, pax, infantes, tienePasajeros, cliente, esSuperadmin, asesores, miNombre, miRolVenta,
}: {
  id: number; pax: number; infantes: number; tienePasajeros: boolean; cliente: ClientePrefill; esSuperadmin: boolean;
  asesores: { nombre: string; email: string | null }[];
  miNombre: string; miRolVenta: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  const [capturando, setCapturando] = useState(false);
  // Si quien gestiona es asesor de ventas, se autollena con su usuario.
  const [asesorSel, setAsesorSel] = useState(miRolVenta ? miNombre : "");
  const asesorBloqueado = miRolVenta && !esSuperadmin; // solo superadmin lo cambia

  const total = Math.max(1, pax || 1);
  const [paxRows, setPaxRows] = useState<PasajeroReserva[]>(() =>
    Array.from({ length: total }, (_, i) => ({
      nombres: i === 0 ? cliente.nombres : "",
      apellidos: i === 0 ? cliente.apellidos : "",
      tipoDoc: i === 0 ? (cliente.tipoDoc || "CC") : "CC",
      numeroDoc: i === 0 ? cliente.numeroDoc : "",
      fechaNacimiento: "",
      nacionalidad: "Colombiana",
      esInfante: i >= total - Math.max(0, infantes),
    }))
  );

  const setRow = (i: number, k: keyof PasajeroReserva, v: string) =>
    setPaxRows((rows) => rows.map((r, n) => (n === i ? { ...r, [k]: v } : r)));

  function convertirDirecto() {
    setErr("");
    start(async () => {
      const r = await convertirCotizacion(id);
      if (r.ok) router.push(`/dashboard/contratos/${r.numero}`);
      else setErr(r.error);
    });
  }

  function generarConPasajeros() {
    const falta = paxRows.findIndex((p) => !p.nombres.trim() || !p.apellidos.trim());
    if (falta >= 0) { setErr(`Pasajero ${falta + 1}: nombres y apellidos son obligatorios.`); return; }
    if (!asesorSel && !esSuperadmin) { setErr("Elige el asesor interno que gestiona esta reserva."); return; }
    setErr("");
    start(async () => {
      const r = await convertirCotizacion(id, paxRows, false, asesorSel);
      if (r.ok) router.push(`/dashboard/contratos/${r.numero}`);
      else setErr(r.error);
    });
  }

  function generarSinPasajeros() {
    setErr("");
    start(async () => {
      const r = await convertirCotizacion(id, [], true);
      if (r.ok) router.push(`/dashboard/contratos/${r.numero}`);
      else setErr(r.error);
    });
  }

  function descartar() {
    setErr("");
    start(async () => {
      const r = await descartarCotizacion(id);
      if (r.ok) router.refresh();
      else setErr(r.error ?? "No se pudo descartar.");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => (tienePasajeros ? convertirDirecto() : setCapturando((v) => !v))}
          disabled={pending}
          style={{ backgroundColor: "var(--brand-success)" }}
        >
          {pending ? "Procesando…" : "Confirmar → generar contrato"}
        </Button>
        {!confirmarDescarte ? (
          <Button onClick={() => setConfirmarDescarte(true)} disabled={pending} variant="outline">Descartar</Button>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">¿Seguro?</span>
            <Button onClick={descartar} disabled={pending} variant="outline" className="text-red-600">Sí, descartar</Button>
            <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setConfirmarDescarte(false)}>Cancelar</button>
          </div>
        )}
      </div>

      {/* Captura de pasajeros (cuando la cotización no los trae, ej. tarifario B2C) */}
      {!tienePasajeros && capturando && (
        <div className="space-y-3 rounded-xl border border-gray-200 p-4">
          <p className="text-sm font-medium text-gray-700">Datos de los pasajeros ({total})</p>
          <p className="text-xs text-gray-400">Ya tienes al titular; completa el resto. Sin pasajeros no pasa a contrato.</p>
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
          {paxRows.map((p, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <div className="sm:col-span-1"><label className="text-[11px] text-gray-500">Nombres</label><Input value={p.nombres} onChange={(e) => setRow(i, "nombres", e.target.value)} /></div>
              <div className="sm:col-span-1"><label className="text-[11px] text-gray-500">Apellidos</label><Input value={p.apellidos} onChange={(e) => setRow(i, "apellidos", e.target.value)} /></div>
              <div>
                <label className="text-[11px] text-gray-500">Tipo doc</label>
                <select value={p.tipoDoc} onChange={(e) => setRow(i, "tipoDoc", e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
                  {TIPOS_DOC.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className="text-[11px] text-gray-500">N° doc</label><Input value={p.numeroDoc} onChange={(e) => setRow(i, "numeroDoc", e.target.value)} /></div>
              <div><label className="text-[11px] text-gray-500">Nacimiento</label><Input type="date" value={p.fechaNacimiento} onChange={(e) => setRow(i, "fechaNacimiento", e.target.value)} /></div>
              <div><label className="text-[11px] text-gray-500">Nacionalidad</label><Input value={p.nacionalidad} onChange={(e) => setRow(i, "nacionalidad", e.target.value)} /></div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={generarConPasajeros} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
              {pending ? "Generando…" : "Generar contrato"}
            </Button>
            {esSuperadmin && (
              <button type="button" onClick={generarSinPasajeros} disabled={pending} className="text-xs text-gray-400 hover:text-gray-700 underline">
                Generar sin pasajeros (superadmin)
              </button>
            )}
          </div>
        </div>
      )}

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <p className="text-xs text-gray-400">
        Al confirmar se genera el número de contrato, se descuentan las sillas y se crean las cuentas por pagar.
      </p>
    </div>
  );
}
