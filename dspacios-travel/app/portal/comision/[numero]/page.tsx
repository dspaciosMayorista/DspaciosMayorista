import { notFound } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "@/components/contrato/PrintButton";
import { CuentaCobroDocumento } from "@/components/portal/CuentaCobroDocumento";
import { AceptarCuenta } from "@/components/portal/AceptarCuenta";
import { formatFechaLarga } from "@/lib/utils";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agenciaDe } from "@/lib/tenant.server";
import { esTenant } from "@/lib/tenant";
import { resolverComisionB2B } from "@/lib/finanzas/comisionResolver";
import { cargarContextoEdicion } from "@/lib/portal/perfilEdicionServidor";
import { construirSnapshot, elegirVersion, hashSnapshot, MENSAJE_NO_FIRMA, puedeFirmar } from "@/lib/cuentaCobro/snapshot";
import { contextoFirma, firmaDataUri, firmaVigente, leerAceptaciones } from "@/lib/cuentaCobro/servidor";
import { tituloDocumento } from "@/lib/utils/tituloDocumento";
import { ElegirComision, idComisionDeQuery } from "./ElegirComision";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ numero: string }>; searchParams: Promise<{ id?: string | string[]; v?: string | string[] }> };

export async function generateMetadata({ params, searchParams }: Props) {
  const { numero } = await params;
  const r = await resolverComisionB2B(numero, idComisionDeQuery((await searchParams).id));
  return { title: { absolute: tituloDocumento("Cuenta de cobro", r?.numeroContrato ?? numero, r?.tipo === "comision" ? r.aliado : undefined) } };
}

const Aviso = ({ children }: { children: React.ReactNode }) => (
  <div className="mx-auto mb-3 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:hidden" role="status">{children}</div>
);

export default async function CuentaCobroPage({ params, searchParams }: Props) {
  const { numero } = await params;
  const sp = await searchParams;
  const r = await resolverComisionB2B(numero, idComisionDeQuery(sp.id));
  if (!r) notFound();
  if (r.tipo === "elegir") return <ElegirComision r={r} />;

  // Cuenta de cobro = documento de PERSONA NATURAL (freelance). Las agencias
  // (persona jurídica) deben facturar electrónicamente, no generan este documento.
  if (r.tipoAsesorEfectivo === "agencia" && !r.esInterno) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-sm text-gray-600">
          Esta comisión corresponde a una agencia (persona jurídica). Las agencias deben
          enviar su factura electrónica para cobrar la comisión, no una cuenta de cobro.
        </p>
      </div>
    );
  }

  // Membrete: razón/nombre comercial de la agencia dueña del contrato (mayorista
  // o minorista) — antes estaba fijo en "Mayorista", incorrecto para minorista.
  const tenantVenta = esTenant(r.tenant) ? r.tenant : "mayorista";
  const agencia = await agenciaDe(tenantVenta);
  const vivo = construirSnapshot(r, {
    nombre: agencia?.nombre_comercial || agencia?.razon_social || "D'SPACIOS TRAVEL",
    nit: agencia?.nit ?? null,
    direccion: agencia?.direccion ?? null,
  }, fechaNegocio());
  const hashVivo = hashSnapshot(vivo);
  const admin = createAdminClient(); // identidad:n/a — tablas propias de #98 (sin número de contrato) y Storage; el acceso ya lo decidió resolverComisionB2B

  // ── #98: ¿hay una versión ACEPTADA con exactamente este contenido? ─────────
  const lectura = vivo.clave ? await leerAceptaciones(admin, vivo.clave) : { ok: true as const, filas: [] };
  const volver = (
    <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
      <Link href="/portal/b2b" className="text-sm text-gray-500 hover:text-gray-800">← Mis contratos</Link>
      <div className="flex items-center gap-3">
        {r.aliadoB2bId != null && (
          <Link href={`/portal/comision/${encodeURIComponent(r.numeroContrato)}/estado-cuenta?id=${r.aliadoB2bId}`} className="text-sm text-gray-500 hover:text-gray-800">
            Estado de cuenta →
          </Link>
        )}
        <PrintButton />
      </div>
    </div>
  );
  if (!lectura.ok) {
    // Sin poder comprobar si ya fue aceptada, no se muestra una versión «sin aceptar» que podría ser falsa.
    return <div className="min-h-screen bg-gray-100 py-6">{volver}<Aviso>No pudimos comprobar si esta cuenta de cobro ya fue aceptada. Intenta de nuevo en unos minutos.</Aviso></div>;
  }
  const filas = lectura.filas;
  const vParam = Array.isArray(sp.v) ? sp.v[0] : sp.v;
  const mostrada = elegirVersion(filas, hashVivo, vParam);
  const base = `/portal/comision/${encodeURIComponent(r.numeroContrato)}`;
  const qId = r.aliadoB2bId != null ? `?id=${r.aliadoB2bId}` : "";

  let snap = vivo;
  let firma = null as null | { version: number; aceptadaEn: string; imagen: string | null };
  let aviso: React.ReactNode = null;
  let acciones: React.ReactNode = null;
  if (mostrada) {
    snap = mostrada.snapshot;
    firma = {
      version: mostrada.version,
      aceptadaEn: mostrada.aceptada_en,
      imagen: snap.aliado.id != null ? await firmaDataUri(admin, mostrada.firma_id, snap.aliado.id) : null,
    };
    if (mostrada.snapshot_hash !== hashVivo) {
      aviso = <Aviso>Estás viendo la versión {mostrada.version}, aceptada el {formatFechaLarga(fechaNegocio(new Date(mostrada.aceptada_en)))}. Después cambiaron valores o datos del documento: la versión vigente aún no ha sido aceptada. <Link className="underline" href={`${base}${qId}`}>Ver la versión vigente</Link></Aviso>;
    }
  } else {
    if (filas.length > 0) aviso = <Aviso>Los valores o datos de esta cuenta de cobro cambiaron después de la última aceptación (versión {filas[filas.length - 1].version}). Esta versión vigente está sin aceptar; la versión aceptada sigue disponible abajo.</Aviso>;
    // Solo el aliado freelance dueño puede aceptar; el personal interno ve el documento pero nunca acepta por él.
    if (!r.esInterno && r.esDueno && r.tipoAsesorEfectivo !== "agencia") {
      const { data: { user } } = await (await createClient()).auth.getUser();
      const p = puedeFirmar(r, user ? contextoFirma(await cargarContextoEdicion(admin, user.id)) : null);
      if (p.ok) {
        const f = await firmaVigente(admin, p.aliadoId);
        acciones = !f.ok
          ? <Aviso>No pudimos leer tu firma ahora. Intenta de nuevo en unos minutos.</Aviso>
          : f.firma
            ? <AceptarCuenta numero={r.numeroContrato} comisionId={r.aliadoB2bId} hash={hashVivo} />
            : <Aviso>Para aceptar esta cuenta de cobro primero sube la imagen de tu firma en <Link className="underline" href="/portal/b2b/perfil">Mi perfil</Link>.</Aviso>;
      } else if (p.motivo === "ficha_compartida" || p.motivo === "ficha_distinta" || p.motivo === "sin_ficha") {
        acciones = <Aviso>{MENSAJE_NO_FIRMA[p.motivo]}</Aviso>;
      }
    }
  }
  const historial = filas.length > 0 && (
    <nav className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-xs print:hidden" aria-label="Versiones aceptadas">
      <p className="font-semibold text-gray-700">Versiones aceptadas</p>
      <ul className="mt-1 space-y-1">
        {[...filas].reverse().map((f) => (
          <li key={f.id}>
            <Link className={`underline ${mostrada?.id === f.id ? "font-semibold" : ""}`} href={`${base}${qId}${qId ? "&" : "?"}v=${f.version}`}>
              Versión {f.version} — {formatFechaLarga(fechaNegocio(new Date(f.aceptada_en)))}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="min-h-screen bg-gray-100 py-6 print:min-h-0 print:bg-white print:py-0">
      {volver}
      {aviso}
      <CuentaCobroDocumento snap={snap} firma={firma} acciones={<>{acciones}{historial}</>} />
    </div>
  );
}
