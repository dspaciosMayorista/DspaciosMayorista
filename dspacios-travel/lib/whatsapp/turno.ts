// Un turno de la conversación por WhatsApp (#56). Sin I/O propio: almacén, consultas, envío y aviso llegan inyectados.
// Reutiliza el flujo determinista (`avanzar`) y le pone los límites del canal público:
//   · solo Bloqueos y Porción terrestre; nunca B2B/agencias;
//   · «asesor» = traspaso REAL: se guarda, se avisa al equipo y SOLO entonces se le confirma al cliente.
//
// FIABILIDAD (Meta reintenta un POST no-200 hasta 7 días y puede repetir entregas):
//   1. Se «alquila» el mensaje en la bandeja (lease), pero el id NO se da por atendido hasta el final.
//   2. La respuesta se calcula UNA vez y se guarda (`resultado`); un reintento la reaplica, no la recalcula.
//   3. Cada efecto es idempotente o lleva su marca: traspaso (UNIQUE mensaje_id), aviso (`avisado_en` + Idempotency-Key),
//      envío (contador `enviados`: se reanuda desde el primer cuerpo que Meta no aceptó), sesión (avance atómico que solo avanza).
//   4. Cualquier fallo transitorio devuelve «reintentar» (la ruta responde 503 y Meta vuelve a llamar). Tras MAX_INTENTOS o
//      MAX_EDAD_H se abandona con registro: más allá de ~24 h Meta ya no admite respuestas libres.
// CONCURRENCIA (dos mensajes del MISMO cliente en vuelo a la vez): el turno es exclusivo por wa_id.
//   · `tomarTurno` es un compare-and-set atómico (lock con lease): quien llega con el turno ocupado cede y Meta reintenta; así cada turno
//     lee la sesión YA confirmada del anterior (no hay lectura vieja ni actualización perdida).
//   · Orden: un mensaje con `ts` menor que sigue en curso (recién reclamado) pasa primero; el posterior cede (compuerta GATE_MS). Si el anterior
//     llega al servidor después de que el posterior ya terminó, no hay forma de saberlo: se procesa sobre el estado vigente (sin perder nada).
//   · `avanzarSesion` es UNA sentencia condicional (sigo siendo el dueño del turno Y el mensaje no es más viejo que el último aplicado): si el
//     lease se perdió o el mensaje quedó obsoleto, no escribe y el turno no responde. Nunca lectura seguida de upsert.
// Orden con traspaso: guardar solicitud → avisar al equipo → avanzar sesión → confirmar al cliente. La sesión (con el silencio del bot) ya
// avanzó cuando se envía la respuesta; si el envío falla, el equipo YA fue avisado y quien escriba será el asesor.
import { avanzar, type ServiciosConversacion } from "@/lib/salesbot/conversacion/flujo";
import { estadoInicial, type EntradaConversacion, type EstadoConversacion, type MensajeBot, type Opcion } from "@/lib/salesbot/conversacion/contrato";
import { interpretarComando, interpretarProducto } from "@/lib/salesbot/conversacion/interpretar";
import type { MensajeEntrante } from "@/lib/whatsapp/entrante";
import { aMensajesWhatsApp, type CuerpoWA } from "@/lib/whatsapp/saliente";

export const VIGENCIA_SESION_H = 6;
export const SILENCIO_TRASPASO_H = 2;
export const LEASE_MS = 60_000;
/** Lease del turno por cliente: más largo que un turno normal; si el proceso muere, el siguiente lo retoma al vencer. */
export const TURNO_LEASE_MS = 90_000;
/** Cuánto tiempo un mensaje anterior en curso hace ceder al posterior (después se sigue: no se bloquea al cliente por un fallo persistente). */
export const GATE_MS = 120_000;
export const MAX_INTENTOS = 6;
export const MAX_EDAD_H = 20;
/** Por debajo de esto aún cabe una respuesta libre (ventana de servicio de 24 h). */
const VENTANA_LIBRE_H = 23;

export type SesionWA = { estado: EstadoConversacion; traspasoHasta: string | null; actualizada: string };
export type Traspaso = { waId: string; nombrePerfil: string | null; resumen: Record<string, unknown> };
export type Resultado = { sesion: SesionWA | null; mensajes: MensajeBot[]; traspaso: Traspaso | null };
export type EstadoSesionAvance = "ok" | "obsoleta" | "perdido";
export type EstadoTurnoLock = "ok" | "ocupado" | "turno_previo";

/** ¿Un mensaje anterior todavía en curso hace ceder a este? Pura: la usa el almacén real y el de prueba. */
export function cedeAlPrevio(
  previo: { id: string; ts: number; primerRecibo: string },
  yo: { id: string; ts: number; primerRecibo: string },
  ahora: Date,
  ventanaMs: number,
): boolean {
  if (ahora.getTime() - new Date(previo.primerRecibo).getTime() > ventanaMs) return false;
  if (previo.ts !== yo.ts) return previo.ts < yo.ts;
  if (previo.primerRecibo !== yo.primerRecibo) return previo.primerRecibo < yo.primerRecibo;
  return previo.id < yo.id;
}

export type AvisoPendiente = Traspaso & { id: number; intentos: number };

export type Registro = { id: string; waId: string; intentos: number; primerRecibo: string; resultado: Resultado | null; enviados: number };
export type Reclamo = { tipo: "listo"; registro: Registro } | { tipo: "hecho" } | { tipo: "ocupado" };

/** Decisión sobre una fila ya existente de la bandeja (pura: la usa el almacén real y se prueba aparte). */
export function decidirReclamo(fila: { estado: string; leaseHasta: string }, ahora: Date): "hecho" | "ocupado" | "retomar" {
  if (fila.estado !== "procesando") return "hecho";
  return new Date(fila.leaseHasta).getTime() > ahora.getTime() ? "ocupado" : "retomar";
}

export type Almacen = {
  /** Alquila el mensaje: lo crea, o lo retoma si su lease venció. NUNCA lo da por atendido. */
  reclamar(id: string, waId: string, ts: number, ahora: Date, leaseMs: number): Promise<Reclamo>;
  /** El turno cedió (otro mensaje del cliente va primero): suelta el lease y NO cuenta como intento. */
  devolver(id: string, intentos: number): Promise<void>;
  /** Compare-and-set atómico del turno exclusivo del cliente. */
  tomarTurno(waId: string, id: string, ts: number, ahora: Date, leaseMs: number, ventanaMs: number): Promise<EstadoTurnoLock>;
  soltarTurno(waId: string, id: string): Promise<void>;
  /** UNA sentencia condicional: solo escribe si sigo siendo el dueño del turno y el mensaje no es más viejo que el último aplicado. */
  avanzarSesion(waId: string, id: string, ts: number, s: SesionWA): Promise<EstadoSesionAvance>;
  guardarResultado(id: string, r: Resultado): Promise<void>;
  registrarEnvio(id: string, enviados: number): Promise<void>;
  cerrar(id: string, estado: "completado" | "abandonado"): Promise<void>;
  leerSesion(waId: string): Promise<SesionWA | null>;
  /** Idempotente por mensaje: un reintento devuelve la misma fila. */
  guardarTraspaso(t: Traspaso, mensajeId: string): Promise<{ id: number; avisado: boolean }>;
  marcarAvisado(id: number, ahora: Date): Promise<void>;
  /** Avisos de traspasos sin avisar cuya hora ya llegó; los reclama con un compare-and-set por fila (dos cron simultáneos no se pisan). */
  reclamarAvisosPendientes(ahora: Date, limite: number, leaseMs: number, gracias: Date): Promise<AvisoPendiente[]>;
  registrarFalloAviso(id: number, proximo: Date): Promise<void>;
  /** Suelta el lease tras un fallo para que el reintento de Meta no espere a que venza. Mejor esfuerzo. */
  liberar(id: string): Promise<void>;
};

export type DepsTurno = {
  almacen: Almacen;
  servicios: ServiciosConversacion;
  ahora: Date;
  hoy: string;
  urlBase?: string | null;
  /** Un cuerpo por llamada. «permanente» = Meta lo rechazó y no mejora reintentando. */
  enviar: (waId: string, cuerpo: CuerpoWA) => Promise<"ok" | "permanente" | "transitorio">;
  /** Sin esta función NO hay canal de aviso: el bot no promete traspasos. Debe LANZAR si el aviso no salió. */
  avisarAsesor?: (t: Traspaso & { id: number }) => Promise<void>;
  /** Para el log técnico (sin contenido del cliente). */
  registrar?: (etapa: string, error: unknown) => void;
};

export type EstadoTurno = "completado" | "duplicado" | "reintentar" | "abandonado";

const MENU: Opcion[] = [
  { etiqueta: "Bloqueos (vuelo + hotel)", valor: "producto:bloqueo" },
  { etiqueta: "Porción terrestre", valor: "producto:porcion" },
  { etiqueta: "Hablar con un asesor", valor: "asesor" },
];

export const menuInicial = (intro = "Hola, soy el asistente de D'spacios Travel. Puedo consultarte opciones de Bloqueos (vuelo + hotel) y Porción terrestre (solo hotel) con precios y disponibilidad vigentes. ¿Qué te interesa?"): MensajeBot => ({ texto: intro, opciones: MENU });

const AYUDA: MensajeBot = {
  texto: "Dime si buscas un Bloqueo o una Porción terrestre y te pido lo que falte. Puedes escribir «cambiar fechas», «otra opción» o «empezar de nuevo» en cualquier momento. Los precios son orientativos; un asesor confirma la disponibilidad y cierra la venta.",
  opciones: MENU,
};
const SIN_ASESOR: MensajeBot = {
  texto: "En este momento no puedo pasarte con un asesor por este chat. Intenta de nuevo en unos minutos.",
  opciones: MENU.filter((o) => o.valor !== "asesor"),
};
const CONFIRMA_ASESOR: MensajeBot = { texto: "Listo. Un asesor de D'spacios revisará tu consulta y te escribirá por este mismo chat. Si quieres volver al asistente, escribe «empezar de nuevo»." };
const FALLBACK: MensajeBot = { texto: "No pude completar tu solicitud en este momento. Escríbenos de nuevo en unos minutos, por favor." };

/** Opciones del flujo que este canal no ofrece. */
const PROHIBIDAS = (v: string) => v === "producto:programa" || v === "agencia" || v.startsWith("ag:");

const texto = (e: EntradaConversacion) => (e.tipo === "texto" ? e.texto : "");

function resumenDe(e: EstadoConversacion): Record<string, unknown> {
  return {
    producto: e.producto,
    destino: e.destino,
    fechaIda: e.fechaIda,
    fechaRegreso: e.fechaRegreso,
    adultos: e.adultos,
    habitaciones: e.habitaciones,
    menores: e.edadesMenores?.length ?? null,
    seleccion: e.seleccion,
    combo: e.combo,
  };
}

/** Quita lo que el canal público no ofrece; un mensaje que ofrece Programas se reemplaza por el menú propio. */
function filtrar(mensajes: MensajeBot[]): MensajeBot[] {
  return mensajes.map((m) => {
    if (m.opciones?.some((o) => o.valor === "producto:programa")) return menuInicial("¿Qué te interesa consultar?");
    if (!m.opciones) return m;
    const opciones = m.opciones.filter((o) => !PROHIBIDAS(o.valor));
    return { ...m, opciones: opciones.length ? opciones : undefined };
  });
}

/** Decide la respuesta. Lee la sesión y consulta los motores, pero NO escribe nada: es seguro recalcularla. */
async function calcular(d: DepsTurno, m: MensajeEntrante): Promise<Resultado> {
  const previa = await d.almacen.leerSesion(m.waId);
  const vigente = !!previa && d.ahora.getTime() - new Date(previa.actualizada).getTime() < VIGENCIA_SESION_H * 3_600_000;
  const sesion = (estado: EstadoConversacion, traspasoHasta: string | null = null): SesionWA => ({ estado, traspasoHasta, actualizada: d.ahora.toISOString() });
  const r = (mensajes: MensajeBot[], s: SesionWA | null, traspaso: Traspaso | null = null): Resultado => ({ sesion: s, mensajes, traspaso });

  if (m.entrada === "invalido") {
    return r([{ texto: "Por ahora solo entiendo mensajes de texto (hasta 300 caracteres) y las opciones del menú.", opciones: MENU }], vigente ? null : sesion(estadoInicial()));
  }
  const entrada = m.entrada;
  const cmd = entrada.tipo === "opcion" ? entrada.valor : interpretarComando(texto(entrada))?.tipo;

  // Primer contacto (o sesión vencida, o «empezar de nuevo»): bienvenida con menú; el flujo arranca con la siguiente respuesta.
  if (!vigente || cmd === "reiniciar" || !previa) return r([menuInicial()], sesion(estadoInicial()));
  // Durante un traspaso el bot calla para no pisar al asesor.
  if (previa.traspasoHasta && new Date(previa.traspasoHasta) > d.ahora) return r([], null);

  if (cmd === "asesor") {
    if (!d.avisarAsesor) return r([SIN_ASESOR], sesion(previa.estado)); // nadie sería avisado: no se promete nada
    const hasta = new Date(d.ahora.getTime() + SILENCIO_TRASPASO_H * 3_600_000).toISOString();
    return r([CONFIRMA_ASESOR], sesion(previa.estado, hasta), { waId: m.waId, nombrePerfil: m.nombrePerfil, resumen: resumenDe(previa.estado) });
  }
  if (cmd === "ayuda") return r([AYUDA], null);
  const pideAgencia = cmd === "agencia" || (entrada.tipo === "opcion" && PROHIBIDAS(entrada.valor) && entrada.valor !== "producto:programa");
  const prod = entrada.tipo === "texto" ? interpretarProducto(entrada.texto) : null;
  const pidePrograma = entrada.tipo === "opcion" ? entrada.valor === "producto:programa" : prod?.tipo === "ok" && prod.producto === "programa";
  if (pideAgencia || pidePrograma) {
    return r(
      [
        {
          texto: pideAgencia
            ? "Las tarifas y condiciones para agencias las gestiona directamente un asesor."
            : "Los programas (circuitos) aún no están disponibles por este chat; un asesor puede ayudarte con ellos.",
          opciones: MENU,
        },
      ],
      sesion(previa.estado),
    );
  }

  const res = await avanzar(previa.estado, entrada, d.servicios, d.hoy);
  if (res.estado.producto === "programa" || res.estado.agenciaId != null || res.estado.pendiente === "agencia") {
    return r([menuInicial("¿Qué te interesa consultar?")], sesion(estadoInicial()));
  }
  return r(filtrar(res.mensajes), sesion(res.estado));
}

const horas = (desde: string, hasta: Date) => (hasta.getTime() - new Date(desde).getTime()) / 3_600_000;

/** Procesa UN mensaje de Meta hasta dejarlo completado, o informa que hay que reintentar. */
export async function procesarMensaje(d: DepsTurno, m: MensajeEntrante): Promise<EstadoTurno> {
  let reg: Registro;
  let liberable: string | null = null;
  const falla = (etapa: string, error: unknown): EstadoTurno => {
    d.registrar?.(etapa, error);
    if (liberable) void d.almacen.liberar(liberable).catch(() => undefined);
    return "reintentar";
  };
  try {
    const rec = await d.almacen.reclamar(m.id, m.waId, m.ts, d.ahora, LEASE_MS);
    if (rec.tipo === "hecho") return "duplicado";
    if (rec.tipo === "ocupado") return "reintentar";
    reg = rec.registro;
    liberable = reg.id;
  } catch (e) {
    return falla("reclamar", e);
  }

  // Tope de reintentos: se abandona CON registro y, si el cliente aún no recibió nada y sigue la ventana, con un aviso honesto.
  if (reg.intentos > MAX_INTENTOS || horas(reg.primerRecibo, d.ahora) > MAX_EDAD_H) {
    d.registrar?.("abandonado", new Error(`intentos=${reg.intentos}`));
    try {
      await d.almacen.cerrar(reg.id, "abandonado");
    } catch (e) {
      return falla("cerrar_abandonado", e);
    }
    if (reg.enviados === 0 && horas(reg.primerRecibo, d.ahora) < VENTANA_LIBRE_H) {
      try {
        for (const c of aMensajesWhatsApp([FALLBACK])) await d.enviar(reg.waId, c);
      } catch {
        // Mejor esfuerzo: ya quedó registrado el abandono.
      }
    }
    return "abandonado";
  }

  // Turno exclusivo por cliente: dos mensajes suyos en vuelo no se mezclan ni se pisan.
  let turno: EstadoTurnoLock;
  try {
    turno = await d.almacen.tomarTurno(m.waId, reg.id, m.ts, d.ahora, TURNO_LEASE_MS, GATE_MS);
  } catch (e) {
    return falla("turno", e);
  }
  if (turno !== "ok") {
    // Ceder no es un fallo ni gasta intentos: el mensaje espera su turno y Meta vuelve a llamar.
    void d.almacen.devolver(reg.id, Math.max(reg.intentos - 1, 1)).catch(() => undefined);
    return "reintentar";
  }
  try {
    return await ejecutar(d, m, reg, falla);
  } finally {
    await d.almacen.soltarTurno(m.waId, reg.id).catch(() => undefined);
  }
}

async function ejecutar(d: DepsTurno, m: MensajeEntrante, reg: Registro, falla: (etapa: string, error: unknown) => EstadoTurno): Promise<EstadoTurno> {
  let resultado = reg.resultado;
  if (!resultado) {
    try {
      resultado = await calcular(d, m); // con el turno tomado: la sesión leída es la ya confirmada por el mensaje anterior
      await d.almacen.guardarResultado(reg.id, resultado);
    } catch (e) {
      return falla("calcular", e);
    }
  }

  // 1) Solicitud de asesor: guardada y AVISADA antes de confirmarle nada al cliente.
  if (resultado.traspaso) {
    try {
      const t = await d.almacen.guardarTraspaso(resultado.traspaso, reg.id);
      if (!t.avisado) {
        if (!d.avisarAsesor) throw new Error("sin_canal_de_aviso");
        await d.avisarAsesor({ ...resultado.traspaso, id: t.id });
        await d.almacen.marcarAvisado(t.id, d.ahora);
      }
    } catch (e) {
      return falla("traspaso", e);
    }
  }

  // 2) Sesión: avance atómico y fenceado. Obsoleto = un mensaje posterior ya la dejó más adelante: no se responde con algo viejo.
  if (resultado.sesion) {
    try {
      const av = await d.almacen.avanzarSesion(m.waId, reg.id, m.ts, resultado.sesion);
      if (av === "perdido") return falla("sesion_perdida", new Error("turno_perdido"));
      if (av === "obsoleta") {
        d.registrar?.("mensaje_obsoleto", new Error("ts_menor_al_aplicado"));
        await d.almacen.cerrar(reg.id, "completado");
        return "completado";
      }
    } catch (e) {
      return falla("sesion", e);
    }
  }

  // 3) Envío: se reanuda desde el primer cuerpo que Meta no aceptó.
  const cuerpos = aMensajesWhatsApp(resultado.mensajes, d.urlBase ?? null);
  for (let i = reg.enviados; i < cuerpos.length; i++) {
    let r: Awaited<ReturnType<DepsTurno["enviar"]>>;
    try {
      r = await d.enviar(m.waId, cuerpos[i]);
    } catch (e) {
      return falla("envio", e);
    }
    if (r === "transitorio") return falla("envio", new Error("transitorio"));
    if (r === "permanente") d.registrar?.("envio_descartado", new Error(`cuerpo=${i}`));
    // Si el registro falla justo después de que Meta aceptó, el reintento repetiría ESTE cuerpo: se insiste una vez antes de rendirse.
    try {
      await d.almacen.registrarEnvio(reg.id, i + 1);
    } catch {
      try {
        await d.almacen.registrarEnvio(reg.id, i + 1);
      } catch (e) {
        return falla("registrar_envio", e);
      }
    }
  }

  // 4) Recién ahora el mensaje queda atendido.
  try {
    await d.almacen.cerrar(reg.id, "completado");
  } catch (e) {
    return falla("cerrar", e);
  }
  return "completado";
}
