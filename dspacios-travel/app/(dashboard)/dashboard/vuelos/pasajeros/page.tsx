import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PasajerosBuscador, type PasajeroFila } from "./PasajerosBuscador";
import { CargaMasivaCSV, type Columna } from "@/components/CargaMasivaCSV";
import { cargarPasajerosMasivo } from "../actions";
import { normalizarReferenciaManual, resolverManifiestoAutorizado } from "@/lib/vuelos/contratoManual";
import { emparejarInfantesConSilla } from "@/lib/vuelos/manifiestoInfantes";
import { contratosQuePuedeAbrir, numeroContratoEnlazable } from "@/lib/vuelos/enlaceContrato";

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

  // Este listado es GLOBAL (todos los bloqueos, no uno solo) — la pregunta de
  // autorización sigue siendo la misma que para el detalle de un bloqueo:
  // "¿el rol de este usuario pertenece al módulo Vuelos?" (mi_rol(), la
  // misma fuente que ya usa proxy.ts para dejarlo entrar aquí). No se
  // amplía a nadie: quien ya veía este listado sigue viéndolo igual; lo
  // único que cambia es que la resolución de contrato_manual y la búsqueda
  // de infantes usan un cliente admin SOLO tras esa verificación, en vez del
  // cliente de sesión (RLS por tenant) — ver lib/vuelos/contratoManual.ts.
  const contratosOrganicos = [...new Set((sillas ?? []).map((s) => s.numero_contrato).filter((n): n is string => !!n))];
  const { infantes, referenciaManualPorContrato } = await resolverManifiestoAutorizado(
    sb,
    contratosOrganicos,
    [...contratoManualPorSilla.values()]
  );

  // Contrato EFECTIVO de cada silla, solo para emparejar cada infante con su
  // silla "base" (heredar vuelo/hotel/asesor) — nunca se usa para mostrar/
  // editar la silla en sí (eso sigue siendo el contrato orgánico o el manual
  // sin cambios): orgánico si lo tiene, si no el interno resuelto de su
  // contrato manual, o ninguno si no resolvió nada.
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

  // Presentación: cada infante debe aparecer como renglón subordinado
  // INMEDIATAMENTE debajo de la fila de su adulto responsable — nunca en una
  // tabla aparte. La agrupación es exclusivamente por `responsable_id`
  // (resuelto a su documento en resolverManifiestoAutorizado, nunca a su
  // nombre), emparejado contra el documento+contrato EFECTIVO de las sillas
  // CON pasajero (`filasSillas`) — ver lib/vuelos/manifiestoInfantes.ts. Se
  // usa `filasSillas` (no todas las `sillas`) para que, si el emparejamiento
  // encuentra una silla, esa silla exista siempre como fila renderizable
  // (`base` más abajo nunca falla). Si el responsable no viaja en este
  // listado (o su documento no cruza con ninguna silla nombrada), el
  // infante no se asocia arbitrariamente: cae en `sinResponsable` para la
  // advertencia compacta de `PasajerosBuscador`.
  const { infantesPorSillaId, sinResponsable } = emparejarInfantesConSilla(
    filasSillas
      .filter((f) => f.sillaId != null)
      .map((f) => ({
        id: f.sillaId as number,
        tipoDoc: f.tipoDoc || null,
        numeroDoc: f.numeroDoc || null,
        contratoEfectivo: contratoEfectivoPorSilla.get(f.sillaId as number) ?? null,
      })),
    infantes.map((i) => ({
      id: i.id,
      nombre: i.nombre,
      tipoId: i.tipo_id,
      identificacion: i.identificacion,
      numeroContrato: i.numero_contrato,
      fechaNacimiento: i.fecha_nacimiento,
      responsable: i.responsable ? { id: i.responsable.id, tipoId: i.responsable.tipo_id, identificacion: i.responsable.identificacion } : null,
    }))
  );

  // Acción "Editar en contrato" del renglón del infante (ver
  // lib/vuelos/enlaceContrato.ts): se muestra SOLO si el usuario actual puede
  // abrir ese contrato. Se resuelve EN LOTE, una sola consulta para todos los
  // infantes del listado, leyendo `ventas` con el cliente de SESIÓN — la
  // misma consulta que hace la ficha del contrato. La RLS devuelve
  // exactamente los contratos que este rol/tenant puede abrir (superadmin/
  // gerencia ambos tenants; administracion/operaciones solo el suyo;
  // control_vuelo ninguno). El Client Component (PasajerosBuscador) nunca
  // decide autorización: recibe un booleano ya resuelto por el servidor.
  const numerosContratosInfantes = [...infantesPorSillaId.values()].flatMap((infs) =>
    infs.map((inf) => inf.numeroContrato)
  );
  const contratosEnlazables = await contratosQuePuedeAbrir(sb, numerosContratosInfantes);

  const filasInfantes: PasajeroFila[] = [];
  for (const [sillaId, infs] of infantesPorSillaId) {
    const base = filasSillas.find((f) => f.sillaId === sillaId);
    if (!base) continue; // no debería pasar (emparejarInfantesConSilla solo recibió sillas de filasSillas) — fail-closed igual.
    for (const inf of infs) {
      filasInfantes.push({
        ...base,
        id: `infante-${inf.id}`,
        padreId: base.id,
        sillaId: null,
        esInfante: true,
        estado: "infante",
        nombres: inf.nombre ?? "",
        apellidos: "",
        tipoDoc: inf.tipoId ?? "",
        numeroDoc: inf.identificacion ?? "",
        fechaNacimientoInfante: inf.fechaNacimiento,
        // Contrato PROPIO del infante (siempre el numero_contrato interno
        // real) — no el de `base`, que para un contrato manual resuelto
        // seguiría mostrando "" (el contrato orgánico de esa silla, vacío).
        contrato: inf.numeroContrato,
        // "Editar en contrato": true SOLO si el usuario actual puede abrir
        // /dashboard/contratos/[numero] de su contrato — resuelto en el
        // servidor (contratosEnlazables, ver arriba). El cliente renderiza
        // el enlace únicamente cuando este flag llega true.
        puedeEditarEnContrato: numeroContratoEnlazable(inf.numeroContrato, contratosEnlazables) !== null,
      });
    }
  }

  const filas: PasajeroFila[] = [...filasSillas, ...filasInfantes];
  const advertenciasInfantes = sinResponsable.map((inf) => ({ id: inf.id, nombre: inf.nombre }));

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

      <PasajerosBuscador filas={filas} advertenciasInfantes={advertenciasInfantes} />
    </div>
  );
}
