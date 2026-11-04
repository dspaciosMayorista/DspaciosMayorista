// Checkout del paquete dinámico (#82). La tarjeta de «Dinámicos» deja elegidos hotel, habitaciones, vuelo y precio; aquí se captura el cliente.
// El servidor vuelve a leer el paquete publicado (solo PVP, ya filtrado por la agencia de la sesión) y resuelve el canal por la sesión.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cargarDinamicosPublicados } from "@/lib/paqueteDinamico/cargarPublico";
import { liquidarPaquete, validarPaquete, type Composicion } from "@/lib/paqueteDinamico/calculo";
import { resolverCanalDin } from "@/lib/paqueteDinamico/solicitud";
import { crearCotizacionDin } from "@/app/(dashboard)/dashboard/cotizaciones/din-actions";
import { getContextoB2B } from "../actions";
import { CheckoutDinamico, type ResumenDin } from "./CheckoutDinamico";

export const dynamic = "force-dynamic";

type Q = Record<string, string | string[] | undefined>;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const entero = (v: string | string[] | undefined, max = 20) => { const n = Number(uno(v)); return Number.isInteger(n) && n >= 0 && n <= max ? n : 0; };
const idOpt = (v: string | string[] | undefined) => { const n = Number(uno(v)); return Number.isInteger(n) && n > 0 ? n : null; };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="mx-auto max-w-xl p-8 text-center">
      <p role="alert" className="mb-4 text-sm text-gray-700">{texto}</p>
      <Link href="/tarifario" className="text-sm font-semibold underline" style={{ color: "var(--brand-primary)" }}>Volver al tarifario</Link>
    </div>
  );
}

export default async function CheckoutDinamicoPage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const paqueteId = idOpt(q.p), hotelId = idOpt(q.h), vueloId = idOpt(q.v);
  const ida = uno(q.ida), reg = uno(q.reg);
  if (!paqueteId || !ISO.test(ida) || !ISO.test(reg)) return <Aviso texto="La selección está incompleta. Vuelve al tarifario y elige de nuevo." />;

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

  const p = (await cargarDinamicosPublicados()).find((x) => x.id === paqueteId);
  if (!p) return <Aviso texto="Este paquete ya no está disponible para cotizar." />;
  const hotel = p.usaHotel ? p.hoteles.find((h) => h.id === hotelId) : undefined;
  if (p.usaHotel && !hotel) return <Aviso texto="El hotel elegido no pertenece al paquete." />;
  const vuelo = p.usaVuelo ? p.vuelos.find((v) => v.id === vueloId) : undefined;
  if (p.usaVuelo && !vuelo) return <Aviso texto="El vuelo elegido no pertenece al paquete." />;

  const composicion: Composicion = {
    habitaciones: { sencilla: entero(q.hs), doble: entero(q.hd), triple: entero(q.ht), multiple: entero(q.hm) },
    ninos: entero(q.n1), ninos2: entero(q.n2), infantes: entero(q.inf),
  };
  const opcion = p.opciones.find((o) => (o.hotelId ?? null) === (hotel?.id ?? null) && (o.vueloId ?? null) === (vuelo?.id ?? null));
  let total: number | null = null;
  if (opcion && !validarPaquete(opcion.calc).length) { try { total = liquidarPaquete(opcion.calc, composicion).total; } catch { total = null; } }
  if (total == null) return <Aviso texto="No se pudo calcular el precio con esa composición. Vuelve al tarifario y revisa las habitaciones." />;
  const dias = Math.round((Date.parse(`${reg}T00:00:00Z`) - Date.parse(`${ida}T00:00:00Z`)) / 86_400_000);
  if (dias !== p.noches) return <Aviso texto={`El viaje debe durar exactamente ${p.noches} noches.`} />;

  const hab = Object.entries(composicion.habitaciones).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
  if (composicion.ninos) hab.push(`${composicion.ninos} niño 1`);
  if (composicion.ninos2) hab.push(`${composicion.ninos2} niño 2`);
  if (composicion.infantes) hab.push(`${composicion.infantes} infante${composicion.infantes > 1 ? "s" : ""}`);
  const resumen: ResumenDin = {
    paquete: p.nombre, destino: p.destino, noches: p.noches, moneda: p.moneda, hotel: hotel?.nombre ?? null, vuelo: vuelo?.etiqueta ?? null,
    fechaIda: ida, fechaRegreso: reg, habitaciones: hab.join(", ") || "—", total,
  };
  const aliado = canal.canal === "b2b" ? ((await getContextoB2B()).agencia?.nombre ?? null) : null;

  return (
    <CheckoutDinamico
      resumen={resumen} canal={canal.canal} aliado={aliado} crear={crearCotizacionDin}
      solicitud={{ paqueteId, hotelId: hotel?.id ?? null, vueloId: vuelo?.id ?? null, composicion, fechaIda: ida, fechaRegreso: reg }}
    />
  );
}
