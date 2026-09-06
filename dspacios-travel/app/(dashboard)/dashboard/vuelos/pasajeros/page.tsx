import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PasajerosBuscador, type PasajeroFila } from "./PasajerosBuscador";
import { CargaMasivaCSV, type Columna } from "@/components/CargaMasivaCSV";
import { cargarPasajerosMasivo } from "../actions";

export const dynamic = "force-dynamic";

const PAS_COLS: Columna[] = [
  { key: "pnr", label: "PNR", ejemplo: "L93FYZ" },
  { key: "nombres", label: "Nombres", ejemplo: "MARIO ALEJANDRO" },
  { key: "apellidos", label: "Apellidos", ejemplo: "DUQUE FRANCO" },
  { key: "tipo_doc", label: "Tipo doc", ejemplo: "CC" },
  { key: "numero_doc", label: "Número doc", ejemplo: "15429812" },
  { key: "nacimiento", label: "Nacimiento (AAAA-MM-DD)", ejemplo: "1965-09-09" },
];

export default async function PasajerosPage() {
  const sb = await createClient();
  const { data: sillas } = await sb
    .from("sillas")
    .select(
      "id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, numero_contrato, asesor, agencia, hotel, acomodacion, bloqueos_vuelo(id, record, ruta, fecha_ida, vuelo_ida, fecha_regreso, vuelo_regreso)"
    );

  const filasSillas: PasajeroFila[] = (sillas ?? [])
    .filter((s) => (s.pasajero_nombres ?? "").trim() || (s.pasajero_apellidos ?? "").trim())
    .map((s) => {
      const b = s.bloqueos_vuelo as unknown as {
        id: number; record: string; ruta: string | null; fecha_ida: string | null; vuelo_ida: string | null; fecha_regreso: string | null; vuelo_regreso: string | null;
      } | null;
      return {
        id: `silla-${s.id}`,
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

  // Infantes (no ocupan silla — ver lib/reservar/pasajeros.ts — pero deben
  // seguir apareciendo en este listado). Se traen solo para los contratos que
  // YA aparecen arriba (tienen al menos un pasajero con silla en algún
  // record), y heredan el vuelo/record/hotel/asesor de ese mismo contrato —
  // un infante nunca tiene fila propia en `sillas`, así que no hay otra forma
  // de saber a qué vuelo va.
  const contratosConSilla = [...new Set(filasSillas.map((f) => f.contrato).filter(Boolean))];
  const filasInfantes: PasajeroFila[] = [];
  if (contratosConSilla.length) {
    const { data: infantes } = await sb
      .from("contrato_pasajeros")
      .select("id, nombre, tipo_id, identificacion, numero_contrato")
      .eq("es_infante", true)
      .in("numero_contrato", contratosConSilla);
    for (const inf of infantes ?? []) {
      const base = filasSillas.find((f) => f.contrato === inf.numero_contrato);
      if (!base) continue;
      filasInfantes.push({
        ...base,
        id: `infante-${inf.id}`,
        sillaId: null,
        esInfante: true,
        estado: "infante",
        nombres: inf.nombre ?? "",
        apellidos: "",
        tipoDoc: inf.tipo_id ?? "",
        numeroDoc: inf.identificacion ?? "",
      });
    }
  }

  const filas: PasajeroFila[] = [...filasSillas, ...filasInfantes];

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8">
      <Link href="/dashboard/vuelos" className="text-sm text-gray-400 hover:text-gray-700">← Vuelos</Link>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Pasajeros en vuelo</h1>
      <p className="mb-6 text-sm text-gray-500">
        Busca por nombre, apellido, documento o contrato; o filtra por mes para ver todos los que viajan ese mes.
      </p>

      <div className="mb-6">
        <CargaMasivaCSV
          titulo="Carga masiva de pasajeros"
          descripcion="Pega o sube el listado con su PNR. Cada pasajero se asigna a una silla libre de su record."
          columnas={PAS_COLS}
          onSubmit={cargarPasajerosMasivo}
          nombreArchivo="plantilla_pasajeros"
          nota={
            <>
              El <b>PNR</b> (record) debe existir en Vuelos. Repetidos por documento en el <b>mismo PNR</b> se omiten;
              en <b>otro PNR</b> se avisan para revisar; y se reporta cuántos pasajeros traen un PNR que no existe.
            </>
          }
        />
      </div>

      <PasajerosBuscador filas={filas} />
    </div>
  );
}
