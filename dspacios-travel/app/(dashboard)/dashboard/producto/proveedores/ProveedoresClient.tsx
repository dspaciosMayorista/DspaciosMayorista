"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearProveedor, actualizarProveedor, eliminarProveedor, type TipoProveedor, type ProveedorInput } from "./actions";

type Proveedor = {
  id: number; tipo: string | null; nombre: string; razon_social: string | null;
  nit: string | null; ciudad: string | null; contacto: string | null;
  datos_pago: string | null; banco: string | null; tipo_cuenta: string | null; numero_cuenta: string | null;
  politica_reservas: string | null;
  aplica_retencion: boolean; pct_retencion: number;
};

const TIPOS: { value: TipoProveedor; label: string }[] = [
  { value: "hotelero", label: "Hotelero" },
  { value: "aereo", label: "Aéreo" },
  { value: "servicios", label: "Servicios adicionales" },
];
const TIPO_LABEL: Record<string, string> = { hotelero: "Hotelero", aereo: "Aéreo", servicios: "Servicios" };
const TIPOS_CUENTA = ["Ahorros", "Corriente"];

const lbl = "mb-1 block text-xs font-medium text-gray-600";

// Texto de respaldo para la columna "Datos bancarios" de la tabla.
function bancarioTexto(p: Proveedor): string {
  const partes = [p.banco, p.tipo_cuenta, p.numero_cuenta].filter((x): x is string => !!x);
  if (partes.length) return partes.join(" · ");
  return p.datos_pago ?? "—";
}

export function ProveedoresClient({ proveedores }: { proveedores: Proveedor[] }) {
  const [editId, setEditId] = useState<number | null>(null);
  const [tipo, setTipo] = useState<TipoProveedor>("hotelero");
  const [nombre, setNombre] = useState("");
  const [razon, setRazon] = useState("");
  const [nit, setNit] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [contacto, setContacto] = useState("");
  const [banco, setBanco] = useState("");
  const [tipoCuenta, setTipoCuenta] = useState("");
  const [numeroCuenta, setNumeroCuenta] = useState("");
  const [politica, setPolitica] = useState("");
  const [ret, setRet] = useState(false);
  const [pctRet, setPctRet] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function reset() {
    setEditId(null); setTipo("hotelero"); setNombre(""); setRazon(""); setNit("");
    setCiudad(""); setContacto(""); setBanco(""); setTipoCuenta(""); setNumeroCuenta("");
    setPolitica(""); setRet(false); setPctRet(""); setErr("");
  }

  function editar(p: Proveedor) {
    setEditId(p.id);
    setTipo((p.tipo as TipoProveedor) ?? "hotelero");
    setNombre(p.nombre); setRazon(p.razon_social ?? ""); setNit(p.nit ?? "");
    setCiudad(p.ciudad ?? ""); setContacto(p.contacto ?? "");
    setBanco(p.banco ?? ""); setTipoCuenta(p.tipo_cuenta ?? ""); setNumeroCuenta(p.numero_cuenta ?? "");
    setPolitica(p.politica_reservas ?? "");
    setRet(p.aplica_retencion); setPctRet(p.aplica_retencion ? String(p.pct_retencion * 100) : "");
    setErr("");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function guardar() {
    if (!nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    setErr("");
    const input: ProveedorInput = {
      tipo, nombre, razonSocial: razon, nit, ciudad, contacto,
      banco, tipoCuenta, numeroCuenta, politicaReservas: politica,
      aplicaRetencion: ret, pctRetencion: Number(pctRet) / 100 || 0,
    };
    start(async () => {
      const r = editId == null ? await crearProveedor(input) : await actualizarProveedor(editId, input);
      if (r.ok) reset();
      else setErr(r.error);
    });
  }

  const editando = editId != null;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">{editando ? "Editar proveedor" : "Nuevo proveedor"}</p>
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
          <div><label className={lbl}>Banco</label><Input value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Ej. Bancolombia" /></div>
          <div>
            <label className={lbl}>Tipo de cuenta</label>
            <select value={tipoCuenta} onChange={(e) => setTipoCuenta(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              {TIPOS_CUENTA.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Número de cuenta</label><Input value={numeroCuenta} onChange={(e) => setNumeroCuenta(e.target.value)} placeholder="Ej. 123-456789-00" /></div>
          <div className="md:col-span-3">
            <label className={lbl}>Política de reservas <span className="font-normal text-gray-400">(uso interno · no se muestra en el contrato)</span></label>
            <textarea value={politica} onChange={(e) => setPolitica(e.target.value)} rows={2}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="Ej. Reserva con 50% de anticipo · cancelación sin costo hasta 15 días antes · no reembolsable en temporada alta…" />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={ret} onChange={(e) => setRet(e.target.checked)} /> Retención
            </label>
            {ret && <Input type="number" className="w-20" placeholder="%" value={pctRet} onChange={(e) => setPctRet(e.target.value)} />}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : editando ? "Guardar cambios" : "Agregar proveedor"}
          </Button>
          {editando && <Button variant="outline" onClick={reset} disabled={pending}>Cancelar</Button>}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {proveedores.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Tipo</th><th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Razón social</th><th className="px-4 py-2">NIT</th>
              <th className="px-4 py-2">Datos bancarios</th><th className="px-4 py-2">Política de reservas</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>{proveedores.map((p) => <Row key={p.id} p={p} onEdit={editar} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ p, onEdit }: { p: Proveedor; onEdit: (p: Proveedor) => void }) {
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{TIPO_LABEL[p.tipo ?? ""] ?? p.tipo}</span>
      </td>
      <td className="px-4 py-2 text-gray-700">{p.nombre}</td>
      <td className="px-4 py-2 text-gray-500">{p.razon_social ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{p.nit ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{bancarioTexto(p)}</td>
      <td className="px-4 py-2 text-gray-500"><span className="block max-w-[260px] whitespace-pre-wrap">{p.politica_reservas ?? "—"}</span></td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <button type="button" onClick={() => onEdit(p)} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
        <span className="mx-2 text-gray-300">·</span>
        <button type="button" disabled={pending}
          onClick={() => { if (confirm(`¿Eliminar ${p.nombre}?`)) start(() => { void eliminarProveedor(p.id); }); }}
          className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
      </td>
    </tr>
  );
}
