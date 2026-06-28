"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { guardarAgencia } from "./actions";

const CAMPOS: { k: string; label: string; col?: number }[] = [
  { k: "razon_social", label: "Razón social", col: 2 },
  { k: "nombre_comercial", label: "Nombre comercial", col: 2 },
  { k: "nit", label: "NIT" },
  { k: "dv", label: "DV" },
  { k: "rnt", label: "RNT" },
  { k: "actividad_economica", label: "Actividad económica (CIIU)" },
  { k: "direccion", label: "Dirección", col: 2 },
  { k: "ciudad", label: "Ciudad" },
  { k: "telefono", label: "Teléfono" },
  { k: "correo", label: "Correo", col: 2 },
  { k: "representante_legal", label: "Representante legal", col: 2 },
  { k: "banco", label: "Banco" },
  { k: "tipo_cuenta", label: "Tipo de cuenta" },
  { k: "numero_cuenta", label: "N° de cuenta", col: 2 },
];

export function AgenciaForm({ data }: { data: Record<string, string | boolean | null> }) {
  const [v, setV] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const c of CAMPOS) o[c.k] = (data[c.k] as string) ?? "";
    return o;
  });
  const [facElec, setFacElec] = useState(!!data.factura_electronica);
  const [resp, setResp] = useState((data.responsabilidades as string) ?? "");
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  function guardar() {
    setErr(""); setOk(false);
    start(async () => {
      const r = await guardarAgencia({ ...v, responsabilidades: resp, factura_electronica: facElec });
      if (r.ok) setOk(true); else setErr(r.error);
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {CAMPOS.map((c) => (
          <div key={c.k} className={c.col === 2 ? "md:col-span-2" : ""}>
            <label className="mb-1 block text-xs font-medium text-gray-600">{c.label}</label>
            <Input value={v[c.k]} onChange={(e) => set(c.k, e.target.value)} />
          </div>
        ))}
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">Responsabilidades DIAN</label>
          <textarea value={resp} onChange={(e) => setResp(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
          <input type="checkbox" checked={facElec} onChange={(e) => setFacElec(e.target.checked)} className="rounded" />
          Facturador electrónico (responsabilidad 52)
        </label>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</Button>
        {ok && <span className="text-xs text-[#3d7a63]">Guardado ✓</span>}
      </div>
    </div>
  );
}
