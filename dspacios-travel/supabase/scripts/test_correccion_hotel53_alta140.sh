#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────
# PRUEBA de la corrección puntual hotel 53 / ALTA id 140 (preflight, corrección, postcheck, rollback).
# SOLO en un contenedor Postgres LOCAL DESECHABLE con datos SINTÉTICOS (nunca una base real). Requiere Docker y postgres:17.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_correccion_hotel53_alta140.sh
# Comprueba: veredicto del preflight; que la corrección cambia SOLO fecha_inicio y ese elemento de rangos; que las demás filas y
# columnas quedan idénticas (huella md5); que la guardia aborta si la fila no coincide o si se repite; el postcheck; y la reversión exacta.
# ─────────────────────────────────────────────────────────────────────────
set -eu
CT="pg_corr53_$$"
export MSYS_NO_PATHCONV=1
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
trap 'docker rm -f "$CT" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$CT" -e POSTGRES_PASSWORD=x postgres:17 >/dev/null
n=0; until docker exec "$CT" psql -U postgres -qc "select 1" >/dev/null 2>&1; do n=$((n + 1)); [ $n -ge 30 ] && exit 2; sleep 1; done
docker cp supabase/scripts/preflight_correccion_hotel53_alta140_fecha_inicio.sql "$CT":/tmp/preflight.sql >/dev/null
docker cp supabase/scripts/postcheck_correccion_hotel53_alta140_fecha_inicio.sql "$CT":/tmp/postcheck.sql >/dev/null
docker cp supabase/scripts/correccion_hotel53_alta140_fecha_inicio.sql "$CT":/tmp/correccion.sql >/dev/null
P="docker exec -i $CT psql -U postgres -X -q -v ON_ERROR_STOP=1"
Q="docker exec -i $CT psql -U postgres -X -q -At -F |"

$P -c "
create table public.hotel_temporadas (id bigint primary key, hotel_id bigint, nombre text not null, fecha_inicio date, fecha_fin date, prioridad int, tipo text default 'tarifa', rangos jsonb not null default '[]', blackouts jsonb not null default '[]', compra_inicio date, compra_fin date);
create table public.hotel_temporadas_historial (id bigserial primary key, temporada_id bigint, operacion text, datos jsonb);
create function public.fn_hist() returns trigger language plpgsql as \$\$ begin insert into public.hotel_temporadas_historial(temporada_id, operacion, datos) values (old.id, tg_op, to_jsonb(old)); return new; end \$\$;
create trigger trg_hist after update on public.hotel_temporadas for each row execute function public.fn_hist();
insert into public.hotel_temporadas(id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, rangos, blackouts, compra_inicio, compra_fin) values
 (140, 53, 'ALTA', '0206-12-24', '2027-01-03', 2, '[{\"fecha_inicio\":\"0206-12-24\",\"fecha_fin\":\"2027-01-03\",\"nota\":\"x\"}]', '[{\"fecha_inicio\":\"2026-12-30\",\"fecha_fin\":\"2026-12-31\"}]', '2026-07-24', '2027-04-30'),
 (141, 53, 'BAJA', '2026-11-01', '2027-03-01', 1, '[{\"fecha_inicio\":\"2026-11-01\",\"fecha_fin\":\"2027-03-01\"}]', '[]', null, null),
 (9, 9, 'MEDIA', '2026-06-26', '2026-06-29', 1, '[{\"fecha_inicio\":\"2026-06-26\",\"fecha_fin\":\"62026-06-29\"}]', '[]', null, null);"
huella_otras() { $Q -c "select md5(string_agg(to_jsonb(t)::text, ',' order by id)) from public.hotel_temporadas t where id <> 140"; }
huella_140_sin() { $Q -c "select md5((to_jsonb(t) - 'fecha_inicio' - 'rangos')::text) from public.hotel_temporadas t where id = 140"; }
veredicto() { $Q -f "/tmp/$1.sql" | awk -F'|' '$1 == "99" { print $5 }'; }

echo "--- 1) preflight con la fila exactamente como se esperaba"
[ "$(veredicto preflight)" = "LISTO PARA CORREGIR" ] && ok "preflight: LISTO PARA CORREGIR" || fallo "preflight no dio LISTO"
[ "$($Q -f /tmp/preflight.sql | grep -c 'NO COINCIDE')" = 0 ] && ok "preflight: ningún control sin coincidir" || fallo "preflight con controles sin coincidir"

H_OTRAS="$(huella_otras)"; H_SIN="$(huella_140_sin)"
echo "--- 2) corrección"
$P -f /tmp/correccion.sql && ok "corrección aplicada" || fallo "la corrección falló"
[ "$($Q -c "select fecha_inicio from public.hotel_temporadas where id = 140")" = "2026-12-24" ] && ok "fecha_inicio = 2026-12-24" || fallo "fecha_inicio no quedó en 2026-12-24"
[ "$($Q -c "select rangos->0->>'fecha_inicio' || '>' || (rangos->0->>'fecha_fin') || '>' || (rangos->0->>'nota') from public.hotel_temporadas where id = 140")" = "2026-12-24>2027-01-03>x" ] && ok "el elemento de rangos cambió solo en fecha_inicio (conserva fin y otras claves)" || fallo "el elemento de rangos no quedó como se esperaba"
[ "$(huella_140_sin)" = "$H_SIN" ] && ok "las demás columnas de la fila 140 quedaron idénticas (prioridad, blackouts, compra, fecha_fin…)" || fallo "otra columna de la fila 140 cambió"
[ "$(huella_otras)" = "$H_OTRAS" ] && ok "ninguna otra fila cambió (incluido el hotel 9 con 62026-06-29)" || fallo "otra fila cambió"
[ "$($Q -c "select count(*) from public.hotel_temporadas_historial where temporada_id = 140 and datos->>'fecha_inicio' = '0206-12-24'")" = 1 ] && ok "la versión anterior quedó en el historial" || fallo "no quedó historial"

echo "--- 3) postcheck"
[ "$(veredicto postcheck)" = "CORRECCIÓN VERIFICADA" ] && ok "postcheck: CORRECCIÓN VERIFICADA" || fallo "postcheck no verificó"

echo "--- 4) guardia: repetir la corrección aborta y no cambia nada"
H_ANTES="$($Q -c "select md5(string_agg(to_jsonb(t)::text, ',' order by id)) from public.hotel_temporadas t")"
if $P -f /tmp/correccion.sql >/dev/null 2>&1; then fallo "la segunda ejecución NO abortó"; else ok "la segunda ejecución aborta"; fi
[ "$($Q -c "select md5(string_agg(to_jsonb(t)::text, ',' order by id)) from public.hotel_temporadas t")" = "$H_ANTES" ] && ok "no cambió nada tras el aborto" || fallo "cambió algo tras el aborto"

echo "--- 5) guardia: filas que NO coinciden con lo verificado"
for caso in \
  "update public.hotel_temporadas set fecha_fin = '2027-01-04', fecha_inicio = '0206-12-24', rangos = '[{\"fecha_inicio\":\"0206-12-24\",\"fecha_fin\":\"2027-01-04\"}]' where id = 140" \
  "update public.hotel_temporadas set fecha_inicio = '0206-12-24', rangos = '[{\"fecha_inicio\":\"0206-12-24\",\"fecha_fin\":\"2027-01-03\"},{\"fecha_inicio\":\"0206-12-24\",\"fecha_fin\":\"2027-01-03\"}]' where id = 140" \
  "update public.hotel_temporadas set fecha_inicio = '0206-12-25', rangos = '[{\"fecha_inicio\":\"0206-12-25\",\"fecha_fin\":\"2027-01-03\"}]' where id = 140" \
  "update public.hotel_temporadas set fecha_inicio = '0206-12-24', hotel_id = 54, rangos = '[{\"fecha_inicio\":\"0206-12-24\",\"fecha_fin\":\"2027-01-03\"}]' where id = 140"; do
  $P -c "update public.hotel_temporadas set fecha_inicio = '2026-12-24' where false" >/dev/null
  $P -c "$caso" >/dev/null
  H0="$($Q -c "select md5(string_agg(to_jsonb(t)::text, ',' order by id)) from public.hotel_temporadas t")"
  if $P -f /tmp/correccion.sql >/dev/null 2>&1; then fallo "aplicó sobre una fila que no coincide: $caso"; else ok "aborta con fila distinta"; fi
  [ "$($Q -c "select md5(string_agg(to_jsonb(t)::text, ',' order by id)) from public.hotel_temporadas t")" = "$H0" ] || fallo "cambió algo con fila distinta"
  [ "$(veredicto preflight)" = "NO APLICAR" ] && ok "el preflight dice NO APLICAR" || fallo "el preflight no dijo NO APLICAR"
done

echo "--- 6) rollback exacto (sobre la fila corregida)"
$P -c "update public.hotel_temporadas set hotel_id = 53, fecha_inicio = '2026-12-24', fecha_fin = '2027-01-03', rangos = '[{\"fecha_inicio\":\"2026-12-24\",\"fecha_fin\":\"2027-01-03\",\"nota\":\"x\"}]' where id = 140" >/dev/null
docker cp supabase/scripts/rollback_correccion_hotel53_alta140_fecha_inicio.sql "$CT":/tmp/rollback.sql >/dev/null
$P -f /tmp/rollback.sql && ok "rollback aplicado" || fallo "el rollback falló"
[ "$($Q -c "select fecha_inicio || '|' || (rangos->0->>'fecha_inicio') || '|' || (rangos->0->>'nota') from public.hotel_temporadas where id = 140")" = "0206-12-24|0206-12-24|x" ] && ok "volvió exactamente al valor anterior" || fallo "el rollback no dejó el valor anterior"

[ "$FALLOS" = 0 ] && echo "TODO OK" || { echo "$FALLOS FALLO(S)"; exit 1; }
