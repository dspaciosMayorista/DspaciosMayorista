import Link from "next/link";
import { PortalShell, Titulo, Aviso, SubPestanas } from "@/components/portal/PortalShell";
import { BotonTarifario } from "@/components/portal/BotonTarifario";
import { PortalGate } from "@/components/portal/PortalGate";
import { TablaCotizaciones } from "@/components/portal/TablaCotizaciones";
import { ListaComparativas } from "@/components/portal/ListaComparativas";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import { resolverContextoPortal, cargarCotizacionesPortal, cargarComparativasPortal, cargarValorContratosPortal, cargarSolicitudesContratoPortal, linkPagoPortal } from "@/lib/portal/b2bPortalServidor";
import { cargarPreparacionPortal } from "@/lib/portal/preparacionContratoServidor";

export const dynamic = "force-dynamic";

export default async function PortalCotizaciones({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return <PortalGate ctx={ctx} />;
  const { vista } = await searchParams;
  const actual = vista === "asistidas" ? "asistidas" : "directas";

  const [cots, comparativas, linkPago, solicitudes] = await Promise.all([cargarCotizacionesPortal(ctx), cargarComparativasPortal(ctx), linkPagoPortal(), cargarSolicitudesContratoPortal(ctx)]);
  const hoy = hoyBogota();
  // #84: valor vigente de los contratos de las cotizaciones convertidas (una lectura por lote de 100, solo de los contratos que esta lista ya muestra).
  const valores = await cargarValorContratosPortal(ctx, [...cots.directas, ...cots.asistidas]);
  const filas = actual === "directas" ? cots.directas : cots.asistidas;
  // O-3: comprobantes y pasajeros adicionales solo de las cotizaciones que esta lista ya muestra (las propias del aliado).
  const preparacion = await cargarPreparacionPortal(filas.filter((c) => c.modo !== "comparativa" && c.estado !== "convertida").map((c) => c.id));
  const comps = actual === "directas" ? comparativas.directas : comparativas.asistidas;

  return (
    <PortalShell nombre={ctx.nombre} rol={ctx.rol} cta={<BotonTarifario />} activa="cotizaciones" mostrarAgentes={ctx.esTitularAgencia} linkPago={linkPago}>
      <Titulo apoyo={<>Directas: las generaste tú desde el tarifario. Asistidas: las armó D&apos;spacios para ti.</>}>Cotizaciones</Titulo>
      <SubPestanas
        base="/portal/b2b/cotizaciones" actual={actual} etiqueta="Tipo de cotización"
        items={[
          { id: "directas", label: "Directas", cuenta: cots.directas.length + comparativas.directas.length },
          { id: "asistidas", label: "Asistidas", cuenta: cots.asistidas.length + comparativas.asistidas.length },
        ]}
      />
      {valores.error && <Aviso>No pudimos cargar el valor actual de tus contratos; se muestra el valor cotizado. Intenta más tarde.</Aviso>}
      {cots.error && <Aviso>No pudimos cargar todas tus cotizaciones, así que lo que ves puede estar incompleto. Intenta más tarde.</Aviso>}
      {solicitudes.error && <Aviso>No pudimos cargar el estado de tus solicitudes de contrato; no significa que no hayas solicitado alguna. Intenta más tarde.</Aviso>}
      {preparacion.error && <Aviso>No pudimos cargar tus comprobantes y pasajeros adicionales; lo que ves puede estar incompleto. Intenta más tarde.</Aviso>}
      {comparativas.error && <Aviso>No pudimos cargar tus comparativas en este momento; no significa que no tengas. Intenta más tarde.</Aviso>}

      {(filas.length > 0 || comps.length === 0) && (
        <TablaCotizaciones
          filas={filas} hoy={hoy} contratos={valores.mapa} solicitudes={solicitudes.porCotizacion} preparaciones={preparacion.porCotizacion}
          vacio={actual === "directas"
            ? <>Aún no tienes cotizaciones directas. Arma una desde el <Link href="/tarifario" className="font-semibold" style={{ color: "var(--brand-primary)" }}>tarifario</Link>.</>
            : "Aún no tienes cotizaciones asistidas. Aparecerán aquí cuando D'spacios arme una para ti."}
        />
      )}
      {comps.length > 0 && <ListaComparativas comparativas={comps} hoy={hoy} />}
    </PortalShell>
  );
}
