"use client";
// Checkout del paquete dinámico (#82): continuación de la tarjeta (hotel, habitaciones, vuelo y precio ya elegidos).
// Aquí SOLO se capturan los datos del cliente, con las mismas piezas del checkout habitual:
//  · sesión interna → número de documento + «Buscar» (BuscarTitular, la búsqueda de personas por documento existente);
//  · aliado B2B → datos del titular del contrato; · visitante → «Tus datos».
// El canal (interno, B2B o B2C) lo resuelve el SERVIDOR por la sesión al crear la cotización; el navegador no lo manda.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BedDouble, Hotel, Plane, Sparkles, Users, Utensils } from "lucide-react";
import type { VueloDetalle } from "@/lib/paqueteDinamico/publico";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/DateInput";
import { BuscarTitular } from "@/components/personas/BuscarTitular";
import { TIPOS_DOC_PERSONA } from "@/lib/personas/identidad";
import { formatMoneda } from "@/lib/utils";
import { contactoVisitanteValido, type CanalDin } from "@/lib/paqueteDinamico/solicitud";
import type { CrearCotizacionDinInput } from "@/app/(dashboard)/dashboard/cotizaciones/din-actions";

/** La Server Action la pasa la página (servidor): este componente cliente no importa código de servidor. */
export type CrearCotizacionDinFn = (input: CrearCotizacionDinInput) => Promise<
  | { ok: true; id: number; destino: "dashboard" | "portal" | "publico"; enlace: string; avisoPersonas?: string }
  | { ok: false; error: string }
>;

export type ResumenDin = {
  paquete: string; destino: string; noches: number; moneda: string;
  hotel: { nombre: string; categoria: string; regimen: string } | null;
  habitaciones: string; viajeros: string;
  vuelo: { etiqueta: string; detalle: VueloDetalle | null } | null;
  servicios: string[];
  fechaIda: string; fechaRegreso: string; total: number; lineas: { descripcion: string; valor: number }[];
  /** Vuelve a la tarjeta con la selección guardada. */
  volver: string;
};

const inp = "h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm";
const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function CheckoutDinamico({ resumen, solicitud, canal, aliado, crear }: {
  resumen: ResumenDin; solicitud: Omit<CrearCotizacionDinInput, "cliente">; canal: CanalDin; aliado: string | null; crear: CrearCotizacionDinFn;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [c, setC] = useState({ nombres: "", apellidos: "", tipoDoc: "", numeroDoc: "", nacimiento: "", telefono: "", email: "" });
  const interno = canal === "interno";
  const listo = interno
    ? c.nombres.trim() && c.apellidos.trim() && c.numeroDoc.trim() && c.telefono.trim()
    : canal === "publico" ? contactoVisitanteValido(c) : c.nombres.trim() && c.apellidos.trim() && c.numeroDoc.trim();

  const enviar = () => start(async () => {
    setErr(null);
    const r = await crear({ ...solicitud, cliente: c });
    if (!r.ok) return setErr(r.error);
    if (r.destino === "dashboard" || r.destino === "portal") { router.push(r.enlace); return; }
    setHecho(r.enlace);
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
      <Link href={resumen.volver} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700" data-testid="cambiar-seleccion"><ArrowLeft className="h-4 w-4" /> Cambiar la selección</Link>
      <h1 className="text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>Checkout · {resumen.paquete}</h1>

      <section className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="resumen-dinamico">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Tu selección · {resumen.destino} · {resumen.noches} noches · {resumen.fechaIda} a {resumen.fechaRegreso}</h2>
        <div className="space-y-3 text-sm">
          {resumen.hotel && (
            <>
              <div data-testid="res-hotel"><p className="flex items-center gap-1.5 font-semibold text-gray-700"><Hotel className="h-4 w-4" /> Hotel</p><p className="text-gray-800">{resumen.hotel.nombre}{resumen.hotel.categoria ? ` · ${resumen.hotel.categoria}` : ""}</p></div>
              <div data-testid="res-alimentacion"><p className="flex items-center gap-1.5 font-semibold text-gray-700"><Utensils className="h-4 w-4" /> Alimentación</p><p className="text-gray-800">{resumen.hotel.regimen || "No especificada"}</p></div>
            </>
          )}
          <div data-testid="res-habitaciones"><p className="flex items-center gap-1.5 font-semibold text-gray-700"><BedDouble className="h-4 w-4" /> Habitaciones</p><p className="text-gray-800">{resumen.habitaciones}</p></div>
          <div data-testid="res-viajeros"><p className="flex items-center gap-1.5 font-semibold text-gray-700"><Users className="h-4 w-4" /> Viajeros</p><p className="text-gray-800">{resumen.viajeros}</p></div>
          {resumen.vuelo && (
            <div data-testid="res-vuelo"><p className="flex items-center gap-1.5 font-semibold text-gray-700"><Plane className="h-4 w-4" /> Vuelo</p>
              <p className="text-gray-800">{[resumen.vuelo.detalle?.aerolinea, resumen.vuelo.detalle?.ruta].filter(Boolean).join(" · ") || resumen.vuelo.etiqueta}</p>
              <p className="text-xs text-gray-600">Ida {resumen.fechaIda}{resumen.vuelo.detalle?.vueloIda ? ` · vuelo ${resumen.vuelo.detalle.vueloIda}` : ""}{resumen.vuelo.detalle?.horaSalidaIda ? ` · sale ${resumen.vuelo.detalle.horaSalidaIda.slice(0, 5)}` : ""}{resumen.vuelo.detalle?.horaLlegadaIda ? ` · llega ${resumen.vuelo.detalle.horaLlegadaIda.slice(0, 5)}` : ""}</p>
              <p className="text-xs text-gray-600">Regreso {resumen.fechaRegreso}{resumen.vuelo.detalle?.vueloRegreso ? ` · vuelo ${resumen.vuelo.detalle.vueloRegreso}` : ""}{resumen.vuelo.detalle?.horaSalidaReg ? ` · sale ${resumen.vuelo.detalle.horaSalidaReg.slice(0, 5)}` : ""}{resumen.vuelo.detalle?.horaLlegadaReg ? ` · llega ${resumen.vuelo.detalle.horaLlegadaReg.slice(0, 5)}` : ""}</p></div>
          )}
          {resumen.servicios.length > 0 && (
            <div data-testid="res-servicios"><p className="flex items-center gap-1.5 font-semibold text-gray-700"><Sparkles className="h-4 w-4" /> Servicios</p><ul className="list-disc pl-5 text-gray-800">{resumen.servicios.map((x) => <li key={x}>{x}</li>)}</ul></div>
          )}
        </div>
        <div className="mt-3 border-t border-gray-100 pt-3">
          <ul className="space-y-0.5 text-xs text-gray-600" data-testid="desglose-dinamico">{resumen.lineas.map((l, i) => <li key={i} className="flex justify-between"><span>{l.descripcion}</span><span>{formatMoneda(l.valor, resumen.moneda)}</span></li>)}</ul>
          <p className="mt-2 text-base">Total estimado: <b style={{ color: "var(--brand-primary)" }}>{formatMoneda(resumen.total, resumen.moneda)}</b></p>
          <p className="mt-1 text-xs text-gray-500">El precio definitivo lo fija el sistema al generar la cotización.</p>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-gray-700"><Users className="h-4 w-4" />{canal === "b2b" ? "Datos del titular del contrato" : canal === "interno" ? "Cliente" : "Tus datos"}</h2>
        {canal === "b2b" && aliado && <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800" data-testid="aliado-dinamico">Cotizas como {aliado}; la cotización quedará en tu portal.</p>}
        {interno ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="checkout-titular-interno">
            <div className="sm:col-span-2">
              <label className={lbl} htmlFor="din-numero-doc">Número de documento *</label>
              <div className="flex gap-1">
                <input id="din-numero-doc" className={inp} value={c.numeroDoc} onChange={(e) => setC({ ...c, numeroDoc: e.target.value })} />
                <BuscarTitular numero={c.numeroDoc} contexto="interno|dinamico" actual={c} campos={["nombres", "apellidos", "telefono", "email"]}
                  onAplicar={({ tipoDoc, ...d }) => setC((p) => ({ ...p, tipoDoc, ...d }))} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className={lbl} htmlFor="din-tipo-doc">Tipo de documento</label>
              <select id="din-tipo-doc" className={inp} value={c.tipoDoc} onChange={(e) => setC({ ...c, tipoDoc: e.target.value })}>
                <option value="">Elige el tipo…</option>
                {TIPOS_DOC_PERSONA.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Nombres *</label><input className={inp} value={c.nombres} onChange={(e) => setC({ ...c, nombres: e.target.value })} /></div>
            <div><label className={lbl}>Apellidos *</label><input className={inp} value={c.apellidos} onChange={(e) => setC({ ...c, apellidos: e.target.value })} /></div>
            <div><label className={lbl}>Teléfono / WhatsApp *</label><input className={inp} value={c.telefono} onChange={(e) => setC({ ...c, telefono: e.target.value })} /></div>
            <div><label className={lbl}>Correo</label><input type="email" className={inp} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className={lbl}>Nombres *</label><input className={inp} value={c.nombres} onChange={(e) => setC({ ...c, nombres: e.target.value })} /></div>
            <div><label className={lbl}>Apellidos</label><input className={inp} value={c.apellidos} onChange={(e) => setC({ ...c, apellidos: e.target.value })} /></div>
            {canal === "b2b" && (
              <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                <div><label className={lbl} htmlFor="din-tipo-doc">Tipo</label>
                  <select id="din-tipo-doc" className={inp} value={c.tipoDoc} onChange={(e) => setC({ ...c, tipoDoc: e.target.value })}>
                    <option value="">—</option>{TIPOS_DOC_PERSONA.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select></div>
                <div><label className={lbl}>Documento *</label><input className={inp} value={c.numeroDoc} onChange={(e) => setC({ ...c, numeroDoc: e.target.value })} /></div>
              </div>
            )}
            {canal === "b2b" && <div><label className={lbl}>Nacimiento</label><DateInput aria-label="Nacimiento" type="date" value={c.nacimiento} onValueChange={(d) => setC({ ...c, nacimiento: d })} /></div>}
            <div><label className={lbl}>Teléfono / WhatsApp</label><input className={inp} value={c.telefono} onChange={(e) => setC({ ...c, telefono: e.target.value })} /></div>
            <div><label className={lbl}>Correo</label><input type="email" className={inp} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
            {canal === "publico" && <p className="text-xs text-gray-500 sm:col-span-2">Indica tu nombre y un correo o teléfono de contacto.</p>}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={enviar} disabled={pending || !listo || !!hecho} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Cotizando…" : "Generar cotización"}</Button>
        </div>
        {err && <p role="alert" className="mt-3 text-sm text-red-600">{err}</p>}
        {hecho && (
          <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Tu cotización quedó lista. Guárdala o compártela con este enlace: <Link href={hecho} target="_blank" className="font-semibold underline">abrir cotización</Link>
          </p>
        )}
      </section>
    </div>
  );
}
