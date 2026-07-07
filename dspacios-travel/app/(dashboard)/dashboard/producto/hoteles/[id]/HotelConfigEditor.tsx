"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";
import { actualizarHotelConfig } from "../actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function HotelConfigEditor({
  hotelId, rangos, inicial, destinos = [],
}: {
  hotelId: number;
  rangos: RangoEdad[];
  destinos?: { id: number; nombre: string }[];
  inicial: {
    nombre: string;
    destinoId: number | null;
    zona: string;
    edadInfanteMin: number; edadInfanteMax: number;
    edadNinoMin: number; edadNinoMax: number;
    rangosEdad: number[];
    contactoTelefono: string;
    emailComercial: string;
    estrellas: number | null;
    clasificacion: string;
    descripcion: string;
    ubicacion: string;
    videoUrl: string;
    moneda: string;
    ninoNota: string;
    adultsOnly: boolean;
    petFriendly: boolean;
    petCostoNeto: number;
    petCostoDesc: string;
    petNota: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState(inicial.nombre);
  const [destinoId, setDestinoId] = useState<number | "">(inicial.destinoId ?? "");
  const [zona, setZona] = useState(inicial.zona);
  const [moneda, setMoneda] = useState<"COP" | "USD">(inicial.moneda === "USD" ? "USD" : "COP");
  const [contactoTel, setContactoTel] = useState(inicial.contactoTelefono);
  const [emailCom, setEmailCom] = useState(inicial.emailComercial);
  const [estrellas, setEstrellas] = useState(String(inicial.estrellas ?? 0));
  const [clasificacion, setClasificacion] = useState(inicial.clasificacion);
  const [descripcion, setDescripcion] = useState(inicial.descripcion);
  const [ubicacion, setUbicacion] = useState(inicial.ubicacion);
  const [videoUrl, setVideoUrl] = useState(inicial.videoUrl);
  const [infMin, setInfMin] = useState(String(inicial.edadInfanteMin));
  const [infMax, setInfMax] = useState(String(inicial.edadInfanteMax));
  const [ninoMin, setNinoMin] = useState(String(inicial.edadNinoMin));
  const [ninoMax, setNinoMax] = useState(String(inicial.edadNinoMax));
  const [ninoNota, setNinoNota] = useState(inicial.ninoNota);
  const [adultsOnly, setAdultsOnly] = useState(inicial.adultsOnly);
  const [petFriendly, setPetFriendly] = useState(inicial.petFriendly);
  const [petCostoNeto, setPetCostoNeto] = useState(String(inicial.petCostoNeto || ""));
  const [petCostoDesc, setPetCostoDesc] = useState(inicial.petCostoDesc);
  const [petNota, setPetNota] = useState(inicial.petNota);
  const [rangosSel, setRangosSel] = useState<number[]>(inicial.rangosEdad);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarHotelConfig(hotelId, {
        nombre,
        destinoId: destinoId === "" ? null : Number(destinoId),
        zona,
        edadInfanteMin: Number(infMin) || 0, edadInfanteMax: Number(infMax) || 0,
        edadNinoMin: Number(ninoMin) || 0, edadNinoMax: Number(ninoMax) || 0,
        rangosEdad: rangosSel,
        contactoTelefono: contactoTel, emailComercial: emailCom,
        estrellas: Number(estrellas) || null, clasificacion, descripcion, ubicacion, videoUrl, moneda,
        ninoNota, adultsOnly,
        petFriendly,
        petCostoNeto: petFriendly ? (Number(petCostoNeto) || 0) : 0,
        petCostoDesc: petFriendly ? petCostoDesc : "",
        petNota: petFriendly ? petNota : "",
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
          <div>
            <label className={lbl}>Nombre del hotel <span className="font-normal text-gray-400">(si te equivocaste, corrígelo aquí)</span></label>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del hotel" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={lbl}>Destino <span className="font-normal text-gray-400">(si lo asignaste mal, cámbialo aquí)</span></label>
              <select value={destinoId} onChange={(e) => setDestinoId(e.target.value === "" ? "" : Number(e.target.value))} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">— Elige un destino —</option>
                {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre?.toUpperCase()}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Zona</label><Input value={zona} onChange={(e) => setZona(e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={adultsOnly} onChange={(e) => setAdultsOnly(e.target.checked)} />
            Adults Only — este hotel NO acepta niños ni infantes
          </label>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label className={lbl}>Infante mín.</label><Input type="number" value={infMin} onChange={(e) => setInfMin(e.target.value)} disabled={adultsOnly} /></div>
            <div><label className={lbl}>Infante máx.</label><Input type="number" value={infMax} onChange={(e) => setInfMax(e.target.value)} disabled={adultsOnly} /></div>
            <div><label className={lbl}>Niño mín.</label><Input type="number" value={ninoMin} onChange={(e) => setNinoMin(e.target.value)} disabled={adultsOnly} /></div>
            <div><label className={lbl}>Niño máx.</label><Input type="number" value={ninoMax} onChange={(e) => setNinoMax(e.target.value)} disabled={adultsOnly} /></div>
          </div>

          <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
            La tarifa de infante (precio por noche y su nota especial) ya no se configura
            aquí: vive junto a la tarifa neta del hotel (Niño 1 / Niño 2 / Infante), más
            abajo en <b>Tarifa neta</b>, porque puede cambiar según la temporada.
          </p>
          <div>
            <label className={lbl}>Nota sobre niños</label>
            <textarea value={ninoNota} onChange={(e) => setNinoNota(e.target.value)} rows={2}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="Ej. Debe pagar seguro hotelero obligatorio en el hotel." />
          </div>

          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
            <label className="mb-3 flex items-center gap-2 text-xs font-semibold text-sky-800">
              <input type="checkbox" checked={petFriendly} onChange={(e) => setPetFriendly(e.target.checked)} />
              Pet friendly — este hotel acepta mascotas
              <span className="font-normal text-sky-700">(tarifa y notas; 0 = gratis)</span>
            </label>
            {petFriendly && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={lbl}>Cargo neto por mascota / noche</label>
                    <Input type="number" min={0} value={petCostoNeto} onChange={(e) => setPetCostoNeto(e.target.value)} placeholder="0" />
                    <p className="mt-1 text-[11px] text-gray-500">0 = gratis. Si tiene costo, se cobra por mascota × noches de la estadía, con el mismo % de markup del paquete.</p>
                  </div>
                  <div>
                    <label className={lbl}>Descripción del cargo</label>
                    <Input value={petCostoDesc} onChange={(e) => setPetCostoDesc(e.target.value)} placeholder="Ej. Aseo adicional por mascota" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className={lbl}>Nota sobre mascotas</label>
                  <textarea value={petNota} onChange={(e) => setPetNota(e.target.value)} rows={2}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    placeholder="Ej. Máximo 1 mascota por habitación, peso máximo 10kg." />
                </div>
              </>
            )}
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
            <div>
              <label className={lbl}>Moneda de las tarifas</label>
              <select value={moneda} onChange={(e) => setMoneda(e.target.value as "COP" | "USD")} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="COP">COP — pesos</option>
                <option value="USD">USD — dólares</option>
              </select>
            </div>
          </div>
          <div>
            <label className={lbl}>Descripción del hotel <span className="font-normal text-gray-400">(se muestra en el tarifario)</span></label>
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="Ubicación, atractivos, qué lo hace especial…" />
          </div>
          <div>
            <label className={lbl}>Ubicación para el mapa <span className="font-normal text-gray-400">(dirección o coordenadas lat,lng)</span></label>
            <Input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Ej. Carrera 1 #2-34, El Rodadero, Santa Marta  ·  o  11.2026,-74.2253" />
          </div>
          <div>
            <label className={lbl}>Video del hotel <span className="font-normal text-gray-400">(URL de YouTube, se muestra en su ficha)</span></label>
            <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtu.be/…" />
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
