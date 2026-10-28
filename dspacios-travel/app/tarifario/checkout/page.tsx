"use client";

import { BuscarTitular } from "@/components/personas/BuscarTitular";
import { Suspense, lazy, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoneda } from "@/lib/utils";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { useCart, type CartItem, type HotelCartItem, type HotelCartItemPersona, type HotelCartItemBernalo } from "@/lib/cart/CartContext";
import { normalizarEdadesMenoresCarrito } from "@/lib/reservar/edadesMenores";
import { comisionSobre, formatImporte, monedaDeItem, preverCotizacion } from "@/lib/cart/monedaCarrito";
import { AvisoMonedas, TotalesPorMoneda } from "../totalesCarrito";
import { UserCheck } from "lucide-react";
import { PresentacionComparativaEditor, errorEdicion, presentacionDesdeEdicion, type EdicionPresentacion, type OpcionEditable } from "@/components/cotizacion/PresentacionComparativaEditor";
import type { PresentacionComparativa } from "@/lib/cotizacion/comparativa";
import { crearSolicitudReserva, fotosPortada, getContextoAsistenciaB2B, previsualizarPresentacionComparativa, type PresentacionPrevia, previsualizarTerminosB2BAsistido, previsualizarComparativaB2B, type PrevisualizacionB2B, type PrevisualizacionComparativaB2B, getContextoB2B, type SolicitudResult, type ContextoAsistenciaCheckout, type ContextoB2B, type ResultadoComparativaCreada } from "./actions";
import { TerminosB2BAsistido } from "@/components/cotizacion/TerminosB2BAsistido";
import { ServicioManualPanel } from "./ServicioManualPanel";
import { ResumenOpcionesComparativa } from "./ResumenOpcionesComparativa";
import { useIatasDestinos } from "@/lib/cart/useIatasDestinos";
import { agruparHotelesPorViaje, esClaveGrupoViaje, fechasDeVuelo, vuelosComunesCompatibles, type ServicioManual } from "@/lib/cart/servicioManual";
// #35: se carga solo cuando el modo comparativa está activo (no entra al grafo del checkout normal).
const ContinuarComparativa = lazy(() => import("@/lib/cotizacion/comparativaCheckout").then((m) => ({ default: m.ContinuarComparativa })));
import { MAX_OPCIONES, mensajeAcomodacionComparativa, validarAcomodacionComparativa } from "@/lib/cotizacion/comparativa";
import { TIPOS_DOC_PERSONA } from "@/lib/personas/identidad";

// El servidor devolvió que el desglose B2B cambió entre la vista previa y generar (no se creó nada).
const esTerminosCambiaron = (r: SolicitudResult): r is Extract<SolicitudResult, { tipo: "terminos_cambiaron" }> => !r.ok && "tipo" in r && r.tipo === "terminos_cambiaron";

function resumenHab(it: HotelCartItemPersona): string {
  const partes = Object.entries(it.habitaciones).filter(([, n]) => n > 0).map(([a, n]) => `${n} ${ACOM_ROOM_LABEL[a as AcomRoom] ?? a}`);
  if (it.ninos > 0) partes.push(`${it.ninos} Niño 1`);
  if (it.ninos2 > 0) partes.push(`${it.ninos2} Niño 2`);
  return partes.join(", ");
}

// Resumen mínimo, solo lectura, de un ítem Bernalo (habitaciones físicas, sin
// conteo por acomodación — regla A.2).
function resumenHabBernalo(it: { habitaciones: { acom: string; adultos: number }[] }): string {
  return it.habitaciones.map((h) => `${ACOM_ROOM_LABEL[h.acom as AcomRoom] ?? h.acom} (${h.adultos} adt)`).join(", ");
}

export default function CheckoutPage() {
  const { items, totales, remove, clear, actualizarPrecioBernalo, modoComparativa, setModoComparativa } = useCart();
  const hotelItems = items.filter((i): i is HotelCartItemPersona => i.tipo === "hotel" && i.modeloTarifario !== "unidad");
  // Fase 3F-4A: el checkout YA envía los ítems Bernalo — el servidor los
  // re-liquida directo con `computarReservaBernalo` (checkout/actions.ts),
  // nunca confía en `precio`/`moneda` del carrito para calcular nada (solo
  // para detectar si cambiaron, ver `enviar()`).
  const bernaloItems = items.filter((i): i is HotelCartItemBernalo => i.tipo === "hotel" && i.modeloTarifario === "unidad");
  const tourItems = items.filter((i): i is Extract<CartItem, { tipo: "tour" }> => i.tipo === "tour");
  const manualItems = items.filter((i): i is Extract<CartItem, { tipo: "manual" }> => i.tipo === "manual");
  // #64: IATA de cada destino (catálogo) y grupos de la comparativa (destino IATA + fechas). Los vuelos se asocian al grupo; sus fechas son las del plan del hotel.
  const iataDe = useIatasDestinos(hotelItems.map((h) => h.destino));
  const hotelesViaje = hotelItems.map((h) => ({ id: h.id, ref: h.id, nombre: h.hotelNombre, destino: h.destino, destinoIata: iataDe(h.destino), fechaIda: h.fechaIda, fechaRegreso: h.fechaRegreso, pax: h.pax }));
  const gruposViaje = agruparHotelesPorViaje(hotelesViaje).grupos;
  /** Lo que se envía de un vuelo: selector (hotel del carrito, o grupo en una comparativa) y fechas SIEMPRE las del plan vigente. */
  const vueloParaEnviar = (m: Extract<CartItem, { tipo: "manual" }>): Extract<CartItem, { tipo: "manual" }> => {
    if (m.clase !== "vuelo" || !m.tramo) return m;
    const grupo = esClaveGrupoViaje(m.hotelRef) ? gruposViaje.find((g) => g.clave === m.hotelRef) : gruposViaje.find((g) => g.hoteles.some((h) => h.id === m.hotelRef));
    const hotel = hotelesViaje.find((h) => h.id === m.hotelRef);
    const plan = vista.crear ? (grupo ? { fechaIda: grupo.fechaIda, fechaRegreso: grupo.fechaRegreso } : null) : (hotel ?? null);
    const f = plan ? fechasDeVuelo(m.tramo, plan) : { fechaIda: m.fechaIda, fechaRegreso: m.fechaRegreso };
    return { ...m, ...f, hotelRef: vista.crear ? (grupo?.clave ?? m.hotelRef) : m.hotelRef };
  };
  // `tipoDoc` (#42, D-6): se pide en el checkout; vacío = sin elegir (nunca un "CC" por defecto). No bloquea
  // el envío: sin tipo, la persona queda como ficha provisional en el CRM.
  const [c, setC] = useState({ nombres: "", apellidos: "", tipoDoc: "", numeroDoc: "", telefono: "", email: "" });
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  // Entre la vista previa y generar cambió el desglose B2B: se avisa, la vista previa se actualiza y hay que confirmar de nuevo.
  const [avisoTerminos, setAvisoTerminos] = useState("");
  // Fase 3F-4A, regla B.10: cuando el servidor detecta que el PVP/moneda de
  // un ítem Bernalo cambiaron, el carrito se actualiza y se exige una
  // SEGUNDA confirmación explícita (el botón normal ya no basta) — nunca se
  // reintenta solo, y el segundo clic vuelve a pasar por el mismo recálculo
  // completo (regla B.11).
  const [precioCambio, setPrecioCambio] = useState<{ paqueteId: number; hotelId: number; mensaje: string } | null>(null);
  const [res, setRes] = useState<Extract<SolicitudResult, { ok: true }> | null>(null);
  const [fotos, setFotos] = useState<Record<number, string>>({});
  // #35: modo de la página según la URL. Se lee en el cliente (sin useSearchParams → sin Suspense).
  // #64: el interno puede dejar la comparativa para que el cliente elija desde el enlace (solo se envía en modo comparativa).
  const [compartir, setCompartir] = useState(false);
  const [otrasAcom, setOtrasAcom] = useState(false);
  const [resCmp, setResCmp] = useState<Extract<ResultadoComparativaCreada, { ok: true }> | null>(null);
  const search = useSyncExternalStore(() => () => {}, () => window.location.search, () => "");
  const vista = useMemo(() => {
    const q = new URLSearchParams(search);
    const token = q.get("comparativa"), op = q.get("op"), ac = q.get("ac");
    return { crear: q.get("modo") === "comparativa", continuar: token && op && ac ? { token, op, ac } : null };
  }, [search]);

  // El modo «Cotización comparativa» del carrito y la URL no se contradicen en silencio: abrir la comparativa lo activa, y el modo activo no cae en la compra normal.
  const router = useRouter();
  const [, refrescarUrl] = useState(0);
  useEffect(() => {
    if (vista.continuar) return;
    if (vista.crear && !modoComparativa) setModoComparativa(true);
    else if (!vista.crear && modoComparativa) { router.replace("/tarifario/checkout?modo=comparativa"); refrescarUrl((n) => n + 1); }
  }, [vista.crear, vista.continuar, modoComparativa, setModoComparativa, router]);

  // Contexto B2B (si el aliado está logueado): habilita modo + facturación.
  const [ctx, setCtx] = useState<ContextoB2B | null>(null);
  const [modo, setModo] = useState<"comisionable" | "neta">("comisionable");
  const [fact, setFact] = useState({ nombre: "", nit: "", email: "", telefono: "" });
  useEffect(() => {
    getContextoB2B().then((x) => {
      setCtx(x);
      if (x.esB2B && x.agencia) setFact(x.agencia);
    }).catch(() => {});
  }, []);
  const esB2B = !!ctx?.esB2B;
  const faltanFacturacion = [!fact.nit.trim() && "NIT", !fact.telefono.trim() && "teléfono"].filter((x): x is string => !!x);

  // #102 — Venta ASISTIDA por personal interno: B2C (cliente final) o B2B (aliado identificado del catálogo, PVP con comisión o NETO).
  // Solo ELIGE: el servidor decide quién puede asistir, valida el aliado, su tipo y su porcentaje, y congela los términos. Se muestra solo
  // al personal autorizado (no a un aliado logueado, que ya tiene su propio flujo) y no en el modo comparativa.
  const [asist, setAsist] = useState<ContextoAsistenciaCheckout | null>(null);
  const [canal, setCanal] = useState<"b2c" | "b2b">("b2c");
  const [aliadoTxt, setAliadoTxt] = useState("");
  const [modoAsist, setModoAsist] = useState<"comisionable" | "neta">("comisionable");
  useEffect(() => {
    getContextoAsistenciaB2B().then(setAsist).catch(() => {});
  }, []);
  // #64/#102: también en la comparativa; allí cada opción liquida SUS términos (no hay total ni comisión global).
  const puedeAsistir = asist?.puede === true && !esB2B;
  // #64: el vuelo manual también lo agrega el personal interno a una comparativa (común a todas las opciones).
  const puedeManual = asist?.puede === true && !esB2B;
  const aliadosAsist = asist?.puede === true ? asist.aliados : [];
  // Buscador por nombre: la lista (<datalist>) filtra mientras se escribe; la elección es SIEMPRE un aliado activo del catálogo (su id). Texto que no
  // coincide exactamente con una opción no elige nada y no se puede enviar. Si dos opciones se llamaran igual se distinguen con su número.
  const normNombre = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();
  const etiquetaAliado = (a: (typeof aliadosAsist)[number]) => {
    const base = `${a.nombre.trim().replace(/\s+/g, " ")} · ${a.tipo === "agencia" ? "Agencia" : "Freelance"}`;
    return aliadosAsist.filter((o) => normNombre(o.nombre) === normNombre(a.nombre) && o.tipo === a.tipo).length > 1 ? `${base} (#${a.id})` : base;
  };
  const opcionesAliado = aliadosAsist.map((a) => ({ a, etiqueta: etiquetaAliado(a) }));
  const coincidencias = opcionesAliado.filter((o) => normNombre(o.etiqueta) === normNombre(aliadoTxt));
  const aliadoElegido = coincidencias.length === 1 ? coincidencias[0].a : null;
  const asistenciaB2B = puedeAsistir && canal === "b2b";
  // Presentación de la comisión: la del aliado logueado o, en venta asistida, la del aliado elegido (el servidor la recalcula y la congela).
  const hayB2B = esB2B || asistenciaB2B;
  const modoVista: "comisionable" | "neta" = asistenciaB2B ? modoAsist : modo;
  const pct = asistenciaB2B ? (aliadoElegido?.pct ?? 0) : (ctx?.pctComision ?? 0);
  // La comisión B2B (presentación) se calcula sobre UNA sola moneda: el total
  // único del carrito o, si mezcla divisas, lo que se anticipa que entrará a
  // la cotización (`preverCotizacion`). Si no se puede anticipar (ítems sin
  // moneda registrada), no se muestra una cifra. El servidor la recalcula.
  const prevision = preverCotizacion(items);
  const baseComision = totales.unica
    ?? (prevision.moneda && prevision.montoIncluido != null && !prevision.bloqueantes.length
      ? { moneda: prevision.moneda, monto: prevision.montoIncluido }
      : null);
  const { comision, neto: totalNeto } = comisionSobre(baseComision?.monto ?? 0, pct);
  const sobreParte = !totales.unica && baseComision != null;
  // La venta asistida NO estima la comisión aquí (no es un % del PVP: se descuenta antes el impuesto no comisionable): su desglose viene del servidor (vista previa).
  // Una comparativa no tiene una liquidación B2B única: sus alternativas compiten y no se suman (cada opción se cotiza por separado).
  const verComision = esB2B && !vista.crear;

  // Resuelve la portada actual por hotel (ítems del carrito sin fotoUrl).
  useEffect(() => {
    const ids = [...new Set([...hotelItems, ...bernaloItems].map((i) => i.hotelId))];
    if (!ids.length) return;
    fotosPortada(ids).then(setFotos).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  const fotoDe = (it: HotelCartItem) => fotos[it.hotelId] || it.fotoUrl;

  const inp = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const lbl = "mb-1 block text-xs font-medium text-gray-600";

  // Entrada que se manda al servidor (la misma para la solicitud normal y para la comparativa).
  function armarEntrada(itemsNormalizados: { it: HotelCartItemPersona; edadesMenores: number[] }[]) {
    return {
        items: [
          ...itemsNormalizados.map(({ it, edadesMenores }) => ({
            // `itemId`: solo para que sus servicios vinculados lo señalen.
            itemId: it.id,
            modulo: it.modulo, paqueteId: it.paqueteId, hotelId: it.hotelId, bloqueoId: it.bloqueoId,
            ...(it.modulo === "dinamico" ? { salidaId: it.salidaId ?? null } : {}),
            hotelNombre: it.hotelNombre, destino: it.destino, categoria: it.categoria, regimen: it.regimen,
            fechaIda: it.fechaIda, fechaRegreso: it.fechaRegreso, noches: it.noches,
            habitaciones: it.habitaciones, ninos: it.ninos, ninos2: it.ninos2, infantes: it.infantes, pax: it.pax, precio: it.precio,
            edadesMenores, cantidadMenores: edadesMenores.length,
          })),
          // `precio`/`moneda` viajan SOLO para que el servidor detecte si
          // cambiaron frente al recálculo autoritativo — nunca se usan para
          // calcular nada (regla B.9: el resultado del servidor SIEMPRE
          // reemplaza lo que mande el navegador). `itemId` (cierre 3F-4A #1)
          // es el `id` que el carrito ya le asignó a este ítem — viaja SOLO
          // para que el servidor pueda correlacionar un `precio_actualizado`
          // de vuelta a ESTE ítem exacto, nunca por paqueteId+hotelId (que
          // puede repetirse si hay dos ítems del mismo hotel con
          // ocupaciones distintas).
          ...bernaloItems.map((it) => ({
            modeloTarifario: "unidad" as const,
            itemId: it.id,
            paqueteId: it.paqueteId, hotelId: it.hotelId, hotelNombre: it.hotelNombre, destino: it.destino,
            categoria: it.categoria, alimentacion: it.alimentacion, salida: it.salida, habitaciones: it.habitaciones,
            precio: it.precio, moneda: it.moneda,
          })),
        ],
        // El servidor re-liquida cada tour EN VIVO por `servicioId`/
        // `paqueteId` (nunca confía en nombre/precio/moneda del carrito) —
        // ver liquidarServicioPuntual en lib/reservar/cotizar.ts.
        tours: tourItems.map((it) => ({
          servicioId: it.servicioId, paqueteId: it.paqueteId,
          fechaIda: it.fechaIda, fechaRegreso: it.fechaRegreso, pax: it.pax,
          // Hotel al que pertenece (servicio elegido en su tarjeta) — el
          // servidor lo valida y cotiza el conjunto completo o nada.
          hotelItemId: it.hotelItemId ?? null,
        })),
        // #64: precio de venta declarado por el asesor; el servidor lo vuelve a validar y exige sesión interna.
        ...(manualItems.length ? { manuales: manualItems.map(vueloParaEnviar).map((m) => ({ clase: m.clase, nombre: m.nombre, origen: m.origen, destino: m.destino, fechaIda: m.fechaIda, fechaRegreso: m.fechaRegreso, pax: m.pax, precio: m.precio, moneda: m.moneda, impuestoNoComisionable: m.impuestoNoComisionable, tramo: m.tramo, hotelRef: m.hotelRef, horaIda: m.horaIda ?? null, horaRegreso: m.horaRegreso ?? null })) } : {}),
        ...(vista.crear && compartir ? { compartirPublico: true } : {}),
        // Elección EXPRESA: por defecto cada hotel se cotiza solo con la acomodación del carrito.
        ...(vista.crear && otrasAcom ? { otrasAcomodaciones: true } : {}),
        cliente: c,
        // `facturacion`/`pctComision` YA NO se envían: el servidor los
        // resuelve siempre desde la sesión autenticada (`getContextoB2B()`),
        // nunca desde lo que mande el navegador. `modo` sí viaja — es una
        // elección legítima del B2B ya autenticado, pero solo tiene efecto
        // si el servidor confirma la sesión como B2B.
        ...(esB2B ? { modo } : {}),
        // #102: solo la ELECCIÓN del personal interno (aliado + modalidad). El servidor la autoriza, valida el aliado y recalcula todo.
        ...(asistenciaB2B && aliadoElegido ? { asistencia: { canal: "b2b" as const, aliadoId: aliadoElegido.id, modo: modoAsist } } : {}),
      };
  }

  // #75: presentación editable de cada opción (Incluye / No incluye y descripciones). La propuesta y las líneas las da el servidor con el mismo motor.
  const claveEntrada = (e: ReturnType<typeof armarEntrada>) => JSON.stringify({ ...e, cliente: null });
  const [pres, setPres] = useState<{ clave: string; r: PresentacionPrevia } | null>(null);
  const [edicionPres, setEdicionPres] = useState<EdicionPresentacion>({});
  const [preparandoPres, startPres] = useTransition();
  const opcionesPres: OpcionEditable[] = pres?.r.ok
    ? pres.r.opciones.map((o) => ({
      clave: o.clave, titulo: `Opción ${o.opcionRef} · ${o.hotel ?? "Hotel"}${otrasAcom ? ` · ${ACOM_ROOM_LABEL[o.acomodacionRef as AcomRoom] ?? o.acomodacionRef}` : ""}`,
      lineas: o.lineas, incluyeSugerido: o.incluye, noIncluyeSugerido: o.noIncluye,
    }))
    : [];
  function prepararPresentacion() {
    setErr("");
    const norm = normalizarCarrito();
    if (!norm.ok) { setErr(norm.error); return; }
    const entrada = armarEntrada(norm.itemsNormalizados);
    startPres(async () => {
      const r = await previsualizarPresentacionComparativa(entrada).catch(() => ({ ok: false as const, error: "No se pudo preparar la presentación. Intenta de nuevo." }));
      setPres({ clave: claveEntrada(entrada), r });
      setEdicionPres({});
    });
  }

  function enviarComparativa() {
    setErr("");
    if (!c.nombres.trim() || !c.apellidos.trim()) { setErr("Ingresa nombres y apellidos."); return; }
    if (!c.telefono.trim()) { setErr("El teléfono / WhatsApp es obligatorio."); return; }
    if (asistenciaB2B && !aliadoElegido) { setErr("Elige un aliado de la lista (agencia o freelance) de la venta B2B."); return; }
    // #64: en una comparativa solo hay vuelos manuales COMUNES a todas las opciones, y deben ser compatibles con cada una (el servidor lo vuelve a exigir).
    if (manualItems.length) {
      const v = vuelosComunesCompatibles(manualItems.map(vueloParaEnviar) as ServicioManual[], hotelesViaje);
      if (!v.ok) { setErr(v.error); return; }
      // Multidestino (o varias fechas) con vuelos: una sola acomodación por opción. Se avisa aquí, antes de crear, con un mensaje claro (el servidor lo vuelve a exigir).
      const acom = validarAcomodacionComparativa(hotelItems, true);
      if (acom) { setErr(mensajeAcomodacionComparativa(acom)); return; }
    }
    if (bernaloItems.length) { setErr("Los hoteles por unidad todavía no se pueden comparar. Quítalos del carrito."); return; }
    if (hotelItems.length < 2 || hotelItems.length > MAX_OPCIONES) { setErr(`Una comparativa necesita entre 2 y ${MAX_OPCIONES} hoteles en el carrito.`); return; }
    if (hotelItems.some((h) => h.modulo === "bloqueo")) { setErr("Los paquetes con vuelo negociado todavía no se pueden comparar."); return; }
    if (tourItems.some((t) => !t.hotelItemId)) { setErr("En una comparativa cada servicio debe estar vinculado a un hotel. Quita los servicios sueltos."); return; }
    const itemsNormalizados: { it: HotelCartItemPersona; edadesMenores: number[] }[] = [];
    for (const it of hotelItems) {
      const r = normalizarEdadesMenoresCarrito(it);
      if (!r.ok) { setErr(`${it.hotelNombre}: ${r.error}`); return; }
      itemsNormalizados.push({ it, edadesMenores: r.edadesMenores });
    }
    // #75: si el asesor preparó la presentación, se envía tal cual se ve; si el carrito cambió desde entonces, se pide prepararla de nuevo (nunca se descarta en silencio).
    const entradaCmp = armarEntrada(itemsNormalizados);
    // Intentó Preparar: no se genera con la propuesta automática por detrás de un error ni mientras la vista previa sigue en curso.
    if (preparandoPres) { setErr("La presentación se está preparando. Espera a que termine antes de generar la comparativa."); return; }
    if (pres && !pres.r.ok) { setErr(`No se puede generar la comparativa: la preparación del Incluye / No incluye falló (${pres.r.error}). Corrige el problema y vuelve a preparar.`); return; }
    let presentacion: PresentacionComparativa | undefined;
    if (pres?.r.ok) {
      if (pres.clave !== claveEntrada(entradaCmp)) { setErr("El carrito cambió después de preparar el Incluye / No incluye y las descripciones. Vuelve a prepararlos antes de generar."); return; }
      const errPres = errorEdicion(opcionesPres, edicionPres);
      if (errPres) { setErr(errPres); return; }
      presentacion = presentacionDesdeEdicion(opcionesPres, edicionPres);
    }
    start(async () => {
      const { crearComparativaCarrito } = await import("@/app/tarifario/checkout/actions");
      const r = await crearComparativaCarrito({ ...entradaCmp, ...(presentacion ? { presentacion } : {}) });
      if (r.ok) { setResCmp(r); clear(); } else setErr(r.error);
    });
  }

  // Edades de menores y tours listos para el servidor, o el motivo por el que el carrito aún no puede enviarse.
  function normalizarCarrito(): { ok: true; itemsNormalizados: { it: HotelCartItemPersona; edadesMenores: number[] }[] } | { ok: false; error: string } {
    const itemsNormalizados: { it: HotelCartItemPersona; edadesMenores: number[] }[] = [];
    for (const it of hotelItems) {
      const r = normalizarEdadesMenoresCarrito(it);
      if (!r.ok) return { ok: false, error: `${it.hotelNombre}: ${r.error}` };
      itemsNormalizados.push({ it, edadesMenores: r.edadesMenores });
    }
    for (const it of tourItems) {
      if (it.servicioId == null || !it.fechaIda || !it.fechaRegreso) {
        return { ok: false, error: `${it.nombre}: este servicio se agregó antes de poder re-liquidarlo en el servidor. Quítalo del carrito y agrégalo de nuevo desde Receptivos.` };
      }
    }
    return { ok: true, itemsNormalizados };
  }

  // Vista previa del desglose B2B (lo calcula el servidor con el mismo motor de la cotización; no se estima aquí). Se vuelve a pedir al cambiar aliado,
  // modalidad o carrito; la respuesta de otra combinación nunca se muestra (clave).
  const normPrevia = asistenciaB2B && aliadoElegido ? normalizarCarrito() : null;
  const entradaPrevia = normPrevia?.ok ? armarEntrada(normPrevia.itemsNormalizados) : null;
  const clavePrevia = entradaPrevia ? JSON.stringify({ ...entradaPrevia, cliente: null }) : null;
  const [previa, setPrevia] = useState<{ clave: string; r: PrevisualizacionB2B } | null>(null);
  const [previaCmp, setPreviaCmp] = useState<{ clave: string; r: PrevisualizacionComparativaB2B } | null>(null);
  useEffect(() => {
    if (!entradaPrevia || !clavePrevia) return;
    let vigente = true;
    if (vista.crear) {
      previsualizarComparativaB2B(entradaPrevia)
        .then((r) => { if (vigente) setPreviaCmp({ clave: clavePrevia, r }); })
        .catch(() => { if (vigente) setPreviaCmp({ clave: clavePrevia, r: { ok: false, error: "No se pudo calcular el desglose. Intenta de nuevo en unos minutos." } }); });
      return () => { vigente = false; };
    }
    previsualizarTerminosB2BAsistido(entradaPrevia)
      .then((r) => { if (vigente) setPrevia({ clave: clavePrevia, r }); })
      .catch(() => { if (vigente) setPrevia({ clave: clavePrevia, r: { ok: false, error: "No se pudo calcular el desglose. Intenta de nuevo en unos minutos." } }); });
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavePrevia]);
  const actual = vista.crear ? previaCmp : previa;
  const estadoPrevia: "no_aplica" | "calculando" | "ok" | "error" =
    !asistenciaB2B || !aliadoElegido ? "no_aplica"
      : normPrevia && !normPrevia.ok ? "error"
        : actual?.clave !== clavePrevia ? "calculando" : actual?.r.ok ? "ok" : "error";
  const errorPrevia = normPrevia && !normPrevia.ok ? normPrevia.error : actual?.r.ok === false ? actual.r.error : "";
  // Sin desglose del servidor no se confirma una venta B2B: evita generar con cifras que no se vieron.
  const sinDesglose = estadoPrevia === "calculando" || estadoPrevia === "error";

  function enviar() {
    setErr("");
    setAvisoTerminos("");
    setPrecioCambio(null);
    if (!c.nombres.trim() || !c.apellidos.trim()) { setErr("Ingresa nombres y apellidos."); return; }
    if (!c.numeroDoc.trim()) { setErr("El documento es obligatorio."); return; }
    if (!c.telefono.trim()) { setErr("El teléfono / WhatsApp es obligatorio."); return; }
    if (asistenciaB2B && !aliadoElegido) { setErr("Elige un aliado de la lista (agencia o freelance) de la venta B2B."); return; }

    // Carritos guardados en el navegador ANTES de pedir la edad de cada menor
    // no traen `edadesMenores`: sin menores declarados se normaliza a `[]`
    // (nada que perder); con menores pero sin edad de cada uno se bloquea
    // AQUÍ, con un mensaje que dice qué hotel retirar y volver a agregar —
    // nunca se manda al servidor a que intente adivinar (ese reparto legado
    // ya no existe para este flujo público, ver checkout/actions.ts).
    const norm = normalizarCarrito();
    if (!norm.ok) { setErr(norm.error); return; }
    const itemsNormalizados = norm.itemsNormalizados;

    start(async () => {
      const entrada = armarEntrada(itemsNormalizados);
      if (asistenciaB2B && entrada.asistencia && previa?.clave === clavePrevia && previa.r.ok) {
        const { pvp, impuesto, base, pct, pct_origen, comision, total_exigible, modo_compra, moneda } = previa.r.terminos;
        entrada.asistencia = { ...entrada.asistencia, vistos: { pvp, impuesto, base, pct, pct_origen, comision, total_exigible, modo_compra, moneda } } as typeof entrada.asistencia;
      }
      const r = await crearSolicitudReserva(entrada);
      if (r.ok) { setRes(r); clear(); }
      else if (esTerminosCambiaron(r)) {
        if (clavePrevia) setPrevia({ clave: clavePrevia, r: { ok: true, terminos: r.terminos } });
        setAvisoTerminos(r.error);
      }
      // `"tipo" in r` (en vez de `r.tipo === "precio_actualizado"`) es lo que
      // permite a TypeScript angostar `r` a `ResultadoPrecioActualizadoBernalo`
      // aquí y al resto (`{ok:false, error:string}`) en el `else` final — la
      // única variante con esa clave es "precio_actualizado" (regla B.10).
      else if ("tipo" in r) {
        // Cierre 3F-4A #1: se corrige EXACTAMENTE el ítem que cambió
        // (`r.itemId`, el mismo `id` del carrito) — nunca el primero que
        // coincida por paqueteId+hotelId, que podría ser un ítem distinto
        // (misma habitación de hotel agregada dos veces con ocupaciones
        // diferentes).
        const item = bernaloItems.find((i) => i.id === r.itemId);
        if (item) actualizarPrecioBernalo(item.id, r.pvp, r.moneda);
        setPrecioCambio({ paqueteId: r.paqueteId, hotelId: r.hotelId, mensaje: r.mensaje });
      } else {
        setErr(r.error);
      }
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand-gradient px-6 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <Link href="/tarifario" className="text-sm text-white/80 hover:text-white">← Volver al tarifario</Link>
          <h1 className="mt-1 text-xl font-semibold">{vista.continuar ? "Continuar con tu opción" : vista.crear ? "Crear cotización comparativa" : "Finalizar solicitud"}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {vista.continuar ? (
          <Suspense fallback={null}><ContinuarComparativa token={vista.continuar.token} opcionRef={vista.continuar.op} acomodacionRef={vista.continuar.ac} /></Suspense>
        ) : resCmp ? (
          <ExitoComparativa res={resCmp} />
        ) : res ? (
          <Exito res={res} />
        ) : !items.length ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
            <p>Tu carrito está vacío.</p>
            <Link href="/tarifario" className="mt-2 inline-block text-sm font-medium" style={{ color: "var(--brand-primary)" }}>Ver alojamientos →</Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* #64: solo personal interno autorizado (mismo contexto que la venta asistida); el servidor lo exige de nuevo. */}
            {puedeManual && <ServicioManualPanel comun={!!vista.crear} />}
            {vista.crear && <ResumenOpcionesComparativa items={items} iataDe={iataDe} />}
            {vista.crear && (
              <label className="flex items-start gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                <input type="checkbox" className="mt-0.5" checked={otrasAcom} onChange={(e) => setOtrasAcom(e.target.checked)} data-testid="otras-acomodaciones" />
                <span><b>Ofrecer también otras acomodaciones de cada hotel.</b> Si no lo marcas, cada opción se cotiza solo con la acomodación que elegiste en el carrito (por ejemplo, Marina Suite doble); no se agregan alternativas por tener otra tarifa disponible.</span>
              </label>
            )}
            {puedeManual && vista.crear && (
              <label className="flex items-start gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                <input type="checkbox" className="mt-0.5" checked={compartir} onChange={(e) => setCompartir(e.target.checked)} data-testid="compartir-comparativa" />
                <span><b>Permitir que el cliente elija desde el enlace.</b> Si no lo marcas, solo el equipo puede elegir una opción; el cliente la ve pero no continúa por su cuenta. Los vuelos manuales quedan congelados: el cliente no puede cambiarlos.</span>
              </label>
            )}
            {/* #75: solo personal interno — el servidor rechaza una presentación enviada por otro canal. */}
            {puedeManual && vista.crear && (
              <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-testid="presentacion-comparativa">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-gray-700">Incluye / No incluye y descripciones</h2>
                    <p className="text-xs text-gray-500">Opcional. La propuesta sale solo de lo cotizado en cada opción; edítala antes de generar. Si no la preparas, cada opción lleva la propuesta del sistema y el «No incluye» queda vacío.</p>
                  </div>
                  <button type="button" onClick={prepararPresentacion} disabled={preparandoPres}
                    className="shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ borderColor: "var(--brand-primary)", color: "var(--brand-primary)" }}>
                    {preparandoPres ? "Preparando…" : pres?.r.ok ? "Volver a preparar" : "Preparar"}
                  </button>
                </div>
                {pres && !pres.r.ok && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{pres.r.error}</p>}
                {opcionesPres.length > 0 && <PresentacionComparativaEditor opciones={opcionesPres} edicion={edicionPres} onChange={setEdicionPres} />}
              </section>
            )}

            {/* Resumen del carrito */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Tu selección</h2>
              {vista.crear && (
                <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
                  Modo comparativa: cada hotel del carrito (con sus servicios vinculados) será una opción para que escojas <b>una</b>. Los hoteles no se suman entre sí y no hay un total global.
                </p>
              )}
              <ul className="space-y-3">
                {items.map((it) => (
                  <li key={it.id} className="flex gap-3 border-b border-gray-50 pb-3 last:border-0 last:pb-0">
                    <div className="relative flex h-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-lg text-gray-300" style={{ width: 72 }}>
                      {(it.tipo === "hotel" ? fotoDe(it) : it.fotoUrl)
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={(it.tipo === "hotel" ? fotoDe(it) : it.fotoUrl) as string} alt={it.tipo === "hotel" ? it.hotelNombre : it.nombre} className="absolute inset-0 h-full w-full object-cover" />
                        : <span aria-hidden>{it.tipo === "hotel" ? "🏨" : "🗺️"}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      {it.tipo === "hotel" && it.modeloTarifario !== "unidad" ? (
                        <>
                          <div className="font-medium text-gray-800">{it.hotelNombre}</div>
                          <div className="text-xs text-gray-500">
                            {it.destino ?? ""}{it.fechaIda ? ` · ${it.fechaIda} → ${it.fechaRegreso ?? ""}` : ""}
                          </div>
                          <div className="text-xs text-gray-400">{it.categoria} / {it.regimen} · {resumenHab(it)}</div>
                        </>
                      ) : it.tipo === "hotel" ? (
                        <>
                          <div className="font-medium text-gray-800">{it.hotelNombre}</div>
                          <div className="text-xs text-gray-500">{it.destino ?? ""}</div>
                          <div className="text-xs text-gray-400">{it.categoria} / {it.alimentacion} · {resumenHabBernalo(it)}</div>
                        </>
                      ) : (
                        <>
                          <div className="font-medium text-gray-800">
                            <span className="mr-1 rounded bg-[rgba(38,187,217,0.12)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--brand-accent)" }}>{it.tipo === "manual" ? (it.clase === "vuelo" ? "Vuelo manual" : "Servicio manual") : "Tour"}</span>
                            {it.nombre}
                          </div>
                          <div className="text-xs text-gray-500">
                            {it.destino ?? ""}{it.fechaIda ? ` · ${it.fechaIda} → ${it.fechaRegreso ?? ""}` : ""}
                          </div>
                          <div className="text-xs text-gray-400">
                            {it.pax} pax
                            {/* Vínculo con su hotel (solo presentación): quitar el
                                hotel quita también este servicio — ver `remove`. */}
                            {it.tipo === "tour" && it.hotelItemId && (() => {
                              const h = items.find((x) => x.id === it.hotelItemId);
                              return h && h.tipo === "hotel" ? ` · con ${h.hotelNombre}` : "";
                            })()}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>{formatImporte(it.precio, monedaDeItem(it))}</div>
                      <button type="button" onClick={() => remove(it.id)} className="text-xs text-gray-400 hover:text-red-500">Quitar</button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                {!vista.crear && <TotalesPorMoneda totales={totales} etiqueta={`Total${hayB2B ? " (PVP)" : " estimado"}`} />}
                {!vista.crear && <AvisoMonedas totales={totales} prevision={prevision} />}
                {verComision && !baseComision && (
                  <p className="text-xs text-gray-500">La comisión se calculará sobre la cotización que se genere (una sola moneda).</p>
                )}
                {verComision && baseComision && modoVista === "neta" && (
                  <>
                    <div className="flex items-center justify-between text-sm text-gray-500">
                      <span>Comisión ({Math.round(pct * 100)}%){sobreParte ? ` sobre lo cotizado en ${baseComision.moneda}` : ""}</span>
                      <span>−{formatMoneda(comision, baseComision.moneda)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-100 pt-1">
                      <span className="text-sm font-semibold text-gray-700">Total neto a pagar{sobreParte ? " (estimado)" : ""}</span>
                      <span className="text-lg font-bold" style={{ color: "var(--brand-success)" }}>{formatMoneda(totalNeto, baseComision.moneda)}</span>
                    </div>
                  </>
                )}
                {verComision && baseComision && modoVista === "comisionable" && (
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>Comisión a liquidar ({Math.round(pct * 100)}%){sobreParte ? ` sobre lo cotizado en ${baseComision.moneda}` : ""}</span>
                    <span style={{ color: "var(--brand-success)" }}>{formatMoneda(comision, baseComision.moneda)}</span>
                  </div>
                )}
              </div>
            </section>

            {/* #102 — Venta asistida por personal interno: cliente final (B2C) o aliado identificado (B2B). */}
            {puedeAsistir && (
              <section className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="venta-asistida">
                <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <UserCheck className="h-4 w-4" aria-hidden style={{ color: "var(--brand-primary)" }} />
                  Tipo de venta
                </h2>
                <p className="mb-3 text-xs text-gray-400">Eres personal de D&apos;spacios: elige para quién es esta cotización. El aliado es el beneficiario; tu usuario queda como quien la asistió.</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de venta">
                  {([["b2c", "Cliente final (B2C)"], ["b2b", "Aliado (B2B)"]] as const).map(([v, l]) => (
                    <button key={v} type="button" aria-pressed={canal === v} onClick={() => setCanal(v)}
                      className="rounded-lg border px-4 py-2 text-sm font-medium transition-all"
                      style={canal === v
                        ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" }
                        : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                      {l}
                    </button>
                  ))}
                </div>
                {canal === "b2b" && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className={lbl} htmlFor="asist-aliado">Aliado (agencia o freelance) *</label>
                      <input id="asist-aliado" className={inp} list="asist-aliados-lista" autoComplete="off" placeholder="Escribe para buscar por nombre…"
                        value={aliadoTxt} onChange={(e) => setAliadoTxt(e.target.value)}
                        aria-invalid={aliadoTxt.trim() !== "" && !aliadoElegido} aria-describedby="asist-aliado-ayuda" />
                      <datalist id="asist-aliados-lista">
                        {opcionesAliado.map(({ a, etiqueta }) => <option key={a.id} value={etiqueta} />)}
                      </datalist>
                      <p id="asist-aliado-ayuda" role="status" className={`mt-1 text-xs ${aliadoTxt.trim() !== "" && !aliadoElegido ? "text-amber-700" : "text-gray-400"}`}>
                        {aliadoTxt.trim() !== "" && !aliadoElegido
                          ? "Elige un aliado de la lista: el texto libre que no coincide con un aliado activo no se puede enviar."
                          : "Solo aliados activos del catálogo."}
                      </p>
                      {aliadosAsist.length === 0 && <p role="status" className="mt-1 text-xs text-amber-700">No hay aliados activos en el catálogo.</p>}
                      {aliadoElegido && (
                        <p className="mt-1 text-xs text-gray-500" data-testid="asist-pct">
                          Comisión {Math.round(aliadoElegido.pct * 10000) / 100} % · {aliadoElegido.pctOrigen === "aliado" ? "porcentaje propio del aliado" : aliadoElegido.pctOrigen === "general" ? "porcentaje general del sistema" : "porcentaje por defecto"}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Modalidad B2B">
                      {([["comisionable", "PVP con comisión"], ["neta", "NETO"]] as const).map(([v, l]) => (
                        <button key={v} type="button" aria-pressed={modoAsist === v} onClick={() => setModoAsist(v)}
                          className="rounded-lg border px-4 py-2 text-sm font-medium transition-all"
                          style={modoAsist === v
                            ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" }
                            : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                          {l}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400">
                      {modoAsist === "neta"
                        ? "NETO: el aliado paga el PVP menos su comisión, ya descontada del precio (no se le paga después)."
                        : "PVP con comisión: el comprador paga el PVP completo; la comisión del aliado queda pendiente de liquidar."}
                    </p>
                    {estadoPrevia === "calculando" && <p role="status" className="text-xs text-gray-500" data-testid="previa-calculando">Calculando el desglose con el servidor…</p>}
                    {avisoTerminos && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="terminos-cambiaron">{avisoTerminos} El desglose de abajo ya está actualizado.</p>}
                    {estadoPrevia === "ok" && !vista.crear && previa?.r.ok && <TerminosB2BAsistido plan={previa.r.terminos} previa />}
                    {estadoPrevia === "ok" && vista.crear && previaCmp?.r.ok && (
                      <div className="space-y-3" data-testid="terminos-por-opcion">
                        <p className="text-xs text-gray-500">Cada alternativa liquida sus propios términos: no se suman entre sí ni existe un total o comisión de la comparativa.</p>
                        {previaCmp.r.opciones.map((o) => (
                          <div key={`${o.opcionRef}-${o.acomodacionRef}`} data-testid="terminos-opcion">
                            <p className="mb-1 text-xs font-semibold text-gray-700">Opción {o.opcionRef} · {o.hotel ?? "Hotel"} · {o.acomodacionRef}</p>
                            <TerminosB2BAsistido plan={o.terminos} previa />
                          </div>
                        ))}
                      </div>
                    )}
                    {estadoPrevia === "error" && (
                      <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="previa-error">
                        Todavía no se puede liquidar la venta B2B: {errorPrevia} Mientras tanto no se muestran importes ni se puede generar la cotización: el desglose lo calcula el servidor.
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
            {asist && !asist.puede && "error" in asist && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{asist.error}</p>
            )}

            {/* Modalidad B2B */}
            {esB2B && !vista.crear && (
              <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">Modalidad del contrato</h2>
                <div className="flex flex-wrap gap-2">
                  {([["comisionable", "Contrato comisionable"], ["neta", "Contrato neto"]] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setModo(v)}
                      className="rounded-lg border px-4 py-2 text-sm font-medium transition-all"
                      style={modo === v
                        ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" }
                        : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  {modo === "neta"
                    ? "Pagas el PVP menos tu comisión. La factura va a la agencia."
                    : "Pagas el PVP completo; la comisión se te liquida aparte."}
                </p>
              </section>
            )}

            {/* Facturación (solo contrato neto) — SOLO LECTURA: son los datos
                registrados de tu agencia; el servidor los toma directo de tu
                sesión, así que editarlos acá no cambiaría lo que se cotiza. */}
            {esB2B && !vista.crear && modo === "neta" && (
              <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <h2 className="mb-1 text-sm font-semibold text-gray-700">Facturar a (agencia)</h2>
                <p className="mb-3 text-xs text-gray-400">Datos registrados de tu agencia. No se editan aquí: para corregirlos, pídelo a D&apos;spacios Travel.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><label className={lbl}>Razón social / Nombre</label><input className={inp} value={fact.nombre} placeholder="No registrado" disabled readOnly /></div>
                  <div><label className={lbl}>NIT</label><input className={inp} value={fact.nit} placeholder="No registrado" disabled readOnly /></div>
                  <div><label className={lbl}>Teléfono</label><input className={inp} value={fact.telefono} placeholder="No registrado" disabled readOnly /></div>
                  <div><label className={lbl}>Correo</label><input className={inp} value={fact.email} placeholder="No registrado" disabled readOnly /></div>
                </div>
                {/* Sin dato de origen no se inventa ninguno: se dice qué falta y quién lo completa. */}
                {faltanFacturacion.length > 0 && (
                  <p role="status" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Tu registro no tiene {faltanFacturacion.join(" ni ")}. Puedes enviar la solicitud; D&apos;spacios Travel lo completará antes de facturar.
                  </p>
                )}
              </section>
            )}

            {/* Datos del titular del contrato / cliente */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">{asistenciaB2B && modoAsist === "neta" ? "Titular de la reserva" : esB2B ? "Datos del titular del contrato" : "Tus datos"}</h2>
              {asistenciaB2B && modoAsist === "neta" && (
                <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800" data-testid="neto-cliente-aviso">
                  En NETO el cliente de la cotización y del contrato es {aliadoElegido ? <b>{aliadoElegido.nombre}</b> : "el aliado elegido"} (con la identidad de su ficha en el catálogo). Estos datos son los de la persona que viaja: el titular de la reserva.
                </p>
              )}
              {asist?.puede === true && !esB2B ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="checkout-titular-interno">
                  <div className="sm:col-span-2">
                    <label className={lbl} htmlFor="checkout-numero-doc">Número de documento *</label>
                    <div className="flex gap-1">
                      <input id="checkout-numero-doc" className={inp} value={c.numeroDoc} onChange={(e) => setC({ ...c, numeroDoc: e.target.value })} />
                      <BuscarTitular
                        numero={c.numeroDoc}
                        contexto={`${canal}|${modoAsist}|${aliadoElegido?.id ?? ""}`}
                        actual={c}
                        campos={["nombres", "apellidos", "telefono", "email"]}
                        onAplicar={({ tipoDoc, ...d }) => setC((p) => ({ ...p, tipoDoc, ...d }))}
                      />
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={lbl} htmlFor="checkout-tipo-doc">Tipo de documento</label>
                    <select id="checkout-tipo-doc" className={inp} value={c.tipoDoc} onChange={(e) => setC({ ...c, tipoDoc: e.target.value })}>
                      <option value="">Elige el tipo…</option>
                      {TIPOS_DOC_PERSONA.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div><label className={lbl}>Nombres *</label><input className={inp} value={c.nombres} onChange={(e) => setC({ ...c, nombres: e.target.value })} /></div>
                  <div><label className={lbl}>Apellidos *</label><input className={inp} value={c.apellidos} onChange={(e) => setC({ ...c, apellidos: e.target.value })} /></div>
                  <div><label className={lbl}>Teléfono / WhatsApp *</label><input className={inp} value={c.telefono} onChange={(e) => setC({ ...c, telefono: e.target.value })} /></div>
                  <div><label className={lbl}>Correo</label><input type="email" className={inp} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><label className={lbl}>Nombres *</label><input className={inp} value={c.nombres} onChange={(e) => setC({ ...c, nombres: e.target.value })} /></div>
                  <div><label className={lbl}>Apellidos *</label><input className={inp} value={c.apellidos} onChange={(e) => setC({ ...c, apellidos: e.target.value })} /></div>
                  <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                    <div>
                      <label className={lbl} htmlFor="checkout-tipo-doc">Tipo</label>
                      <select id="checkout-tipo-doc" className={inp} value={c.tipoDoc} onChange={(e) => setC({ ...c, tipoDoc: e.target.value })}>
                        <option value="">—</option>
                        {TIPOS_DOC_PERSONA.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div><label className={lbl}>Documento *</label><input className={inp} value={c.numeroDoc} onChange={(e) => setC({ ...c, numeroDoc: e.target.value })} /></div>
                  </div>
                  <div><label className={lbl}>Teléfono / WhatsApp *</label><input className={inp} value={c.telefono} onChange={(e) => setC({ ...c, telefono: e.target.value })} /></div>
                  <div className="sm:col-span-2"><label className={lbl}>Correo</label><input type="email" className={inp} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
                </div>
              )}
              {precioCambio && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  {precioCambio.mensaje}
                </p>
              )}
              {ctx?.error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{ctx.error}</p>}
              {err && <p role="alert" data-testid="error-checkout" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
              <button type="button" onClick={vista.crear ? enviarComparativa : enviar} disabled={pending || !!ctx?.error || sinDesglose}
                className="mt-4 w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
                {pending ? "Generando…" : vista.crear ? "Generar cotización comparativa" : precioCambio ? "Confirmar con el nuevo precio y enviar" : "Generar cotización y enviar solicitud"}
              </button>
              <p className="mt-2 text-center text-[11px] text-gray-400">Generamos tu cotización y preparamos la solicitud para enviarla por WhatsApp o correo.</p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Exito({ res }: { res: Extract<SolicitudResult, { ok: true }> }) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
        <div className="text-2xl">✓</div>
        <h2 className="mt-1 text-lg font-semibold text-green-800">¡Cotización generada!</h2>
        <p className="mt-1 text-sm text-green-700">Tu cotización: {res.cotizacion.codigo}</p>
      </div>

      {res.b2bAsistido && <TerminosB2BAsistido plan={res.b2bAsistido} />}

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Tu documento</h3>
        <p className="mb-3 text-xs text-gray-500">Guárdalo o imprímelo (PDF) para mostrarlo en la oficina.</p>
        <a
          href={res.cotizacion.url || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm font-medium hover:bg-gray-50"
          style={{ color: "var(--brand-primary)" }}
        >
          <span>Ver / descargar cotización {res.cotizacion.codigo}</span>
          <span aria-hidden>↗</span>
        </a>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Envía tu solicitud</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          {res.waUrl ? (
            <a href={res.waUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 rounded-lg px-4 py-3 text-center text-sm font-semibold text-white" style={{ backgroundColor: "#25D366" }}>
              Enviar por WhatsApp
            </a>
          ) : null}
          {res.mailtoUrl ? (
            <a href={res.mailtoUrl}
              className="flex-1 rounded-lg px-4 py-3 text-center text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
              Enviar por correo
            </a>
          ) : null}
        </div>
        {!res.waUrl && !res.mailtoUrl && (
          <p className="text-xs text-amber-600">No hay destinatarios configurados. Comparte el detalle de abajo con tu asesor.</p>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-500">Ver / copiar el mensaje</summary>
          <textarea readOnly value={res.mensaje} rows={10} className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700" />
        </details>
      </div>

      <Link href="/tarifario" className="block text-center text-sm font-medium" style={{ color: "var(--brand-primary)" }}>
        ← Volver al tarifario
      </Link>
    </div>
  );
}

function ExitoComparativa({ res }: { res: Extract<ResultadoComparativaCreada, { ok: true }> }) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
        <h2 className="mt-1 text-lg font-semibold text-green-800">¡Comparativa generada!</h2>
        <p className="mt-1 text-sm text-green-700">Tu comparativa: {res.codigo}</p>
        <p className="mt-1 text-xs text-green-700">Compara los hoteles y escoge UNO. Elegir no genera ningún cobro ni contrato.</p>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Tu documento</h3>
        <a href={res.url || "#"} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm font-medium hover:bg-gray-50" style={{ color: "var(--brand-primary)" }}>
          <span>Ver la comparativa {res.codigo}</span><span aria-hidden>↗</span>
        </a>
      </div>
      <Link href="/tarifario" className="block text-center text-sm font-medium" style={{ color: "var(--brand-primary)" }}>
        ← Volver al tarifario
      </Link>
    </div>
  );
}
