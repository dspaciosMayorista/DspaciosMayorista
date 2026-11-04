"use client";
// Checkout del paquete dinámico (#82): continuación de la tarjeta (hotel, habitaciones, vuelo y precio ya elegidos).
// Aquí SOLO se capturan los datos del cliente, con las mismas piezas del checkout habitual:
//  · sesión interna → número de documento + «Buscar» (BuscarTitular, la búsqueda de personas por documento existente);
//  · aliado B2B → datos del titular del contrato; · visitante → «Tus datos».
// El canal (interno, B2B o B2C) lo resuelve el SERVIDOR por la sesión al crear la cotización; el navegador no lo manda.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
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
  paquete: string; destino: string; noches: number; moneda: string; hotel: string | null; vuelo: string | null;
  fechaIda: string; fechaRegreso: string; habitaciones: string; total: number;
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
      <Link href="/tarifario" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft className="h-4 w-4" /> Volver al tarifario</Link>
      <h1 className="text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>Checkout · {resumen.paquete}</h1>

      <section className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="resumen-dinamico">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Tu selección</h2>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-gray-500">Destino: </dt><dd className="inline">{resumen.destino} · {resumen.noches} noches</dd></div>
          {resumen.hotel && <div><dt className="inline text-gray-500">Hotel: </dt><dd className="inline">{resumen.hotel}</dd></div>}
          <div><dt className="inline text-gray-500">Habitaciones: </dt><dd className="inline">{resumen.habitaciones}</dd></div>
          {resumen.vuelo && <div><dt className="inline text-gray-500">Vuelo: </dt><dd className="inline">{resumen.vuelo}</dd></div>}
          <div><dt className="inline text-gray-500">Fechas: </dt><dd className="inline">{resumen.fechaIda} a {resumen.fechaRegreso}</dd></div>
        </dl>
        <p className="mt-3 text-base">Total estimado: <b style={{ color: "var(--brand-primary)" }}>{formatMoneda(resumen.total, resumen.moneda)}</b></p>
        <p className="mt-1 text-xs text-gray-500">El precio definitivo lo fija el sistema al generar la cotización.</p>
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
