import { createClient } from "@/lib/supabase/server";
import { cargarCatalogoManual } from "@/lib/catalogo/cargarCatalogoManual";
import Link from "next/link";
import { NuevoContratoForm, type PaqueteOpt, type BloqueoOpt } from "../NuevoContratoForm";

export const dynamic = "force-dynamic";

export default async function NuevoContratoPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let asesorDefault = "";
  let puedeForzarMargen = false;
  if (user) {
    const { data: perfil } = await sb.from("usuarios").select("nombre, rol").eq("id", user.id).single();
    asesorDefault = perfil?.nombre ?? "";
    puedeForzarMargen = ["superadmin", "administracion"].includes(perfil?.rol ?? "");
  }

  const [{ data: paquetesRaw }, { data: bloqueosRaw }, { data: vendedores }, { data: aliados }, { data: destinos }, { data: tarifasRaw }, catalogoManual] = await Promise.all([
    sb.from("paquetes")
      .select("id, categoria, nombre, plan_alimentacion, impuesto_no_comisionable, paquete_hoteles(nombre, ciudad, alimentacion, acomodacion_detalle), paquete_precios(acomodacion, precio)")
      .eq("activo", true)
      .order("nombre"),
    sb.from("bloqueos_vuelo").select("id, record, ruta, fecha_ida, fecha_regreso, aerolinea").order("fecha_ida"),
    sb.from("usuarios").select("nombre").eq("rol", "venta").eq("activo", true).order("nombre"),
    sb.from("aliados").select("id, nombre, tipo").order("nombre"),
    sb.from("destinos").select("id, nombre, codigo_iata").order("nombre"),
    sb.from("aerolinea_tarifas").select("id, aerolinea_id, nombre, descripcion").order("orden"),
    // #95: hoteles (con proveedor, categorías, regímenes, acomodaciones y restricciones) y servicios del catálogo para PRECARGAR información general editable (sin precios).
    // Minorista lo consume igual que destinos, para autocompletar sin perder la opción de texto libre.
    cargarCatalogoManual(sb),
  ]);

  const paquetes = (paquetesRaw ?? []) as unknown as PaqueteOpt[];
  const bloqueos = (bloqueosRaw ?? []) as unknown as BloqueoOpt[];
  const agencias = (aliados ?? []).filter((a) => (a.tipo ?? "agencia") === "agencia").map((a) => ({ id: a.id, nombre: a.nombre }));
  const freelances = (aliados ?? []).filter((a) => a.tipo === "freelance").map((a) => ({ id: a.id, nombre: a.nombre }));
  // Proveedores y aerolíneas salen del MISMO catálogo ya leído por `cargarCatalogoManual` (una sola lectura paginada, no dos).
  const proveedoresNombres = catalogoManual.proveedores;
  const tarifasPorAerolinea = new Map<number, { nombre: string; descripcion: string }[]>();
  for (const t of tarifasRaw ?? []) {
    const arr = tarifasPorAerolinea.get(t.aerolinea_id) ?? [];
    arr.push({ nombre: t.nombre, descripcion: t.descripcion });
    tarifasPorAerolinea.set(t.aerolinea_id, arr);
  }
  const aerolineas = catalogoManual.aerolineasConId.map((a) => ({ nombre: a.nombre, tarifas: tarifasPorAerolinea.get(a.id) ?? [] }));

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/contratos" className="text-sm text-gray-400 hover:text-gray-600">← Contratos</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Nuevo contrato (manual)</h1>
      <p className="mb-4 text-sm text-gray-500">
        Para ventas <b>dinámicas</b> donde el asesor captura todo a mano.
      </p>
      <div className="mb-6 rounded-xl border border-[var(--brand-accent)] bg-[rgba(38,187,217,0.06)] p-4 text-sm">
        <p className="font-medium text-gray-800">¿Es un Bloqueo, Porción terrestre o Servicios del tarifario?</p>
        <p className="mt-1 text-gray-600">
          Esos ya no se arman aquí: se generan desde el <b>tarifario</b> para no recapturar datos.{" "}
          <Link href="/dashboard/reservar" className="font-semibold text-[var(--brand-primary)] hover:underline">Ir a Reservar →</Link>
        </p>
      </div>
      <NuevoContratoForm asesorDefault={asesorDefault} paquetes={paquetes} bloqueos={bloqueos}
        vendedores={vendedores ?? []} agencias={agencias} freelances={freelances} destinos={destinos ?? []}
        hotelesCatalogo={catalogoManual.hoteles} serviciosCatalogo={catalogoManual.servicios} proveedoresCatalogo={proveedoresNombres}
        aerolineasCatalogo={aerolineas}
        puedeForzarMargen={puedeForzarMargen} />
    </div>
  );
}
