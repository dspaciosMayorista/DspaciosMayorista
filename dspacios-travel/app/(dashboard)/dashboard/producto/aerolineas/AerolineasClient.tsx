"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  crearAerolinea,
  eliminarAerolinea,
  actualizarAerolinea,
  crearTarifaAerolinea,
  eliminarTarifaAerolinea,
} from "./actions";

type Tarifa = { id: number; nombre: string; descripcion: string };
type Aerolinea = { id: number; nombre: string; activo: boolean; tarifas: Tarifa[] };

export function AerolineasClient({ aerolineas }: { aerolineas: Aerolinea[] }) {
  const [nombre, setNombre] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function crear() {
    if (!nombre.trim()) return;
    setErr("");
    start(async () => {
      const r = await crearAerolinea(nombre);
      if (r.ok) setNombre(""); else setErr(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-gray-700">Nueva aerolínea</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Nombre (ej. AVIANCA)" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-56" />
          <Button onClick={crear} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "…" : "Agregar"}
          </Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {aerolineas.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
          Sin aerolíneas cargadas todavía.
        </p>
      ) : (
        <div className="space-y-2">
          {aerolineas.map((a) => <FilaAerolinea key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}

function FilaAerolinea({ a }: { a: Aerolinea }) {
  const [abierto, setAbierto] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button type="button" onClick={() => setAbierto((o) => !o)} className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {a.nombre}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-normal text-gray-500">{a.tarifas.length} tarifa(s)</span>
          {!a.activo && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-normal text-amber-600">inactiva</span>}
        </button>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={a.activo} disabled={pending}
              onChange={(e) => start(async () => void (await actualizarAerolinea(a.id, e.target.checked)))} />
            Activa
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() => { if (confirm(`¿Eliminar ${a.nombre} y sus tarifas?`)) start(async () => void (await eliminarAerolinea(a.id))); }}
            className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-50"
          >
            Eliminar
          </button>
        </div>
      </div>
      {abierto && (
        <div className="border-t border-gray-100 p-4">
          <TarifasPanel aerolineaId={a.id} tarifas={a.tarifas} />
        </div>
      )}
    </div>
  );
}

function TarifasPanel({ aerolineaId, tarifas }: { aerolineaId: number; tarifas: Tarifa[] }) {
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [pending, start] = useTransition();
  const [pendingDel, startDel] = useTransition();
  const [err, setErr] = useState("");

  function agregar() {
    setErr("");
    start(async () => {
      const r = await crearTarifaAerolinea({ aerolineaId, nombre, descripcion });
      if (r.ok) { setNombre(""); setDescripcion(""); } else setErr(r.error);
    });
  }

  return (
    <div className="space-y-3">
      {tarifas.length === 0 ? (
        <p className="text-xs text-gray-400">Sin tipos de tarifa/equipaje todavía.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {tarifas.map((t) => (
              <tr key={t.id} className="border-b border-gray-50">
                <td className="py-1.5 pr-3 align-top font-medium text-gray-700" style={{ width: 200 }}>{t.nombre}</td>
                <td className="py-1.5 pr-3 align-top text-gray-500">{t.descripcion}</td>
                <td className="py-1.5 text-right align-top">
                  <button
                    type="button"
                    disabled={pendingDel}
                    onClick={() => startDel(async () => void (await eliminarTarifaAerolinea(t.id)))}
                    className="text-xs text-gray-300 hover:text-red-500 disabled:opacity-50"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
        <div>
          <label className="mb-1 block text-[11px] text-gray-500">Tipo (corto)</label>
          <Input placeholder="Artículo personal" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-44" />
        </div>
        <div className="min-w-[260px] flex-1">
          <label className="mb-1 block text-[11px] text-gray-500">Descripción completa (tal como va en el contrato)</label>
          <Input
            placeholder="ARTICULO PERSONAL MOCHILA O BOLSO (45 x 35 x 20 cm) POR PERSONA AVIANCA"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>
        <Button type="button" onClick={agregar} disabled={pending} className="h-9" style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "…" : "Agregar"}
        </Button>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
