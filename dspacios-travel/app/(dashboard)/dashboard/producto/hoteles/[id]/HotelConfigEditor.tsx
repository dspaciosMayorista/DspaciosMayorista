"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";
import { actualizarHotelConfig } from "../actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function HotelConfigEditor({
  hotelId, rangos, inicial,
}: {
  hotelId: number;
  rangos: RangoEdad[];
  inicial: {
    zona: string;
    edadInfanteMin: number; edadInfanteMax: number;
    edadNinoMin: number; edadNinoMax: number;
    rangosEdad: number[];
    contactoTelefono: string;
    emailComercial: string;
    estrellas: number | null;
    clasificacion: string;
    descripcion: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [zona, setZona] = useState(inicial.zona);
  const [contactoTel, setContactoTel] = useState(inicial.contactoTelefono);
  const [emailCom, setEmailCom] = useState(inicial.emailComercial);
  const [estrellas, setEstrellas] = useState(String(inicial.estrellas ?? 0));
  const [clasificacion, setClasificacion] = useState(inicial.clasificacion);
  const [descripcion, setDescripcion] = useState(inicial.descripcion);
  const [infMin, setInfMin] = useState(String(inicial.edadInfanteMin));
  const [infMax, setInfMax] = useState(String(inicial.edadInfanteMax));
  const [ninoMin, setNinoMin] = useState(String(inicial.edadNinoMin));
  const [ninoMax, setNinoMax] = useState(String(inicial.edadNinoMax));
  const [rangosSel, setRangosSel] = useState<number[]>(inicial.rangosEdad);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarHotelConfig(hotelId, {
        zona,
        edadInfanteMin: Number(infMin) || 0, edadInfanteMax: Number(infMax) || 0,
        edadNinoMin: Number(ninoMin) || 0, edadNinoMax: Number(ninoMax) || 0,
        rangosEdad: rangosSel,
        contactoTelefono: contactoTel, emailComercial: emailCom,
        estrellas: Number(estrellas) || null, clasificacion, descripcion,
      });
      if (r.ok) { setMsg("Guardado."); router.refresh(); } else setMsg(r.error);
    });
  }

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">Configuración del hotel (edades y rangos)</span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="col-span-2 sm:col-span-1"><label className={lbl}>Zona</label><Input value={zona} onChange={(e) => setZona(e.target.value)} /></div>
            <div><label className={lbl}>Infante mín.</label><Input type="number" value={infMin} onChange={(e) => setInfMin(e.target.value)} /></div>
            <div><label className={lbl}>Infante máx.</label><Input type="number" value={infMax} onChange={(e) => setInfMax(e.target.value)} /></div>
            <div><label className={lbl}>Niño mín.</label><Input type="number" value={ninoMin} onChange={(e) => setNinoMin(e.target.value)} /></div>
            <div><label className={lbl}>Niño máx.</label><Input type="number" value={ninoMax} onChange={(e) => setNinoMax(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className={lbl}>Teléfono de contacto (reservas)</label><Input value={contactoTel} onChange={(e) => setContactoTel(e.target.value)} placeholder="+57 ..." /></div>
            <div><label className={lbl}>Correo comercial (solicitudes)</label><Input type="email" value={emailCom} onChange={(e) => setEmailCom(e.target.value)} placeholder="reservas@hotel.com" /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={lbl}>Estrellas</label>
              <select value={estrellas} onChange={(e) => setEstrellas(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="0">Sin estrellas</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {n === 1 ? "estrella" : "estrellas"}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Clasificación <span className="font-normal text-gray-400">(si no usa estrellas)</span></label>
              <Input value={clasificacion} onChange={(e) => setClasificacion(e.target.value)} placeholder="Boutique, Luxury, Villa…" />
            </div>
          </div>
          <div>
            <label className={lbl}>Descripción del hotel <span className="font-normal text-gray-400">(se muestra en el tarifario)</span></label>
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="Ubicación, atractivos, qué lo hace especial…" />
          </div>
          <RangosEdadPicker rangos={rangos} seleccionados={rangosSel} onChange={setRangosSel} />
          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
              {pending ? "Guardando…" : "Guardar configuración"}
            </Button>
            {msg && <span className="text-sm text-gray-600">{msg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
