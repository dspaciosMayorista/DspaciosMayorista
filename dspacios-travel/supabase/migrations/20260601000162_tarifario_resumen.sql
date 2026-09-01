-- ───────────────────────────────────────────────────────────────────────────
-- 162 · TARIFARIO — vista de resumen para carga en dos niveles
--
--  ⚠️ NO EJECUTADA EN PRODUCCIÓN TODAVÍA — aditiva, reversible (ver
--  supabase/scripts/rollback_162_tarifario_resumen.sql). Ejecutar SOLO cuando
--  el dueño lo autorice explícitamente.
--
--  Incidente: /tarifario, /dashboard/tarifario y /dashboard/reservar cargan
--  el catálogo COMPLETO de `tarifario_resultado` (~17.197 filas, ~15.876
--  vigentes) en CADA visita, para mostrar inicialmente ~58 tarjetas de hotel.
--  Dos rondas previas (compresión del payload, luego paginación con rediseño
--  visual) fueron rechazadas por el dueño — ninguna resolvía la causa real:
--  cargar la matriz completa (hotel × categoría × régimen × acomodación) para
--  pintar una tarjeta que solo necesita un precio "desde" es trabajo de sobra.
--  Una tercera ronda (esta vista + `expandirResumenAFilas()` en el servidor)
--  fue igualmente rechazada por seguir "re-multiplicando" el resumen a miles
--  de filas ANTES de transportarlo al cliente — la vista existía, pero el
--  código de aplicación deshacía su beneficio. Esta versión de la vista es la
--  MISMA (con 3 columnas nuevas, ver abajo); lo que cambió es que el cliente
--  (`lib/tarifario/resumen.ts`) ya NO expande — transporta el DTO de resumen
--  tal cual.
--
--  ⚠️ Por qué esta vista SOLO colapsa la dimensión ACOMODACIÓN (no también
--  categoría/régimen, que hubiera acercado más la magnitud a "hoteles/
--  salidas"): `lib/tarifario/vigencia.ts` (`filtrarTarifarioVencidas`)
--  verifica vigencia de COMPRA por (hotel, categoría, régimen) — un mismo
--  hotel puede tener una categoría vigente y otra vencida al mismo tiempo. Esa
--  verificación se hace re-liquidando en TypeScript (`liquidarHotelNoches`/
--  `liquidarHotelMasBarato`, lib/calc/paquetes.ts) contra `hotel_temporadas`/
--  `tarifa_hotel` — lógica que NO está portada a SQL. Colapsar categoría/
--  régimen en esta vista habría hecho IMPOSIBLE aplicar esa verificación con
--  la misma precisión (no se podría saber, de un "desde" ya mezclado, si vino
--  de una categoría que justo venció) — el precio publicado dejaría de ser
--  exacto. Se prefirió una reducción más MODESTA pero VERIFICADAMENTE
--  correcta: se colapsa únicamente ACOMODACIÓN (sencilla/doble/triple/
--  multiple/niño1/niño2/infante → un solo grupo de columnas), que es la
--  dimensión de mayor cardinalidad (hasta 7×) y la única que el "desde" de
--  hoy (`minRoomPvp()`) ya ignora por completo. `filtrarTarifarioVencidas` se
--  REUSA sin modificar sobre estas filas resumidas (siguen trayendo hotel_id/
--  categoria/regimen/fecha_ida/noches — exactamente lo que esa función ya
--  espera). Colapsar también categoría/régimen queda documentado como
--  siguiente paso posible, condicionado a portar la vigencia a SQL — no se
--  intenta en esta migración.
--
--  Resultado: de ~17.197 filas a una fila por combinación (módulo, paquete,
--  bloqueo/salida, hotel, servicio, categoría, régimen) — sigue siendo un
--  recorte real (elimina la multiplicación por acomodación, hasta 7×, y las
--  columnas que solo importan al detalle: descripción/recargo/escalas), pero
--  no llega a la magnitud de "hoteles" a secas. La matriz de acomodación
--  completa (con descripción/recargo/escalas) se sigue leyendo de
--  `tarifario_resultado` directamente, solo BAJO DEMANDA (al abrir un hotel,
--  elegir una salida en Vista tabla, o cambiar a la pestaña Servicios) — ver
--  lib/tarifario/resumen.ts y app/tarifario/detalle-actions.ts.
--
--  Columnas agregadas (todas MIN(precio_pvp), nunca costos netos — mismo
--  contrato de "no exponer costo neto" que ya tenía `tarifario_resultado`):
--    · precio_sencilla/doble/triple/multiple → precio de esa acomodación
--      para este (hotel, categoría, régimen, combo) exacto. Excluye
--      precio_pvp <= 0 (una habitación en $0 no es "gratis", es "no
--      configurada" — distinto criterio a niño/infante, ver abajo).
--    · precio_nino/precio_nino2/precio_infante → NUEVAS en esta versión.
--      Sin el filtro `precio_pvp > 0`: a diferencia de una habitación, $0 en
--      niño/niño2/infante SÍ es un precio válido y publicado ("gratis" —
--      confirmado en la sección "Motor de cálculo" del CLAUDE.md: niño 1/2 y
--      la tarifa de infante de la migración 122 aceptan $0 explícitamente).
--      `min()` sin ese filtro deja NULL cuando no existe ninguna fila de esa
--      acomodación (no se ofrece) y dev vuelve el precio real (incluido 0)
--      cuando sí existe — el mismo contrato que ya usa el detalle completo
--      (`tarifario_resultado`) y que consume `TablaHorizontal` en
--      TarifarioPublic.tsx (`esRoom` / `mostrar = v != null && (!esRoom || v
--      > 0)`).
--    · desde_adulto → MIN de sencilla/doble/triple/multiple ÚNICAMENTE
--      (excluye nino/nino2/infante — igual que `ACOM_ROOMS` en
--      lib/acomodaciones.ts). El precio "desde" NUNCA debe incluir la tarifa
--      de infante/niño (casi siempre la más baja) como si fuera el precio de
--      adulto.
--    · desde_general → MIN(precio_pvp) sin filtrar acomodación, para
--      `servicios` (que no usa acomodación) y para los add-on de cada paquete.
--
--  RLS: `security_invoker = true` — la vista corre con los privilegios y las
--  policies de QUIEN CONSULTA, nunca del dueño de la vista (recomendación
--  estándar de Supabase para toda vista nueva). Como `tarifario_resultado`
--  ya tiene "for select using (true)" (lectura pública, sin tenant — el
--  tarifario es de mayorista únicamente, no existe separación por tenant en
--  esta tabla), la vista queda con la MISMA exposición exacta: pública,
--  authenticated y anon por igual, sin cambiar ni ampliar ni restringir el
--  acceso actual.
--
--  ⚠️ Endurecimiento de esta migración (revisión posterior):
--    · Explícita `begin;`/`commit;` — mismo patrón ya usado en 153/154/159/
--      160 de este repo — para que un fallo a mitad de camino (ej. el abort
--      de colisión de abajo) revierta TODO, nunca deja una vista a medio
--      crear ni un `grant` aplicado sin su `comment`.
--    · Ya NO usa `drop view if exists` al inicio: eso pisaría en silencio
--      cualquier relación previa con el mismo nombre (una tabla, una vista
--      distinta, algo creado a mano) sin que nadie se entere. En su lugar,
--      aborta con `raise exception` si `to_regclass('public.tarifario_
--      resumen')` ya resuelve a CUALQUIER relación (vista, tabla, lo que
--      sea) — mismo idiom de preflight ya usado en la migración 160 de este
--      repo. Falla cerrado: si algo con ese nombre ya existe, la migración
--      entera no aplica nada y hay que revisar a mano antes de reintentar.
--    · `revoke all ... from public, anon, authenticated` explícito ANTES del
--      `grant select` — belt-and-suspenders: aunque Postgres no otorga
--      privilegios por defecto sobre una vista nueva a `anon`/
--      `authenticated` (no son el owner ni hay `default privileges`
--      configurados así en este proyecto), este patrón dice de forma
--      explícita, sin depender de configuración implícita, exactamente qué
--      privilegios quedan al final: NINGUNO salvo el `select` que se otorga
--      a continuación.
--  Pruebas negativas de colisión/atomicidad (no se ejecutan solas, se corren
--  a mano contra una base de verificación local — nunca contra producción):
--  supabase/scripts/pruebas/test_162_atomicidad_colision.sql.
-- ───────────────────────────────────────────────────────────────────────────

begin;

do $$
begin
  if to_regclass('public.tarifario_resumen') is not null then
    raise exception
      'La relación public.tarifario_resumen ya existe (tabla, vista u otro objeto) — abortando la migración 162 para no pisarla. Revisar manualmente qué es antes de reintentar.';
  end if;
end $$;

create view public.tarifario_resumen
  with (security_invoker = true)
as
  select
    r.modulo,
    r.paquete_id,
    r.paquete_nombre,
    r.paquete_activo,
    r.bloqueo_id,
    r.bloqueo_label,
    r.empaquetado_id,
    r.salida_id,
    r.hotel_id,
    r.hotel_nombre,
    r.servicio_id,
    r.servicio_nombre,
    r.destino_id,
    r.destino_nombre,
    r.categoria,
    r.regimen,
    r.fecha_ida,
    r.fecha_regreso,
    r.noches,
    r.moneda,
    min(r.precio_pvp) filter (where r.acomodacion = 'sencilla' and r.precio_pvp > 0) as precio_sencilla,
    min(r.precio_pvp) filter (where r.acomodacion = 'doble'    and r.precio_pvp > 0) as precio_doble,
    min(r.precio_pvp) filter (where r.acomodacion = 'triple'   and r.precio_pvp > 0) as precio_triple,
    min(r.precio_pvp) filter (where r.acomodacion = 'multiple' and r.precio_pvp > 0) as precio_multiple,
    -- Chd1/Chd2/infante: SIN el filtro `precio_pvp > 0` — $0 es un precio
    -- válido ("gratis"), no "no configurado". Ver nota larga arriba.
    min(r.precio_pvp) filter (where r.acomodacion = 'nino')    as precio_nino,
    min(r.precio_pvp) filter (where r.acomodacion = 'nino2')   as precio_nino2,
    min(r.precio_pvp) filter (where r.acomodacion = 'infante') as precio_infante,
    min(r.precio_pvp) filter (
      where r.acomodacion in ('sencilla', 'doble', 'triple', 'multiple') and r.precio_pvp > 0
    ) as desde_adulto,
    min(r.precio_pvp) filter (where r.precio_pvp > 0) as desde_general,
    -- Solo para `servicios`: descripción/recargo/tipo de tarifa son iguales en
    -- todas las filas del mismo servicio (no varían por acomodación, y
    -- `servicios` tampoco usa categoría/régimen) — un `min()` arbitrario entre
    -- iguales no cambia el valor.
    min(r.descripcion) as descripcion,
    min(r.recargo_individual) as recargo_individual,
    min(r.tipo_tarifa) as tipo_tarifa
  from public.tarifario_resultado r
  where r.paquete_activo = true
  group by
    r.modulo, r.paquete_id, r.paquete_nombre, r.paquete_activo, r.bloqueo_id, r.bloqueo_label,
    r.empaquetado_id, r.salida_id, r.hotel_id, r.hotel_nombre, r.servicio_id, r.servicio_nombre,
    r.destino_id, r.destino_nombre, r.categoria, r.regimen, r.fecha_ida, r.fecha_regreso, r.noches, r.moneda;

comment on view public.tarifario_resumen is
  'Resumen agregado de tarifario_resultado (colapsa la dimensión acomodación; una fila por módulo/paquete/bloqueo/hotel/servicio/categoría/régimen). Carga inicial liviana del tarifario en dos niveles — la matriz de acomodación completa (con descripción/recargo/escalas) sigue viviendo en tarifario_resultado, consultada bajo demanda. Incluye precio_nino/precio_nino2/precio_infante (nunca filtrados por precio_pvp>0: 0 es un precio válido para menores). security_invoker: hereda exactamente el mismo acceso público que ya tenía tarifario_resultado.';

-- Explícito: sin privilegios previos de ningún tipo antes del grant select de
-- abajo. Ver nota de endurecimiento arriba.
revoke all on public.tarifario_resumen from public, anon, authenticated;

-- `grant select` EXPLÍCITO a `anon` Y `authenticated` — a diferencia de
-- `ventas_basica`/`abonos_resumen` (migraciones 144/148, que solo conceden a
-- `authenticated` porque son vistas internas), esta vista sirve el tarifario
-- PÚBLICO (`/tarifario`, sin login): necesita el mismo alcance que ya tiene
-- `tarifario_resultado` hoy (su policy es "for select using (true)", sin
-- distinguir anon de authenticated). `security_invoker` decide CON QUÉ
-- policies se evalúa la vista (las de quien consulta, nunca las del dueño);
-- el `grant` decide QUIÉN puede consultarla en absoluto — hacen falta los dos.
grant select on public.tarifario_resumen to anon, authenticated;

commit;
