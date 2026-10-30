import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  RUTA_LISTA, esRolClientesContratos, etiquetaCanal, normalizarNumeroContrato, numeroParaMostrar,
  obtenerFichaContrato, rolDelActor, rutaContrato,
} from "@/lib/crm/clientesContratos68";

export const dynamic = "force-dynamic";

// Ficha de UN contrato (#68). Mismo contrato de respuesta para «ajeno», «de otro tenant», «inexistente» y «sin
// permiso»: la RPC devuelve vacío y esta página muestra siempre el mismo texto, sin revelar cuál de los casos fue.
// No hay sección de coincidencias con otros contratos ni lectura de crm_contactos (V1).

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href={RUTA_LISTA} className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--brand-primary)] hover:underline">
        <ArrowLeft size={14} /> Clientes de contratos
      </Link>
      {children}
    </div>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{valor && valor.trim() ? valor : "—"}</dd>
    </div>
  );
}

export default async function FichaClienteContratoPage({ params }: { params: Promise<{ numero_contrato: string }> }) {
  const sb = await createClient();
  const rol = await rolDelActor(sb);
  if (!esRolClientesContratos(rol)) {
    return (
      <Marco>
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Módulo no disponible para tu usuario.</p>
      </Marco>
    );
  }

  const numero = normalizarNumeroContrato((await params).numero_contrato);
  const res = numero ? await obtenerFichaContrato(sb, numero) : ({ ok: true, contrato: null } as const);

  if (!res.ok) {
    return (
      <Marco>
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{res.error}</p>
      </Marco>
    );
  }
  if (!res.contrato) {
    return (
      <Marco>
        <h1 className="text-xl font-semibold text-gray-900">Contrato no disponible</h1>
        <p className="mt-3 rounded-lg bg-white px-4 py-4 text-sm text-gray-600">
          No hay un contrato con ese número que puedas consultar desde aquí.
        </p>
      </Marco>
    );
  }

  const c = res.contrato;
  return (
    <Marco>
      <h1 className="text-2xl font-bold text-gray-900">Contrato {numeroParaMostrar(c.numero_contrato)}</h1>
      <p className="mt-1 text-sm text-gray-500">
        Datos del cliente tal como se escribieron en este contrato. No se unen con otros contratos ni con la base de
        campañas, y no implican autorización para enviar publicidad.
      </p>
      <dl className="mt-5 grid gap-4 rounded-xl border border-gray-200 bg-white p-5 sm:grid-cols-2">
        <Campo etiqueta="Cliente" valor={c.cliente} />
        <Campo etiqueta="Documento" valor={c.cliente_documento} />
        <Campo etiqueta="Correo" valor={c.cliente_email} />
        <Campo etiqueta="Teléfono" valor={c.cliente_telefono} />
        <Campo etiqueta="Destino" valor={c.destino} />
        <Campo etiqueta="Estado" valor={c.estado} />
        <Campo etiqueta="Fecha de venta" valor={c.fecha_venta} />
        <Campo etiqueta="Canal" valor={etiquetaCanal(c)} />
        <Campo etiqueta="Salida" valor={c.fecha_salida} />
        <Campo etiqueta="Regreso" valor={c.fecha_regreso} />
      </dl>
      <p className="mt-4">
        <Link href={rutaContrato(c.numero_contrato)} className="inline-flex items-center gap-1.5 text-sm text-[var(--brand-primary)] hover:underline">
          <ExternalLink size={14} /> Abrir el contrato
        </Link>
      </p>
    </Marco>
  );
}
