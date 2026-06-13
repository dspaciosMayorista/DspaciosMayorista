import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProgramaDetalle } from "@/lib/programas";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { PrintButton } from "@/components/contrato/PrintButton";

export const dynamic = "force-dynamic";

const ACOM_LABEL: Record<string, string> = {
  sencilla: "Sencilla", doble: "Doble", triple: "Triple", cuadruple: "Cuádruple", multiple: "Múltiple", nino: "Niño",
};
const ACOM_ORDER = ["sencilla", "doble", "triple", "cuadruple", "multiple", "nino"];

function comidas(d: { desayuno: boolean; almuerzo: boolean; cena: boolean }): string {
  const c = [d.desayuno && "Desayuno", d.almuerzo && "Almuerzo", d.cena && "Cena"].filter(Boolean);
  return c.length ? `(${c.join(", ")})` : "";
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data } = await sb.from("programas").select("nombre").eq("id", Number(id)).maybeSingle();
  return { title: data ? `${data.nombre} — D'spacios Travel` : "Programa — D'spacios Travel" };
}

export default async function ProgramaDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
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

  const det = await getProgramaDetalle(sb, id);
  if (!det) notFound();
  if (!det.programa.publicado && !esInterno) notFound();

  const { programa: p } = det;
  const moneda = p.moneda;
  const incluye = det.inclusiones.filter((x) => x.tipo === "incluye");
  const noIncluye = det.inclusiones.filter((x) => x.tipo === "no_incluye");
  const acomsCat = ACOM_ORDER.filter((a) => det.categorias.some((c) => c.precios.some((pr) => pr.acomodacion === a)));
  const acomsSal = ACOM_ORDER.filter((a) => det.salidas.some((s) => s.precios.some((pr) => pr.acomodacion === a)));
  const haySalidaConHotel = det.salidas.some((s) => s.columna);

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-end px-4 print:hidden">
        <PrintButton />
      </div>

      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="programa-doc relative overflow-hidden rounded-xl bg-white p-8 shadow-sm print:rounded-none print:shadow-none">
          {/* Marca de agua de fondo (logo D'spacios), no membrete */}
          <div className="watermark" aria-hidden="true" />

          <div className="relative">
            {/* Encabezado */}
            <header className="mb-5 border-b border-gray-200 pb-4">
              <h1 className="text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>{p.nombre}</h1>
              {p.subtitulo && <p className="mt-1 text-sm text-gray-600">{p.subtitulo}</p>}
              <p className="mt-1 text-xs text-gray-500">
                {p.dias ? `${p.dias} días / ${p.noches ?? ""} noches` : ""}
                {p.incluye_aereo ? " · Con aéreo" : " · Solo terrestre"}
                {(p.vigencia_desde || p.vigencia_hasta) ? ` · Vigencia: ${formatFechaLarga(p.vigencia_desde)} — ${formatFechaLarga(p.vigencia_hasta)}` : ""}
              </p>
            </header>

            {/* Precios por categoría */}
            {det.categorias.length > 0 && (
              <section className="mb-5 break-inside-avoid">
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
              <section className="mb-5 break-inside-avoid">
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
                        <td className="py-1 pr-2 font-medium text-gray-700">{s.etiqueta ?? (s.fecha_desde ? `${formatFechaLarga(s.fecha_desde)} — ${formatFechaLarga(s.fecha_hasta)}` : "—")}</td>
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

            {/* Incluye / No incluye */}
            {(incluye.length > 0 || noIncluye.length > 0) && (
              <section className="mb-5 grid grid-cols-2 gap-4 break-inside-avoid text-xs">
                {incluye.length > 0 && (
                  <div>
                    <h3 className="mb-1 font-bold text-gray-700">El programa incluye</h3>
                    <ul className="space-y-0.5 text-gray-600">
                      {incluye.map((x, i) => <li key={i}>✓ {x.ciudad ? <b>{x.ciudad}: </b> : null}{x.texto}</li>)}
                    </ul>
                  </div>
                )}
                {noIncluye.length > 0 && (
                  <div>
                    <h3 className="mb-1 font-bold text-gray-700">No incluye</h3>
                    <ul className="space-y-0.5 text-gray-600">
                      {noIncluye.map((x, i) => <li key={i}>✕ {x.texto}</li>)}
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
                    <li key={i}>
                      <b>{t.nombre}</b>{t.ciudad ? ` · ${t.ciudad}` : ""}{t.precio != null ? ` — ${formatMoneda(t.precio, moneda)}` : ""}
                    </li>
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

            <footer className="mt-6 border-t border-gray-200 pt-3 text-center text-[10px] text-gray-400">
              D&apos;spacios Travel · Mayorista de Turismo — Tarifas por persona, sujetas a disponibilidad y cambios sin previo aviso.
            </footer>
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
            /* Marca de agua: logo grande, centrado y tenue, detrás del contenido.
               position: fixed se repite en cada página al imprimir. */
            .watermark {
              position: absolute;
              inset: 0;
              background-image: url('/marca/logo-full.png');
              background-repeat: no-repeat;
              background-position: center;
              background-size: 70%;
              opacity: 0.06;
              z-index: 0;
              pointer-events: none;
            }
            @page { size: A4; margin: 12mm; }
            @media print {
              html, body { background: #fff !important; }
              .watermark {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background-size: 60%;
              }
            }
          `,
        }}
      />
    </div>
  );
}
