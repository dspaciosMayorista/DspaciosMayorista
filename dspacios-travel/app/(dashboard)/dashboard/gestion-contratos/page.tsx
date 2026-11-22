import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleAlert, Info } from "lucide-react";
import { cargarGestionContratos } from "@/lib/gestionContratos/cargar.server";
import { aQuery, hayFiltros, POR_PAGINA, totalPaginas } from "@/lib/gestionContratos/filtros";
import { NOMBRE_AGENCIA, dinero } from "@/lib/gestionContratos/presentacion";
import { FiltrosGestionUI } from "./FiltrosGestion";
import { TablaGestion } from "./TablaGestion";

export const dynamic = "force-dynamic";

// #106 · Gestión integral de contratos — SOLO superadmin, Mayorista y Minorista juntos. La agencia es un filtro de esta pantalla (no la cookie de agencia activa).
export default async function GestionContratosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const carga = await cargarGestionContratos(await searchParams);
  if (carga.estado === "sin_permiso") redirect("/dashboard");
  if (carga.estado === "error") {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Gestión de contratos</h1>
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"><CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden /> {carga.mensaje}</p>
      </div>
    );
  }
  const { filtros, pagina, avisos, datos, pisoDesde } = carga;
  const paginas = totalPaginas(datos.total);
  const enlace = (p: number) => `/dashboard/gestion-contratos${aQuery(filtros, p)}`;
  const fueraDeRango = datos.filas.length === 0 && datos.total > 0;

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Gestión de contratos</h1>
      <p className="mt-1 text-sm text-gray-500">
        Mayorista y Minorista juntos. Solo superadmin. Saldo = total de cobro − abonos, en la moneda de cobro de cada contrato (nunca se suman monedas distintas).
      </p>
      <p className="mt-2 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span>
        Cada voucher y cada factura se leen en dos pasos separados: <strong>generación</strong> (voucher) o <strong>emisión validada por la DIAN</strong> (factura), y después la <strong>entrega</strong> o el <strong>envío</strong>.
        «Entrega registrada manualmente» y «Envío registrado manualmente» son acuses de un superadmin: indican que el personal reporta la acción, no que el sistema envió un correo ni que el cliente lo recibió o aceptó.
        Un voucher generado o una factura emitida no cuentan como entregados o enviados hasta que se registre el acuse.
        </span>
      </p>

      <div className="mt-4"><FiltrosGestionUI actuales={filtros} /></div>
      {avisos.length > 0 && <ul className="mt-3 space-y-1 text-xs text-amber-700">{avisos.map((a) => <li key={a} className="flex items-start gap-1"><CircleAlert size={12} className="mt-0.5 shrink-0" aria-hidden /> {a}</li>)}</ul>}

      <section aria-label="Resumen del conjunto filtrado" className="mt-4">
        <p className="text-sm text-gray-600"><strong className="tabular-nums">{datos.total.toLocaleString("es-CO")}</strong> contrato{datos.total === 1 ? "" : "s"}{pisoDesde ? ` con viaje desde hoy (${pisoDesde}, hora de Bogotá)` : hayFiltros(filtros) ? " con estos filtros" : " en total"}.</p>
        {pisoDesde && (
          <p data-testid="nota-viaje-reciente" className="mt-1 text-xs text-gray-500">
            «Viaje más reciente» muestra solo salidas de hoy en adelante, la más próxima primero; no incluye viajes pasados ni contratos sin fecha de salida. Para consultar el historial, elige otro orden o fija «Viaje (salida) desde/hasta» en Más filtros.
          </p>
        )}
        {!pisoDesde && filtros.orden === "salida_asc" && (
          <p data-testid="nota-viaje-explicito" className="mt-1 text-xs text-gray-500">Con fechas de viaje elegidas se muestran también salidas anteriores a hoy, ordenadas por fecha de salida ascendente.</p>
        )}
        {datos.resumen.length > 0 && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {datos.resumen.map((r) => (
              <div key={`${r.tenant}:${r.moneda}`} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{NOMBRE_AGENCIA[r.tenant]} · {r.moneda}</p>
                <p className="mt-0.5 tabular-nums text-gray-900">{dinero(r.saldoPorCobrar, r.moneda)} <span className="text-xs text-gray-500">por cobrar</span></p>
                <p className="text-xs text-gray-500">{r.conSaldo} con saldo · {r.contratos} contratos{r.sobrepagados > 0 ? ` · ${r.sobrepagados} sobrepagado${r.sobrepagados === 1 ? "" : "s"}` : ""}{r.sinTotal > 0 ? ` · ${r.sinTotal} sin total` : ""}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-4">
        {fueraDeRango
          ? <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Esta página no existe para estos filtros. <Link href={enlace(1)} prefetch={false} className="font-medium underline">Volver a la primera página</Link>.</div>
          : <TablaGestion filas={datos.filas} />}
      </div>

      {paginas > 1 && (
        <nav aria-label="Paginación" className="mt-4 flex items-center justify-between text-sm text-gray-600">
          {pagina > 1 ? <Link href={enlace(pagina - 1)} prefetch={false} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-50"><ChevronLeft size={14} aria-hidden /> Anterior</Link> : <span />}
          <span>Página {pagina} de {paginas} · {POR_PAGINA} por página</span>
          {pagina < paginas ? <Link href={enlace(pagina + 1)} prefetch={false} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-50">Siguiente <ChevronRight size={14} aria-hidden /></Link> : <span />}
        </nav>
      )}
    </div>
  );
}
