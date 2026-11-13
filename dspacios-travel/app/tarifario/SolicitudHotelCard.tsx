"use client";

import { useEffect, useState, useTransition } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { CarruselFotoHotel } from "./CarruselFotoHotel";
import { Categoria } from "./tarjetaHotelCompartida";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/DateInput";
import { useEscapeCerrar } from "@/components/ui/useEscapeCerrar";
import { TEXTO_BAJO_SOLICITUD } from "@/lib/reservar/solicitudHotel";
import type { HotelBajoSolicitud } from "@/lib/tarifario/datosSolicitud";
import { crearSolicitudHotel, validarOcupacionSolicitud, type OcupacionSolicitudResult, type SolicitudHotelResult } from "./solicitudHotelActions";

// #120 · Tarjeta de un hotel SIN tarifa publicada. Nunca muestra precio ni «desde»; no se agrega al carrito (los hoteles tarifados siguen su camino de siempre):
// el cliente envía una solicitud que crea su propia cotización pendiente de tarifa.

const TIPOS_HAB = [["sencilla", "Sencilla"], ["doble", "Doble"], ["triple", "Triple"], ["multiple", "Múltiple"]] as const;

export function SolicitudHotelCard({ hotel }: { hotel: HotelBajoSolicitud }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" data-testid={`solicitud-hotel-${hotel.hotelId}`}>
      {/* Mismo carrusel y proporción (16:10) que la tarjeta de un hotel con tarifa: se ve la foto completa y se pasa entre las fotos cargadas del hotel. */}
      <CarruselFotoHotel fotos={hotel.fotos} alt={hotel.hotelNombre}>
        <span className="absolute left-2 top-2 z-10 max-w-[70%] truncate rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-primary)]">{hotel.paqueteNombre}</span>
      </CarruselFotoHotel>
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900">{hotel.hotelNombre}</h3>
          <Categoria estrellas={hotel.estrellas} clasificacion={null} className="text-sm" />
        </div>
        {hotel.destinoNombre && <p className="text-xs text-gray-500">{hotel.destinoNombre}</p>}
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{TEXTO_BAJO_SOLICITUD}</p>
        <Button type="button" className="w-full" onClick={() => setAbierto(true)}>Solicitar cotización</Button>
      </div>
      {abierto && <FormularioSolicitud hotel={hotel} onClose={() => setAbierto(false)} />}
    </div>
  );
}

function FormularioSolicitud({ hotel, onClose }: { hotel: HotelBajoSolicitud; onClose: () => void }) {
  const [pendiente, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Extract<SolicitudHotelResult, { ok: true }> | null>(null);
  const [salida, setSalida] = useState(hotel.salidas.length === 1 ? "0" : "");
  // Las fechas de una porción terrestre se escriben siempre a mano (sin valor por defecto silencioso).
  const [ida, setIda] = useState("");
  const [regreso, setRegreso] = useState("");
  const [hab, setHab] = useState<Record<string, number>>({ sencilla: 0, doble: 1, triple: 0, multiple: 0 });
  // «¿Viajan menores?» se responde primero; las edades solo existen (y solo se envían) si la respuesta es sí. Un hotel Adults Only no admite menores: no se pregunta.
  const [menores, setMenores] = useState<"" | "si" | "no">(hotel.adultsOnly ? "no" : "");
  const [edades, setEdades] = useState("");
  // Adultos que viajan de verdad (opcional): solo cambia algo si un niño ocupa la plaza libre de una habitación (p. ej. doble con 1 adulto + 1 niño = 2 viajeros).
  const [adultos, setAdultos] = useState("");
  const adultosNum = menores === "si" && adultos.trim() ? Number(adultos) : null;
  const edadesParsed = menores === "si" ? edades.split(/[,\s]+/).filter(Boolean).map(Number) : [];
  function responderMenores(v: "si" | "no") {
    setMenores(v);
    if (v === "no") { setEdades(""); setAdultos(""); } // nunca queda una edad vieja oculta
  }
  const [categoria, setCategoria] = useState("");
  const [regimen, setRegimen] = useState("");
  const [notas, setNotas] = useState("");
  const [cli, setCli] = useState({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "" });

  function enviar() {
    setError(null);
    const s = hotel.tipo === "bloqueo" ? hotel.salidas[Number(salida)] : null;
    if (hotel.tipo === "bloqueo" && !s) { setError("Elige la salida."); return; }
    if (!menores) { setError("Indica si viajan menores."); return; }
    const edadesMenores = edadesParsed;
    start(async () => {
      const r = await crearSolicitudHotel({
        paqueteId: hotel.paqueteId, hotelId: hotel.hotelId, bloqueoId: s?.bloqueoId ?? null, empaquetadoId: s?.empaquetadoId ?? null,
        fechaIda: s?.fechaIda ?? ida, fechaRegreso: s?.fechaRegreso ?? regreso, categoria, regimen, habitaciones: hab, viajanMenores: menores === "si", edadesMenores, adultos: adultosNum, cliente: cli, notas,
      });
      if (r.ok) setRes(r); else setError(r.error);
    });
  }

  // Aviso ANTES de enviar: ¿la acomodación elegida admite a los niños/infantes declarados? (mismas reglas del motor; el servidor lo vuelve a exigir al enviar).
  const [ocupacion, setOcupacion] = useState<OcupacionSolicitudResult | null>(null);
  const claveOcupacion = JSON.stringify([hab, edadesParsed, adultosNum]);
  useEffect(() => {
    if (edadesParsed.some((e) => !Number.isInteger(e) || e < 0 || e > 17)) { setOcupacion({ ok: false, error: "Las edades de los menores deben ser números entre 0 y 17." }); return; }
    if (Object.values(hab).every((n) => n === 0)) { setOcupacion(null); return; }
    let vigente = true;
    const t = setTimeout(async () => {
      try { const r = await validarOcupacionSolicitud({ paqueteId: hotel.paqueteId, hotelId: hotel.hotelId, habitaciones: hab, edadesMenores: edadesParsed, adultos: adultosNum }); if (vigente) setOcupacion(r); }
      catch { if (vigente) setOcupacion(null); }
    }, 400);
    return () => { vigente = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveOcupacion, hotel.paqueteId, hotel.hotelId]);

  // Escape cierra el formulario como la X (accesibilidad de teclado); no mientras se envía la solicitud.
  useEscapeCerrar(true, onClose, pendiente);

  const campo = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Solicitar cotización de ${hotel.hotelNombre}`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{hotel.hotelNombre}</h3>
            <p className="text-sm text-amber-800">{TEXTO_BAJO_SOLICITUD}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        {res ? (
          <div className="space-y-3 text-sm" data-testid="solicitud-enviada">
            <p className="rounded-lg bg-green-50 px-3 py-2 font-medium text-green-800">Solicitud {res.codigo} registrada{res.repetida ? " (ya existía una igual)" : ""}. Un asesor confirmará disponibilidad y tarifa.</p>
            <div className="flex flex-wrap gap-2">
              {res.waUrl && <a href={res.waUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-success)] px-3 py-2 font-medium text-white"><MessageCircle className="h-4 w-4" aria-hidden="true" /> Contactar por WhatsApp</a>}
              {res.mailtoUrl && <a href={res.mailtoUrl} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 font-medium text-gray-700"><Send className="h-4 w-4" aria-hidden="true" /> Enviar por correo</a>}
              {res.url && <a href={res.url} className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 font-medium text-gray-700">Ver mi solicitud</a>}
            </div>
          </div>
        ) : (
          <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
            {hotel.tipo === "bloqueo" ? (
              <label className="block"><span className="text-gray-600">Salida</span>
                <select className={campo} value={salida} onChange={(e) => setSalida(e.target.value)} required>
                  <option value="">Elige la salida</option>
                  {hotel.salidas.map((s, i) => <option key={`${s.bloqueoId ?? "e"}-${s.empaquetadoId ?? "b"}`} value={String(i)}>{(s.ruta ?? "Vuelo")} · {s.fechaIda} al {s.fechaRegreso}</option>)}
                </select>
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="text-gray-600">Ida</span><DateInput aria-label="Ida" type="date" value={ida} min={hotel.viaje?.inicio ?? undefined} max={hotel.viaje?.fin ?? undefined} onValueChange={setIda} required /></label>
                <label className="block"><span className="text-gray-600">Regreso</span><DateInput aria-label="Regreso" type="date" value={regreso} min={ida || (hotel.viaje?.inicio ?? undefined)} max={hotel.viaje?.fin ?? undefined} onValueChange={setRegreso} required /></label>
              </div>
            )}
            <fieldset><legend className="text-gray-600">Habitaciones</legend>
              <div className="mt-1 grid grid-cols-4 gap-2">
                {TIPOS_HAB.map(([k, rot]) => (
                  <label key={k} className="block text-center text-xs text-gray-500">{rot}
                    <Input type="number" min={0} max={10} value={hab[k]} onChange={(e) => setHab({ ...hab, [k]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />
                  </label>
                ))}
              </div>
            </fieldset>
            {!hotel.adultsOnly && (
              <fieldset data-testid="solicitud-menores"><legend className="text-gray-600">¿Viajan menores?</legend>
                <div className="mt-1 flex gap-4">
                  {([["si", "Sí"], ["no", "No"]] as const).map(([v, rot]) => (
                    <label key={v} className="inline-flex items-center gap-1.5"><input type="radio" name="viajan-menores" value={v} checked={menores === v} onChange={() => responderMenores(v)} required /> {rot}</label>
                  ))}
                </div>
              </fieldset>
            )}
            {menores === "si" && <label className="block"><span className="text-gray-600">Edades de los menores (separadas por coma)</span><Input value={edades} onChange={(e) => setEdades(e.target.value)} placeholder="3, 7" required data-testid="solicitud-edades" /></label>}
            {menores === "si" && edadesParsed.length > 0 && (
              <label className="block"><span className="text-gray-600">Adultos que viajan (opcional)</span>
                <Input type="number" min={1} max={40} inputMode="numeric" value={adultos} onChange={(e) => setAdultos(e.target.value)} placeholder="Los de las habitaciones" data-testid="solicitud-adultos" />
                <span className="mt-1 block text-xs text-gray-500">Si una habitación para 2 la ocupan 1 adulto y 1 niño, escribe 1: viajan 2 personas, no 3.</span>
              </label>
            )}
            {ocupacion && !ocupacion.ok && (
              <p role="alert" data-testid="aviso-ocupacion" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {ocupacion.error} Ajusta las habitaciones o las edades antes de enviar.
              </p>
            )}
            {ocupacion?.ok && ocupacion.ninos + ocupacion.infantes > 0 && (
              <p role="status" data-testid="aviso-ocupacion" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                La acomodación admite a tu grupo: {ocupacion.adultos} adulto(s), {ocupacion.ninos} niño(s) y {ocupacion.infantes} infante(s).
              </p>
            )}
            {/* Solo lo configurado para ESTE hotel (hotel_categorias / hotel_regimenes); sin configuración no hay selector ni texto libre: el asesor lo confirma. */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block"><span className="text-gray-600">Tipo de habitación (opcional)</span>
                {hotel.categorias.length ? (
                  <select className={campo} value={categoria} onChange={(e) => setCategoria(e.target.value)} data-testid="solicitud-categoria">
                    <option value="">A confirmar</option>
                    {hotel.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : <p className="mt-1 text-xs text-gray-500" data-testid="solicitud-sin-categorias">Este hotel no tiene tipos de habitación configurados: se confirman con el asesor.</p>}
              </label>
              <label className="block"><span className="text-gray-600">Plan de alimentación (opcional)</span>
                {hotel.regimenes.length ? (
                  <select className={campo} value={regimen} onChange={(e) => setRegimen(e.target.value)} data-testid="solicitud-regimen">
                    <option value="">A confirmar</option>
                    {hotel.regimenes.map((r) => <option key={r.codigo} value={r.codigo}>{r.nombre === r.codigo ? r.codigo : `${r.codigo} · ${r.nombre}`}</option>)}
                  </select>
                ) : <p className="mt-1 text-xs text-gray-500" data-testid="solicitud-sin-regimenes">Este hotel no tiene planes de alimentación configurados: se confirman con el asesor.</p>}
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-gray-600">Nombres</span><Input value={cli.nombres} onChange={(e) => setCli({ ...cli, nombres: e.target.value })} required /></label>
              <label className="block"><span className="text-gray-600">Apellidos</span><Input value={cli.apellidos} onChange={(e) => setCli({ ...cli, apellidos: e.target.value })} required /></label>
              <label className="block"><span className="text-gray-600">Tipo de documento</span>
                <select className={campo} value={cli.tipoDoc} onChange={(e) => setCli({ ...cli, tipoDoc: e.target.value })}>{["CC", "CE", "TI", "PAS", "NIT"].map((t) => <option key={t}>{t}</option>)}</select>
              </label>
              <label className="block"><span className="text-gray-600">Número de documento</span><Input value={cli.numeroDoc} onChange={(e) => setCli({ ...cli, numeroDoc: e.target.value })} required /></label>
              <label className="block"><span className="text-gray-600">WhatsApp / teléfono</span><Input value={cli.telefono} onChange={(e) => setCli({ ...cli, telefono: e.target.value })} required /></label>
              <label className="block"><span className="text-gray-600">Correo (opcional)</span><Input type="email" value={cli.email} onChange={(e) => setCli({ ...cli, email: e.target.value })} /></label>
            </div>
            <label className="block"><span className="text-gray-600">Notas (opcional)</span><textarea className={campo} rows={2} maxLength={500} value={notas} onChange={(e) => setNotas(e.target.value)} /></label>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={pendiente || (ocupacion != null && !ocupacion.ok)}>{pendiente ? "Enviando…" : "Enviar solicitud"}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
