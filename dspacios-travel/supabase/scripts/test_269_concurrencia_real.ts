// Prueba de CONCURRENCIA REAL del canal WhatsApp de SalesBot (#56): el almacén de producción (`almacenSupabase`) contra Postgres + PostgREST
// reales, en un contenedor local desechable. La orquesta test_269_salesbot_whatsapp.sh; no se corre contra Supabase real.
// Variables: NEXT_PUBLIC_SUPABASE_URL (proxy a PostgREST), SUPABASE_SERVICE_ROLE_KEY (JWT de service_role).
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { almacenSupabase } from "../../lib/whatsapp/almacen.ts";
import { procesarMensaje, type DepsTurno } from "../../lib/whatsapp/turno.ts";
import { recuperarAvisos, GRACIA_MIN } from "../../lib/whatsapp/recuperacion.ts";
import { crearSello } from "../../lib/salesbot/contrato.ts";
import type { ServiciosConversacion } from "../../lib/salesbot/conversacion/flujo.ts";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const almacen = almacenSupabase();
const sello = crearSello("buscarBloqueos");
const servicios: ServiciosConversacion = {
  buscarProgramas: async () => ({ ok: false, codigo: "no_autorizado", sello }),
  detallePrograma: async () => ({ ok: false, codigo: "no_autorizado", sello }),
  listarAgencias: async () => ({ ok: false, codigo: "no_autorizado", sello }),
  porcentajeAgencia: async () => ({ ok: false, codigo: "no_autorizado", sello }),
  buscarBloqueos: async () => ({ ok: false, codigo: "sin_resultados", motivo: "No hay bloqueos publicados para ese destino.", sello }),
  ofertaBloqueo: async () => null,
  cotizarBloqueo: async () => ({ ok: false, codigo: "error_tecnico", sello }),
  destinosPorcion: async () => ["SAN ANDRES"],
  buscarPorcion: async () => ({ ok: false, codigo: "sin_resultados", sello }),
  cotizarPorcion: async () => ({ ok: false, codigo: "error_tecnico", sello }) as never,
};
let n = 0;
const id = (p: string) => `${p}-${process.pid}-${++n}`;
const msg = (mid: string, waId: string, ts: number, entrada: unknown) => ({ waId, id: mid, ts, nombrePerfil: null, entrada: entrada as never });
let ok = 0;
const prueba = async (nombre: string, f: () => Promise<void>) => {
  await f();
  ok++;
  console.log(`  ✔ ${nombre}`);
};

const ahora = () => new Date();
function deps(enviados: { para: string; texto: string }[], extra: Partial<DepsTurno> = {}): DepsTurno {
  return {
    almacen,
    servicios,
    ahora: ahora(),
    hoy: new Date().toISOString().slice(0, 10),
    enviar: async (para, c) => (enviados.push({ para, texto: JSON.stringify(c) }), "ok"),
    ...extra,
  };
}
async function comoMeta(ms: ReturnType<typeof msg>[], enviados: { para: string; texto: string }[], extra: Partial<DepsTurno> = {}) {
  const pend = new Set(ms);
  let cesiones = 0;
  for (let r = 0; r < 60 && pend.size; r++) {
    await Promise.all([...pend].map(async (m) => {
      const e = await procesarMensaje(deps(enviados, extra), m);
      if (e === "reintentar") cesiones++;
      else pend.delete(m);
    }));
    if (pend.size) await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(pend.size, 0, "hubo mensajes sin completar");
  return cesiones;
}
const sesion = async (w: string) => (await sb.from("salesbot_wa_sesiones").select("*").eq("wa_id", w).single()).data!;

console.log("Concurrencia real contra Postgres + PostgREST:");

await prueba("reclamar: 12 procesos simultáneos sobre el MISMO mensaje → exactamente uno lo recibe", async () => {
  const mid = id("rec");
  const r = await Promise.all(Array.from({ length: 12 }, () => almacen.reclamar(mid, "573000000001", 1, ahora(), 60_000)));
  assert.equal(r.filter((x) => x.tipo === "listo").length, 1);
  assert.equal(r.filter((x) => x.tipo === "ocupado").length, 11);
});

await prueba("tomarTurno: 12 mensajes simultáneos del MISMO cliente → exactamente uno toma el turno", async () => {
  const w = "5730000000" + String(Math.floor(Math.random() * 90) + 10);
  const ids = Array.from({ length: 12 }, () => id("tt"));
  for (const m of ids) await almacen.reclamar(m, w, 1_000, ahora(), 60_000);
  const r = await Promise.all(ids.map((m) => almacen.tomarTurno(w, m, 1_000, ahora(), 90_000, 0)));
  assert.equal(r.filter((x) => x === "ok").length, 1, JSON.stringify(r));
  const dueño = ids[r.indexOf("ok")];
  const s = await sesion(w);
  assert.equal(s.lock_por, dueño);
  // Solo el dueño suelta el turno.
  const otro = ids.find((m) => m !== dueño)!;
  await almacen.soltarTurno(w, otro);
  assert.equal((await sesion(w)).lock_por, dueño);
  await almacen.soltarTurno(w, dueño);
  assert.equal((await sesion(w)).lock_por, null);
});

await prueba("avanzarSesion: una sentencia condicional → solo el dueño y nunca hacia atrás", async () => {
  const w = "573000000" + String(Math.floor(Math.random() * 900) + 100);
  const [a, b] = [id("av"), id("av")];
  for (const m of [a, b]) await almacen.reclamar(m, w, 1, ahora(), 60_000);
  assert.equal(await almacen.tomarTurno(w, a, 500, ahora(), 90_000, 0), "ok");
  const nueva = { estado: (await almacen.leerSesion(w))!.estado, traspasoHasta: null, actualizada: new Date().toISOString() };
  assert.equal(await almacen.avanzarSesion(w, b, 500, nueva), "perdido", "quien no tiene el turno no escribe");
  assert.equal(await almacen.avanzarSesion(w, a, 500, nueva), "ok");
  assert.equal((await sesion(w)).ultimo_ts, 500);
  assert.equal(await almacen.avanzarSesion(w, a, 400, nueva), "obsoleta", "un mensaje más viejo que el aplicado no retrocede la sesión");
  assert.equal((await sesion(w)).ultimo_ts, 500);
  // Carrera: 10 avances simultáneos con ts distintos del dueño → el ts final es el MAYOR, nunca uno menor.
  const ts = [510, 520, 530, 540, 550, 560, 570, 580, 590, 600];
  const r = await Promise.all(ts.map((t) => almacen.avanzarSesion(w, a, t, nueva)));
  assert.equal((await sesion(w)).ultimo_ts, 600, JSON.stringify(r));
  assert.ok(r.includes("ok"));
});

await prueba("lease vencido: otro proceso retoma el turno y el dueño anterior queda FENCEADO (no puede escribir)", async () => {
  const w = "573000001" + String(Math.floor(Math.random() * 900) + 100);
  const [viejo, nuevo] = [id("fv"), id("fv")];
  for (const m of [viejo, nuevo]) await almacen.reclamar(m, w, 1, ahora(), 60_000);
  assert.equal(await almacen.tomarTurno(w, viejo, 1, ahora(), 1, 0), "ok"); // lease de 1 ms
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(await almacen.tomarTurno(w, nuevo, 2, ahora(), 90_000, 0), "ok");
  const s = { estado: (await almacen.leerSesion(w))!.estado, traspasoHasta: null, actualizada: new Date().toISOString() };
  assert.equal(await almacen.avanzarSesion(w, viejo, 1, s), "perdido");
  assert.equal(await almacen.avanzarSesion(w, nuevo, 2, s), "ok");
});

await prueba("DOS mensajes del mismo wa_id en vuelo, 25 clientes a la vez → sin actualización perdida, respuestas en orden, sin duplicados", async () => {
  const clientes = Array.from({ length: 25 }, (_, i) => `57311${String(i).padStart(7, "0")}`);
  const resultados = await Promise.all(
    clientes.map(async (w) => {
      const enviados: { para: string; texto: string }[] = [];
      await comoMeta([msg(id("h"), w, 900, { tipo: "texto", texto: "hola" })], enviados);
      enviados.length = 0;
      const A = msg(id("A"), w, 1_000, { tipo: "opcion", valor: "producto:bloqueo" });
      const B = msg(id("B"), w, 1_001, { tipo: "texto", texto: "San Andrés" });
      const cesiones = await comoMeta([A, B], enviados); // A y B llegan a la vez
      // Referencia: los MISMOS dos mensajes, uno tras otro, en otro cliente.
      const ref = `57312${w.slice(5)}`;
      const enviadosRef: { para: string; texto: string }[] = [];
      await comoMeta([msg(id("rh"), ref, 900, { tipo: "texto", texto: "hola" })], enviadosRef);
      enviadosRef.length = 0;
      await comoMeta([msg(id("rA"), ref, 1_000, { tipo: "opcion", valor: "producto:bloqueo" })], enviadosRef);
      const trasA = enviadosRef.length;
      await comoMeta([msg(id("rB"), ref, 1_001, { tipo: "texto", texto: "San Andrés" })], enviadosRef);
      const textos = (e: { texto: string }[]) => e.map((x) => x.texto);
      const s = await sesion(w);
      const estado = s.estado as { producto: string; destino: string | null };
      assert.equal(estado.producto, "bloqueo", w);
      assert.equal(s.lock_por, null, `${w}: el turno quedó suelto`);
      const filas = (await sb.from("salesbot_wa_mensajes").select("mensaje_id, estado").in("mensaje_id", [A.id, B.id])).data!;
      assert.deepEqual(filas.map((f) => f.estado), ["completado", "completado"], w);
      if (estado.destino) {
        // Orden A → B: ambos respondieron, en ese orden, y el estado incorpora a los DOS.
        assert.deepEqual(textos(enviados), textos(enviadosRef), `${w}: mismas respuestas y mismo orden que en secuencia`);
        assert.deepEqual((await sesion(ref)).estado, s.estado, `${w}: mismo estado final que en secuencia`);
        assert.equal(s.ultimo_ts, 1_001);
        return { orden: "A→B" as const, cesiones };
      }
      // B llegó al servidor y terminó antes de que A se reclamara: A es obsoleto, no pisa y no responde viejo.
      assert.deepEqual(textos(enviados), textos(enviadosRef).slice(trasA), `${w}: solo responde B`);
      assert.equal(s.ultimo_ts, 1_001);
      return { orden: "B→A (A obsoleto)" as const, cesiones };
    }),
  );
  const porOrden = resultados.reduce<Record<string, number>>((a, r) => ((a[r.orden] = (a[r.orden] ?? 0) + 1), a), {});
  console.log("     resultado por cliente:", JSON.stringify(porOrden), "· cesiones totales:", resultados.reduce((a, r) => a + r.cesiones, 0));
});

await prueba("dos «asesor» simultáneos del mismo cliente → UNA solicitud, UN aviso, UNA confirmación", async () => {
  const w = "57322" + String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const enviados: { para: string; texto: string }[] = [];
  const avisos: number[] = [];
  const extra = { avisarAsesor: async (t: { id: number }) => void avisos.push(t.id) };
  await comoMeta([msg(id("h"), w, 900, { tipo: "texto", texto: "hola" })], enviados, extra);
  enviados.length = 0;
  await comoMeta([msg(id("S1"), w, 1_000, { tipo: "opcion", valor: "asesor" }), msg(id("S2"), w, 1_001, { tipo: "opcion", valor: "asesor" })], enviados, extra);
  const t = (await sb.from("salesbot_wa_traspasos").select("id, avisado_en").eq("wa_id", w)).data!;
  assert.equal(t.length, 1);
  assert.ok(t[0].avisado_en);
  assert.equal(avisos.length, 1);
  assert.equal(enviados.length, 1);
});

await prueba("guardarTraspaso: 10 reintentos simultáneos del mismo mensaje → una sola fila", async () => {
  const mid = id("gt");
  const r = await Promise.all(Array.from({ length: 10 }, () => almacen.guardarTraspaso({ waId: "573000002001", nombrePerfil: null, resumen: { x: 1 } }, mid)));
  assert.equal(new Set(r.map((x) => x.id)).size, 1);
  assert.equal((await sb.from("salesbot_wa_traspasos").select("id").eq("mensaje_id", mid)).data!.length, 1);
});

await prueba("RECUPERACIÓN: traspaso sin avisar (correo agotado) → el cron lo avisa SIN mensaje del cliente; dos corridas simultáneas, un solo aviso", async () => {
  const w = "573000003001";
  const mid = id("rc");
  const t = await almacen.guardarTraspaso({ waId: w, nombrePerfil: null, resumen: { producto: "bloqueo" } }, mid);
  assert.equal(t.avisado, false);
  // Dentro de la gracia no compite con los reintentos de Meta.
  const visto: number[] = [];
  const avisar = async (x: { id: number }) => void (await new Promise((r) => setTimeout(r, 15)), visto.push(x.id));
  const pronto = await recuperarAvisos({ almacen, avisar, ahora: new Date() });
  assert.ok(!visto.includes(t.id), "dentro de la gracia no se toca");
  assert.equal(pronto.avisados >= 0, true);
  // Pasada la gracia: dos corridas a la vez.
  const luego = new Date(Date.now() + (GRACIA_MIN + 1) * 60_000);
  const [a, b] = await Promise.all([recuperarAvisos({ almacen, avisar, ahora: luego }), recuperarAvisos({ almacen, avisar, ahora: luego })]);
  assert.equal(visto.filter((x) => x === t.id).length, 1, "un solo aviso para el traspaso");
  assert.ok(a.avisados + b.avisados >= 1);
  const fila = (await sb.from("salesbot_wa_traspasos").select("avisado_en, aviso_intentos").eq("mensaje_id", mid).single()).data!;
  assert.ok(fila.avisado_en, "quedó marcado como avisado");
  assert.equal(fila.aviso_intentos, 1);
});

await prueba("RECUPERACIÓN con el correo caído: retroceso persistido en la base y reintento posterior", async () => {
  const mid = id("rf");
  const t = await almacen.guardarTraspaso({ waId: "573000003002", nombrePerfil: null, resumen: {} }, mid);
  const base = new Date(Date.now() + (GRACIA_MIN + 1) * 60_000);
  const cae = async () => {
    throw new Error("aviso_fallido");
  };
  const r1 = await recuperarAvisos({ almacen, avisar: cae, ahora: base });
  assert.ok(r1.fallidos >= 1);
  const f1 = (await sb.from("salesbot_wa_traspasos").select("avisado_en, aviso_proximo, aviso_intentos").eq("id", t.id).single()).data!;
  assert.equal(f1.avisado_en, null);
  assert.equal(new Date(f1.aviso_proximo).getTime() - base.getTime(), 5 * 60_000, "primer fallo → 5 min");
  const visto: number[] = [];
  await recuperarAvisos({ almacen, avisar: async (x) => void visto.push(x.id), ahora: new Date(base.getTime() + 60_000) });
  assert.ok(!visto.includes(t.id), "en retroceso no se reintenta");
  await recuperarAvisos({ almacen, avisar: async (x) => void visto.push(x.id), ahora: new Date(base.getTime() + 5 * 60_000 + 1_000) });
  assert.ok(visto.includes(t.id), "pasado el retroceso se avisa");
});

console.log(`\n${ok} pruebas de concurrencia real: OK`);
