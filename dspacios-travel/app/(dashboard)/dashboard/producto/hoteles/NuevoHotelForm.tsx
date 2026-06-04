"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearHotel } from "./actions";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";

type Opt = { id: number; nombre: string };
type Regimen = { id: number; codigo: string; nombre: string };

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const card = "rounded-xl border border-gray-200 bg-white p-5 space-y-4";
const selCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function NuevoHotelForm({
  destinos, proveedores, categorias, regimenes, rangos = [],
}: { destinos: Opt[]; proveedores: Opt[]; categorias: Opt[]; regimenes: Regimen[]; rangos?: RangoEdad[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const [nombre, setNombre] = useState("");
  const [destinoId, setDestinoId] = useState<number | "">("");
  const [proveedorId, setProveedorId] = useState<number | "">("");
  const [zona, setZona] = useState("");
  const [infMin, setInfMin] = useState(0);
  const [infMax, setInfMax] = useState(2);
  const [ninoMin, setNinoMin] = useState(2);
  const [ninoMax, setNinoMax] = useState(10);
  const [catSel, setCatSel] = useState<number[]>([]);
  const [regSel, setRegSel] = useState<number[]>([]);
  const [rangosSel, setRangosSel] = useState<number[]>([]);
  const [contactoTel, setContactoTel] = useState("");
  const [emailCom, setEmailCom] = useState("");

  const toggle = (arr: number[], set: (v: number[]) => void, id: number) =>
    set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || !destinoId) { setErr("Nombre y destino son obligatorios."); return; }
    setErr("");
    start(async () => {
      const r = await crearHotel({
        nombre, destinoId: Number(destinoId), proveedorId: proveedorId === "" ? null : Number(proveedorId),
        zona, edadInfanteMin: infMin, edadInfanteMax: infMax, edadNinoMin: ninoMin, edadNinoMax: ninoMax,
        categoriaIds: catSel, regimenIds: regSel, rangosEdad: rangosSel,
        contactoTelefono: contactoTel, emailComercial: emailCom,
      });
      if (r.ok) router.push(`/dashboard/producto/hoteles/${r.id}`);
      else setErr(r.error);
    });
  }

  return (
    <form onSubmit={guardar} className="space-y-5">
      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Datos del hotel</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div><label className={lbl}>Nombre del hotel *</label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="GHL Corales de Indias" /></div>
          <div><label className={lbl}>Zona / ubicación</label><Input value={zona} onChange={(e) => setZona(e.target.value)} placeholder="Crespo" /></div>
          <div>
            <label className={lbl}>Destino *</label>
            <select value={destinoId} onChange={(e) => setDestinoId(Number(e.target.value) || "")} className={selCls}>
              <option value="">Selecciona destino</option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Proveedor hotelero</label>
            <select value={proveedorId} onChange={(e) => setProveedorId(Number(e.target.value) || "")} className={selCls}>
              <option value="">— (sin asignar)</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Teléfono de contacto (reservas del hotel)</label><Input value={contactoTel} onChange={(e) => setContactoTel(e.target.value)} placeholder="+57 ..." /></div>
          <div><label className={lbl}>Correo comercial (solicitudes de reserva)</label><Input type="email" value={emailCom} onChange={(e) => setEmailCom(e.target.value)} placeholder="reservas@hotel.com" /></div>
        </div>
        <p className="text-xs text-gray-400">El contacto es del hotel (no del proveedor): a este correo se enviarán las solicitudes de reserva.</p>
      </section>

      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Edades (este hotel)</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><label className={lbl}>Infante desde</label><Input type="number" min={0} value={infMin} onChange={(e) => setInfMin(Number(e.target.value))} /></div>
          <div><label className={lbl}>Infante hasta</label><Input type="number" min={0} value={infMax} onChange={(e) => setInfMax(Number(e.target.value))} /></div>
          <div><label className={lbl}>Niño desde</label><Input type="number" min={0} value={ninoMin} onChange={(e) => setNinoMin(Number(e.target.value))} /></div>
          <div><label className={lbl}>Niño hasta</label><Input type="number" min={0} value={ninoMax} onChange={(e) => setNinoMax(Number(e.target.value))} /></div>
        </div>
        <p className="text-xs text-gray-400">La tarifa de infante siempre es $0.</p>
      </section>

      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>¿Qué aplica a este hotel?</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className={lbl}>Categorías de habitación</p>
            {categorias.length === 0 ? (
              <p className="text-xs text-amber-600">No hay categorías. Créalas en Configuración general.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categorias.map((c) => (
                  <button key={c.id} type="button" onClick={() => toggle(catSel, setCatSel, c.id)}
                    className={`rounded-full border px-3 py-1 text-xs ${catSel.includes(c.id) ? "border-[#1D7C9A] bg-[#1D7C9A] text-white" : "border-gray-300 text-gray-600"}`}>
                    {c.nombre}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className={lbl}>Régimen de alimentación</p>
            {regimenes.length === 0 ? (
              <p className="text-xs text-amber-600">No hay regímenes. Créalos en Configuración general.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {regimenes.map((r) => (
                  <button key={r.id} type="button" onClick={() => toggle(regSel, setRegSel, r.id)}
                    className={`rounded-full border px-3 py-1 text-xs ${regSel.includes(r.id) ? "border-[#1D7C9A] bg-[#1D7C9A] text-white" : "border-gray-300 text-gray-600"}`}>
                    {r.codigo}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <RangosEdadPicker rangos={rangos} seleccionados={rangosSel} onChange={setRangosSel} label="Rangos de edad del hotel (infante/niño)" />
      </section>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
        {pending ? "Creando…" : "Crear hotel y cargar tarifas"}
      </Button>
    </form>
  );
}
