import {
  EMPRESA,
  CONTRATO_TITULO,
  CONTRATO_INTRO,
  CLAUSULAS,
  CONSTANCIA_PREFIJO,
  FIRMA_ETIQUETAS,
  COPYRIGHT_PREFIJO,
} from "@/lib/contrato/plantilla";
import { formatCOP, formatFechaLarga, calcularEdad } from "@/lib/utils";
import type {
  Venta,
  ContratoPasajero,
  ContratoHotel,
  ContratoVuelo,
  ContratoItem,
} from "@/types/database";

type Props = {
  venta: Venta;
  pasajeros: ContratoPasajero[];
  hoteles: ContratoHotel[];
  vuelos: ContratoVuelo[];
  items: ContratoItem[];
  totalPagado: number;
};

const PRIMARY = "#1D7C9A";

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <span className="text-sm text-gray-800">{value || "—"}</span>
    </div>
  );
}

export function ContratoDocumento({
  venta,
  pasajeros,
  hoteles,
  vuelos,
  items,
  totalPagado,
}: Props) {
  const total = items.reduce(
    (s, it) => s + it.adultos * it.tarifa_adulto + it.ninos * it.tarifa_nino,
    0
  );
  const saldo = Math.max(total - totalPagado, 0);
  const anio = new Date().getFullYear();

  return (
    <div className="contrato-doc mx-auto max-w-3xl bg-white text-gray-800">
      {/* ── Encabezado ─────────────────────────────────────────── */}
      <header
        className="flex flex-col gap-3 rounded-t-xl px-5 py-5 text-white sm:flex-row sm:items-start sm:justify-between sm:gap-4 md:px-8 md:py-6"
        style={{ backgroundColor: PRIMARY }}
      >
        <div>
          <div className="text-2xl font-bold leading-none">
            D&apos;spacios Travel
          </div>
          <div className="mt-1 text-xs opacity-80">Mayorista de Turismo</div>
        </div>
        <div className="text-center">
          <div className="text-base font-semibold">{CONTRATO_TITULO}</div>
          <div className="mt-1 text-xs opacity-90">
            Contrato #: {venta.numero_contrato}
          </div>
          <div className="text-xs opacity-90">
            Emisión: {formatFechaLarga(venta.fecha_emision)}
          </div>
          <div className="text-xs opacity-90">
            Viaje: {formatFechaLarga(venta.fecha_salida)}
          </div>
        </div>
        <div className="text-right text-xs opacity-90">
          <div>{EMPRESA.sitio}</div>
          <div>{EMPRESA.correo}</div>
          <div className="mt-1">RNT {EMPRESA.rnt}</div>
        </div>
      </header>

      <div className="space-y-7 px-5 py-6 text-sm md:px-8 md:py-7">
        {/* ── Cliente ──────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold" style={{ color: PRIMARY }}>
            Cliente
          </h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Pill label="Nombre" value={venta.cliente} />
            <Pill label="N° Documento" value={venta.cliente_documento ?? ""} />
            <Pill label="Teléfono" value={venta.cliente_telefono ?? ""} />
            <Pill label="Dirección" value={venta.cliente_direccion ?? ""} />
          </div>
        </section>

        {/* ── Vuelos ───────────────────────────────────────────── */}
        {vuelos.length > 0 && (
          <section>
            <h2
              className="mb-2 text-sm font-semibold"
              style={{ color: PRIMARY }}
            >
              Vuelos
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {vuelos.map((v) => (
                <div
                  key={v.id}
                  className="rounded-lg border border-gray-200 p-3"
                >
                  <div className="flex items-center gap-2 font-semibold text-gray-700">
                    <span>✈</span> {v.aerolinea ?? "—"}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    Origen: {v.origen_codigo} — {v.origen_ciudad}
                  </div>
                  <div className="text-xs text-gray-600">
                    Destino: {v.destino_codigo} — {v.destino_ciudad}
                  </div>
                  {v.servicios && (
                    <div className="mt-1 text-xs text-gray-500">
                      Servicios: {v.servicios}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-500">
                    Fecha salida: {formatFechaLarga(v.fecha_salida)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Hoteles y Servicios ──────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold" style={{ color: PRIMARY }}>
            Hoteles y Servicios
          </h2>
          <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <Pill
              label="Asistencia Médica"
              value={venta.asistencia_medica ? "Sí" : "No"}
            />
            <Pill label="Servicio / Plan" value={venta.plan_nombre ?? ""} />
            <Pill
              label="Tours y Traslados"
              value={venta.tours_traslados ?? ""}
            />
          </div>
          {hoteles.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {hoteles.map((h) => (
                <div
                  key={h.id}
                  className="rounded-lg border border-gray-200 p-3"
                >
                  <div className="font-semibold text-gray-700">{h.nombre}</div>
                  <div className="mt-1 text-xs text-gray-600">
                    Ciudad: {h.ciudad ?? "—"}
                  </div>
                  <div className="text-xs text-gray-600">
                    Alimentación: {h.alimentacion ?? "—"} · Acomodación:{" "}
                    {h.acomodacion ?? "—"}
                  </div>
                  {h.detalle_acomodacion && (
                    <div className="text-xs text-gray-500">
                      {h.detalle_acomodacion}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-500">
                    {formatFechaLarga(h.fecha_ingreso)} →{" "}
                    {formatFechaLarga(h.fecha_salida)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Pasajeros ────────────────────────────────────────── */}
        {pasajeros.length > 0 && (
          <section>
            <h2
              className="mb-2 text-sm font-semibold"
              style={{ color: PRIMARY }}
            >
              Pasajeros
            </h2>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="border border-gray-200 px-2 py-1">#</th>
                  <th className="border border-gray-200 px-2 py-1">Nombre</th>
                  <th className="border border-gray-200 px-2 py-1">Tipo ID</th>
                  <th className="border border-gray-200 px-2 py-1">
                    Identificación
                  </th>
                  <th className="border border-gray-200 px-2 py-1">
                    Nacimiento
                  </th>
                  <th className="border border-gray-200 px-2 py-1">Edad</th>
                </tr>
              </thead>
              <tbody>
                {pasajeros.map((p, i) => {
                  const edad = calcularEdad(
                    p.fecha_nacimiento,
                    venta.fecha_salida
                  );
                  return (
                    <tr key={p.id}>
                      <td className="border border-gray-200 px-2 py-1">
                        {i + 1}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">
                        {p.nombre}
                        {p.es_infante && (
                          <span className="ml-1 text-[10px] text-gray-400">
                            (infante)
                          </span>
                        )}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">
                        {p.tipo_id ?? "—"}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">
                        {p.identificacion ?? "—"}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">
                        {formatFechaLarga(p.fecha_nacimiento)}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">
                        {edad ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </section>
        )}

        {/* ── Valores y Pagos ──────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold" style={{ color: PRIMARY }}>
            Valores y Pagos
          </h2>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-lg p-3 text-white" style={{ backgroundColor: PRIMARY }}>
              <div className="text-[10px] uppercase opacity-80">
                Total del contrato
              </div>
              <div className="text-base font-bold">{formatCOP(total)}</div>
            </div>
            <Pill label="Total pagado" value={formatCOP(totalPagado)} />
            <Pill label="Saldo pendiente" value={formatCOP(saldo)} />
            <Pill label="Moneda" value="COP" />
          </div>

          {items.length > 0 && (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="border border-gray-200 px-2 py-1">Ítem</th>
                  <th className="border border-gray-200 px-2 py-1">Adultos</th>
                  <th className="border border-gray-200 px-2 py-1">Niños</th>
                  <th className="border border-gray-200 px-2 py-1">
                    Tarifa Adulto
                  </th>
                  <th className="border border-gray-200 px-2 py-1">
                    Tarifa Niño
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="border border-gray-200 px-2 py-1">
                      {it.descripcion}
                    </td>
                    <td className="border border-gray-200 px-2 py-1">
                      {it.adultos}
                    </td>
                    <td className="border border-gray-200 px-2 py-1">
                      {it.ninos}
                    </td>
                    <td className="border border-gray-200 px-2 py-1">
                      {formatCOP(it.tarifa_adulto)}
                    </td>
                    <td className="border border-gray-200 px-2 py-1">
                      {formatCOP(it.tarifa_nino)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>

        {/* ── Cláusulas ────────────────────────────────────────── */}
        <section className="break-before-page">
          <h2 className="mb-3 text-center text-sm font-bold uppercase tracking-wide text-gray-700">
            {CONTRATO_TITULO}
          </h2>
          <p className="mb-4 text-justify text-xs leading-relaxed text-gray-600">
            {CONTRATO_INTRO}
          </p>
          <div className="space-y-3">
            {CLAUSULAS.map((c) => (
              <div key={c.numero} className="break-inside-avoid">
                <h3 className="text-xs font-semibold text-gray-700">
                  {c.numero}. {c.titulo}
                </h3>
                {c.parrafos.map((p, i) => (
                  <p
                    key={i}
                    className="mt-1 text-justify text-[11px] leading-relaxed text-gray-600"
                  >
                    {p}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* ── Constancia + Firma ───────────────────────────────── */}
        <section className="break-inside-avoid pt-2 text-xs text-gray-600">
          <p>
            {CONSTANCIA_PREFIJO} {formatFechaLarga(venta.fecha_emision)}.
          </p>
          <div className="mt-8">
            <div className="w-64 border-t border-gray-400 pt-1">
              <div className="font-semibold text-gray-800">
                {venta.asesor_firma_nombre ?? "—"}
              </div>
              <div>
                {FIRMA_ETIQUETAS.cargo} {venta.asesor_firma_cargo ?? "Asesor/a"}
              </div>
              {venta.asesor_firma_cc && (
                <div>
                  {FIRMA_ETIQUETAS.cc} {venta.asesor_firma_cc}
                </div>
              )}
              {venta.asesor_firma_tel && (
                <div>
                  {FIRMA_ETIQUETAS.tel} {venta.asesor_firma_tel}
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 rounded-lg bg-gray-50 p-3 text-[11px]">
            <div className="font-semibold text-gray-700">Datos de pago</div>
            <div>
              {EMPRESA.cuentaBancaria.banco} — {EMPRESA.cuentaBancaria.tipo}{" "}
              {EMPRESA.cuentaBancaria.numero}
            </div>
            <div>A nombre de {EMPRESA.cuentaBancaria.titular}</div>
            <div className="mt-1">
              {EMPRESA.razonSocial} · NIT {EMPRESA.nit} · RNT {EMPRESA.rnt}
            </div>
          </div>

          <p className="mt-6 text-center text-[10px] text-gray-400">
            {COPYRIGHT_PREFIJO} {anio} · Documento digital — se solicita no
            imprimir.
          </p>
        </section>
      </div>
    </div>
  );
}
