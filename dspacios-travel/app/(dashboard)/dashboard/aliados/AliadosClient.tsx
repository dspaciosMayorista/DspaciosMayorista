"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearAliado, actualizarAliado, eliminarAliado } from "./actions";
import { ChevronDown, ChevronRight } from "lucide-react";

type Aliado = {
  id: number; nombre: string; tipo: string | null; nit: string | null; tipo_documento: string | null;
  direccion: string | null; contacto: string | null;
  email: string | null; telefono: string | null; pct_comision: number | null;
  aplica_retencion: boolean; pct_retencion: number;
  banco: string | null; tipo_cuenta: string | null; numero_cuenta: string | null;
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function AliadosClient({
  aliados, defAgencia, defFreelance,
}: { aliados: Aliado[]; defAgencia: number; defFreelance: number }) {
  const [tipo, setTipo] = useState<"agencia" | "freelance">("agencia");
  const [nombre, setNombre] = useState("");
  const [tipoDoc, setTipoDoc] = useState("NIT");
  const [nit, setNit] = useState("");
  const [direccion, setDireccion] = useState("");
  const [contacto, setContacto] = useState("");
  const [email, setEmail] = useState("");
  const [tel, setTel] = useState("");
  const [pct, setPct] = useState("");
  const [ret, setRet] = useState(true);
  const [pctRet, setPctRet] = useState("");
  const [banco, setBanco] = useState("");
  const [tipoCuenta, setTipoCuenta] = useState("");
  const [numeroCuenta, setNumeroCuenta] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function crear() {
    if (!nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    setErr("");
    start(async () => {
      const r = await crearAliado({
        nombre, tipo, nit, tipoDocumento: tipoDoc, direccion, contacto, email, telefono: tel,
        pctComision: pct.trim() === "" ? null : Number(pct) / 100,
        aplicaRetencion: ret, pctRetencion: Number(pctRet) / 100 || 0,
        banco, tipoCuenta, numeroCuenta,
      });
      if (r.ok) {
        setNombre(""); setNit(""); setTipoDoc("NIT"); setDireccion(""); setContacto(""); setEmail(""); setTel("");
        setPct(""); setRet(true); setPctRet(""); setBanco(""); setTipoCuenta(""); setNumeroCuenta("");
      } else setErr(r.error);
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
          <div>
            <label className={lbl}>Tipo doc.</label>
            <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} className={sel}>
              <option value="NIT">NIT</option>
              <option value="CC">Cédula</option>
            </select>
          </div>
          <div><label className={lbl}>Número de documento</label><Input value={nit} onChange={(e) => setNit(e.target.value)} /></div>
          <div><label className={lbl}>Dirección</label><Input value={direccion} onChange={(e) => setDireccion(e.target.value)} /></div>
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
        <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Datos de pago (para la cuenta de cobro)</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div><label className={lbl}>Banco</label><Input value={banco} onChange={(e) => setBanco(e.target.value)} /></div>
          <div><label className={lbl}>Tipo de cuenta</label><Input value={tipoCuenta} onChange={(e) => setTipoCuenta(e.target.value)} placeholder="Ahorros / Corriente" /></div>
          <div><label className={lbl}>Número de cuenta</label><Input value={numeroCuenta} onChange={(e) => setNumeroCuenta(e.target.value)} /></div>
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
              <th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Documento</th>
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
  const [abierto, setAbierto] = useState(false);
  const [pending, start] = useTransition();
  const save = (patch: Parameters<typeof actualizarAliado>[1]) => start(() => { void actualizarAliado(a.id, patch); });
  return (
    <>
      <tr className="border-t border-gray-50">
        <td className="px-3 py-2">
          <button type="button" onClick={() => setAbierto((o) => !o)} className="mr-1 align-middle text-gray-400 hover:text-gray-600">
            {abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{a.tipo ?? "agencia"}</span>
        </td>
        <td className="px-3 py-2 text-gray-700">{a.nombre}</td>
        <td className="px-3 py-2 text-gray-500">{a.nit ? `${a.tipo_documento ?? "NIT"} ${a.nit}` : "—"}</td>
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
      {abierto && (
        <tr className="border-t border-gray-50 bg-gray-50/60">
          <td colSpan={7} className="px-4 py-3">
            <DatosPago a={a} />
          </td>
        </tr>
      )}
    </>
  );
}

// Dirección + cuenta bancaria del aliado, usados en el encabezado y en
// "Datos de pago" de la cuenta de cobro (/portal/comision/[numero]).
function DatosPago({ a }: { a: Aliado }) {
  const [tipoDoc, setTipoDoc] = useState(a.tipo_documento ?? "NIT");
  const [direccion, setDireccion] = useState(a.direccion ?? "");
  const [banco, setBanco] = useState(a.banco ?? "");
  const [tipoCuenta, setTipoCuenta] = useState(a.tipo_cuenta ?? "");
  const [numeroCuenta, setNumeroCuenta] = useState(a.numero_cuenta ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarAliado(a.id, { tipoDocumento: tipoDoc, direccion, banco, tipoCuenta, numeroCuenta });
      setMsg(r.ok ? "Guardado ✓" : r.error);
    });
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <div>
        <label className={lbl}>Tipo doc.</label>
        <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} className={sel}>
          <option value="NIT">NIT</option>
          <option value="CC">Cédula</option>
        </select>
      </div>
      <div><label className={lbl}>Dirección</label><Input value={direccion} onChange={(e) => setDireccion(e.target.value)} /></div>
      <div><label className={lbl}>Banco</label><Input value={banco} onChange={(e) => setBanco(e.target.value)} /></div>
      <div><label className={lbl}>Tipo de cuenta</label><Input value={tipoCuenta} onChange={(e) => setTipoCuenta(e.target.value)} placeholder="Ahorros / Corriente" /></div>
      <div><label className={lbl}>Número de cuenta</label><Input value={numeroCuenta} onChange={(e) => setNumeroCuenta(e.target.value)} /></div>
      <div className="col-span-2 flex items-end gap-2 md:col-span-5">
        <Button type="button" onClick={guardar} disabled={pending} className="h-9" style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "…" : "Guardar datos de pago"}
        </Button>
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>
    </div>
  );
}
