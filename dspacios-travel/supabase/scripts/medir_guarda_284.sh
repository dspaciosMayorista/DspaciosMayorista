#!/bin/bash
# MEDICIÓN del costo de la guarda de identidad (284): MISMAS filas, MISMA base, con y sin el trigger, alternando el orden, varias repeticiones.
# Uso: bash supabase/scripts/medir_guarda_284.sh <contenedor> [base] [repeticiones=7] [filas=2000]
# Cada medición va dentro de una transacción que se REVIERTE (no deja datos). "Sin guarda" = ALTER TABLE … DISABLE TRIGGER trg_contrato_guarda dentro de la misma transacción.
# Es una medición LOCAL en un Postgres desechable: sirve para comparar guarda/sin guarda sobre los mismos datos, no como cifra de producción.
CT="${1:?uso: medir_guarda_284.sh <contenedor> [base] [repeticiones] [filas]}"; DB="${2:-postgres}"; REP="${3:-7}"; N="${4:-2000}"
export MSYS_NO_PATHCONV=1
S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1 -d "$DB" "$@" 2>&1; }
B=$(( $(date +%s) % 7000 + 1000 ))
# contrato de siempre (L) y contrato nacido de reuso (R), con la identidad correcta en la cabecera para R
S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('DTM-8$B','mayorista','Ana','pendiente','X')" >/dev/null
UA=$(S -c "select contrato_uid from public.ventas where numero_contrato='DTM-8$B'"); S -c "delete from public.ventas where numero_contrato='DTM-8$B'" >/dev/null
S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,nacio_de_reuso) values ('DTM-8$B','mayorista','Carlos','pendiente','Y',true),('DTM-7$B','mayorista','Legado','pendiente','Y',false)" >/dev/null
UR=$(S -c "select contrato_uid from public.ventas where numero_contrato='DTM-8$B'"); UL=$(S -c "select contrato_uid from public.ventas where numero_contrato='DTM-7$B'")
S -c "insert into public.bloqueos_vuelo(record,destino_id,cupos_total) values ('M$B',1,$N)" >/dev/null
BL=$(S -c "select id from public.bloqueos_vuelo where record='M$B'")

# medir <operación> <con|sin> <cabecera-json|-> <sql de la operación>  → ms
medir() {
  local pre="" off=""; [ "$3" != "-" ] && pre="select set_config('request.headers', '{\"x-contratos\": $3}', true);"
  [ "$2" = sin ] && off="alter table public.contrato_pasajeros disable trigger trg_contrato_guarda; alter table public.sillas disable trigger trg_contrato_guarda;"
  S <<SQL | tail -1
begin;
$off
$pre
select clock_timestamp() as t0 \gset
$4
select round((extract(epoch from clock_timestamp() - :'t0'::timestamptz) * 1000)::numeric, 1);
rollback;
SQL
}
mediana() { sort -n | awk '{a[NR]=$1} END{ if (NR%2) print a[(NR+1)/2]; else print (a[NR/2]+a[NR/2+1])/2 }'; }
fila() { # etiqueta, cabecera, sql
  local con=() sin=()
  for i in $(seq 1 "$REP"); do
    if [ $((i % 2)) -eq 1 ]; then con+=("$(medir x con "$2" "$3")"); sin+=("$(medir x sin "$2" "$3")"); else sin+=("$(medir x sin "$2" "$3")"); con+=("$(medir x con "$2" "$3")"); fi
  done
  local mc ms; mc=$(printf '%s\n' "${con[@]}" | mediana); ms=$(printf '%s\n' "${sin[@]}" | mediana)
  printf '%-62s con guarda %8s ms | sin guarda %8s ms | diferencia %8s ms (%s filas, mediana de %s)\n' "$1" "$mc" "$ms" "$(awk -v a="$mc" -v b="$ms" "BEGIN{printf \"%.1f\", a-b}")" "$N" "$REP"
}
echo "Medición local (misma base y mismas filas; la operación se revierte)."
fila "INSERT de $N sillas libres (sin contrato)" - "insert into public.sillas(bloqueo_id,numero_silla,estado) select $BL, g, 'disponible' from generate_series(1,$N) g;"
fila "UPDATE de $N sillas libres (updated_at)" - "insert into public.sillas(bloqueo_id,numero_silla,estado) select $BL, g, 'disponible' from generate_series(1,$N) g; update public.sillas set updated_at = now() where bloqueo_id = $BL;"
fila "INSERT de $N pasajeros en un contrato DE SIEMPRE, sin identidad" - "insert into public.contrato_pasajeros(numero_contrato,nombre) select 'DTM-7$B','p' || g from generate_series(1,$N) g;"
fila "INSERT de $N pasajeros en un contrato DE SIEMPRE, identidad declarada" "{\"DTM-7$B\": \"$UL\"}" "insert into public.contrato_pasajeros(numero_contrato,nombre) select 'DTM-7$B','p' || g from generate_series(1,$N) g;"
fila "INSERT de $N pasajeros en un contrato de REUSO, identidad correcta" "{\"DTM-8$B\": \"$UR\"}" "insert into public.contrato_pasajeros(numero_contrato,nombre) select 'DTM-8$B','p' || g from generate_series(1,$N) g;"
S -c "begin; set local session_replication_role=replica; delete from public.bloqueos_vuelo where record='M$B'; delete from public.ventas where numero_contrato in ('DTM-8$B','DTM-7$B'); commit;" >/dev/null
