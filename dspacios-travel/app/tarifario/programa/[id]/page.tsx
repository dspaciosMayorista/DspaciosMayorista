import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProgramaDetalle } from "@/lib/programas";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

const ACOM_LABEL: Record<string, string> = {
  sencilla: "Sencilla",
  doble: "Doble",
  triple: "Triple",
  cuadruple: "Cuádruple",
  multiple: "Múltiple",
  nino: "Niño",
};
const ACOM_ORDER = ["sencilla", "doble", "triple", "cuadruple", "multiple", "nino"];

function comidas(d: { desayuno: boolean; almuerzo: boolean; cena: boolean }): string {
  const c = [d.desayuno && "Desayuno", d.almuerzo && "Almuerzo", d.cena && "Cena"].filter(Boolean);
  return c.length ? `(${c.join(", ")})` : "";
}

export default async function ProgramaVitrinaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  let rol: string | null = null;
  if (user) {
    const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
    rol = perfil?.rol ?? null;
  }
  const esInterno = !!rol && ["superadmin", "operaciones", "gerencia", "administracion", "venta"].includes(rol);
  const puedeReservar = !!rol && ["superadmin", "operaciones", "gerencia", "administracion", "venta", "agencia", "freelance"].includes(rol);

  const det = await getProgramaDetalle(sb, id);
  if (!det) notFound();
  // No mostrar borradores al público.
  if (!det.programa.publicado && !esInterno) notFound();

  const { programa: p } = det;
  const moneda = p.moneda;
  const incluye = det.inclusiones.filter((x) => x.tipo === "incluye");
  const noIncluye = det.inclusiones.filter((x) => x.tipo === "no_incluye");

  const acomsPresentes = ACOM_ORDER.filter((a) => det.categorias.some((c) => c.precios.some((pr) => pr.acomodacion === a)));
  const salidaAcoms = ACOM_ORDER.filter((a) => det.salidas.some((s) => s.precios.some((pr) => pr.acomodacion === a)));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand-gradient px-6 py-8 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-center justify-between">
            <Link href="/tarifario" aria-label="Tarifario">
              <Logo variant="white" height={40} priority className="h-9 w-auto" />
            </Link>
            <Link href="/tarifario" className="text-sm underline-offset-2 hover:underline">
              ← Volver al tarifario
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold">{p.nombre}</h1>
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium">
              {p.incluye_aereo ? "✈ Con aéreo" : "Solo terrestre"}
            </span>
          </div>
          <p className="mt-1 text-sm opacity-90">
            {p.subtitulo ?? ""}
            {p.dias ? ` · ${p.dias} días / ${p.noches ?? ""} noches` : ""}
            {p.salidas ? ` · Salidas: ${p.salidas}` : ""}
          </p>
          {p.desde_precio != null && p.desde_precio > 0 && (
            <p className="mt-2 text-sm">
              <span className="opacity-80">Desde</span>{" "}
              <span className="text-xl font-semibold">{formatMoneda(p.desde_precio, moneda)}</span>{" "}
              <span className="opacity-80">por persona</span>
            </p>
          )}
          {(p.vigencia_desde || p.vigencia_hasta) && (
            <p className="mt-1 text-xs opacity-80">
              Vigencia: {formatFechaLarga(p.vigencia_desde)} — {formatFechaLarga(p.vigencia_hasta)}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 md:px-6">
        {p.portada_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.portada_url} alt={p.nombre} className="h-64 w-full rounded-xl object-cover" />
        )}
        {puedeReservar && (
          <div className="flex justify-end">
            <Link
              href={`/dashboard/reservar/programa/${p.id}`}
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--brand-primary)" }}
            >
              Reservar este programa →
            </Link>
          </div>
        )}

        {/* Precios por salida (modo fecha × precio) */}
        {det.salidas.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-semibold text-gray-900">Salidas y precios por persona ({moneda})</h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-4 py-3">Salida</th>
                    <th className="px-4 py-3">Noches</th>
                    {det.salidas.some((s) => s.columna) && <th className="px-4 py-3">Hotel</th>}
                    {salidaAcoms.map((a) => (
                      <th key={a} className="px-4 py-3 text-right">{ACOM_LABEL[a] ?? a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {det.salidas.map((s) => (
                    <tr key={s.id} className="border-b border-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-700">
                        {s.etiqueta ?? (s.fecha_desde ? `${formatFechaLarga(s.fecha_desde)} — ${formatFechaLarga(s.fecha_hasta)}` : "—")}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{s.noches ?? "—"}</td>
                      {det.salidas.some((x) => x.columna) && <td className="px-4 py-3 text-gray-600">{s.columna ?? "—"}</td>}
                      {salidaAcoms.map((a) => {
                        const pr = s.precios.find((p) => p.acomodacion === a);
                        return (
                          <td key={a} className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>
                            {s.bajo_solicitud ? "A solicitud" : pr?.pvp != null ? formatMoneda(pr.pvp, moneda) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Precios por categoría */}
        {det.categorias.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-semibold text-gray-900">Precios por persona ({moneda})</h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-4 py-3">Categoría</th>
                    {det.ciudades.map((c) => (
                      <th key={c.id} className="px-4 py-3">{c.nombre}</th>
                    ))}
                    {acomsPresentes.map((a) => (
                      <th key={a} className="px-4 py-3 text-right">{ACOM_LABEL[a] ?? a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {det.categorias.map((cat, i) => {
                    const hotelDe = (ciudad: string) => cat.hoteles.find((h) => h.ciudad === ciudad)?.hotel ?? "—";
                    const precioDe = (acom: string) => cat.precios.find((pr) => pr.acomodacion === acom);
                    return (
                      <tr key={cat.id} className="border-b border-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-700">{cat.nombre ?? `Categoría ${i + 1}`}</td>
                        {det.ciudades.map((c) => (
                          <td key={c.id} className="px-4 py-3 text-gray-600">{hotelDe(c.nombre)}</td>
                        ))}
                        {acomsPresentes.map((a) => {
                          const pr = precioDe(a);
                          return (
                            <td key={a} className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>
                              {pr?.bajo_solicitud ? "A solicitud" : pr?.pvp != null ? formatMoneda(pr.pvp, moneda) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Itinerario */}
        {det.dias.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-semibold text-gray-900">Itinerario</h2>
            <div className="space-y-3">
              {det.dias.map((d) => (
                <div key={d.dia} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="font-semibold text-gray-800">
                    Día {d.dia}{d.titulo ? `: ${d.titulo}` : ""}{" "}
                    <span className="text-xs font-normal text-gray-400">{comidas(d)}</span>
                  </div>
                  {d.descripcion && <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{d.descripcion}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Incluye / No incluye */}
        {(incluye.length > 0 || noIncluye.length > 0) && (
          <section className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {incluye.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="mb-2 font-semibold text-gray-800">El programa incluye</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  {incluye.map((x, i) => (
                    <li key={i} className="flex gap-2">
                      <span style={{ color: "var(--brand-success)" }}>✓</span>
                      <span>{x.ciudad ? <b>{x.ciudad}: </b> : null}{x.texto}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {noIncluye.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="mb-2 font-semibold text-gray-800">No incluye</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  {noIncluye.map((x, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-gray-300">✕</span>
                      <span>{x.texto}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Tours opcionales */}
        {det.tours.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-semibold text-gray-900">Tours opcionales</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {det.tours.map((t, i) => (
                <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-gray-800">{t.nombre}</div>
                    {t.precio != null && (
                      <div className="shrink-0 font-semibold" style={{ color: "var(--brand-primary)" }}>
                        {formatMoneda(t.precio, moneda)}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {t.ciudad ?? ""}{t.min_pax ? ` · mín ${t.min_pax} pax` : ""}{t.dias_operacion ? ` · ${t.dias_operacion}` : ""}
                  </p>
                  {t.descripcion && <p className="mt-1 text-sm text-gray-600">{t.descripcion}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Blackouts y condiciones */}
        {det.blackouts.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold text-gray-800">Fechas no disponibles (blackouts)</h3>
            <ul className="grid grid-cols-1 gap-1 text-sm text-gray-600 sm:grid-cols-2">
              {det.blackouts.map((b, i) => (
                <li key={i}>
                  {formatFechaLarga(b.fecha_inicio)} — {formatFechaLarga(b.fecha_fin)}
                  {b.motivo ? ` · ${b.motivo}` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}

        {(p.texto_condiciones || p.texto_cancelacion || p.texto_pagos) && (
          <section className="space-y-3 text-sm text-gray-600">
            {p.texto_condiciones && (
              <div>
                <h3 className="font-semibold text-gray-800">Condiciones generales</h3>
                <p className="whitespace-pre-line">{p.texto_condiciones}</p>
              </div>
            )}
            {p.texto_cancelacion && (
              <div>
                <h3 className="font-semibold text-gray-800">Política de cancelación</h3>
                <p className="whitespace-pre-line">{p.texto_cancelacion}</p>
              </div>
            )}
            {p.texto_pagos && (
              <div>
                <h3 className="font-semibold text-gray-800">Política de pagos</h3>
                <p className="whitespace-pre-line">{p.texto_pagos}</p>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
