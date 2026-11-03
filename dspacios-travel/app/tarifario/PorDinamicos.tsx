"use client";
// Sección pública «Dinámicos» (#82): paquetes 100 % dinámicos publicados, con tarjetas de hotel y el flujo normal
// de cotización. El canal (visitante, aliado B2B o personal) lo decide el servidor por la sesión. Solo PVP: ningún costo llega al navegador.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calculator, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/DateInput";
import { formatMoneda } from "@/lib/utils";
import { liquidarPaquete, validarPaquete, type Composicion } from "@/lib/paqueteDinamico/calculo";
import type { DinamicoPublico, HotelPublico } from "@/lib/paqueteDinamico/publico";
import { contactoVisitanteValido } from "@/lib/paqueteDinamico/solicitud";
import type { CrearCotizacionDinInput } from "@/app/(dashboard)/dashboard/cotizaciones/din-actions";
import { CarruselFotoHotel } from "./CarruselFotoHotel";

/**
 * La Server Action llega por prop desde la página (servidor): así este componente cliente no importa código de servidor
 * (`next/headers`…) y las pruebas que renderizan el tarifario no arrastran esa cadena.
 */
export type CrearCotizacionDinFn = (input: CrearCotizacionDinInput) => Promise<
  | { ok: true; id: number; destino: "dashboard" | "portal" | "publico"; enlace: string; avisoPersonas?: string }
  | { ok: false; error: string }
>;

const sel = "h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm";
const lbl = "mb-1 block text-xs font-medium text-gray-600";

function Cotizador({ p, hotel, onCerrar, crear }: { p: DinamicoPublico; hotel: HotelPublico | null; onCerrar: () => void; crear: CrearCotizacionDinFn }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [vueloId, setVueloId] = useState<number | null>(p.vuelos[0]?.id ?? null);
  const [hab, setHab] = useState({ sencilla: 0, doble: 1, triple: 0, multiple: 0 });
  const [men, setMen] = useState({ ninos: 0, ninos2: 0, infantes: 0 });
  const [fIda, setFIda] = useState("");
  const [fReg, setFReg] = useState("");
  const [c, setC] = useState({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", nacimiento: "", telefono: "", email: "" });
  const comp: Composicion = useMemo(() => ({ habitaciones: hab, ...men }), [hab, men]);

  const opcion = p.opciones.find((o) => (o.hotelId ?? null) === (hotel?.id ?? null) && (o.vueloId ?? null) === (vueloId ?? null));
  const total = useMemo(() => {
    if (!opcion || validarPaquete(opcion.calc).length) return null;
    try { return liquidarPaquete(opcion.calc, comp).total; } catch { return null; }
  }, [opcion, comp]);

  const vueloSel = p.vuelos.find((v) => v.id === vueloId);
  const ida = vueloSel?.fechaIda ?? fIda;
  const regreso = vueloSel?.fechaRegreso ?? fReg;

  const cotizar = () => start(async () => {
    setErr(null);
    const r = await crear({ paqueteId: p.id, hotelId: hotel?.id ?? null, vueloId, composicion: comp, cliente: c, fechaIda: ida, fechaRegreso: regreso });
    if (!r.ok) return setErr(r.error);
    if (r.destino === "dashboard" || r.destino === "portal") { router.push(r.enlace); return; }
    setHecho(r.enlace);
  });

  const num = (k: keyof typeof hab) => (
    <div key={k}><label className={lbl}>Hab. {k}</label>
      <Input inputMode="numeric" value={String(hab[k])} onChange={(e) => setHab({ ...hab, [k]: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} /></div>
  );
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(["sencilla", "doble", "triple", "multiple"] as const).map(num)}</div>
      <div className="grid grid-cols-3 gap-2">
        {([["ninos", "Niños (1)"], ["ninos2", "Niños (2)"], ["infantes", "Infantes"]] as const).map(([k, t]) => (
          <div key={k}><label className={lbl}>{t}</label><Input inputMode="numeric" value={String(men[k])} onChange={(e) => setMen({ ...men, [k]: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} /></div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {p.vuelos.length > 0 && (
          <div><label className={lbl}>Vuelo</label>
            <select className={sel} value={vueloId ?? ""} onChange={(e) => setVueloId(Number(e.target.value))}>{p.vuelos.map((v) => <option key={v.id} value={v.id}>{v.etiqueta}</option>)}</select></div>
        )}
        {vueloSel?.fechaIda ? (
          <p className="self-end pb-2 text-sm text-gray-700 sm:col-span-2">Fechas del vuelo: <b>{vueloSel.fechaIda}</b> a <b>{vueloSel.fechaRegreso ?? "—"}</b> · {p.noches} noches</p>
        ) : (
          <>
            <div><label className={lbl}>Fecha de ida</label><DateInput aria-label="Fecha de ida" type="date" value={fIda} onValueChange={setFIda} /></div>
            <div><label className={lbl}>Fecha de regreso ({p.noches} noches)</label><DateInput aria-label="Fecha de regreso" type="date" value={fReg} onValueChange={setFReg} /></div>
          </>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {([["nombres", "Nombres"], ["apellidos", "Apellidos"], ["numeroDoc", "N.º documento"], ["nacimiento", "Nacimiento"], ["telefono", "Teléfono"], ["email", "Correo"]] as const).map(([k, t]) => (
          <div key={k}><label className={lbl}>{t}</label>{k === "nacimiento" ? <DateInput aria-label="Nacimiento" type="date" value={c[k]} onValueChange={(d) => setC({ ...c, [k]: d })} /> : <Input value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} />}</div>
        ))}
        <div><label className={lbl}>Tipo de documento</label><select className={sel} value={c.tipoDoc} onChange={(e) => setC({ ...c, tipoDoc: e.target.value })}>{["CC", "CE", "TI", "PAS", "NIT"].map((t) => <option key={t}>{t}</option>)}</select></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-700">Total estimado: <b>{total != null ? formatMoneda(total, p.moneda) : "—"}</b></p>
        <Button onClick={cotizar} disabled={pending || total == null || !ida || !regreso || !contactoVisitanteValido(c)} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Cotizando…" : "Generar cotización"}</Button>
        <Button variant="outline" onClick={onCerrar}>Cerrar</Button>
      </div>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      {hecho && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Tu cotización quedó lista. Guárdala o compártela con este enlace: <Link href={hecho} target="_blank" className="font-semibold underline">abrir cotización</Link>
        </p>
      )}
    </div>
  );
}

export function PorDinamicos({ dinamicos, cotizar }: { dinamicos: DinamicoPublico[]; cotizar: CrearCotizacionDinFn }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  if (!dinamicos.length) return <p className="py-10 text-center text-sm text-gray-500">Por ahora no hay paquetes dinámicos publicados.</p>;
  return (
    <div className="space-y-8">
      {dinamicos.map((p) => {
        const tarjetas: (HotelPublico | null)[] = p.usaHotel ? p.hoteles : [null];
        return (
          <section key={p.id}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-xl font-semibold text-gray-900">{p.nombre}</h2>
              <span className="text-sm text-gray-500">{p.destino} · <Moon className="-mt-0.5 inline h-3.5 w-3.5" /> {p.noches} noches</span>
            </div>
            {p.descripcion && <p className="mb-3 max-w-3xl text-sm text-gray-600">{p.descripcion}</p>}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tarjetas.map((h) => {
                const clave = `${p.id}:${h?.id ?? "x"}`;
                const desde = h ? h.desde : Math.min(...p.opciones.map((o) => o.desdePorPersona));
                return (
                  <article key={clave} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                    {h && <CarruselFotoHotel fotos={[h.foto]} alt={h.nombre} />}
                    <div className="p-4">
                      <h3 className="font-semibold text-gray-900">{h?.nombre ?? p.nombre}</h3>
                      {h && <p className="text-xs text-gray-500">{[h.categoria, h.regimen].filter(Boolean).join(" · ")}</p>}
                      {h?.descripcion && <p className="mt-1 line-clamp-3 text-sm text-gray-600">{h.descripcion}</p>}
                      <p className="mt-2 text-sm text-gray-500">Desde por persona en doble</p>
                      <p className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(desde, p.moneda)}</p>
                      <Button className="mt-3 w-full" variant="outline" onClick={() => setAbierto(abierto === clave ? null : clave)}><Calculator className="h-4 w-4" /> Cotizar</Button>
                      {abierto === clave && <Cotizador p={p} hotel={h} onCerrar={() => setAbierto(null)} crear={cotizar} />}
                    </div>
                  </article>
                );
              })}
            </div>
            {(p.incluye.length > 0 || p.noIncluye.length > 0) && (
              <div className="mt-3 grid gap-3 text-sm text-gray-600 sm:grid-cols-2">
                {p.incluye.length > 0 && <div><b>Incluye</b><ul className="list-disc pl-5">{p.incluye.map((x) => <li key={x}>{x}</li>)}</ul></div>}
                {p.noIncluye.length > 0 && <div><b>No incluye</b><ul className="list-disc pl-5">{p.noIncluye.map((x) => <li key={x}>{x}</li>)}</ul></div>}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
