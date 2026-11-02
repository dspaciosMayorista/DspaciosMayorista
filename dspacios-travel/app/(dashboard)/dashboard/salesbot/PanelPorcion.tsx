import Link from "next/link";
import { buscarPorcion, cotizarPorcion, destinosPorcionDisponibles, prepararConsultaPaquetes } from "@/lib/salesbot/paquetes/lectura";
import { listarAgencias, porcentajeAgencia } from "@/lib/salesbot/lectura";
import type { CotizacionPaquete, ResultadoPorcion } from "@/lib/salesbot/paquetes/contrato";
import { formatFechaLarga, formatMoneda } from "@/lib/utils";
import { DateInput } from "@/components/ui/DateInput";
import { ACOMODACION, Aviso, BotonConsultar, CamposComposicion, enlaceCon, ErrorConsulta, SelectorAudiencia, SelloConsulta, textoPorcentaje, uno, type Params } from "./comun";

// Pestaña Porción terrestre (#56): hotel sin vuelo, reliquidado EN VIVO para
// las fechas y la composición reales con los motores de venta vigentes. El
// "desde" publicado no se usa como cotización. Sin inventario hotelero: todo
// es "sujeto a confirmación".

const CLAVES_BUSQUEDA = ["producto", "destino", "fechaIda", "fechaRegreso", "adultos", "hab_sencilla", "hab_doble", "hab_triple", "hab_multiple", "edadesMenores", "audiencia", "agencia"];

function textoCondicion(c: ResultadoPorcion["condicion_pago"]): string | null {
  if (!c) return null;
  const partes = [c.tipo === "pago_total" ? "Pago total" : c.pct_inicial != null ? `Anticipo ${c.pct_inicial}%` : "Anticipo", c.dias_saldo != null ? `saldo ${c.dias_saldo} días antes` : null, c.no_reembolsable ? "no reembolsable" : null];
  return partes.filter(Boolean).join(" · ");
}

function TotalPorcion({ c }: { c: CotizacionPaquete }) {
  const precio = (v: number) => formatMoneda(v, c.moneda);
  return (
    <div className="space-y-1 rounded-md border p-3">
      <p className="text-base font-semibold" style={{ color: "var(--brand-primary)" }}>
        Cotización orientativa: {precio(c.total_orientativo)} ({c.total_pax} pax)
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
      {c.condiciones_tarifa.length > 0 && <p className="text-xs text-gray-600">Condiciones: {c.condiciones_tarifa.join(" · ")}</p>}
      {c.nota_nino && <p className="text-xs text-gray-500">{c.nota_nino}</p>}
    </div>
  );
}

export async function PanelPorcion({ sp }: { sp: Params }) {
  const prep = await prepararConsultaPaquetes();
  if (!prep.ok) return <Aviso texto={prep.motivo} />;
  const { ctx } = prep;
  const destinos = destinosPorcionDisponibles(ctx);
  const audiencia = uno(sp, "audiencia") === "b2b" ? "b2b" : "b2c";
  const agenciaId = audiencia === "b2b" ? uno(sp, "agencia") : undefined;

  const entrada: Record<string, string | undefined> = {};
  for (const k of CLAVES_BUSQUEDA) entrada[k] = uno(sp, k);
  entrada.limite = "10";
  const hayBusqueda = !!(entrada.destino && entrada.fechaIda && entrada.fechaRegreso);
  const paquete = uno(sp, "paquete");
  const hotel = uno(sp, "hotel");

  const [busqueda, cotizacion, agencias, pct] = await Promise.all([
    hayBusqueda ? buscarPorcion(ctx, entrada) : Promise.resolve(null),
    hayBusqueda && paquete && hotel ? cotizarPorcion(ctx, { ...entrada, paquete, hotel, combo: uno(sp, "combo") }) : Promise.resolve(null),
    audiencia === "b2b" ? listarAgencias() : Promise.resolve(null),
    agenciaId ? porcentajeAgencia(agenciaId) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Hotel sin vuelo. Elige destino, fechas y composición: cada hotel se recalcula para esas fechas con el mismo cálculo de la venta. Sujeto a disponibilidad del hotel.
      </p>
      <form method="get" className="grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-3">
        <input type="hidden" name="producto" value="porcion" />
        <label className="text-sm">
          <span className="mb-1 block text-gray-700">Destino</span>
          <select name="destino" defaultValue={entrada.destino ?? ""} className="w-full rounded-md border px-2 py-1.5" required>
            <option value="">Elige un destino</option>
            {destinos.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-700">Ida</span>
          <DateInput name="fechaIda" aria-label="Fecha de ida" defaultValue={entrada.fechaIda ?? ""} className="w-full rounded-md border px-2 py-1.5" required />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-700">Regreso</span>
          <DateInput name="fechaRegreso" aria-label="Fecha de regreso" defaultValue={entrada.fechaRegreso ?? ""} className="w-full rounded-md border px-2 py-1.5" required />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-700">Adultos</span>
          <input name="adultos" inputMode="numeric" defaultValue={entrada.adultos ?? ""} className="w-full rounded-md border px-2 py-1.5" required />
        </label>
        <CamposComposicion sp={sp} />
        <SelectorAudiencia audiencia={audiencia} agencias={agencias?.ok ? agencias.datos : null} agenciaId={agenciaId} />
        <div className="flex items-end md:col-start-3">
          <BotonConsultar />
        </div>
      </form>

      {agencias && !agencias.ok && <ErrorConsulta r={agencias} />}
      {pct && (pct.ok ? <Aviso texto={textoPorcentaje(pct.datos)} /> : <ErrorConsulta r={pct} />)}

      {busqueda &&
        (busqueda.ok ? (
          <section className="space-y-3" aria-label="Hoteles">
            <SelloConsulta sello={busqueda.sello} />
            {busqueda.datos.resultados.length === 0 && busqueda.datos.sugerencias_fecha.length > 0 && (
              <Aviso texto="Ningún hotel cotiza esas fechas exactas. Fechas cercanas con tarifa:" />
            )}
            {busqueda.datos.sugerencias_fecha.length > 0 && (
              <ul className="flex flex-wrap gap-2 text-sm">
                {busqueda.datos.sugerencias_fecha.map((s) => (
                  <li key={`${s.fecha_ida}-${s.fecha_regreso}`}>
                    <Link href={enlaceCon(sp, { fechaIda: s.fecha_ida, fechaRegreso: s.fecha_regreso }, ["paquete", "hotel", "combo"])} style={{ color: "var(--brand-accent)" }}>
                      {s.etiqueta}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <ul className="grid gap-3 md:grid-cols-2">
              {busqueda.datos.resultados.map((r) => (
                <li key={`${r.paquete_id}-${r.hotel_id}`} className="rounded-lg border bg-white p-3">
                  <p className="font-semibold text-gray-900">{r.hotel_nombre ?? "Hotel"}</p>
                  <p className="text-sm text-gray-600">{[r.destino, r.paquete_nombre, `${r.noches} noches`].filter(Boolean).join(" · ")}</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {r.combos.map((c) => (
                      <li key={`${c.categoria}|${c.regimen}`}>
                        {c.categoria} · {c.regimen}:{" "}
                        <span className="font-semibold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(c.total_orientativo, r.moneda)}</span> ({c.pax} pax, orientativo){" "}
                        <Link
                          href={enlaceCon(sp, { paquete: String(r.paquete_id), hotel: String(r.hotel_id), combo: `${c.categoria}|${c.regimen}` }, [], "#detalle-porcion")}
                          style={{ color: "var(--brand-accent)" }}
                        >
                          Ver detalle
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {textoCondicion(r.condicion_pago) && <p className="mt-1 text-xs text-gray-500">{textoCondicion(r.condicion_pago)}</p>}
                  <p className="mt-1 text-xs text-gray-500">Sujeto a disponibilidad del hotel.</p>
                </li>
              ))}
            </ul>
            {busqueda.datos.truncado && (
              <p className="text-xs text-gray-500">
                Se muestran {busqueda.datos.resultados.length} de {busqueda.datos.total_encontrados}.
              </p>
            )}
          </section>
        ) : (
          <ErrorConsulta r={busqueda} />
        ))}

      {cotizacion && (
        <section id="detalle-porcion" className="space-y-3 rounded-lg border bg-white p-4" aria-label="Detalle del hotel">
          {cotizacion.ok ? (
            <>
              <SelloConsulta sello={cotizacion.sello} />
              <h2 className="text-lg font-semibold" style={{ color: "var(--brand-primary)" }}>
                Precio por persona · {formatFechaLarga(cotizacion.datos.fecha_ida)} — {formatFechaLarga(cotizacion.datos.fecha_regreso)} ({cotizacion.datos.noches} noches)
              </h2>
              {cotizacion.datos.precio_no_final && (
                <Aviso texto={`Incluye servicios cobrados por grupo (${cotizacion.datos.servicios_grupo_pendientes.join(", ")}): el precio por persona no es final hasta saber el número de viajeros.`} />
              )}
              <ul className="space-y-1 text-sm text-gray-700">
                {cotizacion.datos.combos.map((c) => (
                  <li key={`${c.categoria}|${c.regimen}`}>
                    <span className="font-medium">
                      {c.categoria} · {c.regimen}:
                    </span>{" "}
                    {Object.entries(c.pvp_por_persona)
                      .map(([a, v]) => `${ACOMODACION[a] ?? a} ${formatMoneda(v, cotizacion.datos.moneda)}`)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
              {cotizacion.datos.cotizacion && <TotalPorcion c={cotizacion.datos.cotizacion} />}
              <p className="text-xs text-gray-500">Precios del sistema de venta, orientativos. Sujeto a disponibilidad del hotel; el asesor confirma antes de vender.</p>
            </>
          ) : (
            <>
              <ErrorConsulta r={cotizacion} />
              {"sugerencias_fecha" in cotizacion && cotizacion.sugerencias_fecha.length > 0 && (
                <div className="text-sm">
                  <p className="mb-1 text-gray-700">Fechas cercanas con tarifa:</p>
                  <ul className="flex flex-wrap gap-2">
                    {cotizacion.sugerencias_fecha.map((s) => (
                      <li key={`${s.fecha_ida}-${s.fecha_regreso}`}>
                        <Link href={enlaceCon(sp, { fechaIda: s.fecha_ida, fechaRegreso: s.fecha_regreso }, [], "#detalle-porcion")} style={{ color: "var(--brand-accent)" }}>
                          {s.etiqueta}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
