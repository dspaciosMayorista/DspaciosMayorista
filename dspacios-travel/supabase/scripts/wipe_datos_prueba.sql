-- ============================================================================
-- LIMPIEZA DE DATOS DE PRUEBA  —  D'spacios Travel
-- ============================================================================
-- ⚠️  IRREVERSIBLE. Corre esto en Supabase → SQL Editor SOLO cuando estés
--     seguro y con un respaldo reciente (Database → Backups).
--
-- ALCANCE elegido: "Operaciones + catálogo de producto" + borrar asesores.
--
-- BORRA:
--   • Operaciones: ventas, abonos, cuentas por pagar, comisiones, facturación,
--     rentabilidad, contrato_* (hoteles/items/pasajeros/vuelos), sillas, movimientos.
--   • Catálogo de producto: hoteles y todo lo dependiente (habitaciones, tarifas,
--     temporadas, categorías/regímenes/acomodaciones por hotel), destinos,
--     proveedores, aliados, servicios, itinerarios, inclusiones, paquetes y armado,
--     programas (y sus tablas), bloqueos de vuelo, tarifario_resultado.
--   • Asesores.
--
-- CONSERVA (configuración + accesos):
--   • usuarios            (tus cuentas de acceso)
--   • parametros_tributarios
--   • formas_pago
--   • rangos_edad
--   • categorias_habitacion   (catálogo global de categorías)
--   • planes_alimentacion     (catálogo global de regímenes)
--
-- No toca vistas/funciones (cupos_por_bloqueo, mi_rol, siguiente_numero_contrato);
-- la numeración de contratos se reinicia sola al quedar 'ventas' vacía.
-- ============================================================================

begin;

truncate table
  -- ── Operaciones / finanzas ────────────────────────────────────────────────
  public.rentabilidad,
  public.factura_items,
  public.facturacion,
  public.liquidacion_comisiones,
  public.cuentas_por_pagar,
  public.abonos,
  public.contrato_items,
  public.contrato_pasajeros,
  public.contrato_hoteles,
  public.contrato_vuelos,
  public.movimientos_silla,
  public.sillas,
  public.ventas,
  -- ── Resultado publicado del tarifario ────────────────────────────────────
  public.tarifario_resultado,
  -- ── Armado de paquetes ───────────────────────────────────────────────────
  public.armado_vuelos,
  public.armado_servicios,
  public.armado_hoteles,
  public.armado_paquetes,
  -- ── Paquetes (modelo viejo) ──────────────────────────────────────────────
  public.paquete_precios,
  public.paquete_hoteles,
  public.paquete_costos,
  public.paquetes,
  -- ── Programas (circuitos) ────────────────────────────────────────────────
  public.programa_tours,
  public.programa_precios,
  public.programa_inclusiones,
  public.programa_dias,
  public.programa_ciudades,
  public.programa_categoria_hoteles,
  public.programa_categorias,
  public.programa_blackouts,
  public.programas,
  -- ── Hoteles y tarifas ────────────────────────────────────────────────────
  public.tarifa_precios,
  public.tarifa_hotel,
  public.tarifas,
  public.hotel_acomodaciones,
  public.hotel_temporadas,
  public.hotel_regimenes,
  public.hotel_categorias,
  public.temporada_fechas,
  public.temporadas,
  public.habitaciones,
  public.hoteles,
  -- ── Servicios ────────────────────────────────────────────────────────────
  public.servicio_tarifa_pax,
  public.servicios_adicionales,
  -- ── Itinerarios / inclusiones ────────────────────────────────────────────
  public.itinerarios,
  public.inclusiones,
  -- ── Inventario de vuelos ─────────────────────────────────────────────────
  public.bloqueos_vuelo,
  -- ── Catálogos de producto ────────────────────────────────────────────────
  public.destinos,
  public.proveedores,
  public.aliados,
  -- ── Asesores (se eligió borrarlos) ───────────────────────────────────────
  public.asesores
restart identity cascade;

commit;

-- Verificación rápida (opcional): debe dar 0 en todas.
-- select
--   (select count(*) from public.ventas)    as ventas,
--   (select count(*) from public.hoteles)   as hoteles,
--   (select count(*) from public.programas) as programas,
--   (select count(*) from public.asesores)  as asesores;
