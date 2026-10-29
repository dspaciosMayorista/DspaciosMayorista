import Link from "next/link";
import { PortalShell, SubPestanas } from "@/components/portal/PortalShell";
import { PortalGate } from "@/components/portal/PortalGate";
import { TablaCotizaciones } from "@/components/portal/TablaCotizaciones";
import { ListaComparativas } from "@/components/portal/ListaComparativas";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import { resolverContextoPortal, cargarCotizacionesPortal, cargarComparativasPortal, linkPagoPortal } from "@/lib/portal/b2bPortalServidor";

export const dynamic = "force-dynamic";

const AVISO = "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800";

export default async function PortalCotizaciones({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return <PortalGate ctx={ctx} />;
  const { vista } = await searchParams;
  const actual = vista === "asistidas" ? "asistidas" : "directas";

  const [cots, comparativas, linkPago] = await Promise.all([cargarCotizacionesPortal(ctx), cargarComparativasPortal(ctx), linkPagoPortal()]);
  const hoy = hoyBogota();
  const filas = actual === "directas" ? cots.directas : cots.asistidas;
  const comps = actual === "directas" ? comparativas.directas : comparativas.asistidas;

  return (
    <PortalShell nombre={ctx.nombre} activa="cotizaciones" mostrarAgentes={ctx.esTitularAgencia} linkPago={linkPago}>
      <h1 className="mb-1 text-lg font-semibold text-gray-900">Cotizaciones</h1>
      <p className="mb-4 text-xs text-gray-500">Directas: las generaste tú desde el tarifario. Asistidas: las armó D&apos;spacios para ti.</p>
      <SubPestanas
        base="/portal/b2b/cotizaciones" actual={actual} etiqueta="Tipo de cotización"
        items={[
          { id: "directas", label: "Directas", cuenta: cots.directas.length + comparativas.directas.length },
          { id: "asistidas", label: "Asistidas", cuenta: cots.asistidas.length + comparativas.asistidas.length },
        ]}
      />
      {cots.error && <p role="status" className={`mb-3 ${AVISO}`}>No pudimos cargar todas tus cotizaciones, así que lo que ves puede estar incompleto. Intenta más tarde.</p>}
      {comparativas.error && <p role="status" className={`mb-3 ${AVISO}`}>No pudimos cargar tus comparativas en este momento; no significa que no tengas. Intenta más tarde.</p>}

      {(filas.length > 0 || comps.length === 0) && (
        <TablaCotizaciones
          filas={filas} hoy={hoy}
          vacio={actual === "directas"
            ? <>Aún no tienes cotizaciones directas. Arma una desde el <Link href="/tarifario" className="font-semibold" style={{ color: "var(--brand-primary)" }}>tarifario</Link>.</>
            : "Aún no tienes cotizaciones asistidas. Aparecerán aquí cuando D'spacios arme una para ti."}
        />
      )}
      {comps.length > 0 && <ListaComparativas comparativas={comps} hoy={hoy} />}
    </PortalShell>
  );
}
