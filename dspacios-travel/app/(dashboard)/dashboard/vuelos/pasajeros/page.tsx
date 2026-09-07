import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PasajerosBuscador, type PasajeroFila } from "./PasajerosBuscador";
import { CargaMasivaCSV, type Columna } from "@/components/CargaMasivaCSV";
import { cargarPasajerosMasivo } from "../actions";
import { normalizarReferenciaManual, resolverReferenciasManualesDesdeDB } from "@/lib/vuelos/contratoManual";

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

  // Contrato manual por silla (columna de la migración 085; los tipos
  // generados aún no la incluyen). Igual que en vuelos/[id]/page.tsx: una
  // silla puede estar asociada a una venta EXTERNA (texto libre) o, en la
  // práctica, a una venta INTERNA real (típicamente minorista, sin
  // tarifario/reservar propio) escrita sin su prefijo de tenant. Se resuelve
  // de forma segura y fail-closed (ver lib/vuelos/contratoManual.ts) para
  // que el infante de esa venta pueda encontrarse más abajo.
  const contratoManualPorSilla = new Map<number, string | null>();
  {
    const { data: cm, error: cmErr } = await (sb.from("sillas").select("id, contrato_manual") as unknown as Promise<{ data: { id: number; contrato_manual: string | null }[] | null; error: unknown }>);
    if (!cmErr) for (const r of cm ?? []) contratoManualPorSilla.set(r.id, r.contrato_manual ?? null);
  }
  const referenciaManualPorContrato = await resolverReferenciasManualesDesdeDB(sb, [...contratoManualPorSilla.values()]);
  // Contrato EFECTIVO de cada silla, solo para buscar su infante — nunca se
  // usa para mostrar/editar la silla en sí (eso sigue siendo el contrato
  // orgánico o el manual sin cambios): orgánico si lo tiene, si no el
  // interno resuelto de su contrato manual, o ninguno si no resolvió nada.
  const contratoEfectivoPorSilla = new Map<number, string | null>();
  for (const s of sillas ?? []) {
    if (s.numero_contrato) { contratoEfectivoPorSilla.set(s.id, s.numero_contrato); continue; }
    const manual = normalizarReferenciaManual(contratoManualPorSilla.get(s.id) ?? null);
    contratoEfectivoPorSilla.set(s.id, manual ? referenciaManualPorContrato.get(manual) ?? null : null);
  }

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
  //
  // El contrato de búsqueda es el EFECTIVO (`contratoEfectivoPorSilla`), no
  // `f.contrato`: para una silla con contrato manual resuelto a una venta
  // interna, `f.contrato` sigue mostrando el contrato orgánico (vacío) —
  // cambiarlo habría alterado cómo se ve/edita esa silla, que debe quedar
  // intacta. El efectivo solo se usa para ENCONTRAR al infante y heredar de
  // qué vuelo/hotel/asesor viene.
  const contratosConSilla = [
    ...new Set(
      filasSillas
        .map((f) => (f.sillaId != null ? contratoEfectivoPorSilla.get(f.sillaId) : null))
        .filter((c): c is string => !!c)
    ),
  ];
  const filasInfantes: PasajeroFila[] = [];
  if (contratosConSilla.length) {
    const { data: infantes } = await sb
      .from("contrato_pasajeros")
      .select("id, nombre, tipo_id, identificacion, numero_contrato")
      .eq("es_infante", true)
      .in("numero_contrato", contratosConSilla);
    for (const inf of infantes ?? []) {
      const base = filasSillas.find(
        (f) => f.sillaId != null && contratoEfectivoPorSilla.get(f.sillaId) === inf.numero_contrato
      );
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
        // Contrato PROPIO del infante (siempre el numero_contrato interno
        // real) — no el de `base`, que para un contrato manual resuelto
        // seguiría mostrando "" (el contrato orgánico de esa silla, vacío).
        contrato: inf.numero_contrato,
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
