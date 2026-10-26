// #88 — Ficha (y documento) de un programa terrestre por hotel y vigencia: precio base por
// persona para toda la estancia incluida, por vigencia de la fecha de ENTRADA y modalidad de
// servicios, y tarifa de noche adicional con la unidad de cobro de cada vigencia. Solo PVP:
// jamás recibe un neto (la tabla ya viene calculada en el servidor).
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { ETIQUETA_ACOM, ETIQUETA_MODALIDAD, ETIQUETA_UNIDAD, ACOMODACIONES_ADULTO } from "@/lib/programas/estanciaHotel88";
import type { TablaHotelPvp } from "@/lib/programas/precioReserva57";

const COLUMNAS = [...ACOMODACIONES_ADULTO, "nino"] as const;

export function EstanciaHotelesFicha({ tablas, moneda, noches, compacto = false }: { tablas: TablaHotelPvp[]; moneda: string; noches: number | null; compacto?: boolean }) {
  if (!tablas.length) return null;
  const celda = "px-3 py-2 text-right tabular-nums";
  const color = { color: "var(--brand-primary)" };
  return (
    <section className="space-y-5" aria-label="Precios por hotel y vigencia">
      <h2 className={compacto ? "text-lg font-semibold text-gray-900" : "text-xl font-semibold text-gray-900"}>
        Hoteles y precios por persona ({moneda})
      </h2>
      <p className="text-xs text-gray-500">
        El precio base incluye {noches != null ? `las ${noches} noches` : "la estancia"} del programa y se define por la fecha de entrada al hotel.
        Las noches adicionales se agregan después de la estancia incluida y cada una se cobra con la tarifa vigente en su propia fecha.
      </p>
      {tablas.map((t) => {
        const bases = [...t.base].sort((a, b) => a.desde.localeCompare(b.desde) || a.modalidad.localeCompare(b.modalidad));
        const cols = COLUMNAS.filter((c) => bases.some((b) => b.pvp[c] != null) || t.noches.some((n) => n.pvp[c] != null));
        const ocupacion = [
          t.hotel.maxPaxHabitacion != null ? `máx. ${t.hotel.maxPaxHabitacion} persona(s) por habitación` : null,
          t.hotel.maxMenoresHabitacion != null ? `máx. ${t.hotel.maxMenoresHabitacion} menor(es)` : null,
        ].filter(Boolean).join(" · ");
        return (
          <div key={t.hotel.id} className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="font-semibold text-gray-900">{t.hotel.nombre}</h3>
              <p className="text-xs text-gray-500">
                {[t.hotel.zona, t.hotel.tipoHabitacion, ocupacion].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="px-4 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Estancia incluida · por fecha de entrada</caption>
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2">Entrada</th>
                    <th className="px-3 py-2">Servicios</th>
                    {cols.map((c) => <th key={c} className="px-3 py-2 text-right">{c === "nino" ? "Menor" : ETIQUETA_ACOM[c]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {bases.map((b) => (
                    <tr key={b.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-700">{formatFechaLarga(b.desde)} — {formatFechaLarga(b.hasta)}</td>
                      <td className="px-3 py-2 text-gray-600">{ETIQUETA_MODALIDAD[b.modalidad]}</td>
                      {cols.map((c) => (
                        <td key={c} className={celda} style={color}>
                          {b.bajoSolicitud ? "A solicitud" : b.pvp[c] != null ? formatMoneda(b.pvp[c]!, moneda) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!bases.length && <tr><td className="px-3 py-3 text-gray-400" colSpan={cols.length + 2}>Sin precios cargados.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="px-4 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Noche adicional · por fecha de cada noche (servicios privados y regulares)</caption>
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2">Noche</th>
                    <th className="px-3 py-2">Se cobra</th>
                    {cols.map((c) => <th key={c} className="px-3 py-2 text-right">{c === "nino" ? "Menor" : ETIQUETA_ACOM[c]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...t.noches].sort((a, b) => a.desde.localeCompare(b.desde)).map((n) => (
                    <tr key={n.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-700">{formatFechaLarga(n.desde)} — {formatFechaLarga(n.hasta)}</td>
                      <td className="px-3 py-2 text-gray-600">{ETIQUETA_UNIDAD[n.unidad]}</td>
                      {cols.map((c) => (
                        <td key={c} className={celda} style={color}>
                          {c === "nino" && n.unidad === "habitacion" ? "Incluido" : n.pvp[c] != null ? formatMoneda(n.pvp[c]!, moneda) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!t.noches.length && <tr><td className="px-3 py-3 text-gray-400" colSpan={cols.length + 2}>Este hotel no tiene noches adicionales cargadas.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
              Cuando la noche se cobra por habitación, el valor es por habitación y noche y los menores ocupantes van incluidos; cuando se cobra por persona, cada menor paga su tarifa.
            </p>
          </div>
        );
      })}
    </section>
  );
}
