"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearProveedor, eliminarProveedor, type TipoProveedor } from "./actions";

type Proveedor = {
  id: number; tipo: string | null; nombre: string; razon_social: string | null;
  nit: string | null; ciudad: string | null; contacto: string | null;
  datos_pago: string | null; aplica_retencion: boolean; pct_retencion: number;
};

const TIPOS: { value: TipoProveedor; label: string }[] = [
  { value: "hotelero", label: "Hotelero" },
  { value: "aereo", label: "Aéreo" },
  { value: "servicios", label: "Servicios adicionales" },
];
const TIPO_LABEL: Record<string, string> = { hotelero: "Hotelero", aereo: "Aéreo", servicios: "Servicios" };

const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function ProveedoresClient({ proveedores }: { proveedores: Proveedor[] }) {
  const [tipo, setTipo] = useState<TipoProveedor>("hotelero");
  const [nombre, setNombre] = useState("");
  const [razon, setRazon] = useState("");
  const [nit, setNit] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [contacto, setContacto] = useState("");
  const [datosPago, setDatosPago] = useState("");
  const [ret, setRet] = useState(false);
  const [pctRet, setPctRet] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function crear() {
    if (!nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    setErr("");
    start(async () => {
      const r = await crearProveedor({
        tipo, nombre, razonSocial: razon, nit, ciudad, contacto, datosPago,
        aplicaRetencion: ret, pctRetencion: Number(pctRet) / 100 || 0,
      });
      if (r.ok) { setNombre(""); setRazon(""); setNit(""); setCiudad(""); setContacto(""); setDatosPago(""); setRet(false); setPctRet(""); }
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">Nuevo proveedor</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={lbl}>Tipo *</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoProveedor)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Nombre comercial *</label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div><label className={lbl}>Razón social</label><Input value={razon} onChange={(e) => setRazon(e.target.value)} /></div>
          <div><label className={lbl}>NIT</label><Input value={nit} onChange={(e) => setNit(e.target.value)} /></div>
          <div><label className={lbl}>Ciudad</label><Input value={ciudad} onChange={(e) => setCiudad(e.target.value)} /></div>
          <div><label className={lbl}>Contacto</label><Input value={contacto} onChange={(e) => setContacto(e.target.value)} /></div>
          <div className="md:col-span-2"><label className={lbl}>Datos de pago (banco, cuenta…)</label><Input value={datosPago} onChange={(e) => setDatosPago(e.target.value)} /></div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={ret} onChange={(e) => setRet(e.target.checked)} /> Retención
            </label>
            {ret && <Input type="number" className="w-20" placeholder="%" value={pctRet} onChange={(e) => setPctRet(e.target.value)} />}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={crear} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : "Agregar proveedor"}
          </Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {proveedores.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Tipo</th><th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Razón social</th><th className="px-4 py-2">NIT</th>
              <th className="px-4 py-2">Datos de pago</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>{proveedores.map((p) => <Row key={p.id} p={p} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ p }: { p: Proveedor }) {
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{TIPO_LABEL[p.tipo ?? ""] ?? p.tipo}</span>
      </td>
      <td className="px-4 py-2 text-gray-700">{p.nombre}</td>
      <td className="px-4 py-2 text-gray-500">{p.razon_social ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{p.nit ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{p.datos_pago ?? "—"}</td>
      <td className="px-4 py-2 text-right">
        <button type="button" disabled={pending}
          onClick={() => { if (confirm(`¿Eliminar ${p.nombre}?`)) start(() => { void eliminarProveedor(p.id); }); }}
          className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
      </td>
    </tr>
  );
}
