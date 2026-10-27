"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda, calcularEdad } from "@/lib/utils";
import { paxDeAcomodacion, textoEdadesHotel } from "@/lib/acomodaciones";
import { esInfantePorEdad } from "@/lib/reservar/pasajeros";
import { truncarPasajeros, recalcularVinculosPorEdad } from "@/lib/reservar/pasajerosFilas";
import { OpcionesTipoDoc } from "@/components/personas/OpcionesTipoDoc";
import { aplicarCopiaTitular, copiaVigente, deshacerCopiaTitular, type CopiaTitular } from "@/lib/personas/copiaTitular";
import { BotonCopiarTitular } from "@/components/pasajeros/BotonCopiarTitular";
import { BuscarTitular } from "@/components/personas/BuscarTitular";
import { BuscarPasajeroDocumento } from "@/components/pasajeros/BuscarPasajeroDocumento";
import { reservarPrograma, terminosB2BPrograma } from "../../actions";
import { TerminosB2BAsistido, type TerminosVisibles } from "@/components/cotizacion/TerminosB2BAsistido";
import { blackoutQueAplica, mensajeBlackout, rangoViaje as rangoDelViaje, type BlackoutPrograma } from "@/lib/programas/blackouts409";
import type { AliadoListado } from "@/lib/cotizacion/asistidaB2BServidor";
import type { ModoCompra } from "@/lib/reservar/comisionReserva";
import { validarTrmCosto } from "@/lib/finanzas/costoTrmCarrito";
import { totalDesdePrecios, cotizarEstanciaDesdePvp, resolverBaseHotel, type CambioPrecioPrograma, type TablaHotelPvp } from "@/lib/programas/precioReserva57";
import {
  CLAVES_TARIFA,
  ETIQUETA_MODALIDAD,
  ETIQUETA_UNIDAD,
  MAX_NOCHES_ADICIONALES,
  MODALIDADES_SERVICIOS,
  fechaLegible,
  fechaRegresoEstancia,
  itinerarioConNochesExtra,
  validarItinerarioCompleto,
  type DiaItinerario,
  type ModalidadServicios,
} from "@/lib/programas/estanciaHotel88";

// Pax que cubre 1 habitación (Doble=2, Triple=3, Cuádruple=4, Sencilla=1).
const paxPorHab = (a: string) => paxDeAcomodacion(a);

export type CategoriaReserva = {
  id: number;
  nombre: string;
  precios: { acomodacion: string; pvp: number | null; bajoSolicitud: boolean }[];
  noches?: number | null;       // solo modo salida
  fechaSugerida?: string | null; // solo modo salida (fecha_desde)
};

const ACOM_LABEL: Record<string, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", cuadruple: "Cuádruple", nino: "Niño" };
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

type Pasajero = {
  nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; fechaNacimiento: string; nacionalidad: string;
  // Posición (0-based) del adulto responsable — solo aplica si este
  // pasajero resulta infante por fecha de nacimiento real (revisión de
  // alto riesgo — B1).
  responsableIndex?: number | null;
};
const pasajeroVacio = (): Pasajero => ({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", fechaNacimiento: "", nacionalidad: "Colombiana" });

export function ProgramaReservaForm({
  programaId,
  moneda,
  dias,
  vigenciaDesde,
  vigenciaHasta,
  categorias,
  asesores,
  modoSalida = false,
  edadNinoMin = 2,
  edadNinoMax = 11,
  edadInfanteMax = 1,
  hoteles,
  nochesIncluidas = null,
  errorPrograma = null,
  itinerario = [],
  aliados = [],
  blackouts = [],
  errorItinerarioPrograma = null,
}: {
  programaId: number;
  moneda: string;
  dias: number | null;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  categorias: CategoriaReserva[];
  asesores: { nombre: string; email: string }[];
  modoSalida?: boolean;
  edadNinoMin?: number;
  edadNinoMax?: number;
  edadInfanteMax?: number;
  /** #88 — programa por hotel y vigencia: tablas de PVP por hotel (nunca netos). Presente = modo hotel. */
  hoteles?: TablaHotelPvp[];
  /** Noches incluidas del programa (para las fechas de las noches adicionales). */
  nochesIncluidas?: number | null;
  /** Por qué el programa no permite calcular la estancia (días/noches sin configurar o incoherentes). */
  errorPrograma?: string | null;
  /** Itinerario base del programa (para mostrar el desplazado con las noches extra). */
  itinerario?: DiaItinerario[];
  /** PR #409 — aliados ACTIVOS del catálogo (agencia/freelance) con su % vigente, para vender B2B con PVP o NETO. */
  aliados?: AliadoListado[];
  /** PR #409 — blackouts del programa (con su alcance): la misma regla de la reserva en el servidor, aplicada aquí antes de enviar. */
  blackouts?: BlackoutPrograma[];
  /** PR #409 — por qué el itinerario del programa no permite calcular ni reservar (días 1..N incompletos), en cualquier modo. */
  errorItinerarioPrograma?: string | null;
}) {
  const router = useRouter();
  const modoHotel = hoteles !== undefined;
  const [categoriaId, setCategoriaId] = useState<number>(categorias[0]?.id ?? 0);

  const [habs, setHabs] = useState<Record<string, number>>({}); // habitaciones por acomodación
  const [ninos, setNinos] = useState(0);
  const [infantes, setInfantes] = useState(0);
  // En modo salida, la fecha va atada a la salida elegida (no es un calendario
  // libre): arranca con la de la primera salida.
  const [fechaIda, setFechaIda] = useState(() => (modoSalida ? (categorias[0]?.fechaSugerida ?? "") : ""));

  // #88 — hotel, modalidad de servicios y noches adicionales. La base sale de la vigencia de la
  // fecha de ENTRADA; cada noche adicional, de la vigencia de su propia fecha. Todo con las
  // MISMAS funciones puras que usa el servidor (precioReserva57 / estanciaHotel88).
  const [hotelId, setHotelId] = useState<number>(hoteles?.[0]?.hotel.id ?? 0);
  const [modalidad, setModalidad] = useState<ModalidadServicios>("privado");
  const [adicionales, setAdicionales] = useState(0);
  // TRM de costos (pesos por dólar): solo programas por hotel en USD. La ingresa quien reserva; el servidor la exige y la congela en cada CxP.
  const pideTrmCosto = modoHotel && moneda.toUpperCase() === "USD";
  const [trmCosto, setTrmCosto] = useState("");
  const tablaHotel = modoHotel ? (hoteles ?? []).find((t) => t.hotel.id === hotelId) ?? null : null;
  const baseHotel = tablaHotel && fechaIda ? resolverBaseHotel(tablaHotel.base, modalidad, fechaIda, tablaHotel.hotel.nombre) : null;
  const cat: CategoriaReserva | undefined = modoHotel
    ? {
        id: 0,
        nombre: tablaHotel ? `${tablaHotel.hotel.nombre} · ${ETIQUETA_MODALIDAD[modalidad]}` : "",
        precios: baseHotel?.ok && !baseHotel.fila.bajoSolicitud
          ? CLAVES_TARIFA.map((k) => ({ acomodacion: k, pvp: baseHotel.fila.pvp[k], bajoSolicitud: false }))
          : [],
      }
    : categorias.find((c) => c.id === categoriaId) ?? categorias[0];

  // Acomodaciones (excepto niño) con precio disponible
  const acomsAdulto = (cat?.precios ?? []).filter((p) => p.acomodacion !== "nino" && p.pvp != null && !p.bajoSolicitud);
  const precioNino = (cat?.precios ?? []).find((p) => p.acomodacion === "nino" && p.pvp != null && !p.bajoSolicitud)?.pvp ?? null;

  const textoEdades = textoEdadesHotel({ ninoMin: edadNinoMin, ninoMax: edadNinoMax, infMin: 0, infMax: edadInfanteMax });

  const [cliente, setCliente] = useState({ nombres: "", apellidos: "", tipoDoc: "", numeroDoc: "", telefono: "", email: "" });
  const [tipoAsesor, setTipoAsesor] = useState<"interno" | "agencia" | "freelance">("interno");
  const [asesorInterno, setAsesorInterno] = useState(asesores[0]?.email ?? "");
  const [agenciaAsesor, setAgenciaAsesor] = useState("");
  // PR #409 — B2B: aliado del catálogo y elección EXPRESA (sin valor por defecto) de PVP o NETO antes de generar el contrato.
  const [aliadoId, setAliadoId] = useState<number | null>(null);
  const [modoCompra, setModoCompra] = useState<ModoCompra | "">("");
  const [terminos, setTerminos] = useState<TerminosVisibles | null>(null);
  const [terminosError, setTerminosError] = useState<string | null>(null);
  const [calculandoTerminos, setCalculandoTerminos] = useState(false);
  const esB2B = tipoAsesor !== "interno";
  const aliadosDelTipo = aliados.filter((a) => a.tipo === tipoAsesor);
  const aliadoElegido = aliadosDelTipo.find((a) => a.id === aliadoId) ?? null;
  const [plazo, setPlazo] = useState("");

  // Pasajeros que ocupan silla (adultos por habitación + niños). Los infantes
  // van como pasajeros adicionales para poder validar sus edades.
  const paxConSilla = useMemo(
    () =>
      Object.entries(habs).reduce((s, [a, n]) => s + (Number(n) || 0) * paxPorHab(a), 0) +
      (Number(ninos) || 0),
    [habs, ninos]
  );
  const totalPax = paxConSilla + (Number(infantes) || 0);

  // #57: misma aritmética (centavos) y mismos precios por persona que la ficha y
  // que la liquidación del servidor (`lib/programas/precioReserva57.ts`).
  const totalMatriz = useMemo(
    () => totalDesdePrecios({ adultos: acomsAdulto, precioNino, habitaciones: habs, ninos: Number(ninos) || 0 }),
    [acomsAdulto, habs, ninos, precioNino]
  );
  // #88: en modo hotel el total es el de la estancia (base + noches adicionales), con el desglose por fecha.
  const cotizacionHotel =
    modoHotel && tablaHotel && nochesIncluidas != null && fechaIda
      ? cotizarEstanciaDesdePvp(tablaHotel, nochesIncluidas, {
          modalidad, fechaEntrada: fechaIda, nochesAdicionales: adicionales, habitaciones: habs, ninos: Number(ninos) || 0, infantes: Number(infantes) || 0,
        })
      : null;
  const total = modoHotel ? (cotizacionHotel?.ok ? cotizacionHotel.total : 0) : totalMatriz;
  // Con noches adicionales se desplaza el último día: un itinerario al que le falta un día pondría la recogida en el día equivocado.
  // PR #409: el itinerario debe traer los días 1..N en TODOS los modos (antes solo con noches adicionales en modo hotel).
  const errorItinerario = errorItinerarioPrograma ?? (modoHotel ? validarItinerarioCompleto(itinerario, dias) : null);
  // Blackouts: la entrada, o —si el blackout es de alcance «viaje»— cualquier día del viaje (noches adicionales incluidas).
  const nochesDelViaje = modoHotel
    ? (nochesIncluidas != null ? nochesIncluidas + adicionales : 0)
    : (modoSalida ? (categorias.find((c) => c.id === categoriaId)?.noches ?? null) : null) ?? (dias ? Math.max(0, dias - 1) : 0);
  const rangoViaje = fechaIda ? rangoDelViaje(fechaIda, nochesDelViaje) : null;
  const blackoutAplicado = rangoViaje ? blackoutQueAplica(blackouts, rangoViaje) : null;
  const errorBlackout = blackoutAplicado && rangoViaje ? mensajeBlackout(blackoutAplicado, rangoViaje) : null;
  const errorEstancia = !modoHotel ? null : errorPrograma ? errorPrograma : errorItinerario ? errorItinerario : !tablaHotel ? "Elige el hotel." : cotizacionHotel && !cotizacionHotel.ok ? cotizacionHotel.error : baseHotel && !baseHotel.ok ? baseHotel.error : null;
  const itinerarioReserva = (modoHotel && fechaIda && tablaHotel ? itinerarioConNochesExtra(itinerario, adicionales, fechaIda, tablaHotel.hotel.nombre, dias) : null) ?? [];

  // #57: el servidor recalcula el precio al confirmar. Si cambió, no crea nada y
  // devuelve el nuevo importe; solo un clic EXPRESO del usuario lo acepta. La
  // aceptación y el aviso valen únicamente para la selección en la que se
  // produjeron (cambiar categoría, fecha, habitaciones o niños los descarta).
  const claveSeleccion = JSON.stringify([categoriaId, fechaIda, habs, Number(ninos) || 0, Number(infantes) || 0, hotelId, modalidad, adicionales]);
  const [cambio, setCambio] = useState<{ clave: string; datos: CambioPrecioPrograma } | null>(null);
  const cambioVigente = cambio && cambio.clave === claveSeleccion ? cambio.datos : null;

  // Pasajeros: tantos como pax total
  const [pasajeros, setPasajeros] = useState<Pasajero[]>([]);
  const sincronizarPasajeros = (n: number) => {
    setPasajeros((prev) => {
      const arr = [...prev];
      while (arr.length < n) arr.push(pasajeroVacio());
      // `truncarPasajeros` (compartida, B7 #3): al reducir `n` no solo
      // recorta el arreglo, también limpia cualquier `responsableIndex` que
      // quedara apuntando a una fila recortada — nunca lo reasigna en
      // silencio a quien quede en esa posición.
      return truncarPasajeros(arr, n);
    });
  };
  // Mantener el número de pasajeros sincronizado al cambiar pax.
  if (pasajeros.length !== totalPax) sincronizarPasajeros(totalPax);

  const updHab = (acom: string, v: string) => setHabs((p) => ({ ...p, [acom]: Number(v) || 0 }));
  const updPasajero = (i: number, k: keyof Pasajero, v: string) =>
    setPasajeros((p) => {
      const next = p.map((x, j) => (j === i ? { ...x, [k]: v } : x));
      // Cambio de fecha de nacimiento (B8, ronda 3): recalcula si sigue
      // calificando como infante o como responsable de otro.
      return k === "fechaNacimiento" ? recalcularVinculosPorEdad(next, fechaIda || null) : next;
    });
  const setPasajeroResponsable = (i: number, responsableIndex: number | null) =>
    setPasajeros((p) => p.map((x, j) => (j === i ? { ...x, responsableIndex } : x)));
  // Cambiar la fecha de salida (fecha de REFERENCIA para calcular edades)
  // también puede mover pasajeros entre categorías — mismo recálculo que un
  // cambio de fecha de nacimiento (B8, ronda 3).
  const cambiarFechaIda = (v: string) => {
    setFechaIda(v);
    setPasajeros((p) => recalcularVinculosPorEdad(p, v || null));
  };
  // Los datos del cliente solo se copian a UN pasajero (PR #409); deshacer devuelve lo que tenía.
  const [copiaTitularRaw, setCopiaTitular] = useState<CopiaTitular>(null);
  const copiaTitular = copiaVigente(copiaTitularRaw, pasajeros.length);
  const copiarCliente = (i: number) => {
    const r = aplicarCopiaTitular(pasajeros, i, cliente, copiaTitular);
    if (!r) return;
    setPasajeros(r.pax);
    setCopiaTitular(r.copia);
  };
  const deshacerCopiaCliente = () => {
    const r = deshacerCopiaTitular(pasajeros, copiaTitular);
    setPasajeros(r.pax);
    setCopiaTitular(r.copia);
  };

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Con un cambio de precio pendiente NO se reenvía el importe viejo: se acepta
    // el nuevo con su botón, o se cambia la selección.
    if (cambioVigente) return;
    enviar(total);
  }

  /** Todo lo que el servidor necesita menos los pasajeros: lo comparten «generar reserva» y la vista previa de términos B2B. */
  const datosReserva = (precioConfirmado: number) => ({
    precioConfirmado,
    programaId,
    categoriaId: modoHotel ? 0 : categoriaId,
    salidaId: modoSalida ? categoriaId : undefined,
    estancia: modoHotel ? { hotelId, modalidad, nochesAdicionales: adicionales } : undefined,
    trmCosto: pideTrmCosto ? trmCosto : undefined,
    fechaIda,
    paxPorAcom: habs, // ahora son HABITACIONES por acomodación (el server expande a pax)
    ninos: Number(ninos) || 0,
    infantes: Number(infantes) || 0,
    cliente,
    tipoAsesor,
    asesorInterno,
    // El nombre del aliado sale del catálogo en el servidor; aquí solo viaja la ELECCIÓN.
    agenciaNombre: "",
    agenciaAsesor,
    freelanceNombre: "",
    aliadoId: esB2B ? aliadoId : null,
    modoCompra: esB2B && modoCompra ? modoCompra : undefined,
    plazo,
  });

  // Vista previa de los términos B2B: la calcula el servidor con las reglas de siempre y NO crea nada.
  useEffect(() => {
    setTerminos(null);
    setTerminosError(null);
    if (!esB2B || !aliadoId || !modoCompra) return;
    let vigente = true;
    setCalculandoTerminos(true);
    const t = setTimeout(async () => {
      const r = await terminosB2BPrograma({ ...datosReserva(total), pasajeros: [] });
      if (!vigente) return;
      setCalculandoTerminos(false);
      if (r.ok) setTerminos(r.terminos);
      else setTerminosError(r.error);
    }, 350);
    return () => { vigente = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esB2B, aliadoId, modoCompra, claveSeleccion, tipoAsesor]);

  function enviar(precioConfirmado: number) {
    setError(null);
    if (errorItinerario) return setError(errorItinerario);
    if (errorBlackout) return setError(errorBlackout);
    if (esB2B && !aliadoId) return setError(`Selecciona la ${tipoAsesor} del catálogo.`);
    if (esB2B && !modoCompra) return setError("Elige si el contrato se genera a PVP o a NETO.");
    if (!fechaIda) return setError(modoHotel ? "Elige la fecha de entrada al hotel." : "Elige la fecha de salida.");
    if (modoHotel && errorEstancia) return setError(errorEstancia);
    if (pideTrmCosto) {
      const v = validarTrmCosto(trmCosto);
      if (!v.ok) return setError(v.error);
    }
    if (totalPax <= 0) return setError("Indica cuántas habitaciones reservas en cada acomodación.");
    if (!`${cliente.nombres}${cliente.apellidos}`.trim()) return setError("El nombre del cliente es obligatorio.");
    if (cliente.numeroDoc.trim() && !cliente.tipoDoc) return setError("Elige el tipo de documento del cliente.");
    startTransition(async () => {
      const res = await reservarPrograma({
        ...datosReserva(precioConfirmado),
        pasajeros: pasajeros.map((p, i) => ({
          nombres: p.nombres,
          apellidos: p.apellidos,
          tipoDoc: p.tipoDoc,
          numeroDoc: p.numeroDoc,
          fechaNacimiento: p.fechaNacimiento,
          nacionalidad: p.nacionalidad,
          // Los últimos N pasajeros corresponden a los infantes declarados
          // (clasificación por composición, solo informativa aquí) — el
          // servidor SIEMPRE recalcula por fecha de nacimiento real contra
          // fechaIda (crear_pasajeros_contrato, migración 167).
          esInfante: i >= paxConSilla,
          responsableIndex: p.responsableIndex ?? null,
        })),
      });
      if (!res.ok) {
        if ("cambioPrecio" in res) {
          setCambio({ clave: claveSeleccion, datos: res.cambioPrecio });
          return setError(null);
        }
        return setError(res.error);
      }
      setCambio(null);
      if (res.advertencias?.length) window.alert(`Contrato creado, pero con avisos:\n\n${res.advertencias.join("\n")}`);
      router.push(`/dashboard/contratos/${encodeURIComponent(res.numero)}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Programa por hotel y vigencia (#88) */}
      {modoHotel && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={lbl}>Hotel</label>
              <select aria-label="Hotel" value={hotelId} onChange={(e) => setHotelId(Number(e.target.value))} className={sel}>
                {(hoteles ?? []).map((t) => (
                  <option key={t.hotel.id} value={t.hotel.id}>{[t.hotel.nombre, t.hotel.zona, t.hotel.tipoHabitacion].filter(Boolean).join(" · ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl}>Servicios</label>
              <select aria-label="Servicios" value={modalidad} onChange={(e) => setModalidad(e.target.value as ModalidadServicios)} className={sel}>
                {MODALIDADES_SERVICIOS.map((m) => <option key={m} value={m}>{ETIQUETA_MODALIDAD[m]}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Fecha de entrada al hotel</label>
              <DateInput aria-label="Fecha de entrada al hotel" type="date" value={fechaIda} min={vigenciaDesde ?? undefined} max={vigenciaHasta ?? undefined} onValueChange={(dateValue) => cambiarFechaIda(dateValue)} />
            </div>
            <div>
              <label className={lbl}>Noches adicionales (después de la estancia incluida)</label>
              <Input
                aria-label="Noches adicionales"
                type="number"
                min={0}
                max={MAX_NOCHES_ADICIONALES}
                value={adicionales || ""}
                onChange={(e) => setAdicionales(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                placeholder="0"
              />
            </div>
          </div>

          {pideTrmCosto && (
            <div>
              <label className={lbl}>TRM de costos (pesos por dólar)</label>
              <Input aria-label="TRM de costos" inputMode="decimal" value={trmCosto} onChange={(e) => setTrmCosto(e.target.value)} placeholder="Ej. 4100" className="w-48" />
              <p className="mt-1 text-xs text-gray-400">Se congela en el contrato y en cada cuenta por pagar en dólares. No es la TRM de cobro.</p>
            </div>
          )}

          {errorEstancia && (fechaIda || errorPrograma || errorItinerario) && <p role="alert" className="text-sm text-amber-700">{errorEstancia}</p>}

          {fechaIda && nochesIncluidas != null && !errorEstancia && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700" aria-label="Resumen de la estancia">
              <p>
                Estancia incluida: <strong>{fechaLegible(fechaIda)}</strong> a <strong>{fechaLegible(fechaRegresoEstancia(fechaIda, nochesIncluidas, 0))}</strong> ({nochesIncluidas} noches).
              </p>
              {adicionales > 0 && cotizacionHotel?.ok && (
                <>
                  <p className="mt-1">
                    Regreso con {adicionales} noche(s) adicional(es): <strong>{fechaLegible(fechaRegresoEstancia(fechaIda, nochesIncluidas, adicionales))}</strong>.
                  </p>
                  <table className="mt-2 w-full text-xs">
                    <thead>
                      <tr className="text-left uppercase tracking-wide text-gray-400">
                        <th className="py-1 pr-2">Noche</th><th className="py-1 pr-2">Vigencia</th><th className="py-1 pr-2">Se cobra</th><th className="py-1 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cotizacionHotel.noches.map((n) => (
                        <tr key={n.fecha} className="border-t border-gray-100">
                          <td className="py-1 pr-2">{fechaLegible(n.fecha)}</td>
                          <td className="py-1 pr-2 text-gray-500">{fechaLegible(n.vigenciaDesde)} — {fechaLegible(n.vigenciaHasta)}</td>
                          <td className="py-1 pr-2 text-gray-500">{ETIQUETA_UNIDAD[n.unidad]}</td>
                          <td className="py-1 text-right tabular-nums">{formatMoneda(n.pvpCentavos / 100, moneda)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 font-medium">
                        <td className="py-1" colSpan={3}>Estancia incluida</td>
                        <td className="py-1 text-right tabular-nums">{formatMoneda(cotizacionHotel.totalBase, moneda)}</td>
                      </tr>
                      <tr className="font-medium">
                        <td className="py-1" colSpan={3}>Noches adicionales</td>
                        <td className="py-1 text-right tabular-nums">{formatMoneda(cotizacionHotel.totalNoches, moneda)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}
              {itinerarioReserva.length > 0 && (
                <ol className="mt-3 space-y-0.5 text-xs text-gray-600" aria-label="Itinerario con las noches adicionales">
                  {itinerarioReserva.map((d) => (
                    <li key={d.dia} className={d.libre ? "text-[#1D7C9A]" : ""}>
                      Día {d.dia}{d.fecha ? ` (${fechaLegible(d.fecha)})` : ""}: {d.titulo ?? "—"}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}

      {/* Salida (ya trae su fecha concatenada) o Categoría + fecha libre */}
      {modoHotel ? null : modoSalida ? (
        <div>
          <label className={lbl}>Salida</label>
          <select
            value={categoriaId}
            onChange={(e) => {
              const id = Number(e.target.value);
              setCategoriaId(id);
              const c = categorias.find((x) => x.id === id);
              cambiarFechaIda(c?.fechaSugerida ?? "");
            }}
            className={sel}
          >
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          {cat?.noches != null && <p className="mt-1 text-xs text-gray-400">{cat.noches} noches.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={lbl}>Categoría (hoteles)</label>
            <select value={categoriaId} onChange={(e) => setCategoriaId(Number(e.target.value))} className={sel}>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl}>Fecha de salida</label>
            <DateInput aria-label="Fecha de salida" type="date" value={fechaIda} min={vigenciaDesde ?? undefined} max={vigenciaHasta ?? undefined} onValueChange={(dateValue) => cambiarFechaIda(dateValue)} />
            {dias ? (
              <p className="mt-1 text-xs text-gray-400">Regreso estimado a {dias} días de la salida.</p>
            ) : null}
          </div>
        </div>
      )}

      {/* Habitaciones por acomodación */}
      <div>
        <label className={lbl}>Habitaciones por acomodación (Doble = 2 pax, Triple = 3, Sencilla = 1)</label>
        {textoEdades && <p className="mb-2 text-xs text-gray-400">{textoEdades}</p>}
        <div className="flex flex-wrap gap-3">
          {acomsAdulto.map((a) => {
            const cap = paxPorHab(a.acomodacion);
            const nHab = Number(habs[a.acomodacion]) || 0;
            return (
              <div key={a.acomodacion} className="w-44 rounded-lg border border-gray-200 bg-white p-2">
                <div className="text-xs font-medium text-gray-600">{ACOM_LABEL[a.acomodacion] ?? a.acomodacion} <span className="text-gray-400">· {cap} pax/hab</span></div>
                <div className="mb-1 text-xs" style={{ color: "var(--brand-primary)" }}>
                  {formatMoneda((a.pvp ?? 0) * cap, moneda)} <span className="text-gray-400">/ hab</span>
                </div>
                <Input type="number" min={0} value={habs[a.acomodacion] ?? ""} onChange={(e) => updHab(a.acomodacion, e.target.value)} placeholder="0" />
                {nHab > 0 && <div className="mt-1 text-[11px] text-gray-400">{nHab} hab = {nHab * cap} pax</div>}
              </div>
            );
          })}
          {precioNino != null && (
            <div className="w-44 rounded-lg border border-gray-200 bg-white p-2">
              <div className="text-xs font-medium text-gray-600">Niños <span className="text-gray-400">· por cantidad</span></div>
              <div className="mb-1 text-xs" style={{ color: "var(--brand-primary)" }}>{formatMoneda(precioNino, moneda)} <span className="text-gray-400">c/u</span></div>
              <Input type="number" min={0} value={ninos || ""} onChange={(e) => setNinos(Number(e.target.value) || 0)} placeholder="0" />
            </div>
          )}
          <div className="w-44 rounded-lg border border-gray-200 bg-white p-2">
            <div className="text-xs font-medium text-gray-600">Infantes <span className="text-gray-400">· por cantidad</span></div>
            <div className="mb-1 text-xs text-gray-400">{edadInfanteMax != null ? `hasta ${edadInfanteMax} año${edadInfanteMax === 1 ? "" : "s"}` : "sin costo"}</div>
            <Input type="number" min={0} value={infantes || ""} onChange={(e) => setInfantes(Number(e.target.value) || 0)} placeholder="0" />
          </div>
        </div>
        {acomsAdulto.length === 0 && !(modoHotel && (!fechaIda || errorEstancia)) && (
          <p className="mt-2 text-sm text-amber-700">Esta categoría no tiene precios publicados (revisa “a solicitud”).</p>
        )}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
        <span className="text-sm text-gray-600">{totalPax} pasajero(s)</span>
        <span className="text-lg font-semibold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(total, moneda)}</span>
      </div>

      {/* Cliente */}
      <fieldset className="rounded-xl border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-700">Cliente</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={lbl}>Número de documento</label>
            <div className="flex gap-1">
              <Input value={cliente.numeroDoc} onChange={(e) => setCliente({ ...cliente, numeroDoc: e.target.value })} />
              <BuscarTitular numero={cliente.numeroDoc} actual={cliente} campos={["nombres", "apellidos", "telefono", "email"]} onAplicar={({ tipoDoc, ...d }) => setCliente((p) => ({ ...p, tipoDoc, ...d }))} />
            </div>
          </div>
          <div className="sm:col-span-2"><label className={lbl}>Tipo de documento</label>
            <select value={cliente.tipoDoc} onChange={(e) => setCliente({ ...cliente, tipoDoc: e.target.value })} className={sel}>
              <option value="">Elige el tipo…</option>
              <OpcionesTipoDoc />
            </select>
          </div>
          <div><label className={lbl}>Nombres</label><Input value={cliente.nombres} onChange={(e) => setCliente({ ...cliente, nombres: e.target.value })} /></div>
          <div><label className={lbl}>Apellidos</label><Input value={cliente.apellidos} onChange={(e) => setCliente({ ...cliente, apellidos: e.target.value })} /></div>
          <div><label className={lbl}>Teléfono</label><Input value={cliente.telefono} onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })} /></div>
          <div><label className={lbl}>Email</label><Input value={cliente.email} onChange={(e) => setCliente({ ...cliente, email: e.target.value })} /></div>
        </div>
      </fieldset>

      {/* Pasajeros */}
      {pasajeros.length > 0 && (
        <fieldset className="rounded-xl border border-gray-200 p-4">
          <legend className="px-1 text-sm font-semibold text-gray-700">Pasajeros ({pasajeros.length})</legend>
          <div className="space-y-3">
            {(() => {
              // Edad REAL contra fechaIda — mismo criterio que usará el
              // servidor (crear_pasajeros_contrato) para exigir un adulto
              // responsable vinculado a todo infante nuevo (B1).
              const refFecha = fechaIda || null;
              const edadesReales = pasajeros.map((p) => calcularEdad(p.fechaNacimiento, refFecha));
              const esInfanteRealRow = pasajeros.map((p) => esInfantePorEdad(p.fechaNacimiento, refFecha));
              return pasajeros.map((p, i) => (
                <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">Pasajero {i + 1}</span>
                    <BotonCopiarTitular indice={i} copia={copiaTitular} onCopiar={() => copiarCliente(i)} onDeshacer={deshacerCopiaCliente} etiqueta="Copiar del cliente" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Input value={p.nombres} onChange={(e) => updPasajero(i, "nombres", e.target.value)} placeholder="Nombres" />
                    <Input value={p.apellidos} onChange={(e) => updPasajero(i, "apellidos", e.target.value)} placeholder="Apellidos" />
                    <select value={p.tipoDoc} onChange={(e) => updPasajero(i, "tipoDoc", e.target.value)} className={sel}>
                      {/* value="PAS" (no "PASAPORTE"): el núcleo atómico de la
                          migración 167 compara literalmente contra 'PAS' para
                          eximir del chequeo "solo dígitos" (un pasaporte real
                          puede traer letras) — mismo valor que usan los otros
                          4 formularios que capturan pasajeros. Con
                          "PASAPORTE" ese chequeo SIEMPRE se aplicaba (bug
                          preexistente, corregido aquí) y además la búsqueda
                          por documento (migración 187) nunca cruzaba con un
                          pasaporte cargado desde otro formulario. */}
                      <OpcionesTipoDoc pasajero />
                    </select>
                    <div className="flex items-center gap-1">
                      <Input value={p.numeroDoc} onChange={(e) => updPasajero(i, "numeroDoc", e.target.value)} placeholder="Documento" />
                      <BuscarPasajeroDocumento
                        tipoId={p.tipoDoc}
                        identificacion={p.numeroDoc}
                        onAplicar={(datos) => {
                          if (datos.fechaNacimiento) updPasajero(i, "fechaNacimiento", datos.fechaNacimiento);
                          if (datos.nacionalidad) updPasajero(i, "nacionalidad", datos.nacionalidad);
                          // nombres/apellidos SOLO si la fila encontrada ya
                          // los trae estructurados (migración 187) — nunca se
                          // parte `nombreHistorico` por heurística.
                          if (datos.nombres) updPasajero(i, "nombres", datos.nombres);
                          if (datos.apellidos) updPasajero(i, "apellidos", datos.apellidos);
                        }}
                      />
                    </div>
                    <DateInput aria-label="Fecha de nacimiento" type="date" value={p.fechaNacimiento} onValueChange={(dateValue) => updPasajero(i, "fechaNacimiento", dateValue)} />
                    <Input value={p.nacionalidad} onChange={(e) => updPasajero(i, "nacionalidad", e.target.value)} placeholder="Nacionalidad" />
                  </div>
                  {esInfanteRealRow[i] && (
                    <div className="mt-2">
                      <label className={lbl}>Adulto responsable *</label>
                      <select
                        value={p.responsableIndex ?? ""}
                        onChange={(e) => setPasajeroResponsable(i, e.target.value === "" ? null : Number(e.target.value))}
                        className={sel}
                      >
                        <option value="">Sin vincular (se rechazará al generar)</option>
                        {pasajeros.map((otro, j) => {
                          if (j === i) return null;
                          const edadOtro = edadesReales[j];
                          if (edadOtro == null || edadOtro < 18) return null;
                          const nombre = `${otro.nombres} ${otro.apellidos}`.trim() || `Pasajero ${j + 1}`;
                          return <option key={j} value={j}>{nombre}</option>;
                        })}
                      </select>
                      <p className="mt-1 text-xs text-gray-400">Todo infante debe quedar vinculado a un adulto (18+ años) del mismo contrato.</p>
                    </div>
                  )}
                </div>
              ));
            })()}
          </div>
        </fieldset>
      )}

      {/* Tipo de venta */}
      <fieldset className="rounded-xl border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-700">Tipo de venta</legend>
        <div className="mb-3 flex flex-wrap gap-3 text-sm">
          {(["interno", "agencia", "freelance"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input type="radio" checked={tipoAsesor === t} onChange={() => setTipoAsesor(t)} /> {t === "interno" ? "Interno (B2C)" : t === "agencia" ? "Agencia (B2B)" : "Freelance (B2B)"}
            </label>
          ))}
        </div>
        {tipoAsesor === "interno" && (
          <div>
            <label className={lbl}>Asesor</label>
            <select value={asesorInterno} onChange={(e) => setAsesorInterno(e.target.value)} className={sel}>
              {asesores.map((a) => <option key={a.email} value={a.email}>{a.nombre}</option>)}
            </select>
          </div>
        )}
        {esB2B && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={lbl} htmlFor="aliado-b2b">{tipoAsesor === "agencia" ? "Agencia" : "Freelance"} (catálogo)</label>
                <select id="aliado-b2b" value={aliadoId ?? ""} onChange={(e) => setAliadoId(e.target.value ? Number(e.target.value) : null)} className={sel}>
                  <option value="">Selecciona…</option>
                  {aliadosDelTipo.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
                {!aliadosDelTipo.length && <p className="mt-1 text-xs text-amber-700">No hay {tipoAsesor === "agencia" ? "agencias" : "freelances"} activos en el catálogo.</p>}
                {aliadoElegido && (
                  <p className="mt-1 text-xs text-gray-500">
                    Comisión {Math.round(aliadoElegido.pct * 10000) / 100} % · {aliadoElegido.pctOrigen === "aliado" ? "porcentaje propio del aliado" : aliadoElegido.pctOrigen === "general" ? "porcentaje general del sistema" : "porcentaje por defecto"}
                  </p>
                )}
              </div>
              {tipoAsesor === "agencia" && (
                <div><label className={lbl} htmlFor="agencia-asesor">Asesor de la agencia</label><Input id="agencia-asesor" value={agenciaAsesor} onChange={(e) => setAgenciaAsesor(e.target.value)} /></div>
              )}
            </div>

            <fieldset className="rounded-lg border border-gray-200 p-3">
              <legend className="px-1 text-xs font-medium text-gray-600">¿Cómo se genera el contrato? (obligatorio)</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {([
                  ["comisionable", "PVP", "Se cobra el total del programa; la comisión del aliado se liquida aparte. Cliente: la persona."],
                  ["neta", "NETO", "Se cobra el PVP menos la comisión. Cliente: el aliado; la persona queda como titular de la reserva."],
                ] as const).map(([valor, titulo, ayuda]) => (
                  <label key={valor} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${modoCompra === valor ? "border-[#1D7C9A] bg-sky-50" : "border-gray-200"}`}>
                    <input type="radio" name="modo-compra-b2b" className="mt-1" checked={modoCompra === valor} onChange={() => setModoCompra(valor)} />
                    <span><strong>{titulo}</strong><span className="block text-xs text-gray-500">{ayuda}</span></span>
                  </label>
                ))}
              </div>
              {!modoCompra && <p className="mt-2 text-xs text-gray-500">Elige PVP o NETO para ver la base comisionable, el impuesto no comisionable, el porcentaje y la comisión.</p>}
            </fieldset>

            {calculandoTerminos && <p className="text-xs text-gray-500" role="status">Calculando términos…</p>}
            {terminosError && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" role="status">No se pueden mostrar los términos todavía: {terminosError}</p>}
            {terminos && <TerminosB2BAsistido plan={terminos} previa />}
          </div>
        )}
        <div className="mt-3">
          <label className={lbl}>Plazo de pago (opcional)</label>
          <DateInput aria-label="Plazo de pago (opcional)" type="date" value={plazo} onValueChange={(dateValue) => setPlazo(dateValue)} className="w-48" />
        </div>
      </fieldset>

      {errorItinerario && !modoHotel && <p role="alert" className="text-sm text-amber-700" data-testid="error-itinerario">{errorItinerario} No se puede reservar hasta completarlo.</p>}
      {errorBlackout && <p role="alert" className="text-sm text-amber-700" data-testid="error-blackout">{errorBlackout}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {cambioVigente && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">El precio de la reserva cambió. No se creó ningún contrato.</p>
          <p>
            {cambioVigente.anterior != null ? <>Habías confirmado {formatMoneda(cambioVigente.anterior, cambioVigente.moneda)}. </> : null}
            Importe actual: <strong>{formatMoneda(cambioVigente.nuevo, cambioVigente.moneda)}</strong>.
          </p>
          <Button
            type="button"
            disabled={pending}
            onClick={() => enviar(cambioVigente.nuevo)}
            style={{ backgroundColor: "var(--brand-primary)" }}
          >
            {pending ? "Generando…" : `Aceptar ${formatMoneda(cambioVigente.nuevo, cambioVigente.moneda)} y generar reserva`}
          </Button>
        </div>
      )}
      <Button type="submit" disabled={pending || !!cambioVigente} style={{ backgroundColor: "var(--brand-primary)" }}>
        {pending ? "Generando…" : "Generar reserva"}
      </Button>
    </form>
  );
}
