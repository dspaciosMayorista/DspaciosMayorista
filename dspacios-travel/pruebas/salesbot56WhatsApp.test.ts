import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { leerConfigWhatsApp, VERSION_API_POR_DEFECTO } from "../lib/whatsapp/config.ts";
import { firmaValida, respuestaHandshake } from "../lib/whatsapp/firma.ts";
import { extraerMensajes } from "../lib/whatsapp/entrante.ts";
import { aMensajesWhatsApp, clasificarHttp, type CuerpoWA } from "../lib/whatsapp/saliente.ts";
import { procesarMensaje, decidirReclamo, cedeAlPrevio, GATE_MS, MAX_INTENTOS, type Almacen, type AvisoPendiente, type DepsTurno, type Reclamo, type Registro, type SesionWA, type Traspaso } from "../lib/whatsapp/turno.ts";
import { recuperarAvisos, proximoAviso, GRACIA_MIN, LEASE_AVISO_MS } from "../lib/whatsapp/recuperacion.ts";
import { estadoInicial } from "../lib/salesbot/conversacion/contrato.ts";
import { crearAvisador } from "../lib/whatsapp/aviso.ts";
import type { ServiciosConversacion } from "../lib/salesbot/conversacion/flujo.ts";
import { crearSello } from "../lib/salesbot/contrato.ts";

// #56 canal WhatsApp: firma, parseo, límites de Meta, configuración apagada por
// defecto y el turno (deduplicación, traspaso, producto/B2B fuera de alcance).

describe("config", () => {
  test("apagado por defecto; simulado sin envío; real exige token y número", () => {
    assert.equal(leerConfigWhatsApp({}).estado, "apagado");
    const base = { WHATSAPP_BOT_ACTIVO: "1", WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s" };
    assert.equal(leerConfigWhatsApp(base).estado, "simulado");
    assert.deepEqual((leerConfigWhatsApp({ ...base, WHATSAPP_ENVIO_REAL: "1" }) as { falta: string[] }).falta, ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "SALESBOT_WA_AVISO_EMAIL", "RESEND_API_KEY"]);
    assert.equal(leerConfigWhatsApp({ ...base, WHATSAPP_ENVIO_REAL: "1", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1", SALESBOT_WA_AVISO_EMAIL: "e@x.test", RESEND_API_KEY: "k" }).estado, "real");
    assert.equal(leerConfigWhatsApp({ WHATSAPP_BOT_ACTIVO: "1" }).estado, "mal_configurado");
  });
  test("números de prueba se normalizan a dígitos", () => {
    const c = leerConfigWhatsApp({ WHATSAPP_BOT_ACTIVO: "1", WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s", WHATSAPP_NUMEROS_PRUEBA: "+57 300 111 2222, 573001113333" });
    assert.deepEqual((c as { numerosPrueba: string[] }).numerosPrueba, ["573001112222", "573001113333"]);
  });
});

describe("firma y handshake", () => {
  const firmar = (cuerpo: string, s: string) => `sha256=${createHmac("sha256", s).update(cuerpo).digest("hex")}`;
  test("acepta la firma correcta y rechaza cuerpo alterado, secreto errado y formato", () => {
    const c = '{"a":1}';
    assert.equal(firmaValida(c, firmar(c, "sec"), "sec"), true);
    assert.equal(firmaValida(c + " ", firmar(c, "sec"), "sec"), false);
    assert.equal(firmaValida(c, firmar(c, "otro"), "sec"), false);
    assert.equal(firmaValida(c, null, "sec"), false);
    assert.equal(firmaValida(c, "sha256=zz", "sec"), false);
    assert.equal(firmaValida(c, firmar(c, ""), ""), false);
  });
  test("handshake devuelve el challenge solo con modo y token correctos", () => {
    const q = (o: Record<string, string>) => new URLSearchParams(o);
    assert.equal(respuestaHandshake(q({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "123" }), "tok"), "123");
    assert.equal(respuestaHandshake(q({ "hub.mode": "subscribe", "hub.verify_token": "mal", "hub.challenge": "123" }), "tok"), null);
    assert.equal(respuestaHandshake(q({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "123" }), "tok"), null);
    assert.equal(respuestaHandshake(q({ "hub.mode": "subscribe", "hub.verify_token": "tok" }), "tok"), null);
  });
});

const payload = (messages: unknown[], phone = "PN1") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "x", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phone }, contacts: [{ wa_id: "573001112222", profile: { name: "Ana" } }], messages } }] }],
});

describe("entrante", () => {
  test("texto, botón y lista; el resto es inválido; ignora statuses y otro número", () => {
    const r = extraerMensajes(
      payload([
        { from: "573001112222", id: "w1", type: "text", text: { body: "hola" } },
        { from: "573001112222", id: "w2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "producto:bloqueo", title: "x" } } },
        { from: "573001112222", id: "w3", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "sel:5-b10-7", title: "x" } } },
        { from: "573001112222", id: "w4", type: "audio" },
        { from: "573001112222", id: "w5", type: "text", text: { body: "x".repeat(301) } },
        { from: "573001112222", type: "text", text: { body: "sin id" } },
      ]),
      "PN1",
    );
    assert.deepEqual(r.map((m) => m.entrada), [{ tipo: "texto", texto: "hola" }, { tipo: "opcion", valor: "producto:bloqueo" }, { tipo: "opcion", valor: "sel:5-b10-7" }, "invalido", "invalido"]);
    assert.equal(r[0].nombrePerfil, "Ana");
    assert.deepEqual(extraerMensajes(payload([{ from: "1", id: "w", type: "text", text: { body: "a" } }], "OTRO"), "PN1"), []);
    assert.deepEqual(extraerMensajes({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "s" }] } }] }] }), []);
    assert.deepEqual(extraerMensajes(null), []);
    assert.deepEqual(extraerMensajes("x"), []);
  });
});

// Formas estructurales de lo que arma aMensajesWhatsApp (Cloud API de Meta), solo para leer los cuerpos en las aserciones.
type CuerpoTexto = { type: "text"; text: { body: string } };
type FilaLista = { id: string; title: string; description?: string };
type CuerpoBotones = { type: "interactive"; interactive: { type: "button"; body: { text: string }; action: { buttons: { type: "reply"; reply: { id: string; title: string } }[] } } };
type CuerpoLista = { type: "interactive"; interactive: { type: "list"; body: { text: string }; action: { button: string; sections: { rows: FilaLista[] }[] } } };
type CuerpoInteractivo = CuerpoBotones | CuerpoLista;
const comoTexto = (c: CuerpoWA) => c as unknown as CuerpoTexto;
const comoBotones = (c: CuerpoWA) => c as unknown as CuerpoBotones;
const comoLista = (c: CuerpoWA) => c as unknown as CuerpoLista;
const comoInteractivo = (c: CuerpoWA) => c as unknown as CuerpoInteractivo;

describe("saliente (límites de Meta)", () => {
  const ops = (n: number, largo = 10) => Array.from({ length: n }, (_, i) => ({ etiqueta: `Op${i}`.padEnd(largo, "x"), valor: `v:${i}` }));
  test("sin opciones → texto; ≤3 cortas → botones; más → lista de ≤10 filas", () => {
    assert.equal(aMensajesWhatsApp([{ texto: "hola" }])[0].type, "text");
    const b = comoBotones(aMensajesWhatsApp([{ texto: "elige", opciones: ops(3) }])[0]);
    assert.equal(b.interactive.type, "button");
    assert.deepEqual(b.interactive.action.buttons.map((x) => x.reply.id), ["v:0", "v:1", "v:2"]);
    const l = comoLista(aMensajesWhatsApp([{ texto: "elige", opciones: ops(14) }])[0]);
    assert.equal(l.interactive.type, "list");
    assert.equal(l.interactive.action.sections[0].rows.length, 10);
  });
  test("título largo: botón pasa a lista; fila se recorta a 24 y el texto completo va en la descripción", () => {
    const largo = "Hotel Caribe Plaza Gran Vista Mar Todo Incluido";
    const m = comoLista(aMensajesWhatsApp([{ texto: "elige", opciones: [{ etiqueta: largo, valor: "sel:1" }] }])[0]);
    assert.equal(m.interactive.type, "list");
    const fila = m.interactive.action.sections[0].rows[0];
    assert.ok(fila.title.length <= 24 && fila.title.endsWith("…"));
    assert.equal(fila.description, largo);
    assert.ok(fila.description.length <= 72);
  });
  test("títulos de botón repetidos no se envían como botones", () => {
    const m = comoInteractivo(aMensajesWhatsApp([{ texto: "x", opciones: [{ etiqueta: "Igual", valor: "a" }, { etiqueta: "Igual", valor: "b" }] }])[0]);
    assert.equal(m.interactive.type, "list");
  });
  test("cuerpo largo con botones: texto completo aparte y botones con cuerpo corto (≤1024)", () => {
    const out = aMensajesWhatsApp([{ texto: "a".repeat(1500), opciones: ops(2) }]);
    assert.equal(out.length, 2);
    assert.equal(out[0].type, "text");
    assert.ok(comoInteractivo(out[1]).interactive.body.text.length <= 1024);
  });
  test("el enlace solo sale con dominio configurado y ruta relativa interna", () => {
    const m = { texto: "t", enlace: { etiqueta: "Ver", href: "/tarifario/x" } };
    assert.equal(comoTexto(aMensajesWhatsApp([m])[0]).text.body, "t");
    assert.equal(comoTexto(aMensajesWhatsApp([m], "https://d.test")[0]).text.body, "t\nVer: https://d.test/tarifario/x");
    assert.equal(comoTexto(aMensajesWhatsApp([{ ...m, enlace: { etiqueta: "Ver", href: "//evil.test" } }], "https://d.test")[0]).text.body, "t");
  });
  test("todo mensaje de texto ≤ 4096", () => {
    assert.ok(comoTexto(aMensajesWhatsApp([{ texto: "z".repeat(9000) }])[0]).text.body.length <= 4096);
  });
});

// ── Turno ────────────────────────────────────────────────────────────────

type Fallos = Partial<Record<"reclamar" | "guardarResultado" | "registrarEnvio" | "cerrar" | "leerSesion" | "avanzarSesion" | "guardarTraspaso" | "marcarAvisado" | "tomarTurno", number>>;
const EPOCA = new Date(0).toISOString();

/** Pausa de n vueltas del event loop: entre una operación y la siguiente otro turno puede colarse (concurrencia real, no secuencial). */
const tick = (n: number) =>
  new Promise<void>((r) => {
    let i = 0;
    const paso = () => (i++ < n ? setImmediate(paso) : r());
    paso();
  });
/** PRNG determinista (mulberry32): mismo "ruido" en cada corrida, distinto entre semillas. */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type FilaBandeja = Registro & { estado: string; lease: string; ts: number };
type FilaSesion = SesionWA & { lockPor: string | null; lockHasta: string | null; ultimoTs: number };
type FilaTraspaso = { id: number; mensajeId: string; t: Traspaso; avisado: boolean; creado: Date; intentos: number; proximo: Date | null };

/**
 * Almacén en memoria con la MISMA semántica atómica que el real: cada operación (turno, avance de sesión, reclamo de avisos) decide
 * en un solo bloque síncrono; entre operaciones hay pausas con ruido para que dos turnos se intercalen de verdad.
 */
function almacenMemoria(fallos: Fallos = {}, o: { ruido?: () => number } = {}) {
  const sesiones = new Map<string, FilaSesion>();
  const bandeja = new Map<string, FilaBandeja>();
  const traspasos = new Map<string, FilaTraspaso>();
  const traza: string[] = [];
  let seq = 0;
  // Barrera de llegada: se ARMA justo antes del tramo concurrente (el montaje previo no debe esperarla).
  let barrera = 0;
  let llegadas = 0;
  let abrir: () => void = () => undefined;
  let puerta: Promise<void> = Promise.resolve();
  const armar = (n: number) => {
    barrera = n;
    llegadas = 0;
    puerta = new Promise<void>((r) => (abrir = r));
  };
  const pausa = () => tick(o.ruido ? Math.floor(o.ruido() * 4) : 0);
  const falla = (n: keyof Fallos) => {
    if ((fallos[n] ?? 0) > 0) {
      fallos[n]!--;
      throw new Error(`${n}:XX`);
    }
  };
  const almacen: Almacen = {
    async reclamar(id, waId, ts, ahora, leaseMs) {
      await pausa();
      falla("reclamar");
      const f = bandeja.get(id);
      const lease = new Date(ahora.getTime() + leaseMs).toISOString();
      let res: Reclamo;
      if (!f) {
        const r: FilaBandeja = { id, waId, intentos: 1, primerRecibo: ahora.toISOString(), resultado: null, enviados: 0, estado: "procesando", lease, ts };
        bandeja.set(id, r);
        res = { tipo: "listo", registro: { ...r } };
      } else {
        const d = decidirReclamo({ estado: f.estado, leaseHasta: f.lease }, ahora);
        if (d !== "retomar") res = { tipo: d };
        else {
          f.intentos++;
          f.lease = lease;
          res = { tipo: "listo", registro: { ...f } };
        }
      }
      if (barrera && llegadas < barrera) {
        llegadas++;
        if (llegadas === barrera) abrir();
        await puerta; // todos los turnos simultáneos ya están reclamados antes de que ninguno tome el turno
      }
      return res;
    },
    async devolver(id, intentos) {
      const f = bandeja.get(id);
      if (f && f.estado === "procesando") {
        f.lease = EPOCA;
        f.intentos = intentos;
      }
    },
    async tomarTurno(waId, id, ts, ahora, leaseMs, ventanaMs) {
      await pausa();
      falla("tomarTurno");
      const yo = bandeja.get(id)!;
      const previos = [...bandeja.values()].filter((p) => p.waId === waId && p.estado === "procesando" && p.id !== id);
      if (previos.some((p) => cedeAlPrevio({ id: p.id, ts: p.ts, primerRecibo: p.primerRecibo }, { id, ts, primerRecibo: yo.primerRecibo }, ahora, ventanaMs))) return "turno_previo";
      const lease = new Date(ahora.getTime() + leaseMs).toISOString();
      const s = sesiones.get(waId);
      if (!s) {
        sesiones.set(waId, { estado: estadoInicial(), traspasoHasta: null, actualizada: EPOCA, lockPor: id, lockHasta: lease, ultimoTs: 0 });
        traza.push(`turno:${id}`);
        return "ok";
      }
      if (!s.lockHasta || s.lockHasta <= ahora.toISOString() || s.lockPor === id) {
        s.lockPor = id;
        s.lockHasta = lease;
        traza.push(`turno:${id}`);
        return "ok";
      }
      return "ocupado";
    },
    async soltarTurno(waId, id) {
      const s = sesiones.get(waId);
      if (s && s.lockPor === id) {
        s.lockPor = null;
        s.lockHasta = null;
      }
    },
    async avanzarSesion(waId, id, ts, n) {
      await pausa();
      falla("avanzarSesion");
      const s = sesiones.get(waId);
      if (s && s.lockPor === id && s.ultimoTs <= ts) {
        s.estado = n.estado;
        s.traspasoHasta = n.traspasoHasta;
        s.actualizada = n.actualizada;
        s.ultimoTs = ts;
        traza.push(`avance:${id}`);
        return "ok";
      }
      return s && s.lockPor === id && s.ultimoTs > ts ? "obsoleta" : "perdido";
    },
    async guardarResultado(id, r) {
      await pausa();
      falla("guardarResultado");
      bandeja.get(id)!.resultado = structuredClone(r);
    },
    async registrarEnvio(id, n) {
      await pausa();
      falla("registrarEnvio");
      bandeja.get(id)!.enviados = n;
    },
    async cerrar(id, estado) {
      await pausa();
      falla("cerrar");
      bandeja.get(id)!.estado = estado;
    },
    async leerSesion(w) {
      await pausa();
      falla("leerSesion");
      const s = sesiones.get(w);
      return s ? { estado: structuredClone(s.estado), traspasoHasta: s.traspasoHasta, actualizada: s.actualizada } : null;
    },
    async guardarTraspaso(t, mid) {
      await pausa();
      falla("guardarTraspaso");
      let x = traspasos.get(mid);
      if (!x) traspasos.set(mid, (x = { id: ++seq, mensajeId: mid, t, avisado: false, creado: new Date(bandeja.get(mid)?.primerRecibo ?? AHORA), intentos: 0, proximo: null }));
      return { id: x.id, avisado: x.avisado };
    },
    async liberar(id) {
      const f = bandeja.get(id);
      if (f && f.estado === "procesando") f.lease = EPOCA;
    },
    async marcarAvisado(id) {
      await pausa();
      falla("marcarAvisado");
      for (const x of traspasos.values()) if (x.id === id) x.avisado = true;
    },
    async reclamarAvisosPendientes(ahora, limite, leaseMs, gracias) {
      await pausa();
      const elegibles = [...traspasos.values()]
        .filter((x) => !x.avisado && x.creado <= gracias && (!x.proximo || x.proximo <= ahora))
        .sort((a, b) => a.creado.getTime() - b.creado.getTime())
        .slice(0, limite);
      for (const x of elegibles) {
        x.proximo = new Date(ahora.getTime() + leaseMs);
        x.intentos++;
      }
      return elegibles.map((x) => ({ ...x.t, id: x.id, intentos: x.intentos }));
    },
    async registrarFalloAviso(id, proximo) {
      for (const x of traspasos.values()) if (x.id === id && !x.avisado) x.proximo = proximo;
    },
  };
  return { almacen, sesiones, bandeja, traspasos, traza, fallos, armar };
}

const llamadas: string[] = [];
const sello = crearSello("buscarBloqueos");
const servicios: ServiciosConversacion = {
  buscarProgramas: async () => (llamadas.push("programas"), { ok: false, codigo: "no_autorizado", sello }),
  detallePrograma: async () => (llamadas.push("detalle"), { ok: false, codigo: "no_autorizado", sello }),
  listarAgencias: async () => (llamadas.push("agencias"), { ok: false, codigo: "no_autorizado", sello }),
  porcentajeAgencia: async () => (llamadas.push("pct"), { ok: false, codigo: "no_autorizado", sello }),
  buscarBloqueos: async () => (llamadas.push("bloqueos"), { ok: false, codigo: "sin_resultados", motivo: "No hay bloqueos publicados para ese destino.", sello }),
  ofertaBloqueo: async () => null,
  cotizarBloqueo: async () => ({ ok: false, codigo: "error_tecnico", sello }),
  destinosPorcion: async () => ["SAN ANDRES"],
  buscarPorcion: async () => ({ ok: false, codigo: "sin_resultados", sello }),
  cotizarPorcion: async () => ({ ok: false, codigo: "error_tecnico", sello }) as never,
};
const AHORA = new Date("2026-11-01T15:00:00Z");
const msg = (id: string, entrada: unknown, waId = "573001112222", ts = 1_000) => ({ waId, id, ts, nombrePerfil: "Ana", entrada: entrada as never });
const txt = (t: string) => ({ tipo: "texto", texto: t });
const op = (v: string) => ({ tipo: "opcion", valor: v });

/** Mundo de prueba: envío y aviso con fallos inyectables; `enviados` recoge lo que Meta ACEPTÓ. */
function mundo(fallos: Fallos = {}, o: { avisar?: boolean; ruido?: () => number } = {}) {
  const a = almacenMemoria(fallos, o);
  const enviados: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const avisos: number[] = [];
  const cola = { envio: [] as ("ok" | "permanente" | "transitorio")[], aviso: 0, avisoSiempreFalla: false };
  let ahora = AHORA;
  const gancho: { enAviso?: () => void } = {};
  const deps = (): DepsTurno => ({
    almacen: a.almacen,
    servicios,
    ahora,
    hoy: "2026-11-01",
    enviar: async (w, cuerpo) => {
      const r = cola.envio.shift() ?? "ok";
      if (r === "ok") enviados.push({ ...cuerpo, __para: w, __orden: enviados.length });
      return r;
    },
    avisarAsesor:
      o.avisar === false
        ? undefined
        : async (t) => {
            gancho.enAviso?.();
            if (cola.avisoSiempreFalla || cola.aviso > 0) {
              if (cola.aviso > 0) cola.aviso--;
              throw new Error("aviso_fallido");
            }
            avisos.push(t.id);
          },
  });
  const turno = (m: ReturnType<typeof msg>) => procesarMensaje(deps(), m);
  const textos = () => enviados.map((c) => c.text?.body ?? c.interactive?.body?.text ?? "");
  return { ...a, enviados, avisos, cola, gancho, turno, textos, deps, avanzar: (ms: number) => void (ahora = new Date(ahora.getTime() + ms)), ahora: () => ahora };
}
/** Como hace Meta: reintenta lo que quedó en «reintentar» hasta que todos se completen. */
async function comoMeta(w: ReturnType<typeof mundo>, mensajes: ReturnType<typeof msg>[], rondas = 40) {
  const pendientes = new Set(mensajes);
  const estados = new Map<string, string[]>();
  for (let r = 0; r < rondas && pendientes.size; r++) {
    await Promise.all(
      [...pendientes].map(async (m) => {
        const e = await w.turno(m);
        estados.set(m.id, [...(estados.get(m.id) ?? []), e]);
        if (e !== "reintentar") pendientes.delete(m);
      }),
    );
  }
  assert.equal(pendientes.size, 0, "algún mensaje no llegó a completarse");
  return estados;
}
const valores = (cuerpos: any[]) => cuerpos.flatMap((c) => [...(c.interactive?.action?.buttons?.map((b: any) => b.reply.id) ?? []), ...(c.interactive?.action?.sections?.flatMap((s: any) => s.rows.map((r: any) => r.id)) ?? [])]); // eslint-disable-line @typescript-eslint/no-explicit-any

describe("turno · camino feliz y límites del canal", () => {
  test("primer contacto: menú de Bloqueos / Porción / asesor, sin Programas; queda completado y con sesión", async () => {
    const w = mundo();
    assert.equal(await w.turno(msg("1", txt("hola"))), "completado");
    assert.deepEqual(valores(w.enviados), ["producto:bloqueo", "producto:porcion", "asesor"]);
    assert.equal(w.bandeja.get("1")!.estado, "completado");
    assert.ok(w.sesiones.get("573001112222")!.actualizada > EPOCA);
    assert.equal(w.sesiones.get("573001112222")!.lockPor, null, "el turno se suelta al terminar");
  });

  test("elegir Bloqueos continúa por el flujo vigente y consulta solo el motor de bloqueos", async () => {
    llamadas.length = 0;
    const w = mundo();
    await w.turno(msg("1", txt("hola")));
    await w.turno(msg("2", op("producto:bloqueo"), undefined, 1_001));
    assert.match(w.textos().join("|"), /destino/i);
    await w.turno(msg("3", txt("San Andrés"), undefined, 1_002));
    assert.ok(llamadas.includes("bloqueos"));
    assert.ok(!llamadas.some((l) => ["programas", "agencias", "pct", "detalle"].includes(l)));
  });

  test("Programas no se ofrece ni se consulta (opción o texto)", async () => {
    llamadas.length = 0;
    const w = mundo();
    await w.turno(msg("1", txt("hola")));
    for (const [i, e] of [op("producto:programa"), txt("quiero un programa a Europa")].entries()) {
      await w.turno(msg(`p${i}`, e, undefined, 1_001 + i));
      assert.match(w.textos().at(-1)!, /programas \(circuitos\) aún no están disponibles/i);
    }
    assert.ok(!valores(w.enviados).includes("producto:programa"));
    assert.ok(!llamadas.includes("programas"));
  });

  test("B2B/agencias: ni opción ni listado ni comisión", async () => {
    llamadas.length = 0;
    const w = mundo();
    await w.turno(msg("1", txt("hola")));
    for (const [i, e] of [op("agencia"), op("ag:3"), txt("es para una agencia")].entries()) {
      await w.turno(msg(`a${i}`, e, undefined, 1_001 + i));
      assert.match(w.textos().at(-1)!, /gestiona directamente un asesor/i);
    }
    assert.ok(!llamadas.includes("agencias") && !llamadas.includes("pct"));
  });

  test("audio/imagen: aviso con menú; sesión vencida: bienvenida; ayuda propia sin Programas", async () => {
    const w = mundo();
    await w.turno(msg("1", "invalido"));
    assert.match(w.textos()[0], /solo entiendo mensajes de texto/);
    await w.turno(msg("2", txt("hola"), undefined, 1_001));
    await w.turno(msg("3", txt("ayuda"), undefined, 1_002));
    assert.ok(!/programa/i.test(w.textos().at(-1)!));
    w.avanzar(7 * 3_600_000);
    await w.turno(msg("4", op("producto:bloqueo"), undefined, 1_003));
    assert.match(w.textos().at(-1)!, /asistente de D'spacios/);
  });
});

describe("concurrencia · dos mensajes del MISMO wa_id en vuelo a la vez", () => {
  /** Referencia: los mismos dos mensajes, uno detrás de otro, sin concurrencia. */
  async function referencia() {
    const w = mundo();
    await w.turno(msg("0", txt("hola"), undefined, 900));
    await w.turno(msg("A", op("producto:bloqueo"), undefined, 1_000));
    await w.turno(msg("B", txt("San Andrés"), undefined, 1_001));
    return { estado: structuredClone(w.sesiones.get("573001112222")!.estado), textos: w.textos().slice(1) };
  }

  test("PRUEBA: 60 corridas con ruido distinto y ambos órdenes de llegada → mismo estado final, mismas respuestas, en orden y sin duplicados", async () => {
    const ref = await referencia();
    assert.equal(ref.estado.producto, "bloqueo");
    assert.ok(ref.estado.destino, "la referencia debe haber avanzado el estado con ambos mensajes");
    let cedieron = 0;
    for (let semilla = 1; semilla <= 60; semilla++) {
      for (const primeroB of [false, true]) {
        const w = mundo({}, { ruido: prng(semilla) });
        await w.turno(msg("0", txt("hola"), undefined, 900));
        w.enviados.length = 0;
        w.armar(2);
        const A = msg("A", op("producto:bloqueo"), undefined, 1_000);
        const B = msg("B", txt("San Andrés"), undefined, 1_001);
        const estados = await comoMeta(w, primeroB ? [B, A] : [A, B]);
        const ctx = `semilla=${semilla} primeroB=${primeroB}`;
        assert.deepEqual(w.sesiones.get("573001112222")!.estado, ref.estado, `estado final distinto · ${ctx}`);
        assert.deepEqual(w.textos(), ref.textos, `respuestas u orden distintos · ${ctx}`);
        assert.equal(w.sesiones.get("573001112222")!.ultimoTs, 1_001, ctx);
        assert.deepEqual(w.traza.filter((t) => t.startsWith("avance:")), ["avance:0", "avance:A", "avance:B"], `A avanzó antes que B · ${ctx}`);
        assert.equal(w.bandeja.get("A")!.estado, "completado");
        assert.equal(w.bandeja.get("B")!.estado, "completado");
        assert.equal(w.sesiones.get("573001112222")!.lockPor, null);
        for (const e of estados.values()) assert.equal(e.at(-1), "completado");
        if ([...estados.values()].some((e) => e.includes("reintentar"))) cedieron++;
      }
    }
    assert.ok(cedieron > 0, "la prueba debe haber provocado cesiones reales (si no, no hubo concurrencia)");
  });

  test("el turno posterior CEDE mientras el anterior está en curso (y esa cesión no gasta intentos)", async () => {
    const w = mundo();
    await w.turno(msg("0", txt("hola"), undefined, 900));
    w.armar(2);
    const A = msg("A", op("producto:bloqueo"), undefined, 1_000);
    const B = msg("B", txt("San Andrés"), undefined, 1_001);
    const [ra, rb] = await Promise.all([w.turno(A), w.turno(B)]);
    assert.equal(ra, "completado");
    assert.equal(rb, "reintentar", "B cede: A tiene menor ts y está en curso");
    assert.equal(w.bandeja.get("B")!.intentos, 1, "ceder no cuenta como intento");
    assert.equal(w.sesiones.get("573001112222")!.estado.destino, null, "B no tocó la sesión mientras cedía");
    assert.equal(await w.turno(B), "completado");
    assert.ok(w.sesiones.get("573001112222")!.estado.destino);
  });

  test("ceder muchas veces nunca lleva al abandono (más cesiones que MAX_INTENTOS)", async () => {
    const w = mundo();
    await w.turno(msg("0", txt("hola"), undefined, 900));
    // A queda en curso (reclamado, sin terminar): su lease sigue vigente y la compuerta lo ve.
    await w.almacen.reclamar("A", "573001112222", 1_000, w.ahora(), 600_000);
    const B = msg("B", txt("San Andrés"), undefined, 1_001);
    for (let i = 0; i < MAX_INTENTOS * 2; i++) assert.equal(await w.turno(B), "reintentar");
    assert.equal(w.bandeja.get("B")!.estado, "procesando");
    assert.ok(w.bandeja.get("B")!.intentos <= 1, "sigue en el primer intento");
    await w.almacen.cerrar("A", "completado");
    assert.equal(await w.turno(B), "completado");
  });

  test("la compuerta no bloquea para siempre: pasada GATE_MS un anterior atascado deja de hacer ceder", async () => {
    const w = mundo();
    await w.turno(msg("0", txt("hola"), undefined, 900));
    await w.almacen.reclamar("A", "573001112222", 1_000, w.ahora(), 600_000); // anterior que nunca termina
    const B = msg("B", txt("San Andrés"), undefined, 1_001);
    assert.equal(await w.turno(B), "reintentar");
    w.avanzar(GATE_MS + 1_000);
    assert.equal(await w.turno(B), "completado");
  });

  test("LÍMITE conocido: si el posterior termina ANTES de que el anterior llegue al servidor, el anterior es obsoleto → no pisa el estado ni responde viejo", async () => {
    const w = mundo();
    await w.turno(msg("0", txt("hola"), undefined, 900));
    assert.equal(await w.turno(msg("B", txt("San Andrés"), undefined, 1_001)), "completado");
    const antes = structuredClone(w.sesiones.get("573001112222")!.estado);
    const n = w.enviados.length;
    assert.equal(await w.turno(msg("A", op("producto:bloqueo"), undefined, 1_000)), "completado");
    assert.deepEqual(w.sesiones.get("573001112222")!.estado, antes, "el mensaje viejo no retrocede el estado");
    assert.equal(w.enviados.length, n, "y no se le contesta con una respuesta desactualizada");
    assert.equal(w.sesiones.get("573001112222")!.ultimoTs, 1_001);
  });

  test("clientes DISTINTOS no se bloquean entre sí", async () => {
    const w = mundo();
    w.armar(2);
    const [a, b] = await Promise.all([w.turno(msg("a1", txt("hola"), "573001110001")), w.turno(msg("b1", txt("hola"), "573001110002"))]);
    assert.deepEqual([a, b], ["completado", "completado"]);
    assert.equal(w.enviados.length, 2);
  });

  test("FENCING: si el turno pierde el lease a mitad (otro lo retomó), NO escribe sesión ni responde; el reintento lo completa", async () => {
    const w = mundo();
    await w.turno(msg("0", txt("hola"), undefined, 900));
    const antes = structuredClone(w.sesiones.get("573001112222")!.estado);
    const n = w.enviados.length;
    // Mientras A avisa al equipo, "vence" su lease y otro proceso toma el turno.
    w.gancho.enAviso = () => {
      const s = w.sesiones.get("573001112222")!;
      s.lockPor = "otro-proceso";
    };
    assert.equal(await w.turno(msg("A", op("asesor"), undefined, 1_000)), "reintentar");
    assert.deepEqual(w.sesiones.get("573001112222")!.estado, antes, "no escribió la sesión sin ser dueño del turno");
    assert.equal(w.enviados.length, n, "no respondió");
    w.gancho.enAviso = undefined;
    w.sesiones.get("573001112222")!.lockPor = null; // el otro proceso terminó
    w.sesiones.get("573001112222")!.lockHasta = null;
    assert.equal(await w.turno(msg("A", op("asesor"), undefined, 1_000)), "completado");
    assert.equal(w.traspasos.size, 1, "una sola solicitud pese al intento perdido");
  });

  test("dos 'asesor' simultáneos del mismo cliente → UNA solicitud y UNA confirmación (el segundo la encuentra en silencio)", async () => {
    for (let semilla = 1; semilla <= 30; semilla++) {
      const w = mundo({}, { ruido: prng(semilla) });
      await w.turno(msg("0", txt("hola"), undefined, 900));
      w.enviados.length = 0;
      w.armar(2);
      await comoMeta(w, [msg("A", op("asesor"), undefined, 1_000), msg("B", op("asesor"), undefined, 1_001)]);
      assert.equal(w.traspasos.size, 1, `semilla ${semilla}`);
      assert.equal(w.avisos.length, 1, `semilla ${semilla}`);
      assert.equal(w.enviados.length, 1, `semilla ${semilla}`);
    }
  });
});

describe("fiabilidad · ningún mensaje se pierde por haberse reclamado antes", () => {
  test("VERDE: avanzar la sesión falla → reintentar SIN responder; el reintento responde una sola vez y completa", async () => {
    const w = mundo({ avanzarSesion: 1 });
    assert.equal(await w.turno(msg("w1", txt("hola"))), "reintentar");
    assert.equal(w.enviados.length, 0, "no se responde si la sesión no pudo avanzar");
    assert.equal(await w.turno(msg("w1", txt("hola"))), "completado");
    assert.equal(w.enviados.length, 1, "no se duplica la respuesta");
    assert.equal(w.bandeja.get("w1")!.estado, "completado");
    assert.equal(w.sesiones.get("573001112222")!.lockPor, null, "el turno se soltó también tras el fallo");
  });

  test("VERDE: reclamar, tomar turno, guardar resultado o leer sesión fallan → reintentar; el siguiente intento responde una sola vez", async () => {
    for (const f of ["guardarResultado", "reclamar", "leerSesion", "tomarTurno"] as const) {
      const w = mundo({ [f]: 1 });
      assert.equal(await w.turno(msg("w1", txt("hola"))), "reintentar", f);
      assert.equal(w.enviados.length, 0, f);
      assert.equal(await w.turno(msg("w1", txt("hola"))), "completado", f);
      assert.equal(w.enviados.length, 1, f);
    }
  });

  test("VERDE: guardar el traspaso falla → NO se confirma al cliente; el reintento lo registra una vez, avisa una vez y confirma una vez", async () => {
    const w = mundo();
    await w.turno(msg("1", txt("hola")));
    const antes = w.enviados.length;
    w.fallos.guardarTraspaso = 1;
    assert.equal(await w.turno(msg("2", op("asesor"), undefined, 1_001)), "reintentar");
    assert.equal(w.enviados.length, antes, "sin traspaso guardado no hay confirmación");
    assert.equal(w.avisos.length, 0);
    assert.equal(await w.turno(msg("2", op("asesor"), undefined, 1_001)), "completado");
    assert.equal(w.traspasos.size, 1);
    assert.equal(w.avisos.length, 1);
    assert.equal(w.enviados.length, antes + 1);
    assert.match(w.textos().at(-1)!, /asesor de D'spacios/);
  });

  test("VERDE: el aviso por correo falla → NO se confirma; la solicitud queda guardada SIN avisar; el reintento avisa y confirma, sin duplicar", async () => {
    const w = mundo();
    await w.turno(msg("1", txt("hola")));
    const antes = w.enviados.length;
    w.cola.aviso = 1;
    assert.equal(await w.turno(msg("2", op("asesor"), undefined, 1_001)), "reintentar");
    assert.equal(w.enviados.length, antes);
    assert.equal(w.traspasos.size, 1);
    assert.equal([...w.traspasos.values()][0].avisado, false);
    assert.equal(await w.turno(msg("2", op("asesor"), undefined, 1_001)), "completado");
    assert.equal(w.traspasos.size, 1, "una sola solicitud");
    assert.equal(w.avisos.length, 1, "un solo aviso exitoso");
    assert.equal(w.enviados.length, antes + 1, "una sola confirmación");
  });

  test("VERDE: marcar avisado falla tras avisar → reintentar sin confirmar (el aviso se repite con la MISMA clave de idempotencia)", async () => {
    const w = mundo();
    await w.turno(msg("1", txt("hola")));
    const antes = w.enviados.length;
    w.fallos.marcarAvisado = 1;
    assert.equal(await w.turno(msg("2", op("asesor"), undefined, 1_001)), "reintentar");
    assert.equal(w.enviados.length, antes);
    assert.equal(await w.turno(msg("2", op("asesor"), undefined, 1_001)), "completado");
    assert.deepEqual(w.avisos, [1, 1]); // mismo id de traspaso → mismo Idempotency-Key en el correo
    assert.equal(w.traspasos.size, 1);
  });

  test("VERDE: sin canal de aviso nadie vería la solicitud → no se promete asesor ni se registra traspaso ni se silencia al bot", async () => {
    const w = mundo({}, { avisar: false });
    await w.turno(msg("1", txt("hola")));
    assert.equal(await w.turno(msg("2", op("asesor"), undefined, 1_001)), "completado");
    assert.equal(w.traspasos.size, 0);
    assert.match(w.textos().at(-1)!, /no puedo pasarte con un asesor/);
    assert.ok(!/te escribirá/.test(w.textos().at(-1)!));
    assert.equal(await w.turno(msg("3", op("producto:bloqueo"), undefined, 1_002)), "completado");
    assert.match(w.textos().at(-1)!, /destino/i); // el bot sigue respondiendo
  });

  test("VERDE: envío a Meta transitorio → reintentar; el reintento sigue SOLO con los cuerpos que faltan", async () => {
    const w = mundo();
    // Respuesta ya calculada de 2 cuerpos (texto largo + botones): el reintento no la recalcula.
    await w.almacen.reclamar("x", "573001112222", 1_000, AHORA, 60_000);
    await w.almacen.guardarResultado("x", { sesion: null, traspaso: null, mensajes: [{ texto: "a".repeat(1500), opciones: [{ etiqueta: "Uno", valor: "producto:bloqueo" }] }] });
    await w.almacen.liberar("x");
    w.cola.envio = ["ok", "transitorio"]; // el texto sale, el interactivo falla
    assert.equal(await w.turno(msg("x", txt("hola"))), "reintentar");
    assert.equal(w.enviados.length, 1);
    assert.equal(w.bandeja.get("x")!.enviados, 1);
    assert.equal(await w.turno(msg("x", txt("hola"))), "completado", "el lease se liberó: el reintento no espera");
    assert.equal(w.enviados.length, 2, "solo se envió el cuerpo que faltaba");
    assert.equal(w.bandeja.get("x")!.estado, "completado");
  });

  test("VERDE: con traspaso, el envío falla → el equipo YA fue avisado (la sesión calla al bot); el reintento confirma sin avisar de nuevo", async () => {
    const w = mundo();
    await w.turno(msg("1", txt("hola")));
    w.cola.envio = ["transitorio"];
    assert.equal(await w.turno(msg("2", op("asesor"), undefined, 1_001)), "reintentar");
    assert.equal(w.avisos.length, 1);
    assert.ok(w.sesiones.get("573001112222")!.traspasoHasta, "el asesor ya fue avisado: el bot no pisa su conversación");
    assert.equal(await w.turno(msg("2", op("asesor"), undefined, 1_001)), "completado");
    assert.equal(w.avisos.length, 1, "el aviso no se repite: ya estaba marcado");
    assert.match(w.textos().at(-1)!, /asesor de D'spacios/);
  });

  test("VERDE: envío rechazado de forma permanente (número no permitido, ventana cerrada) se descarta y NO se reintenta para siempre", async () => {
    const w = mundo();
    w.cola.envio = ["permanente"];
    assert.equal(await w.turno(msg("1", txt("hola"))), "completado");
    assert.equal(w.bandeja.get("1")!.estado, "completado");
    assert.equal(w.enviados.length, 0);
  });

  test("VERDE: cerrar falla al final → reintentar sin repetir respuesta ni sesión", async () => {
    const w = mundo({ cerrar: 1 });
    assert.equal(await w.turno(msg("1", txt("hola"))), "reintentar");
    assert.equal(await w.turno(msg("1", txt("hola"))), "completado");
    assert.equal(w.enviados.length, 1);
  });

  test("VERDE: registrar el envío falla una vez → se insiste en el momento y no se duplica", async () => {
    const w = mundo({ registrarEnvio: 1 });
    assert.equal(await w.turno(msg("1", txt("hola"))), "completado");
    assert.equal(w.enviados.length, 1);
    assert.equal(w.bandeja.get("1")!.enviados, 1);
  });
});

describe("idempotencia y reintentos", () => {
  test("decidirReclamo: completado/abandonado = hecho; lease vigente = ocupado; lease vencido = retomar", () => {
    const ahora = new Date("2026-11-01T15:00:00Z");
    const f = (estado: string, lease: string) => decidirReclamo({ estado, leaseHasta: lease }, ahora);
    assert.equal(f("completado", "2000-01-01T00:00:00Z"), "hecho");
    assert.equal(f("abandonado", "2000-01-01T00:00:00Z"), "hecho");
    assert.equal(f("procesando", "2026-11-01T15:00:30Z"), "ocupado");
    assert.equal(f("procesando", "2026-11-01T15:00:00Z"), "retomar");
    assert.equal(f("procesando", "2026-11-01T14:59:00Z"), "retomar");
  });

  test("cedeAlPrevio: menor ts primero; mismo ts por llegada y luego id; un anterior fuera de ventana ya no hace ceder", () => {
    const ahora = new Date("2026-11-01T15:00:00Z");
    const r = "2026-11-01T14:59:30Z";
    const p = (ts: number, primerRecibo = r, id = "p") => ({ id, ts, primerRecibo });
    assert.equal(cedeAlPrevio(p(5), p(6, r, "yo"), ahora, GATE_MS), true);
    assert.equal(cedeAlPrevio(p(7), p(6, r, "yo"), ahora, GATE_MS), false);
    assert.equal(cedeAlPrevio(p(6, "2026-11-01T14:59:00Z"), p(6, r, "yo"), ahora, GATE_MS), true);
    assert.equal(cedeAlPrevio(p(6, r, "a"), p(6, r, "b"), ahora, GATE_MS), true);
    assert.equal(cedeAlPrevio(p(6, r, "c"), p(6, r, "b"), ahora, GATE_MS), false);
    assert.equal(cedeAlPrevio(p(1, "2026-11-01T14:50:00Z"), p(6, r, "yo"), ahora, GATE_MS), false);
  });

  test("el mismo mensaje completado (reentrega de Meta) no se responde otra vez", async () => {
    const w = mundo();
    assert.equal(await w.turno(msg("dup", txt("hola"))), "completado");
    assert.equal(await w.turno(msg("dup", txt("hola"))), "duplicado");
    assert.equal(w.enviados.length, 1);
  });

  test("otro proceso con el lease vigente → reintentar (no se pisa); vencido → se retoma y se reanuda", async () => {
    const w = mundo();
    await w.almacen.reclamar("c", "573001112222", 1_000, AHORA, 60_000); // otro proceso lo tiene
    assert.equal(await w.turno(msg("c", txt("hola"))), "reintentar");
    assert.equal(w.enviados.length, 0);
    w.avanzar(61_000);
    assert.equal(await w.turno(msg("c", txt("hola"))), "completado");
    assert.equal(w.bandeja.get("c")!.intentos, 2);
  });

  test("tope de reintentos: se abandona CON registro; si el cliente no recibió nada y sigue la ventana, un aviso honesto una sola vez", async () => {
    const w = mundo();
    await w.almacen.reclamar("t", "573001112222", 1_000, AHORA, 60_000);
    w.bandeja.get("t")!.intentos = MAX_INTENTOS + 1;
    w.avanzar(61_000);
    assert.equal(await w.turno(msg("t", txt("hola"))), "abandonado");
    assert.equal(w.bandeja.get("t")!.estado, "abandonado");
    assert.match(w.textos().at(-1)!, /No pude completar tu solicitud/);
    assert.equal(w.enviados.length, 1);
    assert.equal(await w.turno(msg("t", txt("hola"))), "duplicado"); // ya no se reintenta
    assert.equal(w.enviados.length, 1);
  });

  test("más de 20 h: se abandona; pasada la ventana libre de 23 h ni siquiera se intenta el aviso", async () => {
    const w = mundo();
    await w.almacen.reclamar("v", "573001112222", 1_000, AHORA, 60_000);
    w.avanzar(24 * 3_600_000);
    assert.equal(await w.turno(msg("v", txt("hola"))), "abandonado");
    assert.equal(w.enviados.length, 0);
  });

  test("asesor: traspaso con resumen, el bot calla 2 h y «empezar de nuevo» lo devuelve", async () => {
    const w = mundo();
    await w.turno(msg("1", txt("hola")));
    await w.turno(msg("2", op("producto:bloqueo"), undefined, 1_001));
    await w.turno(msg("3", op("asesor"), undefined, 1_002));
    assert.equal([...w.traspasos.values()][0].t.resumen.producto, "bloqueo");
    const n = w.enviados.length;
    assert.equal(await w.turno(msg("4", txt("gracias"), undefined, 1_003)), "completado");
    assert.equal(w.enviados.length, n, "calla durante el traspaso");
    w.avanzar(61 * 60_000);
    await w.turno(msg("5", txt("gracias"), undefined, 1_004));
    assert.equal(w.enviados.length, n);
    await w.turno(msg("6", txt("empezar de nuevo"), undefined, 1_005));
    assert.deepEqual(valores(w.enviados.slice(n)), ["producto:bloqueo", "producto:porcion", "asesor"]);
    assert.equal(w.traspasos.size, 1);
  });
});

describe("recuperación de avisos · traspasos cuyo correo agotó los reintentos", () => {
  /** Lleva un traspaso hasta el abandono: el correo falla en cada reintento de Meta. */
  async function traspasoAbandonado() {
    const w = mundo();
    await w.turno(msg("1", txt("hola")));
    w.cola.avisoSiempreFalla = true;
    const A = msg("asesor", op("asesor"), undefined, 1_001);
    let ultimo = "";
    for (let i = 0; i < MAX_INTENTOS + 3 && ultimo !== "abandonado"; i++) ultimo = await w.turno(A);
    assert.equal(ultimo, "abandonado", "el correo agotó los reintentos del webhook");
    return w;
  }
  const recuperar = (w: Awaited<ReturnType<typeof traspasoAbandonado>>, avisar: (t: AvisoPendiente) => Promise<void>) =>
    recuperarAvisos({ almacen: w.almacen, avisar, ahora: w.ahora() });

  test("PRUEBA del caso: tras agotar los reintentos la solicitud queda guardada, SIN avisar, y el cliente solo recibió el aviso honesto", async () => {
    const w = await traspasoAbandonado();
    assert.equal(w.traspasos.size, 1);
    assert.equal([...w.traspasos.values()][0].avisado, false);
    assert.equal(w.avisos.length, 0);
    assert.match(w.textos().at(-1)!, /No pude completar tu solicitud/);
    assert.ok(!w.textos().some((t) => /te escribirá/.test(t)), "nunca se confirmó un traspaso sin aviso");
  });

  test("RECUPERACIÓN: sin ningún mensaje más del cliente, el cron vuelve a avisar y la solicitud queda avisada una sola vez", async () => {
    const w = await traspasoAbandonado();
    const enviadosAntes = w.enviados.length;
    const vistos: number[] = [];
    // Dentro de la gracia (10 min) todavía no compite con los reintentos de Meta.
    assert.deepEqual(await recuperar(w, async (t) => void vistos.push(t.id)), { reclamados: 0, avisados: 0, fallidos: 0 });
    w.avanzar((GRACIA_MIN + 1) * 60_000);
    assert.deepEqual(await recuperar(w, async (t) => void vistos.push(t.id)), { reclamados: 1, avisados: 1, fallidos: 0 });
    assert.equal([...w.traspasos.values()][0].avisado, true);
    assert.equal(w.enviados.length, enviadosAntes, "el cron no le escribe al cliente");
    assert.deepEqual(await recuperar(w, async (t) => void vistos.push(t.id)), { reclamados: 0, avisados: 0, fallidos: 0 });
    assert.deepEqual(vistos, [1], "un solo aviso");
  });

  test("RECUPERACIÓN con el correo todavía caído: retroceso exponencial, sin rendirse, y se completa cuando vuelve", async () => {
    const w = await traspasoAbandonado();
    w.avanzar((GRACIA_MIN + 1) * 60_000);
    const cae = async () => {
      throw new Error("aviso_fallido");
    };
    const fila = () => [...w.traspasos.values()][0];
    assert.deepEqual(await recuperar(w, cae), { reclamados: 1, avisados: 0, fallidos: 1 });
    assert.equal(fila().intentos, 1);
    assert.equal(fila().proximo!.getTime() - w.ahora().getTime(), 5 * 60_000, "1.er fallo → 5 min");
    assert.deepEqual(await recuperar(w, cae), { reclamados: 0, avisados: 0, fallidos: 0 }, "en retroceso no se reintenta");
    w.avanzar(5 * 60_000 + 1);
    assert.deepEqual(await recuperar(w, cae), { reclamados: 1, avisados: 0, fallidos: 1 });
    assert.equal(fila().proximo!.getTime() - w.ahora().getTime(), 10 * 60_000, "2.º fallo → 10 min");
    w.avanzar(10 * 60_000 + 1);
    const ok: number[] = [];
    assert.deepEqual(await recuperar(w, async (t) => void ok.push(t.id)), { reclamados: 1, avisados: 1, fallidos: 0 });
    assert.equal(fila().avisado, true);
    assert.equal(fila().intentos, 3);
    assert.deepEqual(ok, [1]);
  });

  test("dos corridas del cron SIMULTÁNEAS no mandan el mismo aviso dos veces", async () => {
    for (let semilla = 1; semilla <= 30; semilla++) {
      const w = await traspasoAbandonado();
      w.avanzar((GRACIA_MIN + 1) * 60_000);
      const enviados: number[] = [];
      const almacenRuidoso = { ...w.almacen, reclamarAvisosPendientes: async (...a: Parameters<Almacen["reclamarAvisosPendientes"]>) => (await tick(Math.floor(prng(semilla)() * 4)), w.almacen.reclamarAvisosPendientes(...a)) };
      const corrida = () => recuperarAvisos({ almacen: almacenRuidoso, avisar: async (t) => (await tick(2), void enviados.push(t.id)), ahora: w.ahora() });
      const [a, b] = await Promise.all([corrida(), corrida()]);
      assert.equal(a.avisados + b.avisados, 1, `semilla ${semilla}`);
      assert.deepEqual(enviados, [1], `semilla ${semilla}`);
    }
  });

  test("una corrida que murió tras reclamar se recupera cuando vence su lease (no queda perdida)", async () => {
    const w = await traspasoAbandonado();
    w.avanzar((GRACIA_MIN + 1) * 60_000);
    const muere = await w.almacen.reclamarAvisosPendientes(w.ahora(), 20, LEASE_AVISO_MS, new Date(w.ahora().getTime() - GRACIA_MIN * 60_000));
    assert.equal(muere.length, 1); // reclamó y no llegó a avisar
    assert.deepEqual(await recuperar(w, async () => undefined), { reclamados: 0, avisados: 0, fallidos: 0 }, "mientras dura su lease nadie más lo toma");
    w.avanzar(LEASE_AVISO_MS + 1);
    assert.deepEqual(await recuperar(w, async () => undefined), { reclamados: 1, avisados: 1, fallidos: 0 });
  });

  test("proximoAviso: 5 min, 10, 20… con tope de 6 h; y el límite por corrida se respeta", async () => {
    const t0 = new Date("2026-11-01T00:00:00Z");
    const min = (n: number) => (proximoAviso(n, t0).getTime() - t0.getTime()) / 60_000;
    assert.deepEqual([1, 2, 3, 4].map(min), [5, 10, 20, 40]);
    assert.equal(min(20), 360);
    const w = mundo();
    for (let i = 1; i <= 5; i++) await w.almacen.guardarTraspaso({ waId: `57300000000${i}`, nombrePerfil: null, resumen: {} }, `m${i}`);
    w.avanzar((GRACIA_MIN + 1) * 60_000);
    const r = await recuperarAvisos({ almacen: w.almacen, avisar: async () => undefined, ahora: w.ahora(), limite: 2 });
    assert.equal(r.reclamados, 2);
  });
});

describe("Cloud API · versión, errores y aviso", () => {
  test("la versión por defecto es la verificada (v25.0), configurable y validada", () => {
    assert.equal(VERSION_API_POR_DEFECTO, "v25.0");
    const base = { WHATSAPP_BOT_ACTIVO: "1", WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s" };
    assert.equal((leerConfigWhatsApp(base) as { apiVersion: string }).apiVersion, "v25.0");
    assert.equal((leerConfigWhatsApp({ ...base, WHATSAPP_API_VERSION: "v26.0" }) as { apiVersion: string }).apiVersion, "v26.0");
    assert.deepEqual((leerConfigWhatsApp({ ...base, WHATSAPP_API_VERSION: "26" }) as { falta: string[] }).falta, ["WHATSAPP_API_VERSION (formato vNN.N)"]);
  });
  test("clasificarHttp: 2xx ok; 429, 5xx, 401 y 403 transitorios; el resto de 4xx permanente", () => {
    assert.equal(clasificarHttp(200), "ok");
    for (const s of [429, 500, 502, 503, 401, 403]) assert.equal(clasificarHttp(s), "transitorio", String(s));
    for (const s of [400, 404, 410, 422]) assert.equal(clasificarHttp(s), "permanente", String(s));
  });
  test("el aviso lanza si Resend falla y manda la clave de idempotencia del traspaso", async () => {
    const vistos: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const ok = crearAvisador("equipo@x.test", "info@x.test", async (a) => (vistos.push(a), { ok: true }));
    await ok({ id: 7, waId: "573001112222", nombrePerfil: "<b>Ana</b>", resumen: { destino: "A&B" } });
    assert.equal(vistos[0].idempotencyKey, "salesbot-wa-traspaso-7");
    assert.ok(!vistos[0].html.includes("<b>") && vistos[0].html.includes("&lt;b&gt;"));
    const mal = crearAvisador("equipo@x.test", "info@x.test", async () => ({ ok: false, error: "x" }));
    await assert.rejects(() => mal({ id: 1, waId: "1", nombrePerfil: null, resumen: {} }), /aviso_fallido/);
  });
});

describe("cableado", () => {
  const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("el webhook valida firma antes de parsear, responde 503 si queda algo por reintentar y el proxy lo deja pasar solo por ruta exacta", () => {
    const r = leer("app/api/whatsapp/webhook/route.ts");
    assert.ok(r.indexOf("firmaValida(") < r.indexOf("JSON.parse("));
    assert.match(r, /status: pendientes \? 503 : 200/);
    assert.match(leer("proxy.ts"), /RUTAS_CRON = new Set\(\[[\s\S]*"\/api\/whatsapp\/webhook"/);
  });
  test("el cron de avisos: secreto fail-closed, inerte con el canal apagado y en el proxy", () => {
    const r = leer("app/api/cron/avisos-whatsapp/route.ts");
    assert.match(r, /process\.env\.CRON_SECRET/);
    assert.match(r, /if \(!secret\)/);
    assert.match(r, /status: 503/);
    assert.match(r, /auth !== `Bearer \$\{secret\}`/);
    assert.match(r, /status: 401/);
    assert.ok(r.indexOf("auth !== `Bearer") < r.indexOf("leerConfigWhatsApp()"), "el secreto se valida antes de tocar nada");
    assert.match(r, /cfg\.estado === "apagado"\) return NextResponse\.json\(\{ activo: false \}\)/);
    assert.match(leer("proxy.ts"), /RUTAS_CRON = new Set\(\[[\s\S]*"\/api\/cron\/avisos-whatsapp"/);
  });
  test("vercel.json conserva EXACTAMENTE los tres crons diarios (Hobby no admite uno cada 15 min)", () => {
    const v = JSON.parse(leer("vercel.json")) as { crons: { path: string; schedule: string }[] };
    assert.deepEqual(v.crons.map((c) => c.path), ["/api/cron/liberar-vencidas", "/api/cron/notificaciones", "/api/cron/reconciliar-financiero"]);
    assert.ok(v.crons.every((c) => /^\d+ \d+ \* \* \*$/.test(c.schedule)), "todos diarios");
    assert.ok(!leer("vercel.json").includes("avisos-whatsapp"));
    assert.ok(leer("app/api/cron/avisos-whatsapp/route.ts").includes("export async function GET"), "la ruta se conserva");
  });
  test("workflow del cron: cada 15 min en minutos desplazados, manual, sin PR, sin permisos, falla ante config ausente o HTTP no 2xx, sin exponer el secreto", () => {
    const y = readFileSync(new URL("../../.github/workflows/avisos-whatsapp-cron.yml", import.meta.url), "utf8");
    const crons = [...y.matchAll(/^\s*- cron: '([^']+)'/gm)].map((m) => m[1]);
    assert.equal(crons.length, 1);
    const [min, ...resto] = crons[0].split(" ");
    assert.equal(resto.join(" "), "* * * *");
    const minutos = min.split(",").map(Number);
    assert.deepEqual(minutos, [7, 22, 37, 52], "cada 15 min");
    assert.ok(minutos.every((m) => m !== 0 && m !== 30 && m % 15 === 7), "desplazados del inicio de hora");
    assert.match(y, /^\s*workflow_dispatch:/m);
    assert.ok(!/pull_request/.test(y.replace(/^#.*$/gm, "")), "nunca en PR: el secreto no llega a ramas ajenas");
    assert.match(y, /^permissions: \{\}/m);
    assert.match(y, /timeout-minutes: \d+/);
    assert.match(y, /concurrency:\s+group: avisos-whatsapp-cron\s+cancel-in-progress: false/);
    assert.match(y, /CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/);
    assert.match(y, /PRODUCTION_URL: \$\{\{ vars\.PRODUCTION_URL \}\}/);
    const sinComentarios = y.replace(/^\s*#.*$/gm, "");
    assert.equal((sinComentarios.match(/secrets\./g) ?? []).length, 1, "el secreto solo se mapea una vez, a una variable de entorno");
    const run = sinComentarios.slice(sinComentarios.indexOf("run: |"));
    assert.ok(!/\$\{\{/.test(run), "ninguna expresión de GitHub dentro del script (sin inyección)");
    assert.match(run, /set -euo pipefail/);
    assert.match(run, /::error::Configuración ausente/);
    assert.match(run, /secret:CRON_SECRET[\s\S]*variable:PRODUCTION_URL/);
    assert.match(run, /https:\/\/\*\)/);
    assert.match(run, /-K -/, "el secreto viaja por stdin");
    assert.match(run, /--max-time \d+/);
    assert.match(run, /2\?\?\) ;;[\s\S]*exit 1/, "cualquier HTTP no 2xx falla");
    assert.match(run, /\$base\/api\/cron\/avisos-whatsapp/);
    assert.ok(!/(echo|printf)(?![^\n]*Authorization: Bearer %s)[^\n]*\$\{?CRON_SECRET/.test(run), "el secreto no se imprime");
    assert.ok(!/add-mask/.test(run), "ni por ::add-mask::, que lo escribiría en claro fuera de Actions (los secrets ya vienen enmascarados)");
    assert.ok(!/set -x|--verbose|curl[^\n]* -v\b|-H "Authorization/.test(run), "ni va en argumentos ni en modo verboso");
    assert.ok(!/uses:/.test(y), "sin actions de terceros");
  });
  test("el id ya no se da por atendido al reclamarlo y el turno es exclusivo: orden de los efectos", () => {
    const t = leer("lib/whatsapp/turno.ts");
    assert.ok(!/reclamarMensaje|guardarSesion/.test(t));
    const pos = (s: string) => t.indexOf(s);
    assert.ok(pos("almacen.tomarTurno") < pos("calcular(d, m)"), "se toma el turno antes de leer la sesión");
    assert.ok(pos("almacen.guardarTraspaso") < pos("almacen.marcarAvisado") && pos("almacen.marcarAvisado") < pos("almacen.avanzarSesion"));
    assert.ok(pos("almacen.avanzarSesion") < pos("d.enviar(m.waId") && pos("d.enviar(m.waId") < t.lastIndexOf('almacen.cerrar(reg.id, "completado")'));
    assert.match(t, /finally \{\s*await d\.almacen\.soltarTurno/);
  });
  test("el avance de sesión real es UNA sentencia condicional (sin lectura previa ni upsert)", () => {
    const a = leer("lib/whatsapp/almacen.ts");
    const fn = a.slice(a.indexOf("async avanzarSesion"), a.indexOf("async guardarResultado"));
    assert.match(fn, /\.update\(/);
    assert.match(fn, /\.eq\("lock_por", id\)/);
    assert.match(fn, /\.lte\("ultimo_ts", ts\)/);
    assert.ok(!/upsert/.test(a), "ninguna escritura de sesión por upsert");
    assert.ok(fn.indexOf(".update(") < fn.indexOf('.from("salesbot_wa_sesiones").select'), "la lectura solo clasifica un fallo ya ocurrido");
  });
  test("solo envio.ts llama a Meta, y el catálogo del bot usa el cliente anónimo, no service-role", () => {
    for (const f of ["turno", "saliente", "entrante", "servicios", "almacen", "config", "firma", "aviso", "recuperacion"]) assert.ok(!/graph\.facebook\.com/.test(leer(`lib/whatsapp/${f}.ts`)), f);
    assert.match(leer("lib/whatsapp/servicios.ts"), /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    assert.ok(!/SERVICE_ROLE/.test(leer("lib/whatsapp/servicios.ts")));
    assert.match(leer("lib/whatsapp/envio.ts"), /\$\{cfg\.apiVersion\}/);
    assert.ok(!/v\d\d\.\d/.test(leer("lib/whatsapp/envio.ts")), "la versión no está quemada en el envío");
  });
});
