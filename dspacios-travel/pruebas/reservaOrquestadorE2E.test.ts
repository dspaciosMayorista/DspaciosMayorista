import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type TablasFalsas } from "./support/fakeSupabase.ts";

// ─────────────────────────────────────────────────────────────────────────
// EJECUCIÓN REAL del orquestador `computarReserva` (lib/reservar/computo.ts)
// — no un helper puro aislado combinado a mano en el test. Se invoca la
// función EXPORTADA real, inyectando únicamente las respuestas de Supabase
// (vía un cliente falso genérico, pruebas/support/fakeSupabase.ts, que
// filtra un dataset en memoria igual que PostgREST filtraría filas reales
// — nunca reimplementa la lógica de negocio de `computarReserva`).
//
// Datos EXACTOS de producción (diagnóstico del dueño, consultado en
// Supabase el 2026-09-16): hotel 217, paquete 50 activo/porcion_terrestre,
// categoría/régimen "Estándar"/"PAE", temporadas "Prueba d" (base) y
// "Promoción" (ganadora), fecha 2026-09-17→2026-09-18, `tarifa_hotel`
// Promoción/Estándar/PAE con `notas="No rembolsable prueba"` y
// `precio_final_autoritativo=false` (NO es el camino "autoritativo" de la
// migración 179 — es una promoción de tipo descuento/vigencia normal, que
// gana por PRIORIDAD, camino "legacy" de `resolverNetoNocheDetallado`).
//
// Por qué hace falta un loader + mock.module (y por qué NO existían antes en
// este repo): `computo.ts` importa con el alias `@/…` (`@/lib/supabase/
// server`, `@/lib/supabase/admin`, `@/lib/calc/paquetes`, etc.) — ese alias
// SOLO lo resuelve Next.js/tsc en build; bajo `node --test` plano
// (`node --experimental-strip-types`) revienta con `ERR_MODULE_NOT_FOUND`
// (confirmado con un `import()` directo antes de escribir este archivo). Es
// exactamente la razón por la que TODOS los módulos puros de `lib/tarifario/
// *`, `lib/reservar/liquidacionHotel.ts`, etc. usan imports RELATIVOS a
// propósito (ver la nota ya existente en lib/tarifario/vigencia.ts) — pero
// `computo.ts` (y `lib/reservar/cotizar.ts`, que llama) NO son puros: hacen
// I/O real contra Supabase, con el alias `@/`. Además `createAdminClient()`
// se construye DENTRO de `computo.ts`/`cotizar.ts` (no se recibe como
// parámetro), así que no basta con pasar un cliente falso — hay que
// interceptar el MÓDULO `@/lib/supabase/admin` en sí.
//
// Solución de infraestructura de pruebas (NINGÚN archivo de producción se
// tocó para esto): `pruebas/support/aliasLoader.mjs` (loader ESM que resuelve
// `@/*` a la raíz del repo, igual que hace tsconfig.json en build) +
// `node:test`'s `mock.module()` (intercepta `@/lib/supabase/admin` y
// `@/lib/supabase/server` para nunca tocar `next/headers`/red real). Ambos
// habilitados en `package.json`'s `test:unit` (`--experimental-test-module-
// mocks --experimental-loader ./pruebas/support/aliasLoader.mjs`) — sin
// esto, este archivo no puede ejecutarse con `npm run test:unit`.
//
// `crearCotizacionCarrito` NO es exportada (función privada de
// `app/tarifario/checkout/actions.ts`, solo invocable a través de
// `crearSolicitudReserva`, que además hace auth/B2B/notificaciones/inserts
// en `crm_contactos`/`config_solicitudes`) — ejecutarla de verdad exigiría
// fabricar ese segundo nivel de superficie completo. Se decidió NO fabricar
// esa superficie ancha (auth, resolución B2B, notificaciones) porque el
// riesgo real es exactamente el que señaló el dueño: un fixture grande e
// indirecto puede dar una falsa sensación de cobertura sin garantizar que
// refleja el comportamiento real. En su lugar, las secciones de abajo
// construyen el snapshot con `construirHotelSnapPersona()` (lib/reservar/
// hotelSnapPersona.ts) — la MISMA función pura que `crearCotizacionCarrito`
// usa en producción (extraída de su bloque `hotelesSnap.push({...})`, rama
// persona) — y alimentan `resolverCondicionesTarifaParaConversion`/
// `condicionesTarifaParaRender`/`agruparCondicionesTarifaPorTexto` (las
// MISMAS funciones reales que `reservar/actions.ts`/`ContratoDocumento.tsx`
// invocan) con el `condicionesTarifa` que salió de la ejecución REAL de
// `computarReserva` — nunca un array fabricado a mano.
// ─────────────────────────────────────────────────────────────────────────

const HOTEL_ID = 217;
const PAQUETE_ID = 50;
const CATEGORIA = "Estándar";
const REGIMEN = "PAE";
const NOTA = "No rembolsable prueba";

function construirTablas(): TablasFalsas {
  return {
    hoteles: [{
      id: HOTEL_ID, modelo_tarifario: "persona", nombre: "Odair Dubai prueba", moneda: "COP",
      edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12,
      pax_min: 1, pax_max: 4, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null,
      adults_only: false, pet_friendly: false,
    }],
    // pct_mk=0 (sin markup): el foco de esta prueba es la CONDICIÓN de
    // tarifa, no el margen (ya cubierto en lib/calc/paquetes.ts).
    armado_paquetes: [{
      id: PAQUETE_ID, pct_mk: 0, impuesto_fijo: 0, destino_id: 1,
      fecha_viaje_inicio: "2026-09-01", fecha_viaje_fin: "2026-09-30",
    }],
    destinos: [{ id: 1, nombre: "SAN ANDRÉS" }],
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categorias: null, regimenes: null }],
    // Temporadas REALES de producción: "Prueba d" (base, tipo 'tarifa') y
    // "Promoción" (gana por prioridad — tipo 'descuento_pct', NO 'tarifa':
    // es la única forma de que `es_promocion=true` en tarifario_resultado,
    // ver lib/calc/paquetes.ts::resolverNetoNocheDetallado — `esPromocion =
    // tipoTop !== "tarifa"`).
    hotel_temporadas: [
      {
        id: 1, hotel_id: HOTEL_ID, nombre: "Prueba d", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31",
        prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null,
        rangos: null, blackouts: null, min_noches: null, regimen_restringido: null,
        condicion_pago_tipo: null, condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null,
      },
      {
        id: 2, hotel_id: HOTEL_ID, nombre: "Promoción", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30",
        prioridad: 5, compra_inicio: null, compra_fin: null, tipo: "descuento_pct", descuento_valor: 23,
        rangos: null, blackouts: null, min_noches: null, regimen_restringido: null,
        condicion_pago_tipo: null, condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null,
      },
    ],
    tarifa_hotel: [
      // Base "Prueba d" — SIN nota (para que, si la nota llega, se sepa que
      // vino de la Promoción y no de acá).
      {
        id: 10, hotel_id: HOTEL_ID, tipo_habitacion: CATEGORIA, alimentacion: REGIMEN, temporada: "Prueba d",
        neto_sencilla: null, neto_doble: 300000, neto_triple: null, neto_multiple: null,
        neto_nino: null, neto_nino2: null, neto_infante: null, nota_infante: null,
        notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null,
        precio_final_autoritativo: false,
      },
      // "Promoción" — el dato EXACTO de producción: notas con el texto real,
      // precio_final_autoritativo=false (camino legacy, NO el atajo de la
      // migración 179).
      {
        id: 11, hotel_id: HOTEL_ID, tipo_habitacion: CATEGORIA, alimentacion: REGIMEN, temporada: "Promoción",
        neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null,
        neto_nino: null, neto_nino2: null, neto_infante: null, nota_infante: null,
        notas: NOTA, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null,
        precio_final_autoritativo: false,
      },
    ],
    armado_servicios: [],
    servicios_adicionales: [],
    hotel_blackouts: [],
    hotel_acomodaciones: [{
      hotel_id: HOTEL_ID, acomodacion: "doble", pax_tarifa: 2, pax_max: 4,
      adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2,
    }],
  };
}

const JOINS = {
  armado_paquetes: { destinos: "destino_id" },
  armado_hoteles: { hoteles: "hotel_id" },
  armado_servicios: { servicios_adicionales: "servicio_id" },
};

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

const tablas = construirTablas();
const admin = crearClienteFalso(tablas, { joins: JOINS });
const sb = crearClienteFalso(tablas, { joins: JOINS });

mock.module("@/lib/supabase/admin", {
  namedExports: { createAdminClient: () => admin },
});
mock.module("@/lib/supabase/server", {
  // Nunca debe invocarse de verdad: `computo.ts` solo IMPORTA `createClient`
  // para el tipo `Awaited<ReturnType<typeof createClient>>` del parámetro
  // `sb` — el cliente real lo pasa el test, no lo construye `computo.ts`.
  namedExports: { createClient: async () => { throw new Error("createClient() real NUNCA debe invocarse en esta prueba — sb se inyecta como parámetro."); } },
});

// Top-level await (ESM): se ejecuta UNA vez, antes de que `node:test`
// registre los `describe`/`test` de abajo — mismo patrón que otros archivos
// de este directorio que calculan un resultado compartido a nivel de módulo
// para no anidar `test()` dentro de un callback async (no soportado de
// forma confiable por el test runner de Node).
const { computarReserva } = await import("@/lib/reservar/computo.ts");
const { resolverCondicionesTarifaParaConversion, condicionesTarifaParaRender, agruparCondicionesTarifaPorTexto } =
  await import("../lib/calc/condicionesTarifa.ts");
const { construirHotelSnapPersona } = await import("../lib/reservar/hotelSnapPersona.ts");

const INPUT = {
  paqueteId: PAQUETE_ID, bloqueoId: null, modulo: "porcion_terrestre" as const,
  hotelId: HOTEL_ID, fechaIda: "2026-09-17", fechaRegreso: "2026-09-18",
  categoria: CATEGORIA, regimen: REGIMEN,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
  cliente: { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "300", email: "a@a.com" },
  tipoAsesor: "interno" as const, asesorInterno: "Asesor Uno", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
  plazo: "24 horas",
  pasajeros: [
    { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "CO", esInfante: false },
    { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1992-01-01", nacionalidad: "CO", esInfante: false },
  ],
};

const RESULTADO = await computarReserva(sb as unknown as Parameters<typeof computarReserva>[0], INPUT);

describe("computarReserva() — ejecución REAL del orquestador (lib/reservar/computo.ts), con datos EXACTOS de producción (hotel 217, paquete 50, temporadas 'Prueba d'/'Promoción', precio_final_autoritativo=false)", () => {
  test("caso real: ok:true", () => {
    assert.equal(RESULTADO.ok, true, RESULTADO.ok ? "" : `computarReserva falló: ${(RESULTADO as { ok: false; error: string }).error}`);
  });

  test("la Promoción gana por PRIORIDAD (camino legacy, sin precio_final_autoritativo) — el precio es el descontado, no el de la base", () => {
    assert.ok(RESULTADO.ok);
    if (!RESULTADO.ok) return;
    // base 300.000, descuento 23% → 231.000/persona.
    assert.equal(RESULTADO.data.pvpPorAcom["doble"], 231000);
  });

  test("comp.data.condicionesTarifa trae la nota de la Promoción — la que REALMENTE ganó, con ejecución real del orquestador (no un array fabricado a mano)", () => {
    assert.ok(RESULTADO.ok);
    if (!RESULTADO.ok) return;
    assert.deepEqual(RESULTADO.data.condicionesTarifa, [{ temporada: "Promoción", texto: NOTA }]);
  });
});

describe("construirHotelSnapPersona() (lib/reservar/hotelSnapPersona.ts, función REAL usada por crearCotizacionCarrito) + saltos siguientes", () => {
  if (!RESULTADO.ok) {
    test("computarReserva no devolvió ok:true — el resto de esta cadena no puede probarse hasta que la sección anterior se corrija", () => { assert.fail("ver la sección anterior"); });
  } else {
    const REF = "item-0";
    // MISMA función que usa checkout/actions.ts::crearCotizacionCarrito (rama
    // persona) — el test NUNCA fabrica `condiciones_tarifa` a mano.
    const snap = construirHotelSnapPersona({
      id: 1, ref: REF, comp: RESULTADO.data, categoria: CATEGORIA, regimen: REGIMEN,
      destinoFallback: "SAN ANDRÉS", hotelNombreFallback: "Odair Dubai prueba",
      fotoUrl: null, edadesMenoresConfirmadas: [],
    });

    test("el snapshot construido por la función REAL conserva la condición de la Promoción", () => {
      assert.deepEqual(snap.condiciones_tarifa, [{ temporada: "Promoción", texto: NOTA }]);
    });

    type HotelSnap = { ref?: unknown; condiciones_tarifa?: unknown };
    const detalleHotelesSnapCotizacion: HotelSnap[] = [snap];

    test("resolverCondicionesTarifaParaConversion() (función REAL que usa convertirCotizacionCarrito, reservar/actions.ts línea ~2197) resuelve la MISMA condición por `ref`", () => {
      const rConv = resolverCondicionesTarifaParaConversion(detalleHotelesSnapCotizacion, REF);
      assert.equal(rConv.ok, true);
      if (rConv.ok) assert.deepEqual(rConv.condiciones, [{ temporada: "Promoción", texto: NOTA }]);
    });

    test("contrato_hoteles.condiciones_tarifa (jsonb persistido) → condicionesTarifaParaRender() (función REAL de las 4 páginas de documento) → agruparCondicionesTarifaPorTexto() (función REAL de ContratoDocumento.tsx): la nota llega intacta hasta el render", () => {
      const rConv = resolverCondicionesTarifaParaConversion(detalleHotelesSnapCotizacion, REF);
      assert.equal(rConv.ok, true);
      if (!rConv.ok) return;
      const jsonbPersistido: unknown = rConv.condiciones; // lo que contrato_hoteles.insert({condiciones_tarifa: rCondiciones.condiciones}) guarda
      const paraRender = condicionesTarifaParaRender(jsonbPersistido);
      assert.deepEqual(paraRender, [{ temporada: "Promoción", texto: NOTA }]);
      const grupos = agruparCondicionesTarifaPorTexto(paraRender);
      assert.deepEqual(grupos, [{ texto: NOTA, temporadas: ["Promoción"] }]);
    });
  }
});
