import { createAdminClient } from "@/lib/supabase/admin";
import { cargarContextoEdicion } from "@/lib/portal/perfilEdicionServidor";
import { contextoFirma, firmaDataUri, firmaVigente } from "@/lib/cuentaCobro/servidor";
import { formatFechaLarga } from "@/lib/utils";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { FirmaAliado } from "@/components/portal/FirmaAliado";

/**
 * #98 — Sección «Mi firma» de Mi perfil (UNA línea de montaje en la página del perfil). Solo la ve el freelance titular de su ficha; para agencias y fichas
 * compartidas no muestra nada. 3 lecturas (usuario, conteo de ficha compartida y ficha) + 1 de la firma + 1 descarga de Storage solo si ya hay firma.
 */
export async function FirmaAliadoSeccion({ userId }: { userId: string }) {
  const admin = createAdminClient(); // identidad:n/a — tablas propias de #98 (sin número de contrato) y Storage
  const c = contextoFirma(await cargarContextoEdicion(admin, userId));
  if (!c || !c.valido || c.tipo !== "freelance" || !c.puedeFicha || c.aliadoId == null) return null;
  const f = await firmaVigente(admin, c.aliadoId);
  if (!f.ok) return <p className="mb-4 text-xs text-gray-400">No pudimos leer tu firma ahora. Intenta más tarde.</p>;
  const imagen = f.firma ? await firmaDataUri(admin, f.firma.id, c.aliadoId) : null;
  return (
    <div className="mb-4">
      <FirmaAliado imagen={imagen} vigenteDesde={f.firma ? formatFechaLarga(fechaNegocio(new Date(f.firma.creado_en))) : null} />
    </div>
  );
}
