import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crearClienteFalso, type TablasFalsas } from "./support/fakeSupabase.ts";
import { cargarVigenciasServicios } from "../lib/reservar/temporadasServicio.ts";
import { incluidoEnEstadia } from "../lib/calc/servicioVigencias.ts";

// Mismo cargador + mismo resolutor que usan publicación, cotizar/Reservar y carrito (computarReservaBernalo): un traslado cuya vigencia no trae tarifa cae a la base.
const T = 7, HOY = "2026-11-03";
const vig = (precio: number | null) => ({ id: 70, servicio_id: T, nombre: "ALTA", fecha_inicio: "2030-01-01", fecha_fin: "2030-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: precio, precio_infante: null, recargo_individual: null });
const tablas = (v: ReturnType<typeof vig>[], base: number | null, grupos: object[] = []): TablasFalsas => ({
  servicios_adicionales: [{ id: T, tipo_receptivo: "traslado", combo_incluye_traslado: null, combo_traslado_alcance: null, categoria: "tour_traslado", precio_persona: base, precio_infante: null, recargo_individual: null }],
  servicio_temporadas: v, servicio_tarifa_pax: grupos, servicio_precio_alcance: [],
} as unknown as TablasFalsas);
const cargar = async (t: TablasFalsas) => {
  const r = await cargarVigenciasServicios(crearClienteFalso(t) as never, [{ id: T, nombre: "Traslado" }]);
  assert.ok(r.ok); return r.porServicio.get(T)!;
};
const est = ["2030-05-01", "2030-05-04"] as const;

test("cargador real → resolutor: vigencia sin tarifa usa la base (persona y grupo); con tarifa prevalece; sin nada, error orientativo", async () => {
  const sinTarifa = await cargar(tablas([vig(null)], 60000, [{ servicio_id: T, pax_desde: 1, pax_hasta: 4, precio: 200000, temporada: "GENERAL" }]));
  const p = incluidoEnEstadia(sinTarifa, "persona", ...est, HOY);
  assert.equal(p.ok && p.netoPersona, 60000); assert.equal(p.ok && p.origen, "base");
  const g = incluidoEnEstadia(sinTarifa, "grupo", ...est, HOY);
  assert.deepEqual(g.ok && g.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 200000 }]);
  const conTarifa = incluidoEnEstadia(await cargar(tablas([vig(80000)], 60000)), "persona", ...est, HOY);
  assert.equal(conTarifa.ok && conTarifa.netoPersona, 80000);
  const nada = incluidoEnEstadia(await cargar(tablas([vig(null)], null)), "persona", ...est, HOY);
  assert.match(!nada.ok ? nada.error : "", /Crea una vigencia con tarifa o configura la tarifa base en Producto → Servicios/);
});
test("publicación, Reservar, cotización y carrito (Bernalo) comparten cargador y resolutor", () => {
  for (const f of ["lib/reservar/computo.ts", "lib/reservar/computoReservaBernalo.ts", "lib/reservar/cotizar.ts", "app/(dashboard)/dashboard/paquetes/actions.ts"]) {
    const s = readFileSync(f, "utf8");
    assert.match(s, /cargarVigenciasServicios\(/, f);
  }
  for (const f of ["lib/reservar/computo.ts", "lib/reservar/computoReservaBernalo.ts", "lib/reservar/liquidacionHotel.ts", "app/(dashboard)/dashboard/paquetes/actions.ts"]) assert.match(readFileSync(f, "utf8"), /incluidoPorUnidades\(|incluidoEnEstadia\(/, f);
});

// Tours y asistencia: el cargador real entrega la base de TODOS los servicios y el resolutor compartido la usa (cliente falso: prueba SIMULADA, no base real).
const TOUR_ID = 8;
const tablasTour = (v: ReturnType<typeof vig>[], base: number | null, categoria = "tour_traslado"): TablasFalsas => ({
  servicios_adicionales: [{ id: TOUR_ID, tipo_receptivo: null, combo_incluye_traslado: null, combo_traslado_alcance: null, categoria, precio_persona: base, precio_infante: null, recargo_individual: null }],
  servicio_temporadas: v.map((x) => ({ ...x, servicio_id: TOUR_ID })), servicio_tarifa_pax: [], servicio_precio_alcance: [],
} as unknown as TablasFalsas);
test("tour/asistencia por el cargador real: sin alcance, la base llega y respalda; la vigencia prevalece; sin nada, error orientativo", async () => {
  const cargarT = async (t: TablasFalsas) => { const r = await cargarVigenciasServicios(crearClienteFalso(t) as never, [{ id: TOUR_ID, nombre: "SMR TOUR 02 - City Tour Panorámico" }]); assert.ok(r.ok); return r.porServicio.get(TOUR_ID)!; };
  const sinVig = await cargarT(tablasTour([], 30000));
  assert.notEqual(sinVig.usaAlcance, true, "no es un traslado por alcance");
  const a = incluidoEnEstadia(sinVig, "persona", "2030-05-01", "2030-05-01", HOY);
  assert.equal(a.ok && a.netoPersona, 30000); assert.equal(a.ok && a.origen, "base");
  const b = incluidoEnEstadia(await cargarT(tablasTour([vig(80000)], 30000)), "persona", "2030-05-01", "2030-05-01", HOY);
  assert.equal(b.ok && b.netoPersona, 80000, "la vigencia con tarifa prevalece");
  const c = incluidoEnEstadia(await cargarT(tablasTour([vig(null)], 30000)), "persona", "2030-05-01", "2030-05-01", HOY);
  assert.equal(c.ok && c.origen, "base", "vigencia sin tarifa → base");
  const d = incluidoEnEstadia(await cargarT(tablasTour([], null)), "persona", "2030-05-01", "2030-05-01", HOY);
  assert.match(!d.ok ? d.error : "", /«SMR TOUR 02 - City Tour Panorámico».*Crea una vigencia con tarifa o configura la tarifa base en Producto → Servicios/);
});
