import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProgramaDetalle } from "@/lib/programas";
import { agenciaDe } from "@/lib/tenant.server";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { DocToolbar } from "./DocToolbar";
import { Check, X, MapPin, CalendarRange, Plane, Bus, Users, BadgeCheck, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

const ACOM_LABEL: Record<string, string> = {
  sencilla: "Sencilla", doble: "Doble", triple: "Triple", cuadruple: "Cuádruple", multiple: "Múltiple", nino: "Niño",
};
const ACOM_ORDER = ["sencilla", "doble", "triple", "cuadruple", "multiple", "nino"];

function comidas(d: { desayuno: boolean; almuerzo: boolean; cena: boolean }): string {
  const c = [d.desayuno && "Desayuno", d.almuerzo && "Almuerzo", d.cena && "Cena"].filter(Boolean);
  return c.length ? `(${c.join(", ")})` : "";
}

// Una inclusión del proveedor suele venir como UN texto con varias viñetas "•".
// Lo partimos en ítems individuales para mostrarlos limpios, uno por línea.
function aItems(texto: string): string[] {
  return (texto || "")
    .split(/\n|•|·|;|(?:^|\s)-\s/)
    .map((s) => s.replace(/^[\s•·\-]+/, "").trim())
    .filter((s) => s.length > 1);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data } = await sb.from("programas").select("nombre").eq("id", Number(id)).maybeSingle();
  return { title: data ? `${data.nombre} — D'spacios Travel` : "Programa — D'spacios Travel" };
}

export default async function ProgramaDocPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ marca?: string }>;
}) {
  const { id: idStr } = await params;
  const { marca } = await searchParams;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let rol: string | null = null;
  if (user) {
    const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
    rol = perfil?.rol ?? null;
  }
  const esInterno = !!rol && ["superadmin", "operaciones", "gerencia", "administracion", "venta"].includes(rol);
  const esB2B = rol === "agencia" || rol === "freelance";

  // Marca blanca: por defecto según rol (agencia/freelance → blanca); el query manda.
  const marcaBlanca = marca === "blanca" ? true : marca === "dspacios" ? false : esB2B;

  const det = await getProgramaDetalle(sb, id);
  if (!det) notFound();
  if (!det.programa.publicado && !esInterno) notFound();

  const ag = marcaBlanca ? null : await agenciaDe("mayorista").catch(() => null);

  const { programa: p } = det;
  const moneda = p.moneda;
  const incluye = det.inclusiones.filter((x) => x.tipo === "incluye");
  const noIncluye = det.inclusiones.filter((x) => x.tipo === "no_incluye");
  const acomsCat = ACOM_ORDER.filter((a) => det.categorias.some((c) => c.precios.some((pr) => pr.acomodacion === a)));
  const acomsSal = ACOM_ORDER.filter((a) => det.salidas.some((s) => s.precios.some((pr) => pr.acomodacion === a)));
  const haySalidaConHotel = det.salidas.some((s) => s.columna);

  const ruta = det.ciudades.map((c) => c.nombre).filter(Boolean).join(" · ") || p.subtitulo || "";
  const highlights = (p.highlights ?? []).filter(Boolean);

  // "Desde" para la portada: el manual de la cabecera manda; si no, el mínimo PVP real.
  const pvps = [
    ...det.categorias.flatMap((c) => c.precios.map((pr) => pr.pvp)),
    ...det.salidas.flatMap((s) => s.precios.map((pr) => pr.pvp)),
  ].filter((n): n is number => n != null && n > 0);
  const desde = p.desde_precio && p.desde_precio > 0 ? Number(p.desde_precio) : (pvps.length ? Math.min(...pvps) : null);

  const sellos = [
    p.tipo_transporte === "aereo" ? "Con aéreo" : p.tipo_transporte === "terrestre" ? "Salida terrestre" : "Porción terrestre",
    "Servicios compartidos",
    "Tarifa por persona",
    "Sujeto a disponibilidad",
  ];
  const SELLO_ICON = [p.tipo_transporte === "aereo" ? Plane : p.tipo_transporte === "terrestre" ? Bus : MapPin, Users, BadgeCheck, CalendarRange];

  const wa = ag?.telefono ? `https://wa.me/57${ag.telefono.replace(/\D/g, "")}` : null;

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 max-w-3xl px-4 print:hidden">
        <DocToolbar marcaBlanca={marcaBlanca} />
      </div>

      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="programa-doc relative overflow-hidden rounded-xl bg-white shadow-sm print:rounded-none print:shadow-none">
          {/* Marca de agua de fondo (solo versión D'Spacios) */}
          {!marcaBlanca && <div className="watermark" aria-hidden="true" />}

          <div className="relative">
            {/* ── PORTADA ─────────────────────────────────────────────── */}
            <section className="cover relative flex min-h-[230px] flex-col justify-end overflow-hidden">
              {p.portada_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.portada_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 bg-brand-gradient" />
              )}
              <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.75) 100%)" }} />
              <div className="relative z-10 p-6 text-white">
                {!marcaBlanca && (
                  <div className="mb-3">
                    <Logo variant="white" height={30} className="h-7 w-auto" />
                  </div>
                )}
                <h1 className="text-2xl font-extrabold leading-tight drop-shadow-sm">{p.nombre}</h1>
                {p.subtitulo && <p className="mt-1 text-sm text-white/90">{p.subtitulo}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/90">
                  {p.dias && <span className="inline-flex items-center gap-1"><CalendarRange size={13} /> {p.dias} días / {p.noches ?? ""} noches</span>}
                  {ruta && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {ruta}</span>}
                  {desde != null && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 font-semibold">
                      Desde {formatMoneda(desde, moneda)} <span className="font-normal text-white/80">/persona</span>
                    </span>
                  )}
                </div>
              </div>
            </section>

            <div className="p-7">
              {/* Sellos */}
              <div className="mb-4 flex flex-wrap gap-2">
                {sellos.map((s, i) => {
                  const Icon = SELLO_ICON[i];
                  return (
                    <span key={s} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium" style={{ borderColor: "var(--brand-accent)", color: "var(--brand-primary)", backgroundColor: "rgba(38,187,217,0.08)" }}>
                      <Icon size={12} /> {s}
                    </span>
                  );
                })}
                {(p.vigencia_desde || p.vigencia_hasta) && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-500">
                    Vigencia: {formatFechaLarga(p.vigencia_desde)} — {formatFechaLarga(p.vigencia_hasta)}
                  </span>
                )}
              </div>

              {/* Highlights */}
              {highlights.length > 0 && (
                <section className="mb-5 break-inside-avoid">
                  <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-gray-700"><Sparkles size={15} style={{ color: "var(--brand-accent)" }} /> Lo mejor del programa</h2>
                  <div className="flex flex-wrap gap-2">
                    {highlights.map((h, i) => (
                      <span key={i} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ backgroundColor: "rgba(174,244,74,0.18)", color: "#4d6b13" }}>{h}</span>
                    ))}
                  </div>
                </section>
              )}

              {/* Precios por categoría */}
              {det.categorias.length > 0 && (
                <section className="mb-5">
                  <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-700">Precios por persona ({moneda})</h2>
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-gray-300 text-left text-gray-500">
                        <th className="py-1 pr-2">Categoría</th>
                        {det.ciudades.map((c) => <th key={c.id} className="py-1 pr-2">{c.nombre}</th>)}
                        {acomsCat.map((a) => <th key={a} className="py-1 pl-2 text-right">{ACOM_LABEL[a] ?? a}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {det.categorias.map((cat, i) => (
                        <tr key={cat.id} className="border-b border-gray-100">
                          <td className="py-1 pr-2 font-medium text-gray-700">{cat.nombre ?? `Categoría ${i + 1}`}</td>
                          {det.ciudades.map((c) => <td key={c.id} className="py-1 pr-2 text-gray-600">{cat.hoteles.find((h) => h.ciudad === c.nombre)?.hotel ?? "—"}</td>)}
                          {acomsCat.map((a) => {
                            const pr = cat.precios.find((x) => x.acomodacion === a);
                            return <td key={a} className="py-1 pl-2 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>{pr?.bajo_solicitud ? "A solicitud" : pr?.pvp != null ? formatMoneda(pr.pvp, moneda) : "—"}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* Precios por salida */}
              {det.salidas.length > 0 && (
                <section className="mb-5">
                  <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-700">Salidas y precios por persona ({moneda})</h2>
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-gray-300 text-left text-gray-500">
                        <th className="py-1 pr-2">Salida</th>
                        <th className="py-1 pr-2">Noches</th>
                        {haySalidaConHotel && <th className="py-1 pr-2">Hotel</th>}
                        {acomsSal.map((a) => <th key={a} className="py-1 pl-2 text-right">{ACOM_LABEL[a] ?? a}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {det.salidas.map((s) => (
                        <tr key={s.id} className="border-b border-gray-100">
                          <td className="py-1 pr-2 font-medium text-gray-700">
                            {s.etiqueta && <div>{s.etiqueta}</div>}
                            {s.fecha_desde ? (
                              <div className={s.etiqueta ? "font-normal text-gray-500" : ""}>
                                {formatFechaLarga(s.fecha_desde)} — {formatFechaLarga(s.fecha_hasta)}
                              </div>
                            ) : (
                              !s.etiqueta && "—"
                            )}
                          </td>
                          <td className="py-1 pr-2 text-gray-600">{s.noches ?? "—"}</td>
                          {haySalidaConHotel && <td className="py-1 pr-2 text-gray-600">{s.columna ?? "—"}</td>}
                          {acomsSal.map((a) => {
                            const pr = s.precios.find((x) => x.acomodacion === a);
                            return <td key={a} className="py-1 pl-2 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>{s.bajo_solicitud ? "A solicitud" : pr?.pvp != null ? formatMoneda(pr.pvp, moneda) : "—"}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* Itinerario */}
              {det.dias.length > 0 && (
                <section className="mb-5">
                  <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-700">Itinerario</h2>
                  <div className="space-y-2">
                    {det.dias.map((d) => (
                      <div key={d.dia} className="break-inside-avoid text-xs">
                        <p className="font-semibold text-gray-800">Día {d.dia}{d.titulo ? `: ${d.titulo}` : ""} <span className="font-normal text-gray-400">{comidas(d)}</span></p>
                        {d.descripcion && <p className="mt-0.5 whitespace-pre-line text-gray-600">{d.descripcion}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Incluye / No incluye — ítem por línea con íconos */}
              {(incluye.length > 0 || noIncluye.length > 0) && (
                <section className="mb-5 grid grid-cols-1 gap-4 break-inside-avoid text-xs sm:grid-cols-2">
                  {incluye.length > 0 && (
                    <div className="rounded-lg border border-gray-100 bg-[#66B596]/5 p-3">
                      <h3 className="mb-2 font-bold text-gray-700">El programa incluye</h3>
                      <ul className="space-y-1 text-gray-600">
                        {incluye.flatMap((x, i) =>
                          aItems(x.texto).map((it, j) => (
                            <li key={`${i}-${j}`} className="flex gap-1.5">
                              <Check size={13} className="mt-0.5 shrink-0" style={{ color: "var(--brand-success)" }} />
                              <span>{x.ciudad ? <b>{x.ciudad}: </b> : null}{it}</span>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  )}
                  {noIncluye.length > 0 && (
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <h3 className="mb-2 font-bold text-gray-700">No incluye</h3>
                      <ul className="space-y-1 text-gray-600">
                        {noIncluye.flatMap((x, i) =>
                          aItems(x.texto).map((it, j) => (
                            <li key={`${i}-${j}`} className="flex gap-1.5">
                              <X size={13} className="mt-0.5 shrink-0 text-gray-400" />
                              <span>{it}</span>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  )}
                </section>
              )}

              {/* Tours opcionales */}
              {det.tours.length > 0 && (
                <section className="mb-5 break-inside-avoid text-xs">
                  <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-700">Tours opcionales</h2>
                  <ul className="space-y-0.5 text-gray-600">
                    {det.tours.map((t, i) => (
                      <li key={i}><b>{t.nombre}</b>{t.ciudad ? ` · ${t.ciudad}` : ""}{t.precio != null ? ` — ${formatMoneda(t.precio, moneda)}` : ""}</li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Condiciones */}
              {(p.texto_condiciones || p.texto_cancelacion || p.texto_pagos) && (
                <section className="space-y-2 text-[11px] text-gray-600 break-inside-avoid">
                  {p.texto_condiciones && <div><h3 className="font-bold text-gray-700">Condiciones generales</h3><p className="whitespace-pre-line">{p.texto_condiciones}</p></div>}
                  {p.texto_cancelacion && <div><h3 className="font-bold text-gray-700">Política de cancelación</h3><p className="whitespace-pre-line">{p.texto_cancelacion}</p></div>}
                  {p.texto_pagos && <div><h3 className="font-bold text-gray-700">Política de pagos</h3><p className="whitespace-pre-line">{p.texto_pagos}</p></div>}
                </section>
              )}

              {/* Footer */}
              {marcaBlanca ? (
                <footer className="mt-6 border-t border-gray-200 pt-3 text-center text-[10px] text-gray-400">
                  Tarifas por persona, sujetas a disponibilidad y cambios sin previo aviso.
                </footer>
              ) : (
                <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
                  <div className="text-[10px] leading-tight text-gray-500">
                    <Logo variant="full" height={26} className="mb-1 h-6 w-auto" />
                    {ag?.razon_social ?? "D'spacios Travel · Mayorista de Turismo"}
                    {ag?.nit ? ` · NIT ${ag.nit}${ag.dv ? `-${ag.dv}` : ""}` : ""}
                    {ag?.rnt ? ` · RNT ${ag.rnt}` : ""}
                    <br />
                    {[ag?.correo, ag?.telefono].filter(Boolean).join(" · ")}
                  </div>
                  {wa && (
                    <a href={wa} className="rounded-lg px-3 py-2 text-xs font-semibold text-white" style={{ backgroundColor: "var(--brand-success)" }}>
                      Reserva por WhatsApp
                    </a>
                  )}
                </footer>
              )}
            </div>
          </div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .programa-doc, .programa-doc * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .watermark {
              position: absolute; inset: 0;
              background-image: url('/marca/logo-full.png');
              background-repeat: no-repeat; background-position: center; background-size: 70%;
              opacity: 0.05; z-index: 0; pointer-events: none;
            }
            @page { size: A4; margin: 0; }
            @media print {
              html, body { background: #fff !important; }
              .cover { min-height: 200px; }
              .watermark { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-size: 60%; }
              .programa-doc > .relative > .p-7 { padding: 12mm; }
              /* Las tablas de precios pueden ser largas (varias salidas): que
                 fluyan de una página a otra en vez de saltar entera a la
                 siguiente (eso dejaba una página casi en blanco). Solo se evita
                 cortar una fila a la mitad, y el encabezado se repite arriba. */
              .programa-doc table thead { display: table-header-group; }
              .programa-doc table tr { break-inside: avoid; page-break-inside: avoid; }
              /* Que un título de sección no quede solo al final de una página. */
              .programa-doc h2 { break-after: avoid-page; }
            }
          `,
        }}
      />
    </div>
  );
}
