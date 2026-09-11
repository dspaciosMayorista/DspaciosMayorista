-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 174 (`hoteles.modelo_tarifario`).
-- SOLO LECTURA. Correr DESPUÉS de aplicar la 174.
--
-- Verifica lo que la migración PROMETE:
--   A) la columna existe: text, NOT NULL, default 'persona';
--   B) el CHECK limita exactamente a ('persona', 'unidad');
--   C) TODOS los hoteles existentes quedaron en 'persona' (backfill del
--      default, sin excepción);
--   D) la migración NO tocó `tarifa_hotel` ni `hotel_tarifas_unidad` — mismos
--      conteos que en el preflight;
--   E) el comentario de columna documenta la decisión comercial (un solo
--      editor activo) y que no participa en ninguna cotización.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f postcheck_174_hotel_modelo_tarifario.sql
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== A) columna: tipo, nullability y default ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'hoteles' and column_name = 'modelo_tarifario';
\echo 'esperado: modelo_tarifario | text | NO | ''persona''::text'

\echo '=== B) CHECK limitado exactamente a persona | unidad ==='
select con.conname, pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
where con.conrelid = 'public.hoteles'::regclass and con.conname = 'hoteles_modelo_tarifario_check';
\echo 'esperado: CHECK ((modelo_tarifario = ANY (ARRAY[''persona''::text, ''unidad''::text])))'

\echo '=== C) todos los hoteles existentes quedaron en persona ==='
select modelo_tarifario, count(*) as hoteles
from public.hoteles
group by modelo_tarifario
order by modelo_tarifario;
\echo 'esperado: una sola fila -> persona | <hoteles_total del preflight> (ningun hotel en unidad todavia)'

\echo '=== D) ninguna tabla de tarifas existente cambio de conteo ==='
-- Mismo motivo que en el preflight: una referencia estática a
-- `hotel_tarifas_unidad` dentro de un `case` falla al PARSEAR si la tabla no
-- existe, aunque la rama sea inalcanzable — se resuelve con SQL dinámico.
drop table if exists pg_temp._postcheck_174_ctx;
create temp table _postcheck_174_ctx (hoteles_total bigint, tarifa_hotel_total bigint, hotel_tarifas_unidad_total bigint);
do $$
declare
  v_hotel_tarifas_unidad_total bigint := -1;
begin
  if to_regclass('public.hotel_tarifas_unidad') is not null then
    execute 'select count(*) from public.hotel_tarifas_unidad' into v_hotel_tarifas_unidad_total;
  end if;
  insert into _postcheck_174_ctx
    select (select count(*) from public.hoteles), (select count(*) from public.tarifa_hotel), v_hotel_tarifas_unidad_total;
end $$;
select * from _postcheck_174_ctx;
\echo 'esperado: los tres EXACTAMENTE iguales a los del preflight -- la 174 no inserta, actualiza ni borra tarifas'

\echo '=== E) el comentario documenta la decision comercial ==='
select
  coalesce(
    col_description('public.hoteles'::regclass,
      (select ordinal_position from information_schema.columns
        where table_schema = 'public' and table_name = 'hoteles' and column_name = 'modelo_tarifario')),
    ''
  ) ilike '%un solo editor%activo%' as documenta_un_solo_editor,
  coalesce(
    col_description('public.hoteles'::regclass,
      (select ordinal_position from information_schema.columns
        where table_schema = 'public' and table_name = 'hoteles' and column_name = 'modelo_tarifario')),
    ''
  ) ilike '%no%participa%en ninguna cotizaci%n%' as documenta_sin_integracion;
\echo 'esperado: las dos en t'
