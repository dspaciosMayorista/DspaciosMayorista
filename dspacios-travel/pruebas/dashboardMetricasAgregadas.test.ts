import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  clasificarContratos, clasificarContratosDesdeConteos,
  clasificarCartera, carteraPorMonedaDesdeAgregado, fechaLimitePago,
  ventasMesPorMoneda, ventasMesPorMonedaDesdeAgregado, BALDE_MONEDA_DESCONOCIDA, cuposResumenDesdeAgregado,
} from "../lib/dashboard/metricas";

// ─────────────────────────────────────────────────────────────────────────
// Ronda "costo de las consultas": el Dashboard dejó de descargar filas
// completas (ventas/abonos/cupos/CxP/retenciones) para agregarlas en JS —
// ahora agrega en base (migración 186, `fn_dashboard_*`, SECURITY INVOKER).
// Como no hay una base de datos real disponible acá, estas pruebas:
//   1) demuestran que el resultado de las funciones puras que consumen los
//      agregados (`*DesdeAgregado`/`sumarVentasMes`) es IDÉNTICO al de las
//      funciones puras ya probadas que consumían filas individuales
//      (`clasificarContratos`/`clasificarCartera` — el "oráculo"), sobre los
//      MISMOS datos sintéticos;
//   2) espejan la fórmula SQL de cada función (`simularSQL*`, comentada
//      línea por línea contra el `.sql` real) para probar la paridad
//      aritmética exacta — la ejecución real se verifica con el postcheck
//      (supabase/scripts/postcheck_186_dashboard_agregados.sql, sección E:
//      compara el resultado de la función contra un cálculo manual, con
//      datos reales, una vez aplicada la migración);
//   3) demuestran que el tamaño de la respuesta agregada NO crece con el
//      volumen de filas subyacentes (independiente de "Max Rows").
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const migracion186 = readFileSync(join(raiz, "supabase/migrations/20260601000186_dashboard_agregados.sql"), "utf8");
const preflight186 = readFileSync(join(raiz, "supabase/scripts/preflight_186_dashboard_agregados.sql"), "utf8");
const postcheck186 = readFileSync(join(raiz, "supabase/scripts/postcheck_186_dashboard_agregados.sql"), "utf8");
const rollback186 = readFileSync(join(raiz, "supabase/scripts/rollback_186_dashboard_agregados.sql"), "utf8");

describe("Contratos por estado — paridad entre el conteo agrupado (SQL) y las filas individuales (oráculo)", () => {
  function agruparPorEstado(ventas: { estado: string | null }[]): { estado: string; n: number }[] {
    // Espejo EXACTO de `fn_dashboard_contratos_por_estado`:
    //   select coalesce(v.estado, '') as estado, count(*) as n
    //   from ventas where tenant = p_tenant group by v.estado;
    const grupos = new Map<string, number>();
    for (const v of ventas) {
      const k = v.estado ?? "";
      grupos.set(k, (grupos.get(k) ?? 0) + 1);
    }
    return [...grupos.entries()].map(([estado, n]) => ({ estado, n }));
  }

  test("resultado idéntico al oráculo (clasificarContratos) para un escenario mixto", () => {
    const ventas = [
      { estado: "pendiente" }, { estado: "pendiente" },
      { estado: "confirmado" }, { estado: "confirmado" }, { estado: "confirmado" },
      { estado: "activo" },
      { estado: "cancelado" },
    ];
    const oraculo = clasificarContratos(ventas);
    const viaAgregado = clasificarContratosDesdeConteos(agruparPorEstado(ventas));
    assert.deepEqual(viaAgregado, oraculo);
    assert.deepEqual(viaAgregado, { nVigentes: 6, nPendientes: 2, nConfirmadosOActivos: 4 });
  });

  test("resultado idéntico al oráculo con estado desconocido y sin ningún contrato", () => {
    const casos = [
      [{ estado: "confirmado" }, { estado: "activo" }, { estado: "misterioso" }, { estado: "pendiente" }],
      [] as { estado: string | null }[],
      [{ estado: "cancelado" }, { estado: "cancelado" }],
    ];
    for (const ventas of casos) {
      assert.deepEqual(clasificarContratosDesdeConteos(agruparPorEstado(ventas)), clasificarContratos(ventas));
    }
  });

  test("el resultado agrupado NUNCA crece más allá de los estados reales (4), sin importar cuántos contratos haya debajo — independiente de Max Rows", () => {
    const ESTADOS = ["pendiente", "confirmado", "activo", "cancelado"];
    const muchosContratos = Array.from({ length: 25_000 }, (_, i) => ({ estado: ESTADOS[i % ESTADOS.length] }));
    const agrupado = agruparPorEstado(muchosContratos);
    assert.ok(agrupado.length <= ESTADOS.length, `esperado ≤${ESTADOS.length} filas, llegaron ${agrupado.length}`);
    const total = agrupado.reduce((s, g) => s + g.n, 0);
    assert.equal(total, 25_000); // ninguna fila se pierde por agregar en vez de traerlas todas
  });
});

describe("Ventas del mes por moneda — FÓRMULA CORREGIDA: solo confirmado/activo, agrupado estrictamente por moneda", () => {
  type VentaMesTest = { estado: string | null; fecha_venta: string | null; precio_venta: number | null; moneda: string | null };

  function agruparVentasMesSQL(ventas: VentaMesTest[], periodo: string) {
    // Espejo EXACTO de `fn_dashboard_ventas_mes` corregida:
    //   where tenant = p_tenant and estado in ('confirmado','activo')
    //     and to_char(fecha_venta,'YYYY-MM') = p_periodo
    //   group by moneda   -- SIN coalesce: moneda es NOT NULL en la tabla real.
    const grupos = new Map<string, number>();
    for (const v of ventas) {
      if (v.estado !== "confirmado" && v.estado !== "activo") continue;
      if (!(v.fecha_venta ?? "").startsWith(periodo)) continue;
      const m = v.moneda ?? ""; // en la tabla real nunca es null (NOT NULL default 'COP')
      grupos.set(m, (grupos.get(m) ?? 0) + (v.precio_venta ?? 0));
    }
    return [...grupos.entries()].map(([moneda, total]) => ({ moneda, total }));
  }

  test("confirmado y activo cuentan; cancelado y pendiente NO — mismo resultado por el oráculo (filas) y por el agregado (RPC espejada)", () => {
    const periodo = "2026-11";
    const ventas: VentaMesTest[] = [
      { estado: "confirmado", fecha_venta: "2026-11-05", precio_venta: 1_000_000, moneda: "COP" },
      { estado: "activo", fecha_venta: "2026-11-12", precio_venta: 500_000, moneda: "COP" },
      { estado: "cancelado", fecha_venta: "2026-11-20", precio_venta: 2_000_000, moneda: "COP" }, // NO debe contar
      { estado: "pendiente", fecha_venta: "2026-11-22", precio_venta: 3_000_000, moneda: "COP" }, // NO debe contar (borrador)
      { estado: "confirmado", fecha_venta: "2026-10-31", precio_venta: 9_000_000, moneda: "COP" }, // fuera del mes
    ];
    const oraculo = ventasMesPorMoneda(ventas, periodo);
    const viaAgregado = ventasMesPorMonedaDesdeAgregado(agruparVentasMesSQL(ventas, periodo));
    assert.deepEqual(viaAgregado, oraculo);
    assert.deepEqual(viaAgregado, { COP: 1_500_000 }); // solo confirmado + activo de noviembre
  });

  test("COP y USD quedan estrictamente separados — nunca se mezclan en un solo total", () => {
    const periodo = "2026-11";
    const ventas: VentaMesTest[] = [
      { estado: "confirmado", fecha_venta: "2026-11-05", precio_venta: 1_000_000, moneda: "COP" },
      { estado: "activo", fecha_venta: "2026-11-10", precio_venta: 500, moneda: "USD" },
    ];
    const r = ventasMesPorMoneda(ventas, periodo);
    assert.deepEqual(r, { COP: 1_000_000, USD: 500 });
    assert.notEqual(r["COP"], 1_000_500); // nunca la suma mezclada
  });

  test("una moneda no reconocida cae en un balde aparte (BALDE_MONEDA_DESCONOCIDA) — nunca se incorpora a COP", () => {
    const periodo = "2026-11";
    const ventas: VentaMesTest[] = [
      { estado: "confirmado", fecha_venta: "2026-11-05", precio_venta: 1_000_000, moneda: "COP" },
      { estado: "confirmado", fecha_venta: "2026-11-06", precio_venta: 700_000, moneda: "EUR" }, // no soportada hoy
    ];
    const r = ventasMesPorMoneda(ventas, periodo);
    assert.equal(r["COP"], 1_000_000); // NO incluye los 700.000 de EUR
    assert.equal(r[BALDE_MONEDA_DESCONOCIDA], 700_000);
  });

  test("meta COP nunca se compara contra ventas USD — la separación por moneda hace la comparación cruzada imposible por construcción", () => {
    const periodo = "2026-11";
    const ventas: VentaMesTest[] = [{ estado: "confirmado", fecha_venta: "2026-11-05", precio_venta: 500, moneda: "USD" }];
    const ventasPorMoneda = ventasMesPorMoneda(ventas, periodo);
    // La única forma correcta de leer "ventas COP" es ventasPorMoneda["COP"]
    // — que aquí es undefined/0, NUNCA los 500 USD.
    assert.equal(ventasPorMoneda["COP"] ?? 0, 0);
    assert.equal(ventasPorMoneda["USD"], 500);
  });
});

describe("Cupos — mapeo trivial del agregado de 1 fila a los mismos nombres que ya usaba page.tsx", () => {
  test("reempaqueta correctamente capacidad/ocupados/disponibles/críticos", () => {
    const r = cuposResumenDesdeAgregado({ capacidad: 500, ocupados: 320, disponibles: 180, criticos: 4 });
    assert.deepEqual(r, { cuposCapacidad: 500, cuposOcupados: 320, cuposDisponibles: 180, cuposCriticos: 4 });
  });

  test("fila ausente (null) no rompe — todo en 0, nunca undefined/NaN", () => {
    const r = cuposResumenDesdeAgregado(null);
    assert.deepEqual(r, { cuposCapacidad: 0, cuposOcupados: 0, cuposDisponibles: 0, cuposCriticos: 0 });
  });
});

describe("Cartera por moneda — paridad entre el agregado SQL (espejado) y las filas individuales (oráculo)", () => {
  type VentaTest = { numero_contrato: string; precio_venta: number | null; fecha_salida: string | null; estado: string | null; moneda: string | null };

  function simularAgregadoSQL(ventas: VentaTest[], abonosPorContrato: Record<string, number>, hoy: string) {
    // Espejo de `fn_dashboard_cartera_por_moneda` (fórmula corregida): mismo
    // filtro `v.estado in ('confirmado', 'activo')` — 'pendiente' y
    // 'cancelado' NO generan cartera —, mismo saldo, misma regla de fecha
    // límite (fechaLimitePago, reutilizada), mismo agrupamiento.
    const porMoneda: Record<string, { alDia: number; vencida: number; sinFecha: number; sinFechaCount: number }> = {};
    for (const v of ventas) {
      if (v.estado !== "confirmado" && v.estado !== "activo") continue;
      const saldo = (v.precio_venta ?? 0) - (abonosPorContrato[v.numero_contrato] ?? 0);
      if (saldo <= 0) continue;
      const moneda = v.moneda || "COP";
      const b = porMoneda[moneda] ?? (porMoneda[moneda] = { alDia: 0, vencida: 0, sinFecha: 0, sinFechaCount: 0 });
      if (!v.fecha_salida) { b.sinFecha += saldo; b.sinFechaCount += 1; continue; }
      // SQL: `p_hoy <= (fecha_salida - 30)` = al día; lo contrario = vencida.
      if (hoy <= fechaLimitePago(v.fecha_salida)) b.alDia += saldo; else b.vencida += saldo;
    }
    return Object.entries(porMoneda).map(([moneda, b]) => ({
      moneda, al_dia: b.alDia, vencida: b.vencida, sin_fecha: b.sinFecha, sin_fecha_count: b.sinFechaCount,
    }));
  }

  test("resultado idéntico al oráculo (clasificarCartera) para un escenario con COP, USD, pago parcial, sin fecha y fecha límite exacta", () => {
    const HOY = "2026-11-01";
    const ventas: VentaTest[] = [
      { numero_contrato: "A", precio_venta: 1_000_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "COP" }, // al día (límite exacto)
      { numero_contrato: "B", precio_venta: 1_000_000, fecha_salida: "2026-11-30", estado: "confirmado", moneda: "COP" }, // vencida (1 día después)
      { numero_contrato: "C", precio_venta: 1_000_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "COP" }, // pago parcial
      { numero_contrato: "D", precio_venta: 500_000, fecha_salida: null, estado: "confirmado", moneda: "COP" }, // sin fecha
      { numero_contrato: "E", precio_venta: 1_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "USD" }, // otra moneda
      { numero_contrato: "F", precio_venta: 1_000_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "COP" }, // pagado por completo
    ];
    const abonos = { C: 400_000, F: 1_000_000 };

    const oraculo = clasificarCartera(ventas, abonos, HOY);
    const viaAgregado = carteraPorMonedaDesdeAgregado(simularAgregadoSQL(ventas, abonos, HOY));
    assert.deepEqual(viaAgregado, oraculo);

    // Y los valores concretos, para que la prueba no dependa solo de que
    // "ambos caminos coincidan entre sí" sin verificar que además son correctos.
    assert.equal(viaAgregado["COP"].alDia, 1_000_000 + 600_000); // A (completo) + C (saldo parcial, misma fecha límite que A: al día)
    assert.equal(viaAgregado["COP"].vencida, 1_000_000); // solo B
    assert.equal(viaAgregado["COP"].sinFecha, 500_000);
    assert.equal(viaAgregado["USD"].alDia, 1_000);
    assert.ok(!("F" in viaAgregado), "F está pagado por completo, no debe aparecer en ningún balde");
  });

  test("la respuesta agregada tiene como máximo 1 fila por moneda distinta, sin importar cuántos contratos haya (independiente de Max Rows)", () => {
    const HOY = "2026-11-01";
    const monedas = ["COP", "USD"];
    const muchasVentas: VentaTest[] = Array.from({ length: 10_000 }, (_, i) => ({
      numero_contrato: `C${i}`, precio_venta: 100_000, fecha_salida: "2026-12-15", estado: "confirmado", moneda: monedas[i % 2],
    }));
    const filas = simularAgregadoSQL(muchasVentas, {}, HOY);
    assert.equal(filas.length, 2); // una fila por moneda, nunca 10.000
    const total = filas.reduce((s, f) => s + f.al_dia + f.vencida + f.sin_fecha, 0);
    assert.equal(total, 10_000 * 100_000); // ningún contrato se pierde al agregar
  });

  test("'pendiente' NO genera cartera — un borrador de Reservar no es una venta consolidada todavía", () => {
    const HOY = "2026-11-01";
    const ventas: VentaTest[] = [
      { numero_contrato: "P1", precio_venta: 1_000_000, fecha_salida: "2026-12-01", estado: "pendiente", moneda: "COP" },
    ];
    const filas = simularAgregadoSQL(ventas, {}, HOY);
    assert.deepEqual(filas, []);
    assert.deepEqual(carteraPorMonedaDesdeAgregado(filas), {});
  });

  test("'cancelado' NO genera cartera", () => {
    const HOY = "2026-11-01";
    const ventas: VentaTest[] = [
      { numero_contrato: "X1", precio_venta: 1_000_000, fecha_salida: "2026-12-01", estado: "cancelado", moneda: "COP" },
    ];
    const filas = simularAgregadoSQL(ventas, {}, HOY);
    assert.deepEqual(filas, []);
  });

  test("'confirmado' Y 'activo' SÍ generan cartera — ambos son venta efectiva", () => {
    const HOY = "2026-11-01";
    const ventas: VentaTest[] = [
      { numero_contrato: "K1", precio_venta: 1_000_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "COP" },
      { numero_contrato: "K2", precio_venta: 500_000, fecha_salida: "2026-12-01", estado: "activo", moneda: "COP" },
    ];
    const filas = simularAgregadoSQL(ventas, {}, HOY);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].moneda, "COP");
    assert.equal(filas[0].al_dia, 1_500_000);
  });

  test("mezcla real: 2 pendientes + 6 confirmados/activos (cartera efectiva) + 2 cancelados → 6 pendientes de clasificación quedan fuera, cartera solo de los 6 efectivos", () => {
    const HOY = "2026-11-01";
    const ventas: VentaTest[] = [
      { numero_contrato: "M1", precio_venta: 100_000, fecha_salida: "2026-12-01", estado: "pendiente", moneda: "COP" },
      { numero_contrato: "M2", precio_venta: 100_000, fecha_salida: "2026-12-01", estado: "pendiente", moneda: "COP" },
      { numero_contrato: "M3", precio_venta: 100_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "COP" },
      { numero_contrato: "M4", precio_venta: 100_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "COP" },
      { numero_contrato: "M5", precio_venta: 100_000, fecha_salida: "2026-12-01", estado: "confirmado", moneda: "COP" },
      { numero_contrato: "M6", precio_venta: 100_000, fecha_salida: "2026-12-01", estado: "activo", moneda: "COP" },
      { numero_contrato: "M7", precio_venta: 100_000, fecha_salida: "2026-12-01", estado: "activo", moneda: "COP" },
      { numero_contrato: "M8", precio_venta: 100_000, fecha_salida: "2026-12-01", estado: "activo", moneda: "COP" },
      { numero_contrato: "M9", precio_venta: 100_000, fecha_salida: "2026-12-01", estado: "cancelado", moneda: "COP" },
      { numero_contrato: "M10", precio_venta: 100_000, fecha_salida: "2026-12-01", estado: "cancelado", moneda: "COP" },
    ];
    const filas = simularAgregadoSQL(ventas, {}, HOY);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].al_dia, 600_000); // 6 × 100.000 (3 confirmados + 3 activos)
  });
});

describe("Seguridad de las 6 funciones — SECURITY INVOKER, search_path fijo, execute revocado de public/anon, tenant obligatorio", () => {
  test("las 6 son SECURITY INVOKER (nunca DEFINER) — no hace falta saltar RLS para agregar lo que el rol ya puede leer", () => {
    const nombres = [
      "fn_dashboard_contratos_por_estado", "fn_dashboard_cupos_resumen", "fn_dashboard_retenciones_mes",
      "fn_dashboard_cxp_resumen", "fn_dashboard_cartera_por_moneda", "fn_dashboard_ventas_mes",
    ];
    for (const nombre of nombres) {
      const idx = migracion186.indexOf(`function public.${nombre}(`);
      assert.notEqual(idx, -1, `debe existir la función ${nombre}`);
      const bloque = migracion186.slice(idx, migracion186.indexOf("$$;", idx));
      assert.match(bloque, /security invoker/, `${nombre} debe ser SECURITY INVOKER`);
      assert.doesNotMatch(bloque, /security definer/, `${nombre} NO debe ser SECURITY DEFINER`);
      assert.match(bloque, /set search_path = public/, `${nombre} debe fijar search_path`);
    }
  });

  // La cobertura detallada de "revoke ... from public, anon" / "grant ... to
  // authenticated, service_role" para las 6 funciones vive en la prueba
  // "las 6 funciones otorgan EXECUTE a authenticated Y service_role..." más
  // abajo, en este mismo describe — evita duplicar la misma aserción dos veces.

  test("las 6 funciones reciben p_tenant explícito y lo filtran en el where (defensa en profundidad, no delegan el aislamiento solo a RLS) — excepto cupos, que no es una tabla por tenant (mismo criterio que ya usaba el código en JS)", () => {
    assert.match(migracion186, /fn_dashboard_contratos_por_estado\(p_tenant text\)/);
    assert.match(migracion186, /where v\.tenant = p_tenant/);
    assert.match(migracion186, /fn_dashboard_retenciones_mes\(p_tenant text, p_periodo text\)/);
    assert.match(migracion186, /where tenant = p_tenant and mes_declaracion = p_periodo/);
    assert.match(migracion186, /fn_dashboard_cxp_resumen\(p_tenant text, p_desde date, p_hasta date\)/);
    assert.match(migracion186, /fn_dashboard_cartera_por_moneda\(p_tenant text, p_hoy date\)/);
    assert.match(migracion186, /fn_dashboard_ventas_mes\(p_tenant text, p_periodo text\)/);
    assert.match(migracion186, /fn_dashboard_cupos_resumen\(\)/); // sin tenant, a propósito
  });

  test("ninguna de las 6 mezcla monedas: cartera y ventas del mes agrupan por moneda; cxp/retenciones/cupos son conteos o sumas de una sola magnitud sin componente de moneda mezclable", () => {
    assert.match(migracion186, /returns table\(moneda text, al_dia numeric, vencida numeric, sin_fecha numeric, sin_fecha_count bigint\)/);
    assert.match(migracion186, /returns table\(moneda text, total numeric\)/);
    assert.doesNotMatch(migracion186, /sum\(valor_total\)/); // cxp nunca suma $ de valor_total (mezclaría COP/USD)
  });

  test("fn_dashboard_ventas_mes filtra estado in ('confirmado','activo') — 'pendiente' y 'cancelado' quedan excluidos en el WHERE, no en JS", () => {
    const idx = migracion186.indexOf("function public.fn_dashboard_ventas_mes(");
    const bloque = migracion186.slice(idx, migracion186.indexOf("$$;", idx));
    assert.match(bloque, /estado in \('confirmado', 'activo'\)/);
    assert.doesNotMatch(bloque, /coalesce\(moneda, 'COP'\)/); // agrupa por el valor real, sin forzar a COP
  });

  test("fn_dashboard_cartera_por_moneda filtra v.estado in ('confirmado','activo') — la versión anterior (v.estado <> 'cancelado') dejaba entrar 'pendiente'", () => {
    const idx = migracion186.indexOf("function public.fn_dashboard_cartera_por_moneda(");
    const bloque = migracion186.slice(idx, migracion186.indexOf("$$;", idx));
    assert.match(bloque, /v\.estado in \('confirmado', 'activo'\)/);
    assert.doesNotMatch(bloque, /v\.estado <> 'cancelado'/);
  });

  test("las 6 funciones otorgan EXECUTE a authenticated Y service_role, revocado de public/anon", () => {
    const nombres = [
      ["fn_dashboard_contratos_por_estado(text)"],
      ["fn_dashboard_cupos_resumen()"],
      ["fn_dashboard_retenciones_mes(text, text)"],
      ["fn_dashboard_cxp_resumen(text, date, date)"],
      ["fn_dashboard_cartera_por_moneda(text, date)"],
      ["fn_dashboard_ventas_mes(text, text)"],
    ];
    for (const [firma] of nombres) {
      assert.match(migracion186, new RegExp(`revoke all on function public\\.${firma.replace(/[().]/g, "\\$&")} from public, anon;`));
      assert.match(migracion186, new RegExp(`grant execute on function public\\.${firma.replace(/[().]/g, "\\$&")} to authenticated, service_role;`));
    }
  });

  test("aislamiento por tenant: las 5 funciones con p_tenant dependen de RLS que exige puede_ver_tenant(tenant) en las tablas de origen (defensa en profundidad — pasar otro p_tenant no basta para ver datos ajenos)", () => {
    // La RLS real de cada tabla de origen (ya auditada en rondas previas,
    // migraciones 107/116/125/130) exige puede_ver_tenant(tenant) para los
    // roles no-superadmin/gerencia. Como las funciones son SECURITY INVOKER,
    // esa RLS se sigue aplicando sobre el resultado, SIN IMPORTAR qué
    // p_tenant reciba la función como argumento — un administracion/
    // operaciones de la agencia A que llame con p_tenant='B' no ve nada de
    // B, porque RLS ya se lo bloquea a nivel de fila antes de que el filtro
    // `where tenant = p_tenant` de la función siquiera entre en juego.
    const rlsVentas = readFileSync(join(raiz, "supabase/migrations/20260601000116_rls_tenant_isolation.sql"), "utf8");
    assert.match(rlsVentas, /puede_ver_tenant\(tenant\)/);
    const rlsRetenciones = readFileSync(join(raiz, "supabase/migrations/20260601000125_retenciones_cxp.sql"), "utf8");
    assert.match(rlsRetenciones, /retenciones_cxp: contable/);
    const rlsCxpPagos = readFileSync(join(raiz, "supabase/migrations/20260601000130_cxp_pagos.sql"), "utf8");
    assert.match(rlsCxpPagos, /puede_ver_tenant\(tenant\)/);
  });

  test("cupos_por_bloqueo: la vista subyacente de fn_dashboard_cupos_resumen se corrige a security_invoker=true — sin esto, SECURITY INVOKER en la función NO alcanza a proteger la vista (comportamiento pre-PG15 corre con los privilegios del dueño)", () => {
    assert.match(migracion186, /alter view public\.cupos_por_bloqueo set \(security_invoker = true\);/);
  });
});

describe("Scripts preflight/postcheck 186 — Supabase SQL Editor (sin metacomandos, una sola fila JSON)", () => {
  test("sin ninguna línea que empiece por '\\' (sin metacomandos de psql tipo \\echo)", () => {
    for (const script of [preflight186, postcheck186]) {
      const lineasConBarra = script.split("\n").filter((l) => l.trim().startsWith("\\"));
      assert.deepEqual(lineasConBarra, []);
    }
  });

  test("cada script termina en un único `select jsonb_build_object(...)` (una sola fila de resultado)", () => {
    for (const script of [preflight186, postcheck186]) {
      assert.equal((script.match(/select jsonb_build_object\(/g) ?? []).length, 1);
    }
  });

  test("preflight 186 comprueba: las 6 funciones libres, tablas/vista de origen, RLS habilitada, PG≥15, y cupos_por_bloqueo AÚN sin security_invoker", () => {
    assert.match(preflight186, /'funciones_libres'/);
    assert.match(preflight186, /'tablas_origen_existen'/);
    assert.match(preflight186, /'rls_habilitada_en_todas'/);
    assert.match(preflight186, /'pg_15_o_superior'/);
    assert.match(preflight186, /'cupos_por_bloqueo_security_invoker_ya_activo'/);
  });

  test("postcheck 186 comprueba: las 6 RPC sin EXECUTE para anon, con EXECUTE para authenticated Y service_role, ninguna SECURITY DEFINER, cupos_por_bloqueo con security_invoker=true, y la fórmula de cartera (confirmado/activo)", () => {
    assert.match(postcheck186, /has_function_privilege\('anon', p\.oid, 'EXECUTE'\) as anon_execute,/);
    assert.match(postcheck186, /has_function_privilege\('authenticated', p\.oid, 'EXECUTE'\) as authenticated_execute,/);
    assert.match(postcheck186, /has_function_privilege\('service_role', p\.oid, 'EXECUTE'\) as service_role_execute/);
    assert.match(postcheck186, /bool_and\(not anon_execute\)/);
    assert.match(postcheck186, /bool_and\(authenticated_execute\)/);
    assert.match(postcheck186, /bool_and\(service_role_execute\)/);
    assert.match(postcheck186, /bool_and\(not prosecdef\)/);
    assert.match(postcheck186, /'cupos_por_bloqueo_security_invoker'/);
    assert.match(postcheck186, /'cartera_formula_confirmado_activo'/);
  });

  test("postcheck 186 compara la cartera y las ventas del mes con un cálculo manual (misma regla: solo confirmado/activo) por moneda", () => {
    assert.match(postcheck186, /cartera_manual as \(/);
    assert.match(postcheck186, /where v\.tenant = 'mayorista' and v\.estado in \('confirmado', 'activo'\)/);
    assert.match(postcheck186, /'cartera_comparacion_manual'/);
    assert.match(postcheck186, /ventas_manual as \(/);
    assert.match(postcheck186, /'ventas_comparacion_manual'/);
  });

  test("postcheck 186 reporta ventas_pendientes_total como dato informativo (no bloquea `ok`) — para leer junto al resultado de cartera y confirmar que quedan fuera", () => {
    assert.match(postcheck186, /pendientes_check as \(/);
    assert.match(postcheck186, /'ventas_pendientes_total', \(select ventas_pendientes_total from pendientes_check\)/);
  });
});

describe("Rollbacks 185/186 — sin objetos, funciones, secuencias ni grants residuales", () => {
  test("rollback 186 elimina las 6 funciones (arrastrando sus GRANT) y documenta por qué NO revierte security_invoker de la vista", () => {
    assert.match(rollback186, /drop function if exists public\.fn_dashboard_contratos_por_estado\(text\);/);
    assert.match(rollback186, /drop function if exists public\.fn_dashboard_cupos_resumen\(\);/);
    assert.match(rollback186, /drop function if exists public\.fn_dashboard_retenciones_mes\(text, text\);/);
    assert.match(rollback186, /drop function if exists public\.fn_dashboard_cxp_resumen\(text, date, date\);/);
    assert.match(rollback186, /drop function if exists public\.fn_dashboard_cartera_por_moneda\(text, date\);/);
    assert.match(rollback186, /drop function if exists public\.fn_dashboard_ventas_mes\(text, text\);/);
    assert.match(rollback186, /Deliberadamente NO se revierte/);
    assert.match(rollback186, /alter view public\.cupos_por_bloqueo reset \(security_invoker\);/);
  });
});
