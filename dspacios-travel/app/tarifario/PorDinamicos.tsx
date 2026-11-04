"use client";
// Sección pública «Dinámicos» (#82): paquetes 100 % dinámicos publicados. La tarjeta organiza la selección como el resto del tarifario (hotel, alimentación,
// habitaciones, viajeros, vuelo y servicios) y continúa al checkout (/tarifario/checkout/dinamico), donde se capturan los datos del cliente y el servidor
// resuelve el canal (interno, B2C o B2B). Aquí NO hay formulario de identidad. Solo PVP: ningún costo llega al navegador.
// El precio de la selección lo calcula el SERVIDOR (`evaluarSeleccionDin`, mismo núcleo que la cotización); en pantalla se valida igual con las mismas
// reglas de menores/capacidad (`resolverMenores`), así lo que se ve y lo que acepta el servidor no puede divergir.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BedDouble, Calculator, Hotel, Info, Moon, Plane, Sparkles, Users, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/DateInput";
import { formatMoneda } from "@/lib/utils";
import { ACOM_ROOM_LABEL, ACOM_ROOMS, PAX_TARIFA_DEFAULT, type AcomRoom } from "@/lib/acomodaciones";
import type { Composicion } from "@/lib/paqueteDinamico/calculo";
import type { DinamicoPublico, HotelPublico, VueloDetalle } from "@/lib/paqueteDinamico/publico";
import { explicarEdades, resolverMenores } from "@/lib/paqueteDinamico/menores";
import { aQuery, restaurarEstado, type EstadoTarjeta } from "@/lib/paqueteDinamico/seleccionUrl";
import { ajustarCantidadEdades, parseEdadMenor } from "@/lib/reservar/edadesMenores";
import { CarruselFotoHotel } from "./CarruselFotoHotel";
import type { VistaPreviaDin } from "./checkout/dinamico/actions";

/** La Server Action de vista previa llega por prop desde la página (servidor): este componente cliente no importa código de servidor. */
export type EvaluarSeleccionFn = (input: { paqueteId: number; hotelId: number | null; vueloId: number | null; composicion: Composicion; fechaIda: string }) => Promise<VistaPreviaDin>;

const sel = "h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm";
const lbl = "mb-1 block text-xs font-medium text-gray-600";

export const claveTarjeta = (paqueteId: number, hotelId: number | null) => `${paqueteId}:${hotelId ?? "x"}`;
const claveAlmacen = (paqueteId: number, hotelId: number | null) => `dinSel:${paqueteId}:${hotelId ?? 0}`;

function Seccion({ icono: Icono, titulo, children }: { icono: typeof Hotel; titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3" data-testid={`sec-${titulo.toLowerCase()}`}>
      <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700"><Icono className="h-4 w-4" style={{ color: "var(--brand-primary)" }} /> {titulo}</h4>
      {children}
    </section>
  );
}

const hora = (v: string | null) => (v ? v.slice(0, 5) : null);
function DetalleVuelo({ d, ida, regreso }: { d: VueloDetalle | null; ida: string | null; regreso: string | null }) {
  const tramo = (titulo: string, fecha: string | null, vuelo: string | null, sale: string | null, llega: string | null) => (
    <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
      <p className="font-medium text-gray-800">{titulo}{fecha ? ` · ${fecha}` : ""}</p>
      <p className="text-xs text-gray-600">{[vuelo ? `Vuelo ${vuelo}` : null, hora(sale) ? `sale ${hora(sale)}` : null, hora(llega) ? `llega ${hora(llega)}` : null].filter(Boolean).join(" · ") || "Horario por confirmar"}</p>
    </div>
  );
  return (
    <div className="mt-2 space-y-2" data-testid="detalle-vuelo">
      <p className="text-sm text-gray-700">{[d?.aerolinea, d?.ruta].filter(Boolean).join(" · ") || "Vuelo del paquete"}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {tramo("Ida", ida, d?.vueloIda ?? null, d?.horaSalidaIda ?? null, d?.horaLlegadaIda ?? null)}
        {regreso ? tramo("Regreso", regreso, d?.vueloRegreso ?? null, d?.horaSalidaReg ?? null, d?.horaLlegadaReg ?? null) : null}
      </div>
    </div>
  );
}

function Cotizador({ p, hotel, onCerrar, evaluar }: { p: DinamicoPublico; hotel: HotelPublico | null; onCerrar: () => void; evaluar: EvaluarSeleccionFn }) {
  const router = useRouter();
  const almacen = claveAlmacen(p.id, hotel?.id ?? null);
  const vuelosOk = useMemo(() => p.vuelos.map((v) => v.id), [p.vuelos]);
  const serviciosOk = useMemo(() => p.servicios.map((s) => String(s.id)), [p.servicios]);
  // La selección se conserva (sessionStorage) al ir al checkout y volver. Este componente solo se monta tras un clic, así que leer aquí no rompe la hidratación.
  const [ini] = useState<EstadoTarjeta | null>(() => {
    try { const raw = typeof window === "undefined" ? null : window.sessionStorage.getItem(almacen); return raw ? restaurarEstado(JSON.parse(raw), vuelosOk, serviciosOk) : null; } catch { return null; }
  });
  const [hab, setHab] = useState<Record<AcomRoom, number>>(ini?.habitaciones ?? { sencilla: 0, doble: 1, triple: 0, multiple: 0 });
  const [viajanMenores, setViajanMenores] = useState(ini?.viajanMenores ?? false);
  const [edades, setEdades] = useState<string[]>(ini?.edades ?? []);
  const [vueloId, setVueloId] = useState<number | null>(ini?.vueloId ?? p.vuelos[0]?.id ?? null);
  const [fIda, setFIda] = useState(ini?.fechaIda ?? "");
  const [fReg, setFReg] = useState(ini?.fechaRegreso ?? "");
  const [serviciosSel, setServiciosSel] = useState<string[] | null>(ini?.servicios ?? null);
  // La respuesta del servidor se guarda con la clave de la selección que la pidió: si la selección cambió, esa respuesta ya no vale (nunca se queda «Calculando…»).
  const [prev, setPrev] = useState<{ clave: string; r: VistaPreviaDin } | null>(null);

  const vueloSel = p.vuelos.find((v) => v.id === vueloId);
  const ida = vueloSel?.fechaIda ?? fIda;
  const regreso = vueloSel?.fechaRegreso ?? fReg;
  const reglas = hotel?.reglas ?? null;
  const texto = explicarEdades(reglas);
  const adultos = ACOM_ROOMS.reduce((s, a) => s + hab[a] * (reglas?.reglas.find((r) => r.acomodacion === a)?.pax_tarifa ?? PAX_TARIFA_DEFAULT[a]), 0);

  const edadesParse = edades.map(parseEdadMenor);
  const claveEdades = edades.join(",");
  // Referencia estable mientras no cambien las edades (si no, la vista previa se volvería a pedir en cada render).
  const edadesNum = useMemo(() => {
    if (!viajanMenores || !edades.length) return null;
    const ps = claveEdades.split(",").map(parseEdadMenor);
    return ps.every((x) => x.valor != null) ? ps.map((x) => x.valor as number) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viajanMenores, claveEdades]);
  const menores = useMemo(() => {
    if (!viajanMenores) return { ok: true as const, ninos: 0, ninos2: 0, infantes: 0, menoresDeDos: 0, edades: [] as number[], distribucion: [] };
    if (!edadesNum) return null;
    return resolverMenores({ habitaciones: hab, edades: edadesNum, reglas });
  }, [viajanMenores, edadesNum, hab, reglas]);
  const errorLocal = adultos < 1 ? "Elige al menos una habitación." : viajanMenores && edades.length === 0 ? "Indica cuántos menores viajan." : menores && !menores.ok ? menores.error : null;
  // Vuelo por EDADES: menor de 2 años = infante sin silla; desde 2 años = adulto con silla.
  const infantesVuelo = edadesNum ? edadesNum.filter((x) => x < 2).length : 0;
  const sillasVuelo = viajanMenores && edadesNum ? adultos + edadesNum.length - infantesVuelo : null;
  const completa = !errorLocal && !!menores && !!ida && !!regreso;
  const serviciosElegidos = serviciosSel ?? serviciosOk;
  const composicion: Composicion = useMemo(() => ({
    habitaciones: hab, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: viajanMenores && edadesNum ? edadesNum : [], ...(serviciosSel ? { servicios: serviciosSel } : {}),
  }), [hab, viajanMenores, edadesNum, serviciosSel]);

  // Persistencia de la selección.
  useEffect(() => {
    const estado: EstadoTarjeta = { habitaciones: hab, viajanMenores, edades, vueloId, fechaIda: fIda, fechaRegreso: fReg, servicios: serviciosSel };
    try { window.sessionStorage.setItem(almacen, JSON.stringify(estado)); } catch { /* sin almacenamiento: la selección viaja igual en la URL */ }
  }, [almacen, hab, viajanMenores, edades, vueloId, fIda, fReg, serviciosSel]);

  // Precio y aceptación del SERVIDOR (con las fichas), con una pequeña espera para no consultar en cada tecla.
  const claveSel = JSON.stringify([p.id, hotel?.id ?? null, p.usaVuelo ? vueloId : null, composicion, ida]);
  useEffect(() => {
    if (!completa) return;
    const t = setTimeout(async () => {
      const r = await evaluar({ paqueteId: p.id, hotelId: hotel?.id ?? null, vueloId: p.usaVuelo ? vueloId : null, composicion, fechaIda: ida });
      setPrev({ clave: claveSel, r });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completa, evaluar, claveSel]);

  const mostrado = completa && prev?.clave === claveSel ? prev.r : null;
  const calculando = completa && !mostrado;
  const continuar = () => {
    const q = aQuery({ paqueteId: p.id, hotelId: hotel?.id ?? null, vueloId: p.usaVuelo ? vueloId : null, habitaciones: hab, edades: viajanMenores && edadesNum ? edadesNum : [], servicios: serviciosSel, fechaIda: ida, fechaRegreso: regreso });
    router.push(`/tarifario/checkout/dinamico?${q.toString()}`);
  };
  const cambiarCantidadMenores = (n: number) => setEdades((a) => ajustarCantidadEdades(a, Math.max(0, Math.min(10, n))));

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3" data-testid="cotizador-dinamico">
      {p.usaHotel && hotel && (
        <>
          <Seccion icono={Hotel} titulo="Hotel">
            <p className="text-sm text-gray-800">{hotel.nombre}{hotel.categoria ? ` · ${hotel.categoria}` : ""}</p>
          </Seccion>
          <Seccion icono={Utensils} titulo="Alimentación">
            <p className="text-sm text-gray-800">{hotel.regimen || "Plan de alimentación no especificado"}</p>
          </Seccion>
          <Seccion icono={BedDouble} titulo="Habitaciones">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ACOM_ROOMS.map((a) => (
                <div key={a}><label className={lbl}>{ACOM_ROOM_LABEL[a]}</label>
                  <Input aria-label={`Habitaciones ${ACOM_ROOM_LABEL[a]}`} inputMode="numeric" value={String(hab[a])} onChange={(e) => setHab({ ...hab, [a]: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} /></div>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">{adultos} adulto{adultos === 1 ? "" : "s"} en las habitaciones elegidas ({ACOM_ROOMS.map((a) => `${ACOM_ROOM_LABEL[a]} ${reglas?.reglas.find((r) => r.acomodacion === a)?.pax_tarifa ?? PAX_TARIFA_DEFAULT[a]}`).join(" · ")}).</p>
          </Seccion>
        </>
      )}
      {!p.usaHotel && (
        <Seccion icono={BedDouble} titulo="Habitaciones">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ACOM_ROOMS.map((a) => (
              <div key={a}><label className={lbl}>{ACOM_ROOM_LABEL[a]}</label>
                <Input aria-label={`Habitaciones ${ACOM_ROOM_LABEL[a]}`} inputMode="numeric" value={String(hab[a])} onChange={(e) => setHab({ ...hab, [a]: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} /></div>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">{adultos} adulto{adultos === 1 ? "" : "s"} viajan.</p>
        </Seccion>
      )}

      <Seccion icono={Users} titulo="Viajeros">
        <p className="mb-2 text-sm text-gray-700">¿Viajan menores de edad?</p>
        <div className="flex gap-2" role="radiogroup" aria-label="¿Viajan menores?">
          {([[false, "No viajan menores"], [true, "Sí, viajan menores"]] as const).map(([v, t]) => (
            <button key={t} type="button" role="radio" aria-checked={viajanMenores === v} onClick={() => { setViajanMenores(v); if (!v) setEdades([]); else if (!edades.length) setEdades([""]); }}
              className={`rounded-lg border px-3 py-1.5 text-sm ${viajanMenores === v ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white" : "border-gray-200 bg-white text-gray-700"}`}>{t}</button>
          ))}
        </div>
        {viajanMenores && (
          <div className="mt-3 space-y-2" data-testid="edades-menores">
            <div className="max-w-[10rem]"><label className={lbl}>¿Cuántos menores?</label>
              <Input aria-label="Cantidad de menores" inputMode="numeric" value={String(edades.length)} onChange={(e) => cambiarCantidadMenores(Number(e.target.value) || 0)} /></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {edades.map((v, i) => (
                <div key={i}><label className={lbl}>Edad del menor {i + 1}</label>
                  <Input aria-label={`Edad del menor ${i + 1}`} inputMode="numeric" value={v} onChange={(e) => setEdades((a) => a.map((x, j) => (j === i ? e.target.value : x)))} />
                  {edadesParse[i]?.error && v !== "" && <span className="text-xs text-red-600">{edadesParse[i].error}</span>}</div>
              ))}
            </div>
            <div className="flex gap-2 rounded-lg bg-sky-50 p-2 text-xs text-sky-900" data-testid="explicacion-edades">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1"><p>{texto.edades}</p><p>{texto.ninos12}</p>{texto.adultsOnly && <p className="font-semibold">{texto.adultsOnly}</p>}</div>
            </div>
            {menores?.ok && edadesNum && (
              <p className="text-sm text-gray-700" data-testid="reparto-menores">Tarifas: Niño 1 × {menores.ninos} · Niño 2 × {menores.ninos2} · Infante × {menores.infantes}</p>
            )}
          </div>
        )}
      </Seccion>

      {p.usaVuelo && p.vuelos.length > 0 && (
        <Seccion icono={Plane} titulo="Vuelo">
          <select aria-label="Vuelo" className={sel} value={vueloId ?? ""} onChange={(e) => setVueloId(Number(e.target.value))}>{p.vuelos.map((v) => <option key={v.id} value={v.id}>{v.etiqueta}</option>)}</select>
          <DetalleVuelo d={vueloSel?.detalle ?? null} ida={vueloSel?.fechaIda ?? null} regreso={vueloSel?.fechaRegreso ?? null} />
          <div className="mt-2 rounded-lg bg-sky-50 p-2 text-xs text-sky-900" data-testid="regla-vuelo">
            <p>En el vuelo, el <b>menor de 2 años</b> paga solo el fee de infante y no ocupa silla; <b>desde los 2 años</b> paga tarifa de adulto y ocupa silla (por la edad que declares, sin importar cómo clasifique el hotel).</p>
            <p className="mt-1 font-medium" data-testid="sillas-vuelo">{sillasVuelo != null ? `${sillasVuelo} silla${sillasVuelo === 1 ? "" : "s"}${infantesVuelo ? ` + ${infantesVuelo} infante${infantesVuelo === 1 ? "" : "s"} sin silla` : ""}` : `${adultos} adulto${adultos === 1 ? "" : "s"} con silla`}</p>
          </div>
          {!vueloSel?.fechaIda && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div><label className={lbl}>Fecha de ida</label><DateInput aria-label="Fecha de ida" type="date" value={fIda} onValueChange={setFIda} /></div>
              <div><label className={lbl}>Fecha de regreso ({p.noches} noches)</label><DateInput aria-label="Fecha de regreso" type="date" value={fReg} onValueChange={setFReg} /></div>
            </div>
          )}
        </Seccion>
      )}
      {!p.usaVuelo && (
        <Seccion icono={Moon} titulo="Fechas">
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label className={lbl}>Fecha de ida</label><DateInput aria-label="Fecha de ida" type="date" value={fIda} onValueChange={setFIda} /></div>
            <div><label className={lbl}>Fecha de regreso ({p.noches} noches)</label><DateInput aria-label="Fecha de regreso" type="date" value={fReg} onValueChange={setFReg} /></div>
          </div>
        </Seccion>
      )}

      {p.usaServicios && p.servicios.length > 0 && (
        <Seccion icono={Sparkles} titulo="Servicios">
          <ul className="space-y-1.5">
            {p.servicios.map((s) => {
              const id = String(s.id), on = serviciosElegidos.includes(id);
              return (
                <li key={id} className="text-sm">
                  <label className="flex items-start gap-2"><input type="checkbox" checked={on} onChange={() => setServiciosSel(on ? serviciosElegidos.filter((x) => x !== id) : [...serviciosElegidos, id])} />
                    <span><span className="font-medium text-gray-800">{s.nombre}</span>{s.ficha && <span className="block text-xs text-gray-500">{s.ficha.texto}</span>}</span></label>
                </li>
              );
            })}
          </ul>
        </Seccion>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-700" data-testid="total-dinamico">
          Total estimado: <b>{mostrado?.ok ? formatMoneda(mostrado.total, p.moneda) : calculando ? "Calculando…" : "—"}</b>
        </p>
        <Button onClick={continuar} disabled={!mostrado?.ok || calculando} style={{ backgroundColor: "var(--brand-primary)" }}>Continuar al checkout <ArrowRight className="h-4 w-4" /></Button>
        <Button variant="outline" onClick={onCerrar}>Cerrar</Button>
      </div>
      {(errorLocal || (mostrado && !mostrado.ok)) && <p role="alert" className="text-sm text-red-600" data-testid="error-seleccion">{errorLocal ?? (mostrado && !mostrado.ok ? mostrado.error : "")}</p>}
    </div>
  );
}

export function PorDinamicos({ dinamicos, evaluar, abierta = null }: { dinamicos: DinamicoPublico[]; evaluar: EvaluarSeleccionFn; abierta?: string | null }) {
  const [abierto, setAbierto] = useState<string | null>(abierta);
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
                const clave = claveTarjeta(p.id, h?.id ?? null);
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
                      {abierto === clave && <Cotizador p={p} hotel={h} onCerrar={() => setAbierto(null)} evaluar={evaluar} />}
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
