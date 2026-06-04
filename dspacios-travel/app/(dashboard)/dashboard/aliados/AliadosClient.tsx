"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearAliado, actualizarAliado, eliminarAliado } from "./actions";

type Aliado = {
  id: number; nombre: string; tipo: string | null; nit: string | null; contacto: string | null;
  email: string | null; telefono: string | null; pct_comision: number | null;
  aplica_retencion: boolean; pct_retencion: number;
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function AliadosClient({
  aliados, defAgencia, defFreelance,
}: { aliados: Aliado[]; defAgencia: number; defFreelance: number }) {
  const [tipo, setTipo] = useState<"agencia" | "freelance">("agencia");
  const [nombre, setNombre] = useState("");
  const [nit, setNit] = useState("");
  const [contacto, setContacto] = useState("");
  const [email, setEmail] = useState("");
  const [tel, setTel] = useState("");
  const [pct, setPct] = useState("");
  const [ret, setRet] = useState(true);
  const [pctRet, setPctRet] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function crear() {
    if (!nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    setErr("");
    start(async () => {
      const r = await crearAliado({
        nombre, tipo, nit, contacto, email, telefono: tel,
        pctComision: pct.trim() === "" ? null : Number(pct) / 100,
        aplicaRetencion: ret, pctRetencion: Number(pctRet) / 100 || 0,
      });
      if (r.ok) { setNombre(""); setNit(""); setContacto(""); setEmail(""); setTel(""); setPct(""); setRet(true); setPctRet(""); }
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--brand-accent)] bg-[rgba(38,187,217,0.06)] p-3 text-xs text-gray-600">
        <b>Comisión por defecto:</b> agencia {(defAgencia * 100).toFixed(1)}% · freelance {(defFreelance * 100).toFixed(1)}%
        (editables en Configuración → Parámetros). Si a un aliado le pones un <b>% propio</b>, ese manda; si lo dejas vacío, usa el default de su tipo.
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">Nueva agencia / freelance</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className={lbl}>Tipo *</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as "agencia" | "freelance")} className={sel}>
              <option value="agencia">Agencia</option>
              <option value="freelance">Freelance</option>
            </select>
          </div>
          <div><label className={lbl}>Nombre *</label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div><label className={lbl}>NIT / CC</label><Input value={nit} onChange={(e) => setNit(e.target.value)} /></div>
          <div><label className={lbl}>Contacto</label><Input value={contacto} onChange={(e) => setContacto(e.target.value)} /></div>
          <div><label className={lbl}>Email</label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className={lbl}>Teléfono</label><Input value={tel} onChange={(e) => setTel(e.target.value)} /></div>
          <div><label className={lbl}>% comisión (propio, opcional)</label><Input type="number" step="0.1" value={pct} onChange={(e) => setPct(e.target.value)} placeholder={`def ${(((tipo === "agencia" ? defAgencia : defFreelance)) * 100).toFixed(1)}`} /></div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={ret} onChange={(e) => setRet(e.target.checked)} /> Retención
            </label>
            {ret && <Input type="number" className="w-20" placeholder="%" value={pctRet} onChange={(e) => setPctRet(e.target.value)} />}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={crear} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Agregar"}</Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {aliados.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">NIT</th>
              <th className="px-3 py-2 text-right">% comisión</th><th className="px-3 py-2 text-center">Retención</th>
              <th className="px-3 py-2 text-right">% ret.</th><th className="px-3 py-2"></th>
            </tr></thead>
            <tbody>{aliados.map((a) => <Row key={a.id} a={a} defAgencia={defAgencia} defFreelance={defFreelance} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ a, defAgencia, defFreelance }: { a: Aliado; defAgencia: number; defFreelance: number }) {
  const def = (a.tipo === "freelance" ? defFreelance : defAgencia) * 100;
  const [pct, setPct] = useState(a.pct_comision == null ? "" : String((a.pct_comision * 100)));
  const [ret, setRet] = useState(a.aplica_retencion);
  const [pctRet, setPctRet] = useState(String((a.pct_retencion * 100) || ""));
  const [pending, start] = useTransition();
  const save = (patch: Parameters<typeof actualizarAliado>[1]) => start(() => { void actualizarAliado(a.id, patch); });
  return (
    <tr className="border-t border-gray-50">
      <td className="px-3 py-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{a.tipo ?? "agencia"}</span></td>
      <td className="px-3 py-2 text-gray-700">{a.nombre}</td>
      <td className="px-3 py-2 text-gray-500">{a.nit ?? "—"}</td>
      <td className="px-3 py-2 text-right">
        <Input type="number" step="0.1" className="w-20" value={pct} placeholder={`def ${def.toFixed(1)}`}
          onChange={(e) => setPct(e.target.value)}
          onBlur={() => save({ pctComision: pct.trim() === "" ? null : Number(pct) / 100 })} />
      </td>
      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={ret} onChange={(e) => { setRet(e.target.checked); save({ aplicaRetencion: e.target.checked }); }} />
      </td>
      <td className="px-3 py-2 text-right">
        <Input type="number" className="w-16" value={pctRet} onChange={(e) => setPctRet(e.target.value)}
          onBlur={() => save({ pctRetencion: Number(pctRet) / 100 || 0 })} />
      </td>
      <td className="px-3 py-2 text-right">
        <button type="button" disabled={pending} onClick={() => { if (confirm(`¿Eliminar ${a.nombre}?`)) start(() => { void eliminarAliado(a.id); }); }}
          className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
      </td>
    </tr>
  );
}
