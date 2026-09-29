#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
# Prueba de la migración 191 de punta a punta, en PostgreSQL LOCAL desechable.
# NO correr contra Supabase.
#
#   supabase/scripts/pruebas/test_191_migracion.sh [base_190] [puerto]
#
# `base_190` debe tener aplicadas las migraciones 1→190 (local-desde-cero.sh
# con hasta=190) y datos sembrados por la vía legacy. Se usa como PLANTILLA:
# cada caso trabaja sobre una copia, así que la base original no cambia.
#
# Nota del andamio: local-desde-cero.sh concede ALL (incluido TRUNCATE) sobre
# todas las tablas al final. En producción la 189 revocó y verificó el TRUNCATE
# de proveedores_datos_sensibles; aquí se revoca otra vez para reproducir eso.
#
# Casos:
#   1. Paridad rota (dato distinto en la tabla sensible) → 191 aborta sin cambios.
#   2. Proveedor sin fila sensible → 191 aborta sin cambios.
#   3. Una vista que depende de una columna legacy → 191 aborta (sin CASCADE).
#   4. Otra sesión escribiendo el catálogo → 191 no espera más de lock_timeout.
#   5. Aplicación limpia + batería test_191_proveedores_rls_rpc.sql.
#   6. Rollback → columnas repobladas con paridad + prueba funcional estilo 190.
#   7. Reaplicar 191 tras el rollback + batería otra vez.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${1:-base190}"
PUERTO="${2:-5432}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$AQUI/../../migrations/20260601000191_proveedores_retirar_columnas_legacy.sql"
ROLLBACK="$AQUI/../rollback_191_proveedores_retirar_legacy.sql"
BATERIA="$AQUI/test_191_proveedores_rls_rpc.sql"

psql_() { psql -p "$PUERTO" -X -q -v ON_ERROR_STOP=1 "$@"; }
copia() {
  psql_ -d postgres -c "drop database if exists $1" -c "create database $1 template $BASE" >/dev/null 2>&1
  psql_ -d "$1" -c "revoke truncate on public.proveedores_datos_sensibles from anon, authenticated"
}
columnas_legacy() {
  psql_ -d "$1" -At -c "select count(*) from information_schema.columns
    where table_schema='public' and table_name='proveedores'
      and column_name in ('nit','razon_social','datos_pago','banco','tipo_cuenta',
                          'numero_cuenta','politica_reservas','voucher_contacto')"
}
debe_abortar() {  # $1 base, $2 texto esperado en el error
  local salida
  if salida=$(psql_ -d "$1" -f "$MIG" 2>&1); then
    echo "FALLO: la 191 se aplicó y debía abortar ($2)"; exit 1
  fi
  echo "$salida" | grep -q "$2" || { echo "FALLO: error inesperado:"; echo "$salida"; exit 1; }
  [ "$(columnas_legacy "$1")" = "8" ] || { echo "FALLO: quedaron cambios parciales"; exit 1; }
}

echo "== 1. Paridad rota"
copia t191_caso1
psql_ -d t191_caso1 -c "update public.proveedores_datos_sensibles set banco = 'DISTINTO'
  where proveedor_id = (select min(id) from public.proveedores)"
debe_abortar t191_caso1 "paridad incompleta (sin fila sensible: 0, con valores distintos: 1)"
echo "   OK: abortó y no cambió nada"

echo "== 2. Proveedor sin fila sensible"
copia t191_caso2
psql_ -d t191_caso2 -c "delete from public.proveedores_datos_sensibles
  where proveedor_id = (select min(id) from public.proveedores)"
debe_abortar t191_caso2 "paridad incompleta (sin fila sensible: 1"
echo "   OK: abortó y no cambió nada"

echo "== 3. Dependencia no prevista"
copia t191_caso3
psql_ -d t191_caso3 -c "create view public.t191_vista_nit as select id, nit from public.proveedores"
debe_abortar t191_caso3 "depend"
psql_ -d t191_caso3 -At -c "select 1 from public.t191_vista_nit limit 1" >/dev/null
echo "   OK: abortó sin CASCADE y la vista sigue viva"

echo "== 4. Lock ocupado"
copia t191_caso4
psql_ -d t191_caso4 -c "begin; lock table public.proveedores in row exclusive mode; select pg_sleep(15); commit;" >/dev/null 2>&1 &
BLOQUEO=$!
sleep 2
inicio=$(date +%s)
debe_abortar t191_caso4 "lock timeout"
duracion=$(( $(date +%s) - inicio ))
wait "$BLOQUEO" || true
[ "$duracion" -le 15 ] || { echo "FALLO: esperó ${duracion}s"; exit 1; }
echo "   OK: abortó por lock_timeout en ${duracion}s"

echo "== 5. Aplicación limpia + batería"
copia t191_ok
antes=$(psql_ -d t191_ok -At -c "select md5(string_agg(row(s.*)::text, '|' order by proveedor_id, tenant))
  from public.proveedores_datos_sensibles s")
psql_ -d t191_ok -f "$MIG" >/dev/null
[ "$(columnas_legacy t191_ok)" = "0" ] || { echo "FALLO: quedaron columnas"; exit 1; }
despues=$(psql_ -d t191_ok -At -c "select md5(string_agg(row(s.*)::text, '|' order by proveedor_id, tenant))
  from public.proveedores_datos_sensibles s")
[ "$antes" = "$despues" ] || { echo "FALLO: la tabla sensible cambió al aplicar 191"; exit 1; }
psql_ -d t191_ok -f "$BATERIA" | grep -q "TODAS LAS ASERCIONES PASARON"
echo "   OK: 191 aplicada, tabla sensible idéntica, batería en verde"

echo "== 6. Rollback"
psql_ -d t191_ok -f "$ROLLBACK" >/dev/null
[ "$(columnas_legacy t191_ok)" = "8" ] || { echo "FALLO: el rollback no repuso las columnas"; exit 1; }
psql_ -d t191_ok -o /dev/null <<'SQL'
begin;
insert into auth.users (id, email) values ('b1910000-0000-0000-0000-0000000000aa', 't191.rb@t') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
values ('b1910000-0000-0000-0000-0000000000aa', 't191.rb@t', 'T191 RB', 'superadmin', true, 'mayorista')
on conflict (id) do update set rol = 'superadmin', activo = true, tenant = 'mayorista';
select set_config('request.jwt.claims', '{"sub":"b1910000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_id bigint;
begin
  v_id := public.guardar_proveedor('{"tipo":"hotelero","nombre":"T191 RB","nit":"NIT_RB","banco":"BANCO_RB"}'::jsonb);
  if not exists (select 1 from public.proveedores p
      join public.proveedores_datos_sensibles s on s.proveedor_id = p.id and s.tenant = 'mayorista'
      where p.id = v_id and p.nit = 'NIT_RB' and s.nit = 'NIT_RB' and s.banco = 'BANCO_RB') then
    raise exception 'rollback: la RPC de la 190 no sincroniza';
  end if;
  -- Sin un datos_pago real sembrado la comparación siguiente pasaría NULL = NULL.
  if not exists (select 1 from public.proveedores where datos_pago is not null) then
    raise exception 'rollback: ningun datos_pago repuesto (sembrar datos por la via legacy)';
  end if;
  if (select datos_pago from public.proveedores p where p.nombre = 'LEGACY UNO') is distinct from
     (select s.datos_pago from public.proveedores_datos_sensibles s
       join public.proveedores p on p.id = s.proveedor_id where p.nombre = 'LEGACY UNO') then
    raise exception 'rollback: datos_pago no se repuso';
  end if;
end $$;
rollback;
SQL
echo "   OK: columnas repuestas con paridad, RPC y sincronización de la 190 funcionando"

echo "== 7. Reaplicar tras el rollback"
psql_ -d t191_ok -f "$MIG" >/dev/null
psql_ -d t191_ok -f "$BATERIA" | grep -q "TODAS LAS ASERCIONES PASARON"
echo "   OK: 191 reaplicada y batería en verde"

for b in t191_caso1 t191_caso2 t191_caso3 t191_caso4 t191_ok; do
  psql_ -d postgres -c "drop database if exists $b" >/dev/null 2>&1
done
echo "== test_191_migracion: TODO OK"
