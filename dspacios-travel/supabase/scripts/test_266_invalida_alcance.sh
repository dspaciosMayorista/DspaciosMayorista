#!/bin/sh
# 266: orden real de la base compartida (255→256→258→259→262→263→264→265→266). Prueba SIN la 266 (debe mostrar el hueco) y CON ella (cero fallas), y una carrera de
# escrituras concurrentes (la RPC de 4 rangos contra otra RPC y contra una publicación) para descartar bloqueos mutuos.
# SOLO Docker local y desechable. Uso (desde dspacios-travel/):  sh supabase/scripts/test_266_invalida_alcance.sh <base_nueva ^t266_[a-z0-9_]{1,40}$> [contenedor] [plantilla 001-254]
set -eu
DB="${1:-}"; CT="${2:-pg255local}"; PLANTILLA="${3:-plantilla255}"; export MSYS_NO_PATHCONV=1
printf '%s' "$DB" | grep -Eq '^t266_[a-z0-9_]{1,40}$' || { echo "Base inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"; M="$APP/supabase/migrations"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
trap '[ "${KEEP:-}" = 1 ] || $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1' EXIT
$PS -d postgres -c "create database $DB template $PLANTILLA"
for n in 255 256 258 259 262 263 264 265; do $PS -d "$DB" < "$(ls $M/20260601000${n}_*.sql)" >/dev/null 2>&1 || { echo "falló la migración $n" >&2; exit 1; }; done
$PS -d "$DB" < "$AQUI/test_259_semilla.sql" >/dev/null
corre() { $PS -d "$DB" < "$AQUI/test_266_invalida_alcance.sql" 2>&1 | sed 's/^NOTICE:  //' | grep -E "^ *(OK|FALLA)|RESUMEN|MEDICION|ERROR" || true; }
echo "== PREFLIGHT 266 =="; $PS -d "$DB" < "$AQUI/preflight_266_tarifario_invalida_por_alcance.sql" | cut -d'|' -f1,5
echo "== ANTES de la 266 (se espera ver el hueco: FALLAS en alcance/franja/clasificación) =="; corre | grep -E "FALLA|RESUMEN"
echo "== APLICA 266 (dos veces: idempotente) =="
$PS -d "$DB" < "$M/20260601000266_tarifario_invalida_por_alcance.sql" >/dev/null 2>&1; $PS -d "$DB" < "$M/20260601000266_tarifario_invalida_por_alcance.sql" >/dev/null 2>&1
echo "== POSTCHECK 266 =="; $PS -d "$DB" < "$AQUI/postcheck_266_tarifario_invalida_por_alcance.sql" | cut -d'|' -f2,5
echo "== DESPUÉS de la 266 (cero fallas) =="; corre
echo "== CARRERA: dos sesiones guardando 4 rangos en dos vigencias que comparten paquetes + una publicación del paquete 73 (30 vueltas c/u) =="
$PS -d "$DB" <<'SQL' >/dev/null
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
insert into public.servicios_adicionales (id, nombre, tipo_receptivo) overriding system value values (114, 'Traslado 2', 'traslado') on conflict do nothing;
delete from public.servicio_temporadas where servicio_id = 114;
insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) values (114, 'ALTA', '2030-01-01', '2030-03-31');
delete from public.armado_servicios where servicio_id in (112, 114);
insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) select g, s, 'persona', true from generate_series(1, 60) g, (values (112), (114)) v(s);
SQL
VIG_A="$($PS -d "$DB" -c "select id from public.servicio_temporadas where servicio_id = 112 and nombre = 'ALTA'")"; VIG_B="$($PS -d "$DB" -c "select id from public.servicio_temporadas where servicio_id = 114 and nombre = 'ALTA'")"
lazo() { # $1 vigencia
  $PS -d "$DB" <<SQL 2>&1 | grep -iE "deadlock|ERROR" | head -3 || true
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do \$\$ declare i int; begin for i in 1..30 loop
  execute 'set local role authenticated';
  perform public.reemplazar_precios_alcance($1, jsonb_build_array(
    jsonb_build_object('alcance','trayecto','pax_desde',1,'pax_hasta',2,'precio',60000+i), jsonb_build_object('alcance','trayecto','pax_desde',3,'pax_hasta',4,'precio',55000),
    jsonb_build_object('alcance','trayecto','pax_desde',5,'pax_hasta',8,'precio',50000), jsonb_build_object('alcance','trayecto','pax_desde',9,'pax_hasta',15,'precio',45000)));
  execute 'reset role';
  commit;
end loop; end \$\$;
SQL
}
pub() { $PS -d "$DB" <<'SQL' 2>&1 | grep -iE "deadlock|ERROR" | head -3 || true
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ declare i int; g bigint; r bigint; begin for i in 1..30 loop
  select generacion, revision_capturada into g, r from public.iniciar_generacion_tarifario(73);
  perform public.publicar_tarifario_resultado(73, g, r, 'COP', public.bench_filas(60, 73));
  commit;
end loop; end $$;
SQL
}
( lazo "$VIG_A" > .c1.$$ ) & ( lazo "$VIG_B" > .c2.$$ ) & ( pub > .c3.$$ ) & wait
echo "errores/deadlocks: sesión A=$(cat .c1.$$) · sesión B=$(cat .c2.$$) · publicación=$(cat .c3.$$)"; rm -f .c1.$$ .c2.$$ .c3.$$
