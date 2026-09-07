"use client";

import Link from "next/link";
import { useState } from "react";
import { cambiarTenant } from "@/app/(dashboard)/tenant-actions";
import { TENANT_LABEL, type Tenant } from "@/lib/tenant";

/**
 * Enlace "Editar en contrato" de los renglones SUBORDINADOS de infante en los
 * manifiestos de vuelo. Componente cliente REUTILIZABLE por las dos
 * superficies (detalle de bloqueo y listado global de pasajeros), que recibe
 * TODO lo que necesita decidir de quién corresponde:
 *
 *   - `numeroContrato`: el número interno REAL (con su prefijo, si existe, tal
 *     cual vive en `ventas`), que es el destino `/dashboard/contratos/[numero]`;
 *   - `tenantContrato`: el tenant REAL de esa venta (leído por el servidor de
 *     `ventas.tenant` con la RLS de la sesión — ver lib/vuelos/enlaceContrato.ts),
 *     NUNCA deducido del texto del número;
 *   - `tenantActivo`: la agencia ACTIVA actual de la sesión (cookie, la misma
 *     que muestra el sidebar).
 *
 * Comportamiento:
 *   - si `tenantContrato === tenantActivo`, navega NORMAL (nada que cambiar);
 *   - si difieren, PRIMERO llama (y espera) a la Server Action `cambiarTenant`
 *     con el tenant del contrato y navega con recarga COMPLETA solo cuando
 *     responde `ok: true` — la recarga hace que layout, sidebar y datos re-lean
 *     la cookie nueva (mismo patrón que TenantSwitcher);
 *   - si `cambiarTenant` responde `ok: false` o lanza error, NO navega y
 *     muestra un error discreto junto al enlace.
 *
 * El servidor ya garantizó (fail-closed) que este enlace solo existe cuando el
 * usuario puede abrir el contrato Y puede cambiar a su tenant si es distinto
 * (ver `enlaceContratoEnVuelo`); este componente NO autoriza por rol ni lee la
 * base: solo ejecuta el cambio de agencia cuando corresponde.
 */
export function EnlaceEditarContrato({
  numeroContrato,
  tenantContrato,
  tenantActivo,
}: {
  numeroContrato: string;
  tenantContrato: Tenant;
  tenantActivo: Tenant;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const requiereCambio = tenantContrato !== tenantActivo;
  const href = `/dashboard/contratos/${numeroContrato}`;

  async function manejarClic(e: React.MouseEvent<HTMLAnchorElement>) {
    // Mismo tenant activo → navegación normal del enlace (sin tocar la cookie).
    if (!requiereCambio) return;
    // Tenant distinto → la navegación es manual: cambiar agencia y recién
    // después ir al contrato. Se ignora cualquier clic mientras hay uno en curso.
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setFallo(null);
    try {
      const res = await cambiarTenant(tenantContrato);
      if (!res.ok) {
        setFallo(`No se pudo abrir: no se permite cambiar a la agencia ${TENANT_LABEL[tenantContrato]}.`);
        setOcupado(false);
        return;
      }
      // Navegación/recarga COMPLETA para que layout, sidebar y datos usen la
      // cookie ya cambiada (el mismo patrón de TenantSwitcher).
      window.location.assign(href);
    } catch {
      setFallo(`No se pudo abrir el contrato ${numeroContrato}. Inténtalo de nuevo.`);
      setOcupado(false);
    }
  }

  return (
    <>
      <span className="text-gray-300" aria-hidden="true">·</span>
      <Link
        href={href}
        title={`Editar el contrato ${numeroContrato} en su ficha`}
        aria-disabled={ocupado}
        onClick={(e) => {
          void manejarClic(e);
        }}
        className={`font-medium text-[#1D7C9A] hover:underline${ocupado ? " cursor-wait opacity-60" : ""}`}
      >
        Editar en contrato
      </Link>
      {fallo && (
        <span role="status" className="text-[11px] font-medium text-red-600">{fallo}</span>
      )}
    </>
  );
}
