import Link from "next/link";
import { Plane } from "lucide-react";
import { buscarBloqueos, cotizarBloqueo, ofertaBloqueoPorClave, prepararConsultaPaquetes } from "@/lib/salesbot/paquetes/lectura";
import { listarAgencias, porcentajeAgencia } from "@/lib/salesbot/lectura";
import type { CotizacionPaquete, DisponibilidadVuelo, OfertaBloqueo } from "@/lib/salesbot/paquetes/contrato";
import { formatFechaLarga, formatMoneda } from "@/lib/utils";
import { DateInput } from "@/components/ui/DateInput";
import { ACOMODACION, Aviso, BotonConsultar, CamposComposicion, enlaceCon, ErrorConsulta, Ocultos, SelectorAudiencia, SelloConsulta, textoPorcentaje, uno, type Params } from "./comun";

// Pestaña Bloqueos (#56): oferta publicada (vuelo negociado + hotel) y
// cotización orientativa con el motor de venta vigente. Las sillas se informan
// como libres AL CONSULTAR: nunca se apartan ni se prometen.

function textoVuelo(estado: DisponibilidadVuelo, sillas: number | null): string {
  switch (estado) {
    case "sillas_libres":
      return `${sillas} silla(s) libre(s) al consultar. No se apartan.`;
    case "sin_sillas":
      return "Sin sillas libres en este momento.";
    case "no_verificada":
      return "No se pudieron verificar las sillas: confírmalo con el asesor.";
    case "sujeto_a_confirmacion":
      return "Tiquete de sistema: sujeto a confirmación.";
  }
}

function Oferta({ o, sp }: { o: OfertaBloqueo; sp: Params }) {
  return (
    <li className="rounded-lg border bg-white p-3">
      <p className="font-semibold text-gray-900">{o.hotel_nombre ?? "Hotel"}</p>
      <p className="text-sm text-gray-600">
        {[o.destino, o.ruta, o.noches ? `${o.noches} noches` : null].filter(Boolean).join(" · ")}
      </p>
      <p className="text-xs text-gray-500">
        {formatFechaLarga(o.fecha_ida)} — {formatFechaLarga(o.fecha_regreso)}
        {o.paquete_nombre ? ` · ${o.paquete_nombre}` : ""}
      </p>
      <p className="mt-1 text-sm">
        {o.desde_pvp_por_persona != null ? (
          <>
            Desde <span className="font-semibold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(o.desde_pvp_por_persona, o.moneda)}</span> por persona (referencia)
          </>
        ) : (
          <span className="text-gray-500">Sin precio publicado</span>
        )}
      </p>
      <p className="mt-1 flex items-center gap-1 text-xs text-gray-600">
        <Plane size={12} aria-hidden /> {textoVuelo(o.disponibilidad_vuelo, o.sillas_libres)}
      </p>
      <Link href={enlaceCon(sp, { oferta: o.clave }, ["combo"], "#cotizar-bloqueo")} className="mt-2 inline-block text-sm" style={{ color: "var(--brand-accent)" }}>
        Cotizar
      </Link>
    </li>
  );
}

function Cotizacion({ c }: { c: CotizacionPaquete }) {
  const precio = (v: number) => formatMoneda(v, c.moneda);
  return (
    <section className="space-y-3 rounded-lg border bg-white p-4" aria-label="Cotización orientativa">
      <h3 className="text-base font-semibold" style={{ color: "var(--brand-primary)" }}>
        Cotización orientativa: {precio(c.total_orientativo)}
      </h3>
      <p className="text-sm text-gray-600">
        {[c.hotel_nombre, c.destino, `${c.categoria} · ${c.regimen}`].filter(Boolean).join(" · ")} · {formatFechaLarga(c.fecha_ida)} — {formatFechaLarga(c.fecha_regreso)} · {c.total_pax} pax
      </p>
      <ul className="text-sm text-gray-700">
        {c.lineas.map((l) => (
          <li key={l.acomodacion}>
            {l.habitaciones} hab. {ACOMODACION[l.acomodacion] ?? l.acomodacion} ({l.pax} pax) · {precio(l.pvp_por_persona)} por persona
          </li>
        ))}
        {c.menores.nino > 0 && <li>{c.menores.nino} niño(s){c.pvp_menores_por_persona.nino != null ? ` · ${precio(c.pvp_menores_por_persona.nino)} por niño` : ""}</li>}
        {c.menores.nino2 > 0 && <li>{c.menores.nino2} niño(s) 2{c.pvp_menores_por_persona.nino2 != null ? ` · ${precio(c.pvp_menores_por_persona.nino2)} por niño` : ""}</li>}
        {c.menores.infante > 0 && <li>{c.menores.infante} infante(s){c.pvp_menores_por_persona.infante != null ? ` · ${precio(c.pvp_menores_por_persona.infante)} por infante` : " · sin cargo"}</li>}
      </ul>
      {c.disponibilidad_vuelo && (
        <p className="flex items-center gap-1 text-sm text-gray-700">
          <Plane size={14} aria-hidden /> {textoVuelo(c.disponibilidad_vuelo, c.sillas_libres)}
          {c.alcanzan_sillas === false && " No alcanzan para esta composición."}
        </p>
      )}
      {c.alcanzan_sillas === false && <Aviso texto="Las sillas libres no alcanzan para estos pasajeros: no ofrezcas esta salida sin confirmarlo con el asesor." />}
      {c.condiciones_tarifa.length > 0 && (
        <div className="text-sm text-gray-700">
          <p className="font-medium">Condiciones de la tarifa</p>
          <ul className="list-disc pl-5">
            {c.condiciones_tarifa.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {c.nota_nino && <p className="text-xs text-gray-500">{c.nota_nino}</p>}
      <p className="text-xs text-gray-500">Precio calculado por el sistema de venta. Hotel sujeto a confirmación; el asesor confirma antes de vender.</p>
    </section>
  );
}

export async function PanelBloqueos({ sp }: { sp: Params }) {
  const prep = await prepararConsultaPaquetes();
  if (!prep.ok) return <Aviso texto={prep.motivo} />;
  const { ctx } = prep;
  const audiencia = uno(sp, "audiencia") === "b2b" ? "b2b" : "b2c";
  const agenciaId = audiencia === "b2b" ? uno(sp, "agencia") : undefined;
  const claveOferta = uno(sp, "oferta");

  const busqueda = buscarBloqueos(ctx, {
    texto: uno(sp, "texto"),
    destino: uno(sp, "destino"),
    fechaDesde: uno(sp, "fechaDesde"),
    fechaHasta: uno(sp, "fechaHasta"),
    limite: "10",
  });
  const oferta = claveOferta ? ofertaBloqueoPorClave(ctx, claveOferta) : null;
  const entradaCotizacion: Record<string, string | undefined> = { oferta: claveOferta, combo: uno(sp, "combo"), edadesMenores: uno(sp, "edadesMenores") };
  for (const h of ["sencilla", "doble", "triple", "multiple"]) entradaCotizacion[`hab_${h}`] = uno(sp, `hab_${h}`);

  const [cotizacion, agencias, pct] = await Promise.all([
    oferta && uno(sp, "combo") ? cotizarBloqueo(ctx, entradaCotizacion) : Promise.resolve(null),
    audiencia === "b2b" ? listarAgencias() : Promise.resolve(null),
    agenciaId ? porcentajeAgencia(agenciaId) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Paquetes con vuelo negociado y hotel. Precios por persona como referencia; la cotización usa el mismo cálculo de la venta y es orientativa.
      </p>
      <form method="get" className="grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-3">
        <input type="hidden" name="producto" value="bloqueos" />
        <label className="text-sm">
          <span className="mb-1 block text-gray-700">Texto</span>
          <input name="texto" defaultValue={uno(sp, "texto") ?? ""} className="w-full rounded-md border px-2 py-1.5" placeholder="Hotel, ruta o paquete" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-700">Destino</span>
          <input name="destino" defaultValue={uno(sp, "destino") ?? ""} className="w-full rounded-md border px-2 py-1.5" />
        </label>
        <div className="flex gap-2 text-sm">
          <label className="flex-1">
            <span className="mb-1 block text-gray-700">Salida desde</span>
            <DateInput name="fechaDesde" aria-label="Salida desde" defaultValue={uno(sp, "fechaDesde") ?? ""} className="w-full rounded-md border px-2 py-1.5" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-gray-700">Hasta</span>
            <DateInput name="fechaHasta" aria-label="Salida hasta" defaultValue={uno(sp, "fechaHasta") ?? ""} className="w-full rounded-md border px-2 py-1.5" />
          </label>
        </div>
        <SelectorAudiencia audiencia={audiencia} agencias={agencias?.ok ? agencias.datos : null} agenciaId={agenciaId} />
        <div className="flex items-end md:col-start-3">
          <BotonConsultar />
        </div>
      </form>

      {agencias && !agencias.ok && <ErrorConsulta r={agencias} />}
      {pct && (pct.ok ? <Aviso texto={textoPorcentaje(pct.datos)} /> : <ErrorConsulta r={pct} />)}

      <section className="space-y-3" aria-label="Bloqueos">
        {busqueda.ok ? (
          <>
            <SelloConsulta sello={busqueda.sello} />
            <ul className="grid gap-3 md:grid-cols-2">
              {busqueda.datos.ofertas.map((o) => (
                <Oferta key={o.clave} o={o} sp={sp} />
              ))}
            </ul>
            {busqueda.datos.truncado && (
              <p className="text-xs text-gray-500">
                Se muestran {busqueda.datos.ofertas.length} de {busqueda.datos.total_encontradas}. Afina la búsqueda para ver otras.
              </p>
            )}
          </>
        ) : (
          <ErrorConsulta r={busqueda} />
        )}
      </section>

      {claveOferta && !oferta && <Aviso texto="Esa oferta ya no está publicada o vigente." />}
      {oferta && (
        <section id="cotizar-bloqueo" className="space-y-3 rounded-lg border bg-white p-4" aria-label="Cotizar bloqueo">
          <h2 className="text-lg font-semibold" style={{ color: "var(--brand-primary)" }}>
            Cotizar: {[oferta.hotel_nombre ?? "Hotel", oferta.ruta].filter(Boolean).join(" · ")}
          </h2>
          <form method="get" className="grid gap-3 md:grid-cols-3">
            <Ocultos sp={sp} claves={["producto", "texto", "destino", "fechaDesde", "fechaHasta", "audiencia", "agencia", "oferta"]} />
            <label className="text-sm md:col-span-3">
              <span className="mb-1 block text-gray-700">Categoría y régimen</span>
              <select name="combo" defaultValue={uno(sp, "combo") ?? ""} className="w-full rounded-md border px-2 py-1.5">
                <option value="">Elige una opción</option>
                {oferta.combos.map((c) => (
                  <option key={`${c.categoria}|${c.regimen}`} value={`${c.categoria}|${c.regimen}`}>
                    {c.categoria} · {c.regimen} —{" "}
                    {Object.entries(c.pvp_por_persona)
                      .map(([a, v]) => `${ACOMODACION[a] ?? a} ${formatMoneda(v, oferta.moneda)}`)
                      .join(", ")}
                  </option>
                ))}
              </select>
            </label>
            <CamposComposicion sp={sp} />
            <div className="flex items-end">
              <BotonConsultar texto="Cotizar" />
            </div>
          </form>
          {cotizacion &&
            (cotizacion.ok ? (
              <div className="space-y-2">
                <SelloConsulta sello={cotizacion.sello} />
                <Cotizacion c={cotizacion.datos} />
              </div>
            ) : (
              <ErrorConsulta r={cotizacion} />
            ))}
        </section>
      )}
    </div>
  );
}
