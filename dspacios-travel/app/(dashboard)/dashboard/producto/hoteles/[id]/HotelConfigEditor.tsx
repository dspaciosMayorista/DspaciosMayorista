"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";
import { ComboDestino } from "@/components/ComboDestino";
import { ComboProveedor, type ProveedorOpt } from "@/components/ComboProveedor";
import { actualizarHotelConfig } from "../actions";
import { validarEdadesGeneralesHotel } from "@/lib/calc/reglaEdadTarifa";
import { HotelBajoSolicitudControl } from "./HotelBajoSolicitudControl";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function HotelConfigEditor({
  hotelId, rangos, inicial, destinos = [], proveedores = [],
}: {
  hotelId: number;
  rangos: RangoEdad[];
  destinos?: { id: number; nombre: string }[];
  proveedores?: ProveedorOpt[];
  inicial: {
    nombre: string;
    destinoId: number | null;
    proveedorId: number | null;
    zona: string;
    edadInfanteMin?: number | null; edadInfanteMax: number | null;
    edadNinoMin?: number | null; edadNinoMax: number | null;
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
    tarifaBajoSolicitud?: boolean;
    esUnidad?: boolean;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState(inicial.nombre);
  const [destinoId, setDestinoId] = useState<number | "">(inicial.destinoId ?? "");
  const [proveedorId, setProveedorId] = useState<number | "">(inicial.proveedorId ?? "");
  const [zona, setZona] = useState(inicial.zona);
  const [moneda, setMoneda] = useState<"COP" | "USD">(inicial.moneda === "USD" ? "USD" : "COP");
  const [contactoTel, setContactoTel] = useState(inicial.contactoTelefono);
  const [emailCom, setEmailCom] = useState(inicial.emailComercial);
  const [estrellas, setEstrellas] = useState(String(inicial.estrellas ?? 0));
  const [clasificacion, setClasificacion] = useState(inicial.clasificacion);
  const [descripcion, setDescripcion] = useState(inicial.descripcion);
  const [ubicacion, setUbicacion] = useState(inicial.ubicacion);
  const [videoUrl, setVideoUrl] = useState(inicial.videoUrl);
  // O3: sin valores por defecto — un campo vacío es «sin configurar» (nunca 0); el servidor exige «Infante hasta» y «Niño hasta» salvo Adults Only.
  const [infMax, setInfMax] = useState(inicial.edadInfanteMax == null ? "" : String(inicial.edadInfanteMax));
  const [ninoMax, setNinoMax] = useState(inicial.edadNinoMax == null ? "" : String(inicial.edadNinoMax));
  // Estado GUARDADO del hotel (lo que hoy usan cotizar y publicar) y estado de lo que se está escribiendo.
  const guardado = validarEdadesGeneralesHotel({ infanteMax: inicial.edadInfanteMax, ninoMax: inicial.edadNinoMax });
  const escrito = validarEdadesGeneralesHotel({ infanteMax: infMax.trim() === "" ? null : Number(infMax), ninoMax: ninoMax.trim() === "" ? null : Number(ninoMax) });
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
        proveedorId: proveedorId === "" ? null : Number(proveedorId),
        zona,
        edadInfanteMax: infMax.trim() === "" ? null : Number(infMax), edadNinoMax: ninoMax.trim() === "" ? null : Number(ninoMax),
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
      {/* O3: advertencia siempre visible (aunque el panel esté cerrado) cuando el hotel acepta menores y su configuración guardada falta o es inválida. */}
      {!inicial.adultsOnly && !guardado.ok && (
        <div className="m-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert" data-testid="aviso-config-edades">
          <p className="font-semibold">Configuración de edades incompleta: este hotel no se puede cotizar con menores ni publicar.</p>
          <p className="mt-0.5">
            {guardado.faltantes.length > 0 && <>Falta: {guardado.faltantes.map((x) => `«${x}»`).join(", ")}. </>}
            {guardado.invalidos.length > 0 && <>Valor no válido: {guardado.invalidos.join("; ")}. </>}
            Ábrela aquí abajo y complétala; si el hotel no admite menores, márcalo como Adults Only. Las cotizaciones solo con adultos siguen funcionando y los contratos existentes no cambian.
          </p>
        </div>
      )}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={lbl}>Destino <span className="font-normal text-gray-400">(si lo asignaste mal, cámbialo aquí)</span></label>
              <ComboDestino destinos={destinos} value={destinoId} onChange={setDestinoId} placeholder="Selecciona destino…" />
            </div>
            <div>
              <label className={lbl}>Proveedor hotelero</label>
              <ComboProveedor proveedores={proveedores ?? []} value={proveedorId} onChange={setProveedorId} placeholder="Selecciona proveedor…" />
            </div>
            <div><label className={lbl}>Zona</label><Input value={zona} onChange={(e) => setZona(e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={adultsOnly} onChange={(e) => setAdultsOnly(e.target.checked)} />
            Adults Only — este hotel NO acepta niños ni infantes
          </label>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label className={lbl}>Infante hasta (edad) {!adultsOnly && "*"}</label><Input type="number" min={0} max={17} value={infMax} onChange={(e) => setInfMax(e.target.value)} disabled={adultsOnly} placeholder="Obligatorio" data-testid="cfg-inf-max" /></div>
            <div><label className={lbl}>Niño hasta (edad) {!adultsOnly && "*"}</label><Input type="number" min={0} max={17} value={ninoMax} onChange={(e) => setNinoMax(e.target.value)} disabled={adultsOnly} placeholder="Obligatorio" data-testid="cfg-nino-max" /></div>
            <p className="text-xs text-gray-500 sm:col-span-2 sm:self-end">
              {adultsOnly ? "Adults Only: no admite menores, no necesita edades."
                : escrito.ok ? `Infante: 0 a ${escrito.regla.infanteMax} años · Niño: ${escrito.regla.ninoMin} a ${escrito.regla.ninoMax} años · desde los ${escrito.regla.ninoMax + 1} se cuenta como adulto.`
                : `Pendiente: ${[...escrito.faltantes.map((x) => `falta «${x}»`), ...escrito.invalidos].join("; ")}.`}
            </p>
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

          <HotelBajoSolicitudControl hotelId={hotelId} inicial={inicial.tarifaBajoSolicitud ?? false} esUnidad={inicial.esUnidad ?? false} />

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
