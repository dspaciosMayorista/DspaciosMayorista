import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { buscarProgramas, detallePrograma, listarAgencias, porcentajeAgencia } from "@/lib/salesbot/lectura";
import type { DetalleConsulta } from "@/lib/salesbot/contrato";
import { formatFechaLarga, formatMoneda } from "@/lib/utils";
import { DateInput } from "@/components/ui/DateInput";
import { ACOMODACION, Aviso, BotonConsultar, ErrorConsulta, SelectorAudiencia, SelloConsulta, textoPorcentaje, uno, type Params } from "./comun";

// Pestaña Programas (#56, r1): circuitos publicados con PVP por persona como
// referencia. Nunca totales, base comisionable ni monto de comisión (#57).

const TRANSPORTE: Record<string, string> = { aereo: "Con aéreo", terrestre: "Salida terrestre", ninguno: "Porción terrestre" };

function Detalle({ d }: { d: DetalleConsulta }) {
  const precio = (v: number) => formatMoneda(v, d.moneda);
  return (
    <section className="space-y-4 rounded-lg border bg-white p-4" aria-labelledby="detalle-programa">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="detalle-programa" className="text-lg font-semibold" style={{ color: "var(--brand-primary)" }}>
            {d.nombre}
          </h2>
          <p className="text-sm text-gray-600">
            {[d.destino, TRANSPORTE[d.tipo_transporte], d.dias ? `${d.dias} días / ${d.noches ?? "-"} noches` : null].filter(Boolean).join(" · ")}
          </p>
          {(d.vigencia.desde || d.vigencia.hasta) && (
            <p className="text-xs text-gray-500">
              Vigencia: {formatFechaLarga(d.vigencia.desde)} — {formatFechaLarga(d.vigencia.hasta)}
            </p>
          )}
        </div>
        <Link href={d.url_vitrina} target="_blank" className="flex items-center gap-1 text-sm font-medium" style={{ color: "var(--brand-accent)" }}>
          Ver vitrina <ExternalLink size={14} aria-hidden />
        </Link>
      </div>

      {d.precio_en_revision && <Aviso texto="El precio de este programa está en revisión: confírmalo con el asesor antes de compartirlo." />}

      {d.ciudades.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Ruta</h3>
          <p className="text-sm text-gray-700">
            {d.ciudades.map((c) => `${c.nombre} (${c.noches} n)${c.alojamiento_previsto ? `, ${c.alojamiento_previsto}` : ""}`).join(" · ")}
          </p>
        </div>
      )}

      {d.modo_precio === "categoria" && d.categorias.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Precio por persona (referencia) por categoría</h3>
          <ul className="space-y-2 text-sm">
            {d.categorias.map((c) => (
              <li key={c.id}>
                <span className="font-medium">{c.nombre ?? "Categoría"}</span>
                {c.hoteles.length > 0 && <span className="text-gray-500"> — {c.hoteles.map((h) => `${h.ciudad}: ${h.hotel ?? "-"}`).join("; ")}</span>}
                <div className="text-gray-700">
                  {c.precios
                    .map((pr) => `${ACOMODACION[pr.acomodacion] ?? pr.acomodacion}: ${"a_solicitud" in pr ? "a solicitud" : precio(pr.pvp_por_persona)}`)
                    .join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.modo_precio === "salida" && d.salidas.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Precio por persona (referencia) por salida</h3>
          <ul className="space-y-2 text-sm">
            {d.salidas.map((s) => (
              <li key={s.id}>
                <span className="font-medium">
                  {[s.etiqueta, s.fecha_desde ? formatFechaLarga(s.fecha_desde) : null].filter(Boolean).join(" · ") || "Salida"}
                </span>
                {s.columna && <span className="text-gray-500"> — {s.columna}</span>}
                {s.noches != null && <span className="text-gray-500"> — {s.noches} noches</span>}
                <div className="text-gray-700">
                  {s.a_solicitud ? "A solicitud" : s.precios.map((pr) => `${ACOMODACION[pr.acomodacion] ?? pr.acomodacion}: ${precio(pr.pvp_por_persona)}`).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.itinerario.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-gray-800">Itinerario ({d.itinerario.length} días)</summary>
          <ol className="mt-2 space-y-1 text-sm text-gray-700">
            {d.itinerario.map((dia) => (
              <li key={dia.dia}>
                <span className="font-medium">Día {dia.dia}{dia.titulo ? `: ${dia.titulo}` : ""}</span>
                {dia.comidas.length > 0 && <span className="text-gray-500"> ({dia.comidas.join(", ")})</span>}
                {dia.descripcion && <p className="text-gray-600">{dia.descripcion}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {d.incluye.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-gray-800">Incluye</h3>
            <ul className="list-disc pl-5 text-sm text-gray-700">
              {d.incluye.map((i, k) => (
                <li key={k}>{i.ciudad ? `${i.ciudad}: ` : ""}{i.texto}</li>
              ))}
            </ul>
          </div>
        )}
        {d.no_incluye.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-gray-800">No incluye</h3>
            <ul className="list-disc pl-5 text-sm text-gray-700">
              {d.no_incluye.map((i, k) => (
                <li key={k}>{i.ciudad ? `${i.ciudad}: ` : ""}{i.texto}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {d.tours.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Tours opcionales (por persona, referencia)</h3>
          <ul className="space-y-1 text-sm text-gray-700">
            {d.tours.map((t, k) => (
              <li key={k}>
                {t.nombre}
                {t.ciudad ? ` · ${t.ciudad}` : ""}
                {t.pvp_por_persona != null ? ` · ${precio(t.pvp_por_persona)}` : ""}
                {t.min_pax_tour > 1 ? ` · mín. ${t.min_pax_tour} pax` : ""}
                {t.dias_operacion ? ` · ${t.dias_operacion}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.blackouts.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Fechas no disponibles</h3>
          <ul className="text-sm text-gray-700">
            {d.blackouts.map((b, k) => (
              <li key={k}>
                {formatFechaLarga(b.desde)} — {formatFechaLarga(b.hasta)}
                {b.motivo ? ` (${b.motivo})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-sm text-gray-700">
        <h3 className="mb-1 font-semibold text-gray-800">Condiciones</h3>
        {(d.edades.nino_max != null || d.edades.infante_max != null) && (
          <p>
            Edades: infante hasta {d.edades.infante_max ?? "-"} años; niño {d.edades.nino_min ?? "-"} a {d.edades.nino_max ?? "-"} años.
          </p>
        )}
        {d.condiciones.texto_condiciones && <p className="whitespace-pre-line">{d.condiciones.texto_condiciones}</p>}
        {d.condiciones.texto_cancelacion && <p className="whitespace-pre-line">Cancelación: {d.condiciones.texto_cancelacion}</p>}
        {d.condiciones.texto_pagos && <p className="whitespace-pre-line">Pagos: {d.condiciones.texto_pagos}</p>}
      </div>
    </section>
  );
}

export async function PanelProgramas({ sp }: { sp: Params }) {
  const audiencia = uno(sp, "audiencia") === "b2b" ? "b2b" : "b2c";
  const entrada = {
    texto: uno(sp, "texto"),
    destino: uno(sp, "destino"),
    tipoTransporte: uno(sp, "tipoTransporte"),
    fechaSalida: uno(sp, "fechaSalida"),
    presupuesto: uno(sp, "presupuesto"),
    monedaPresupuesto: uno(sp, "monedaPresupuesto"),
    limite: "10",
  };
  const programaId = uno(sp, "programa");
  const agenciaId = audiencia === "b2b" ? uno(sp, "agencia") : undefined;

  const [busqueda, detalle, agencias, pct] = await Promise.all([
    buscarProgramas(entrada),
    programaId ? detallePrograma(programaId) : Promise.resolve(null),
    audiencia === "b2b" ? listarAgencias() : Promise.resolve(null),
    agenciaId ? porcentajeAgencia(agenciaId) : Promise.resolve(null),
  ]);

  if (!busqueda.ok && busqueda.codigo === "no_autorizado") return <ErrorConsulta r={busqueda} />;

  const enlaceDetalle = (id: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "programa") q.set(k, v);
    q.set("programa", String(id));
    return `/dashboard/salesbot?${q.toString()}#detalle-programa`;
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Datos publicados del sistema para orientar al cliente. Los precios son por persona y solo de referencia: el total y la comisión los calcula el asesor.
      </p>

      <form method="get" className="grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-gray-700">Texto</span>
          <input name="texto" defaultValue={entrada.texto ?? ""} className="w-full rounded-md border px-2 py-1.5" placeholder="Nombre, ciudad o destino" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-700">Destino</span>
          <input name="destino" defaultValue={entrada.destino ?? ""} className="w-full rounded-md border px-2 py-1.5" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-700">Transporte</span>
          <select name="tipoTransporte" defaultValue={entrada.tipoTransporte ?? ""} className="w-full rounded-md border px-2 py-1.5">
            <option value="">Todos</option>
            <option value="aereo">Con aéreo</option>
            <option value="terrestre">Salida terrestre</option>
            <option value="ninguno">Porción terrestre</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-700">Fecha de salida</span>
          <DateInput name="fechaSalida" aria-label="Fecha de salida" defaultValue={entrada.fechaSalida ?? ""} className="w-full rounded-md border px-2 py-1.5" />
        </label>
        <div className="flex gap-2 text-sm">
          <label className="flex-1">
            <span className="mb-1 block text-gray-700">Presupuesto por persona</span>
            <input name="presupuesto" inputMode="numeric" defaultValue={entrada.presupuesto ?? ""} className="w-full rounded-md border px-2 py-1.5" />
          </label>
          <label>
            <span className="mb-1 block text-gray-700">Moneda</span>
            <select name="monedaPresupuesto" defaultValue={entrada.monedaPresupuesto ?? "COP"} className="rounded-md border px-2 py-1.5">
              <option value="COP">COP</option>
              <option value="USD">USD</option>
            </select>
          </label>
        </div>
        <SelectorAudiencia audiencia={audiencia} agencias={agencias?.ok ? agencias.datos : null} agenciaId={agenciaId} />
        <div className="flex items-end md:col-start-3">
          <BotonConsultar />
        </div>
      </form>

      {agencias && !agencias.ok && <ErrorConsulta r={agencias} />}
      {pct && (pct.ok ? <Aviso texto={textoPorcentaje(pct.datos)} /> : <ErrorConsulta r={pct} />)}

      <section className="space-y-3" aria-label="Resultados">
        {busqueda.ok ? (
          <>
            <SelloConsulta sello={busqueda.sello} />
            {busqueda.datos.parcial && <Aviso texto="Parte de la información no se pudo leer: los precios se omiten hasta volver a consultar." />}
            {busqueda.datos.omitidos_por_presupuesto > 0 && (
              <p className="text-xs text-gray-500">
                {busqueda.datos.omitidos_por_presupuesto} programa(s) sin precio en esa moneda no se compararon con el presupuesto.
              </p>
            )}
            <ul className="grid gap-3 md:grid-cols-2">
              {busqueda.datos.resultados.map((p) => (
                <li key={p.id} className="rounded-lg border bg-white p-3">
                  <p className="font-semibold text-gray-900">{p.nombre}</p>
                  <p className="text-sm text-gray-600">
                    {[p.destino, TRANSPORTE[p.tipo_transporte], p.dias ? `${p.dias} días / ${p.noches ?? "-"} noches` : null].filter(Boolean).join(" · ")}
                  </p>
                  {p.ciudades.length > 0 && <p className="text-xs text-gray-500">{p.ciudades.join(" · ")}</p>}
                  <p className="mt-1 text-sm">
                    {p.desde_pvp_por_persona != null ? (
                      <>
                        Desde <span className="font-semibold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(p.desde_pvp_por_persona, p.moneda)}</span> por persona (referencia)
                      </>
                    ) : (
                      <span className="text-gray-500">Sin precio publicado</span>
                    )}
                  </p>
                  {p.precio_en_revision && <p className="mt-1 text-xs font-medium text-amber-800">Precio en revisión: confirmar con el asesor</p>}
                  <div className="mt-2 flex gap-3 text-sm">
                    <Link href={enlaceDetalle(p.id)} style={{ color: "var(--brand-accent)" }}>
                      Ver detalle
                    </Link>
                    <Link href={p.url_vitrina} target="_blank" className="flex items-center gap-1" style={{ color: "var(--brand-accent)" }}>
                      Vitrina <ExternalLink size={12} aria-hidden />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            {busqueda.datos.truncado && (
              <p className="text-xs text-gray-500">
                Se muestran {busqueda.datos.resultados.length} de {busqueda.datos.total_encontrados}. Afina la búsqueda para ver otros.
              </p>
            )}
          </>
        ) : (
          <ErrorConsulta r={busqueda} />
        )}
      </section>

      {detalle &&
        (detalle.ok ? (
          <div className="space-y-2">
            <SelloConsulta sello={detalle.sello} />
            <Detalle d={detalle.datos} />
          </div>
        ) : (
          <ErrorConsulta r={detalle} />
        ))}
    </div>
  );
}
