// #11 / B3-4 — El límite de envío de presencia es de UNA identidad, no del navegador. Controlador puro con almacenamiento, reloj, sesión y envío falsos: cambio rápido de cuenta A→B, pestañas de la misma persona,
// cierre de sesión, fallos transitorios/definitivos y almacenamiento roto. Contrato: nunca una llamada por gesto; el servidor sigue limitando a 1 escritura cada 4 min por persona.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { INTERVALO_PING_MS, REINTENTO_TRAS_ERROR_MS, claveDe, crearControladorPresencia, type Almacen } from "../lib/presencia/ping.ts";

const MIN = 60_000;
class Navegador {
  t = 1_000_000_000_000; visible = true; sesionId: string | null = "A"; llamadas: (string | null)[] = []; respuesta: () => Promise<{ error: { code?: string; status?: number } | null }> = async () => ({ error: null });
  datos = new Map<string, string>();
  almacen: Almacen = { leer: (k) => this.datos.get(k) ?? null, escribir: (k, v) => void this.datos.set(k, v), borrar: (k) => void this.datos.delete(k), claves: () => [...this.datos.keys()] };
  pestana(almacen: Almacen = this.almacen) {
    const ctl = crearControladorPresencia({
      ahora: () => this.t, visible: () => this.visible, sesion: async () => this.sesionId,
      enviar: async () => { this.llamadas.push(this.sesionId); return this.respuesta(); }, almacen,
    });
    return ctl;
  }
}
const gestos = async (c: { intentar: () => Promise<boolean> }, n: number) => { let enviados = 0; for (let i = 0; i < n; i++) if (await c.intentar()) enviados++; return enviados; };

describe("B3-4 límite por identidad", () => {
  test("A envía; B entra en el mismo navegador dentro de 5 min: la primera actividad de B SÍ envía (antes la suprimía la clave compartida)", async () => {
    const nav = new Navegador(); const t = nav.pestana();
    assert.equal(await t.intentar(), true); assert.deepEqual(nav.llamadas, ["A"]);
    nav.t += 30_000; nav.sesionId = "B"; t.cambioSesion("B");
    assert.equal(await t.intentar(), true, "B envía"); assert.deepEqual(nav.llamadas, ["A", "B"]);
    assert.equal(await gestos(t, 30), 0, "y 30 gestos más de B no envían nada");
  });
  test("el cambio ocurre en OTRA pestaña y esta no recibió el evento: al volver a la pestaña se relee la sesión (1 lectura local) y B envía; el envío se atribuye a B, no a A", async () => {
    const nav = new Navegador(); const t = nav.pestana();
    await t.intentar(); nav.t += 10_000; nav.sesionId = "B";      // sin t.cambioSesion: esta pestaña aún cree que es A
    await t.reverificar(); assert.equal(t.identidadActual(), "B");
    assert.equal(await t.intentar(), true); assert.deepEqual(nav.llamadas, ["A", "B"]); assert.ok(nav.datos.has(claveDe("B")));
  });
  test("sin evento ni vuelta a la pestaña, un gesto aún dentro del límite de A no envía (límite acotado: ≤ 5 min, y B sí envía desde su propia pestaña); pasado el límite el envío verifica la sesión real y se atribuye a B", async () => {
    const nav = new Navegador(); const t = nav.pestana();
    await t.intentar(); nav.t += 10_000; nav.sesionId = "B";
    assert.equal(await t.intentar(), false, "residual conocido y acotado"); nav.t += INTERVALO_PING_MS;
    assert.equal(await t.intentar(), true); assert.deepEqual(nav.llamadas, ["A", "B"]);
  });
  test("A→B→A→B en pocos segundos: una llamada por CAMBIO de cuenta como mucho, nunca por gesto; A y B conservan su límite", async () => {
    const nav = new Navegador(); const t = nav.pestana();
    let n = await gestos(t, 5);
    for (const quien of ["B", "A", "B", "A"]) { nav.t += 2_000; nav.sesionId = quien; t.cambioSesion(quien); n += await gestos(t, 20); }
    assert.deepEqual(nav.llamadas, ["A", "B"], "A y B enviaron una vez; al volver cada uno, su límite sigue vigente"); assert.equal(n, 2);
  });
  test("un envío de A que termina DESPUÉS de que entró B no toca el límite de B ni reabre el de A", async () => {
    const nav = new Navegador(); const t = nav.pestana();
    let soltar!: (v: { error: { code?: string } | null }) => void;
    nav.respuesta = () => new Promise((r) => { soltar = r; });
    const envio = t.intentar(); await new Promise((r) => setTimeout(r, 0));   // A en vuelo
    const reservaA = nav.datos.get(claveDe("A"));
    nav.sesionId = "B"; t.cambioSesion("B"); nav.respuesta = async () => ({ error: null });
    assert.equal(await t.intentar(), true, "B no queda bloqueada por el envío de A en vuelo");
    soltar({ error: { code: "500" } }); await envio;                         // A falla tarde
    assert.equal(nav.datos.get(claveDe("A")), reservaA, "la clave de A conserva su reserva: el fallo tardío no la reescribe como «reintentar en 1 min»");
    assert.ok(Number(nav.datos.get(claveDe("B"))) === nav.t, "el límite de B sigue siendo el de su propio envío");
  });
  test("pestañas de la MISMA persona comparten el límite: la segunda no envía; dos gestos simultáneos entre pestañas envían una vez", async () => {
    const nav = new Navegador(); const t1 = nav.pestana(), t2 = nav.pestana();
    const [a, b] = await Promise.all([t1.intentar(), t2.intentar()]);
    assert.equal([a, b].filter(Boolean).length, 1, "solo una de las dos envía"); assert.deepEqual(nav.llamadas, ["A"]);
    assert.equal(await gestos(t2, 10), 0); nav.t += INTERVALO_PING_MS; assert.equal(await t2.intentar(), true); assert.equal(nav.llamadas.length, 2);
  });
  test("cierre de sesión: se borran las claves guardadas (sin ids viejos), no hay envío sin sesión y la persona que vuelve envía de nuevo", async () => {
    const nav = new Navegador(); const t = nav.pestana(); await t.intentar();
    nav.sesionId = null; t.cambioSesion(null);
    assert.deepEqual(nav.almacen.claves(), [], "no queda ninguna clave de presencia");
    assert.equal(await gestos(t, 10), 0); assert.equal(nav.llamadas.length, 1, "sin sesión nada se envía");
    nav.sesionId = "A"; t.cambioSesion("A"); assert.equal(await t.intentar(), true); assert.equal(nav.llamadas.length, 2, "reingreso: un envío (la base sigue limitando a 1 escritura cada 4 min)");
  });
  test("claves de OTRAS personas: las viejas (≥5 min) se borran al cambiar de cuenta; las recientes se conservan", async () => {
    const nav = new Navegador(); const t = nav.pestana();
    nav.datos.set(claveDe("X"), String(nav.t - 6 * MIN)); nav.datos.set(claveDe("Y"), String(nav.t - 1 * MIN)); nav.datos.set("otra:cosa", "1");
    await t.intentar();
    assert.equal(nav.datos.has(claveDe("X")), false); assert.equal(nav.datos.has(claveDe("Y")), true); assert.equal(nav.datos.get("otra:cosa"), "1", "no toca claves ajenas");
  });
});

describe("B3-4 reglas que se conservan", () => {
  test("pestaña oculta: nunca; visible: sí; sin sesión: no", async () => {
    const nav = new Navegador(); const t = nav.pestana();
    nav.visible = false; assert.equal(await gestos(t, 5), 0); assert.equal(nav.llamadas.length, 0);
    nav.visible = true; assert.equal(await t.intentar(), true);
  });
  test("límite de 5 min por persona: 4:59 no, 5:00 sí; sin temporizadores (solo envía dentro de un gesto)", async () => {
    const nav = new Navegador(); const t = nav.pestana(); await t.intentar();
    nav.t += INTERVALO_PING_MS - 1; assert.equal(await t.intentar(), false); nav.t += 1; assert.equal(await t.intentar(), true);
  });
  test("fallo transitorio: no se reintenta en bucle; el siguiente intento queda a 1 min (no inmediato, no 5 min) y solo ante un gesto", async () => {
    const nav = new Navegador(); const t = nav.pestana();
    nav.respuesta = async () => ({ error: { code: "500" } });
    assert.equal(await t.intentar(), true); assert.equal(await gestos(t, 10), 0, "10 gestos inmediatos no reintentan");
    nav.t += REINTENTO_TRAS_ERROR_MS - 1; assert.equal(await t.intentar(), false); nav.t += 1; nav.respuesta = async () => ({ error: null });
    assert.equal(await t.intentar(), true); assert.equal(nav.llamadas.length, 2);
  });
  test("excepción de red: igual que un fallo transitorio, sin reventar", async () => {
    const nav = new Navegador(); const t = nav.pestana(); nav.respuesta = async () => { throw new Error("offline"); };
    assert.equal(await t.intentar(), true); assert.equal(await gestos(t, 5), 0);
  });
  test("cuenta sin permiso/inactiva (42501, 401, 403): se detiene SOLO esa identidad; la siguiente persona del mismo navegador sí envía", async () => {
    const nav = new Navegador(); const t = nav.pestana();
    nav.respuesta = async () => ({ error: { code: "42501" } });
    assert.equal(await t.intentar(), true); nav.t += 10 * MIN; assert.equal(await gestos(t, 10), 0, "A no insiste aunque pase el tiempo");
    nav.sesionId = "B"; t.cambioSesion("B"); nav.respuesta = async () => ({ error: null });
    assert.equal(await t.intentar(), true, "B sí"); assert.deepEqual(nav.llamadas, ["A", "B"]);
  });
  test("almacenamiento roto (lanza o no guarda): el respaldo en memoria evita una llamada por gesto", async () => {
    const nav = new Navegador();
    const roto: Almacen = { leer: () => { throw new Error("x"); }, escribir: () => { throw new Error("x"); }, borrar: () => { throw new Error("x"); }, claves: () => { throw new Error("x"); } };
    const t = nav.pestana(roto);
    assert.equal(await t.intentar(), true); assert.equal(await gestos(t, 50), 0); assert.equal(nav.llamadas.length, 1);
  });
  test("100 gestos con la misma persona = 1 llamada (nada de una llamada por gesto) y la sesión solo se consulta cuando un gesto pasa el límite", async () => {
    const nav = new Navegador(); let consultasSesion = 0;
    const t = crearControladorPresencia({ ahora: () => nav.t, visible: () => true, sesion: async () => { consultasSesion++; return "A"; }, enviar: async () => { nav.llamadas.push("A"); return { error: null }; }, almacen: nav.almacen });
    await gestos(t, 100);
    assert.equal(nav.llamadas.length, 1); assert.equal(consultasSesion, 2, "una para conocer la identidad y una verificación previa al único envío");
  });
});
