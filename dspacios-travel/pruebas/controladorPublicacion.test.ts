import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ESTIMACION_ACTIVACION_MS, ESTIMACION_LOTE_MS, HOLGURA_PETICION_MS, publicarPorLotes, VENTANA_PETICION_MS, type ArgsManifiesto, type EstadoPublicacionServidor, type PuertoPublicacion } from "../lib/tarifario/controladorPublicacion.ts";
import { ejecutarReanudable, type RespuestaPaso } from "../lib/tarifario/bucleReanudable.ts";
import { huellaTexto } from "../lib/tarifario/publicacionPorLotes.ts";

// Servidor falso con la MISMA semántica que las funciones SQL de la migración 260: manifiesto inalterable, lotes en espera verificados por huella, cola, y `avanzar` = UN paso
// (cargar el siguiente lote desde la espera, activar solo con todos cargados, o limpiar).
class ServidorFalso implements PuertoPublicacion {
  generacionVigente = 5;
  publicada: { generacion: number; marca: string } | null = { generacion: 4, marca: "anterior" };
  revisionActual = 10;
  manifiestos = new Map<number, { args: ArgsManifiesto; espera: Map<number, string>; cargados: Set<number> }>();
  cola: { generacion: number; estado: "pendiente" | "limpiando" } | null = null;
  llamadasEspera = 0; llamadasAvanzar = 0; llamadasActivar = 0; limpiezasPendientes = 0;
  falloEnEspera: Error | null = null; avanzarResponde: string | null = null; esperaResponde = new Map<number, string>(); activarResponde: string | null = null;
  async manifiesto(a: ArgsManifiesto) {
    if (a.generacion !== this.generacionVigente) return "obsoleta";
    const ex = this.manifiestos.get(a.generacion);
    if (ex) return JSON.stringify([ex.args.lotes, ex.args.composicion, ex.args.modo, ex.args.trm, ex.args.diagnostico]) === JSON.stringify([a.lotes, a.composicion, a.modo, a.trm, a.diagnostico]) ? "ok" : "conflicto";
    this.manifiestos.set(a.generacion, { args: a, espera: new Map(), cargados: new Set() });
    return "ok";
  }
  async estado(_p: number, g: number): Promise<EstadoPublicacionServidor> {
    const m = this.manifiestos.get(g);
    if (!m) return { existe: false };
    return {
      existe: true, vigente: g === this.generacionVigente, publicada: this.publicada?.generacion === g, totalLotes: m.args.lotes.length,
      pendientes: m.args.lotes.filter((l) => !m.cargados.has(l.lote)).map((l) => l.lote), enEspera: [...m.espera.keys()], enCola: this.cola?.generacion === g,
    };
  }
  async espera(_p: number, g: number, lote: number, texto: string) {
    this.llamadasEspera++;
    if (this.falloEnEspera) throw this.falloEnEspera;
    if (this.esperaResponde.has(lote)) return this.esperaResponde.get(lote)!;
    if (g !== this.generacionVigente) return "obsoleta";
    const m = this.manifiestos.get(g);
    const l = m?.args.lotes.find((x) => x.lote === lote);
    if (!m || !l) return "lote_desconocido";
    if (huellaTexto(texto) !== l.huella) return "huella";
    if (!m.cargados.has(lote)) m.espera.set(lote, texto);
    return "ok";
  }
  async encolar(_p: number, g: number) {
    if (g !== this.generacionVigente) return "obsoleta";
    const m = this.manifiestos.get(g);
    if (!m) return "sin_manifiesto";
    if (m.args.lotes.some((l) => !m.cargados.has(l.lote) && !m.espera.has(l.lote))) return "faltan";
    if (this.cola?.generacion !== g) this.cola = { generacion: g, estado: "pendiente" };
    return "ok";
  }
  async avanzar(_p: number, g: number) {
    this.llamadasAvanzar++;
    if (this.avanzarResponde) return this.avanzarResponde;
    if (!this.cola) return "sin_cola";
    if (this.cola.generacion !== g) return "otra_generacion";
    const m = this.manifiestos.get(g)!;
    if (this.cola.estado === "limpiando") {
      if (this.limpiezasPendientes > 0) { this.limpiezasPendientes--; return "limpieza:250"; }
      this.cola = null; return "listo";
    }
    const siguiente = m.args.lotes.find((l) => !m.cargados.has(l.lote));
    if (siguiente) { m.cargados.add(siguiente.lote); m.espera.delete(siguiente.lote); return `lote:${siguiente.lote}`; }
    this.llamadasActivar++;
    if (this.activarResponde) { this.cola = null; return this.activarResponde; }
    this.publicada = { generacion: g, marca: "nueva" };
    this.cola = { generacion: g, estado: "limpiando" };
    return "activada";
  }
}

const filas = (n: number, k = 0) => Array.from({ length: n }, (_, i) => ({ paquete_id: 73, precio_pvp: 1000 + i + k, hotel_nombre: `Hotel ñ ${i}` }));
const base = (s: ServidorFalso, extra: Partial<Parameters<typeof publicarPorLotes>[1]> = {}) =>
  ({ paqueteId: 73, generacion: s.generacionVigente, revision: s.revisionActual, moneda: "COP" as const, filas: filas(4500), tamLote: 1500, ...extra });
// Reloj controlado: cada paso «cuesta» lo que diga `costo` (espera, lote, activación, limpieza).
class Cronometrado extends ServidorFalso {
  t = 0; inicios: { que: string; t: number }[] = [];
  costo = { espera: 1_000, lote: 5_000, act: 2_000, limp: 4_000 };
  override async espera(p: number, g: number, l: number, x: string) { this.inicios.push({ que: "espera", t: this.t }); this.t += this.costo.espera; return super.espera(p, g, l, x); }
  override async avanzar(p: number, g: number) {
    const antes = { act: this.llamadasActivar, lim: this.cola?.estado };
    const r = await super.avanzar(p, g);
    const que = r.startsWith("lote:") ? "lote" : r === "activada" ? "activar" : r.startsWith("limpieza:") || r === "listo" ? "limpiar" : "otro";
    this.inicios.push({ que, t: this.t });
    this.t += que === "lote" ? this.costo.lote : que === "activar" ? this.costo.act : que === "limpiar" ? this.costo.limp : 100;
    void antes; return r;
  }
}
const reloj = (c: Cronometrado) => () => c.t;

describe("controlador de publicación por lotes: preparar, encolar, avanzar", () => {
  test("una petición con presupuesto de sobra: prepara los lotes, los carga, activa y termina la limpieza", async () => {
    const s = new ServidorFalso(); s.limpiezasPendientes = 2;
    const r = await publicarPorLotes(s, base(s));
    assert.equal(r.estado, "publicada");
    if (r.estado === "publicada") { assert.equal(r.lotes, 3); assert.equal(r.filas, 4500); assert.equal(r.limpiezaPendiente, false); }
    assert.equal(s.publicada?.generacion, 5);
    assert.equal(s.llamadasEspera, 3, "cada lote se sube UNA sola vez a la espera");
    assert.equal(s.cola, null, "la cola queda vacía al terminar");
  });

  test("presupuesto agotado: la publicación queda ENCOLADA («pendiente» automática), NO activa y lo publicado antes sigue intacto", async () => {
    const c = new Cronometrado();
    const r = await publicarPorLotes(c, { ...base(c), ventanaMs: 22_000, holguraMs: 0, reloj: reloj(c) });
    assert.equal(r.estado, "pendiente");
    if (r.estado === "pendiente") assert.equal(r.automatica, true, "con todos los lotes en la base continúa sola");
    assert.equal(c.llamadasActivar, 0, "jamás se activa con lotes pendientes");
    assert.deepEqual(c.publicada, { generacion: 4, marca: "anterior" });
    assert.equal(c.cola?.generacion, 5, "quedó en la cola para el trabajador de la base");
  });

  test("sin tiempo ni para PREPARAR todos los lotes: «pendiente» NO automática (otra petición debe volver a calcular y subir los que faltan)", async () => {
    const c = new Cronometrado(); c.costo.espera = 6_000;
    const r = await publicarPorLotes(c, { ...base(c), ventanaMs: 12_000, holguraMs: 0, reloj: reloj(c) });
    assert.equal(r.estado, "pendiente");
    if (r.estado === "pendiente") assert.equal(r.automatica, false);
    assert.equal(c.cola, null, "sin todos los lotes en la base NO se encola");
    assert.deepEqual(c.publicada, { generacion: 4, marca: "anterior" });
  });

  test("otra petición (proceso nuevo, mismas filas) reanuda: sube solo lo que falta preparar y termina", async () => {
    const c = new Cronometrado(); c.costo.espera = 6_000;
    await publicarPorLotes(c, { ...base(c), ventanaMs: 12_000, holguraMs: 0, reloj: reloj(c) });
    const subidos = c.llamadasEspera;
    c.costo.espera = 100;
    const r = await publicarPorLotes(c, { ...base(c), reloj: reloj(c) });   // «navegador nuevo»: no conserva nada en memoria
    assert.equal(r.estado, "publicada");
    assert.equal(c.llamadasEspera - subidos, 3 - subidos, "solo los lotes que no estaban en la espera");
    assert.equal(c.publicada?.generacion, 5);
  });

  test("si al reanudar el cálculo cambió, el manifiesto no coincide: conflicto, no se mezcla ni se activa", async () => {
    const c = new Cronometrado();
    await publicarPorLotes(c, { ...base(c), ventanaMs: 22_000, holguraMs: 0, reloj: reloj(c) });
    const r = await publicarPorLotes(c, base(c, { filas: filas(4500, 1) }));
    assert.deepEqual(r, { estado: "conflicto" });
    assert.equal(c.llamadasActivar, 0);
    assert.deepEqual(c.publicada, { generacion: 4, marca: "anterior" });
  });

  test("el diagnóstico de la 256 forma parte del manifiesto: otro diagnóstico con las mismas filas es OTRO cálculo (conflicto)", async () => {
    const s = new ServidorFalso();
    await publicarPorLotes(s, base(s, { diagnostico: "sin tarifa el 12-dic" }));
    s.publicada = { generacion: 4, marca: "anterior" };
    assert.deepEqual(await publicarPorLotes(s, base(s, { diagnostico: "otro texto" })), { estado: "conflicto" });
  });

  test("generación superada por otra más nueva: se descarta (en el manifiesto, en la espera, al encolar o al avanzar)", async () => {
    const s = new ServidorFalso();
    assert.deepEqual(await publicarPorLotes(s, base(s, { generacion: 4 })), { estado: "descartada", motivo: "obsoleta" });
    const s2 = new ServidorFalso(); s2.esperaResponde.set(2, "obsoleta");
    assert.deepEqual(await publicarPorLotes(s2, base(s2)), { estado: "descartada", motivo: "obsoleta" });
    const s3 = new ServidorFalso(); s3.activarResponde = "fuente_cambio";
    assert.deepEqual(await publicarPorLotes(s3, base(s3)), { estado: "descartada", motivo: "fuente_cambio" });
    const s4 = new ServidorFalso(); s4.activarResponde = "modo_cambio";
    assert.deepEqual(await publicarPorLotes(s4, base(s4)), { estado: "descartada", motivo: "modo_cambio" });
  });

  test("rechazos de integridad (huella, composición) NO son descartes y no se ocultan", async () => {
    const s = new ServidorFalso(); s.esperaResponde.set(1, "huella");
    assert.deepEqual(await publicarPorLotes(s, base(s)), { estado: "rechazada", motivo: "huella" });
    const s2 = new ServidorFalso(); s2.activarResponde = "sin_composicion";
    assert.deepEqual(await publicarPorLotes(s2, base(s2)), { estado: "rechazada", motivo: "sin_composicion" });
    const s3 = new ServidorFalso(); s3.avanzarResponde = "detenida:huella";
    assert.deepEqual(await publicarPorLotes(s3, base(s3)), { estado: "rechazada", motivo: "detenida:huella" });
    const s4 = new ServidorFalso(); s4.avanzarResponde = "fallida";
    assert.deepEqual(await publicarPorLotes(s4, base(s4)), { estado: "rechazada", motivo: "fallida" });
  });

  test("un paso que falló en la base (error:…) o un trabajador ocupado NO es fallo: la publicación sigue sola", async () => {
    const s = new ServidorFalso(); s.avanzarResponde = "error:lock timeout";
    const r = await publicarPorLotes(s, base(s));
    assert.deepEqual(r, { estado: "pendiente", faltan: 3, total: 3, automatica: true });
    const s2 = new ServidorFalso(); s2.avanzarResponde = "ocupada";
    assert.equal((await publicarPorLotes(s2, base(s2))).estado, "pendiente");
  });

  test("un error real de la base al preparar (p. ej. permisos) se propaga: no se confunde con «obsoleta»", async () => {
    const s = new ServidorFalso(); s.falloEnEspera = Object.assign(new Error("permission denied"), { code: "42501" });
    await assert.rejects(() => publicarPorLotes(s, base(s)), /permission denied/);
    assert.equal(s.llamadasActivar, 0);
  });

  test("sin filas no se publica nada", async () => {
    const s = new ServidorFalso();
    assert.deepEqual(await publicarPorLotes(s, base(s, { filas: [] })), { estado: "rechazada", motivo: "sin_filas" });
  });
});

describe("bucle del cliente: qué pasa si se cierra el navegador entre peticiones", () => {
  const pendiente = (faltan: number): RespuestaPaso => ({ ok: true, pendiente: { faltan, total: 3 } });
  const listo: RespuestaPaso = { ok: true };

  test("continúa mientras haya «pendiente», pasa la respuesta previa y termina con la respuesta final", async () => {
    const pasos: number[] = [];
    const respuestas = [pendiente(2), pendiente(1), listo];
    let i = 1; const previas: RespuestaPaso[] = [];
    const r = await ejecutarReanudable(async () => pendiente(3), async (previa) => { previas.push(previa); return respuestas[i++ - 1]; }, { onProgreso: (p) => pasos.push(p.faltan) });
    assert.equal(r.terminado, true);
    assert.deepEqual(pasos, [3, 2, 1]);
    assert.equal(previas.length, 3);
  });

  test("navegador cerrado con la publicación ya encolada: el bucle se detiene SIN más llamadas y la publicación SIGUE sola en la base", async () => {
    const c = new Cronometrado();
    let peticiones = 0;
    const paso = async (): Promise<RespuestaPaso> => {
      peticiones++;
      const r = await publicarPorLotes(c, { ...base(c), ventanaMs: 22_000, holguraMs: 0, reloj: reloj(c) });
      return r.estado === "pendiente" ? { ok: true, pendiente: { faltan: r.faltan, total: r.total, automatica: r.automatica } } : { ok: true };
    };
    const r1 = await ejecutarReanudable(paso, paso, { interrumpido: () => true });
    assert.equal(r1.terminado, false);
    if (!r1.terminado) assert.equal(r1.motivo, "interrumpido");
    assert.equal(peticiones, 1, "tras cerrar el navegador no se hace ninguna petición más");
    assert.deepEqual(c.publicada, { generacion: 4, marca: "anterior" }, "lo publicado antes sigue intacto");
    assert.equal(c.cola?.generacion, 5, "la publicación quedó en la cola de la base");
    // El trabajador de la base (sin navegador) la termina.
    for (let k = 0; k < 20 && c.cola; k++) await c.avanzar(73, 5);
    assert.equal(c.publicada?.generacion, 5, "el trabajador la activó sin que nadie volviera a abrir la pantalla");
  });

  test("tope de pasos: no hay bucle infinito", async () => {
    const r = await ejecutarReanudable(async () => pendiente(1), async () => pendiente(1), { maxPasos: 3 });
    assert.equal(r.terminado, false);
    if (!r.terminado) assert.equal(r.motivo, "tope");
  });

  test("un error en la acción termina el bucle con ese error", async () => {
    const r = await ejecutarReanudable(async () => pendiente(2), async () => ({ ok: false, error: "x" }) as RespuestaPaso);
    assert.equal(r.terminado, true);
    if (r.terminado) assert.equal(r.respuesta.ok, false);
  });
});

describe("ventana de la petición (duración máxima de la acción)", () => {
  test("las constantes por defecto: ventana 60 s (válida en toda configuración de Vercel) y el primer lote cabe", () => {
    assert.equal(VENTANA_PETICION_MS, 60_000);
    assert.ok(ESTIMACION_LOTE_MS + ESTIMACION_ACTIVACION_MS + HOLGURA_PETICION_MS < VENTANA_PETICION_MS);
  });

  test("pasos lentos (7 s): ningún paso empieza si no cabe junto con la activación, y se respeta la ventana", async () => {
    const c = new Cronometrado(); c.costo = { espera: 1_000, lote: 7_000, act: 2_000, limp: 10_000 };
    const r = await publicarPorLotes(c, { ...base(c, { filas: filas(30_000), tamLote: 1500 }), reloj: reloj(c) });   // 20 lotes de 7 s = 140 s > 60 s
    assert.equal(r.estado, "pendiente");
    assert.equal(c.llamadasActivar, 0);
    assert.ok(c.t <= VENTANA_PETICION_MS - HOLGURA_PETICION_MS, "no se excede la ventana (con holgura): " + c.t);
    assert.ok(c.inicios.filter((x) => x.que === "lote").length >= 3, "aprovecha la ventana");
  });

  test("pasos rápidos (1 s): una petición los sube todos, activa y termina antes del final de la ventana", async () => {
    const c = new Cronometrado(); c.costo = { espera: 500, lote: 1_000, act: 1_000, limp: 500 };
    const r = await publicarPorLotes(c, { ...base(c, { filas: filas(30_000), tamLote: 1500 }), reloj: reloj(c) });
    assert.equal(r.estado, "publicada");
    const act = c.inicios.find((x) => x.que === "activar")!;
    assert.ok(act.t + 1_000 <= VENTANA_PETICION_MS - HOLGURA_PETICION_MS);
  });

  test("la ventana se cuenta desde el INICIO de la acción: el tiempo ya gastado calculando las filas resta lugar", async () => {
    const c = new Cronometrado();
    c.t = 54_000;                                             // la acción lleva 54 s (lectura + cálculo) cuando llama al controlador
    const r = await publicarPorLotes(c, { ...base(c), inicioMs: 0, reloj: reloj(c) });
    assert.equal(r.estado, "pendiente", "con 54 s gastados no cabe ni preparar los lotes");
    assert.equal(c.llamadasEspera, 0);
  });

  test("activada la publicación, la limpieza NO empieza si no cabe (la termina el trabajador de la base)", async () => {
    const c = new Cronometrado(); c.costo = { espera: 100, lote: 1_000, act: 1_000, limp: 20_000 }; c.limpiezasPendientes = 3;
    const r = await publicarPorLotes(c, { ...base(c, { filas: filas(6000), tamLote: 1500 }), inicioMs: 0, reloj: reloj(c), ventanaMs: 40_000, holguraMs: 0 });
    assert.equal(r.estado, "publicada");
    if (r.estado === "publicada") assert.equal(r.limpiezaPendiente, true);
    assert.equal(c.cola?.estado, "limpiando", "queda para el trabajador");
  });

  test("un error de la base al preparar se propaga (no se confunde con falta de tiempo ni con «obsoleta»)", async () => {
    const c = new Cronometrado();
    c.falloEnEspera = Object.assign(new Error("23503 fk"), { codigo: "23503" });
    await assert.rejects(() => publicarPorLotes(c, { ...base(c), reloj: reloj(c) }), /23503/);
  });
});
