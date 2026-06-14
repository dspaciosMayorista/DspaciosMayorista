import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PasajerosBuscador, type PasajeroFila } from "./PasajerosBuscador";

export const dynamic = "force-dynamic";

export default async function PasajerosPage() {
  const sb = await createClient();
  const { data: sillas } = await sb
    .from("sillas")
    .select(
      "id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, numero_contrato, asesor, agencia, hotel, acomodacion, bloqueos_vuelo(id, record, ruta, fecha_ida, vuelo_ida, fecha_regreso, vuelo_regreso)"
    );

  const filas: PasajeroFila[] = (sillas ?? [])
    .filter((s) => (s.pasajero_nombres ?? "").trim() || (s.pasajero_apellidos ?? "").trim())
    .map((s) => {
      const b = s.bloqueos_vuelo as unknown as {
        id: number; record: string; ruta: string | null; fecha_ida: string | null; vuelo_ida: string | null; fecha_regreso: string | null; vuelo_regreso: string | null;
      } | null;
      return {
        sillaId: s.id,
        numeroSilla: s.numero_silla,
        estado: s.estado,
        nombres: s.pasajero_nombres ?? "",
        apellidos: s.pasajero_apellidos ?? "",
        tipoDoc: s.tipo_doc ?? "",
        numeroDoc: s.numero_doc ?? "",
        contrato: s.numero_contrato ?? "",
        asesor: s.asesor ?? "",
        agencia: s.agencia ?? "",
        hotel: s.hotel ?? "",
        acomodacion: s.acomodacion ?? "",
        bloqueoId: b?.id ?? null,
        record: b?.record ?? "",
        ruta: b?.ruta ?? "",
        fechaIda: b?.fecha_ida ?? null,
        vueloIda: b?.vuelo_ida ?? "",
        fechaRegreso: b?.fecha_regreso ?? null,
        vueloRegreso: b?.vuelo_regreso ?? "",
      };
    });

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8">
      <Link href="/dashboard/vuelos" className="text-sm text-gray-400 hover:text-gray-700">← Vuelos</Link>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Pasajeros en vuelo</h1>
      <p className="mb-6 text-sm text-gray-500">
        Busca por nombre, apellido, documento o contrato; o filtra por mes para ver todos los que viajan ese mes.
      </p>
      <PasajerosBuscador filas={filas} />
    </div>
  );
}
