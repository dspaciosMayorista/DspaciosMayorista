import { createClient } from "@/lib/supabase/server";
import { getTenant, agenciaDe } from "@/lib/tenant.server";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { fetchAllPaginadoConError } from "@/lib/supabase/fetchAllPaginado";
import {
  esPeriodicidad, resolverVencimientos,
  type Obligacion, type Vencimiento, type Cumplimiento, type ReglaDigitos,
} from "@/lib/contabilidad/calendarioTributario";
import { CalendarioTributarioClient } from "./CalendarioTributarioClient";

export const dynamic = "force-dynamic";
const ROLES_CONTABLES = ["superadmin", "gerencia", "administracion"];

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Calendario tributario</h1>
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{texto}</p>
    </div>
  );
}

export default async function CalendarioTributarioPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES_CONTABLES.includes(perfil?.rol ?? "")) {
    return <Aviso texto="No tienes permisos para ver este módulo. Solicítalo a un administrador." />;
  }

  const tenant = await getTenant();
  const hoy = fechaNegocio();
  const anio = Number(hoy.slice(0, 4));
  // Paginado y con error visible: 10 dígitos × hasta 12 periodos × 3 años por
  // obligación pasa rápido el límite de filas por respuesta de Supabase, y una
  // lista truncada en silencio ocultaría vencimientos.
  const [obR, veR, cuR, agencia] = await Promise.all([
    sb.from("obligacion_tributaria").select("*").eq("tenant", tenant).order("nombre"),
    fetchAllPaginadoConError((d, h) => sb.from("obligacion_vencimiento").select("obligacion_id, anio, periodo, digitos, fecha")
      .eq("tenant", tenant).gte("anio", anio - 1).lte("anio", anio + 1).order("id").range(d, h)),
    fetchAllPaginadoConError((d, h) => sb.from("obligacion_cumplimiento").select("obligacion_id, anio, periodo, presentada_en, pagada_en, nota")
      .eq("tenant", tenant).gte("anio", anio - 1).lte("anio", anio + 1).order("id").range(d, h)),
    agenciaDe(tenant),
  ]);
  const error = obR.error ?? veR.error ?? cuR.error;
  if (error) {
    return <Aviso texto={`No se pudo cargar el calendario (${error.message}). Si es la primera vez, falta aplicar la migración 215.`} />;
  }

  const obligaciones: Obligacion[] = (obR.data ?? [])
    .filter((o) => esPeriodicidad(o.periodicidad))
    .map((o) => ({
      id: o.id, nombre: o.nombre, periodicidad: o.periodicidad as Obligacion["periodicidad"],
      reglaDigitos: o.regla_digitos as ReglaDigitos, diasAviso: o.dias_aviso,
      requierePago: o.requiere_pago, activa: o.activa,
    }));
  const vencimientos: Vencimiento[] = (veR.data ?? []).map((v) => ({
    obligacionId: v.obligacion_id, anio: v.anio, periodo: v.periodo, digitos: v.digitos, fecha: v.fecha,
  }));
  const cumplimientos: Cumplimiento[] = (cuR.data ?? []).map((c) => ({
    obligacionId: c.obligacion_id, anio: c.anio, periodo: c.periodo,
    presentadaEn: c.presentada_en, pagadaEn: c.pagada_en, nota: c.nota,
  }));
  const nit = agencia?.nit ?? null;
  const { items, sinResolver } = resolverVencimientos({ obligaciones, vencimientos, cumplimientos, nit, hoy });

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Calendario tributario</h1>
        <p className="mt-1 text-sm text-gray-500">
          Obligaciones de esta agencia (retención, IVA, ICA, renta, exógena, PILA…), sus fechas límite según
          el NIT y la constancia de presentación y pago. Las alertas también llegan en el correo diario.
        </p>
      </div>
      <CalendarioTributarioClient
        hoy={hoy}
        anio={anio}
        nit={nit}
        obligaciones={obligaciones}
        notas={Object.fromEntries((obR.data ?? []).map((o) => [o.id, o.notas ?? ""]))}
        vencimientos={vencimientos}
        cumplimientos={cumplimientos}
        items={items}
        sinResolver={sinResolver}
      />
    </div>
  );
}
