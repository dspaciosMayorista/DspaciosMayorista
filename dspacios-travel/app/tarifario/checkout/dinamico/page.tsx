// Checkout del paquete dinámico (#82). La tarjeta de «Dinámicos» deja elegidos hotel, alimentación, habitaciones, viajeros, vuelo y servicios; aquí se captura el cliente.
// El servidor vuelve a leer el paquete publicado (solo PVP, ya filtrado por la agencia de la sesión), revalida la selección con el MISMO núcleo que la cotización
// (menores por edad, capacidad por habitación, servicios con su ficha) y resuelve el canal por la sesión.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cargarDinamicosPublicados } from "@/lib/paqueteDinamico/cargarPublico";
import { resolverCanalDin } from "@/lib/paqueteDinamico/solicitud";
import { deQuery } from "@/lib/paqueteDinamico/seleccionUrl";
import { ACOM_ROOM_LABEL, ACOM_ROOMS } from "@/lib/acomodaciones";
import { crearCotizacionDin } from "@/app/(dashboard)/dashboard/cotizaciones/din-actions";
import { getContextoB2B } from "../actions";
import { evaluarSeleccionDin } from "./actions";
import { CheckoutDinamico, type ResumenDin } from "./CheckoutDinamico";

export const dynamic = "force-dynamic";

type Q = Record<string, string | string[] | undefined>;

function Aviso({ texto, volver }: { texto: string; volver?: string }) {
  return (
    <div className="mx-auto max-w-xl p-8 text-center">
      <p role="alert" className="mb-4 text-sm text-gray-700">{texto}</p>
      <Link href={volver ?? "/tarifario"} className="text-sm font-semibold underline" style={{ color: "var(--brand-primary)" }}>{volver ? "Cambiar la selección" : "Volver al tarifario"}</Link>
    </div>
  );
}

export default async function CheckoutDinamicoPage({ searchParams }: { searchParams: Promise<Q> }) {
  const sel = deQuery(await searchParams);
  if (!sel) return <Aviso texto="La selección está incompleta. Vuelve al tarifario y elige de nuevo." />;
  const clave = `${sel.paqueteId}:${sel.hotelId ?? "x"}`;
  // Al volver, la tarjeta se reabre con la selección guardada (sessionStorage) en la pestaña «Dinámicos».
  const volver = `/tarifario?vista=dinamicos&din=${encodeURIComponent(clave)}`;

  // Canal por la sesión (nunca por la URL).
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let sesion: { rol: string; activo: boolean } | "anonimo" = "anonimo";
  if (user) {
    const { data: u } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
    sesion = { rol: String(u?.rol ?? ""), activo: u?.activo === true };
  }
  const canal = resolverCanalDin(sesion);
  if (!canal.ok) return <Aviso texto={canal.error} />;

  const p = (await cargarDinamicosPublicados()).find((x) => x.id === sel.paqueteId);
  if (!p) return <Aviso texto="Este paquete ya no está disponible para cotizar." />;
  const hotel = p.usaHotel ? p.hoteles.find((h) => h.id === sel.hotelId) : undefined;
  if (p.usaHotel && !hotel) return <Aviso texto="El hotel elegido no pertenece al paquete." volver={volver} />;
  const vuelo = p.usaVuelo ? p.vuelos.find((v) => v.id === sel.vueloId) : undefined;
  if (p.usaVuelo && !vuelo) return <Aviso texto="El vuelo elegido no pertenece al paquete." volver={volver} />;
  const dias = Math.round((Date.parse(`${sel.fechaRegreso}T00:00:00Z`) - Date.parse(`${sel.fechaIda}T00:00:00Z`)) / 86_400_000);
  if (dias !== p.noches) return <Aviso texto={`El viaje debe durar exactamente ${p.noches} noches.`} volver={volver} />;

  const composicion = { habitaciones: sel.habitaciones, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: sel.edades, ...(sel.servicios ? { servicios: sel.servicios } : {}) };
  const prev = await evaluarSeleccionDin({ paqueteId: p.id, hotelId: hotel?.id ?? null, vueloId: vuelo?.id ?? null, composicion, fechaIda: sel.fechaIda });
  if (!prev.ok) return <Aviso texto={prev.error} volver={volver} />;

  const hab = ACOM_ROOMS.filter((a) => sel.habitaciones[a] > 0).map((a) => `${sel.habitaciones[a]} ${ACOM_ROOM_LABEL[a].toLowerCase()}`);
  const m = prev.menores;
  const viajeros = sel.edades.length
    ? `${sel.edades.length} menor${sel.edades.length === 1 ? "" : "es"} (edades ${sel.edades.join(", ")}): Niño 1 × ${m.ninos} · Niño 2 × ${m.ninos2} · Infante × ${m.infantes}`
    : "Sin menores";
  const elegidos = sel.servicios ?? p.servicios.map((s) => String(s.id));
  const resumen: ResumenDin = {
    paquete: p.nombre, destino: p.destino, noches: p.noches, moneda: p.moneda,
    hotel: hotel ? { nombre: hotel.nombre, categoria: hotel.categoria, regimen: hotel.regimen } : null,
    habitaciones: hab.join(", ") || "—", viajeros,
    vuelo: vuelo ? { etiqueta: vuelo.etiqueta, detalle: vuelo.detalle, sillas: prev.vuelo.sillas, infantes: prev.vuelo.infantes } : null,
    servicios: p.servicios.filter((s) => elegidos.includes(String(s.id))).map((s) => s.nombre),
    fechaIda: sel.fechaIda, fechaRegreso: sel.fechaRegreso, total: prev.total, lineas: prev.lineas, volver,
  };
  const aliado = canal.canal === "b2b" ? ((await getContextoB2B()).agencia?.nombre ?? null) : null;

  return (
    <CheckoutDinamico
      resumen={resumen} canal={canal.canal} aliado={aliado} crear={crearCotizacionDin}
      solicitud={{ paqueteId: p.id, hotelId: hotel?.id ?? null, vueloId: vuelo?.id ?? null, composicion, fechaIda: sel.fechaIda, fechaRegreso: sel.fechaRegreso }}
    />
  );
}
