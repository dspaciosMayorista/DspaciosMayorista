import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { CargaMasivaCSV } from "@/components/CargaMasivaCSV";
import { cargarAgenciasB2B } from "./actions";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

const COLS = [
  { key: "tipo", label: "Tipo (agencia/freelance)", ejemplo: "agencia" },
  { key: "nombre", label: "Nombre", ejemplo: "Agencia XYZ" },
  { key: "nit", label: "NIT / CC", ejemplo: "900123456-7" },
  { key: "email", label: "Email (acceso)", ejemplo: "ventas@agenciaxyz.com" },
  { key: "telefono", label: "Teléfono", ejemplo: "3001234567" },
  { key: "ciudad", label: "Ciudad", ejemplo: "Bogotá" },
  { key: "pct_comision", label: "% comisión (propio, opcional)", ejemplo: "12" },
  { key: "aplica_retencion", label: "Aplica retención (si/no)", ejemplo: "si" },
  { key: "pct_retencion", label: "% retención", ejemplo: "3.5" },
  { key: "crear_acceso", label: "Crear acceso al portal (si/no)", ejemplo: "si" },
];

export default async function CargarB2BPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Cargar agencias / freelance</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Solo administración / gerencia.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/crm" className="text-sm text-gray-500 hover:text-gray-800">← Contactos</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold text-gray-900">Cargar agencias y freelance</h1>
      <p className="mb-6 text-sm text-gray-500">
        Un solo cargue crea: el <b>aliado</b> (catálogo de comisiones), el <b>contacto</b> en el CRM y, si lo marcas,
        su <b>acceso B2B</b> al portal (usuario). Las contraseñas temporales se muestran al terminar para compartirlas.
      </p>
      <CargaMasivaCSV
        titulo="Carga masiva de agencias / freelance (CSV)"
        nota="'crear_acceso = si' genera el usuario del portal (requiere SUPABASE_SERVICE_ROLE_KEY). El % propio es opcional; si lo dejas vacío usa el default general."
        descripcion="Una fila por entidad. El email es la cuenta de acceso si 'crear_acceso' = si."
        columnas={COLS}
        onSubmit={cargarAgenciasB2B}
        nombreArchivo="plantilla_agencias_b2b"
      />
    </div>
  );
}
