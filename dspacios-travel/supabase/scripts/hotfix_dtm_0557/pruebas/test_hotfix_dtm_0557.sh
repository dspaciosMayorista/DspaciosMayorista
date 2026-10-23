#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
# Prueba LOCAL del hotfix DTM-0057 → DTM-0557. NUNCA contra Supabase.
#
#   pruebas/test_hotfix_dtm_0557.sh [contenedor|local] [base_plantilla]
#   pruebas/test_hotfix_dtm_0557.sh --solo-finalizar DIR
#
# Requiere PostgreSQL con una base que tenga las migraciones aplicadas
# (supabase/scripts/pruebas/local-desde-cero.sh, con o sin `hasta`). Cada caso
# trabaja sobre una copia; la plantilla no cambia. El esquema (anterior o
# posterior a la 194) se detecta solo.
#
# `local` corre psql directo (dentro del contenedor, como usuario postgres):
# mucho más rápido cuando cada `docker exec` es lento. Como el contenedor no
# trae Python, las copias finalizadas se generan antes en el host con
# --solo-finalizar DIR y se pasan con FINALIZADOS=DIR.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail
export MSYS_NO_PATHCONV=1
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$AQUI/.."
# Python de Windows no entiende rutas /c/...: se las pasa convertidas.
py() { local a=(); for x in "$@"; do case "$x" in /*) a+=("$(cygpath -m "$x" 2>/dev/null || echo "$x")");; *) a+=("$x");; esac; done; python "${a[@]}"; }

# Copias finalizadas SOLO para la prueba (en producción se finalizan a mano
# con la salida del preflight). $2 = valor de las columnas de movimientos_silla
# en este esquema ('ausente' antes de la 194, 0 después); $3 = el contrario.
generar() {
  local out="$1" mv="$2" mo="$3" real ampl
  real="ref:asientos_contables.descripcion=4 ref:asiento_lineas.tercero=4 ref:movimientos_silla.numero_contrato=$mv ref:movimientos_silla.contrato_manual=$mv"
  ampl="$real fk:contrato_condiciones=2 fk:contrato_vuelo_control=1 fk:contrato_vuelo_control_cambios=1 fk:cotizaciones=1 ref:liquidacion_descuentos.numero_contrato=1 ref:conciliacion_sistema.numero_contrato=1"
  mkdir -p "$out"
  py "$AQUI/finalizar.py" "$DIR/02_hotfix_renumerar_dtm_0057_a_0557.sql" "$out/hotfix.sql" $real
  py "$AQUI/finalizar.py" "$DIR/04_rollback_dtm_0557_a_0057.sql"         "$out/rollback.sql" $real
  py "$AQUI/finalizar.py" "$DIR/02_hotfix_renumerar_dtm_0057_a_0557.sql" "$out/hotfix_ampl.sql" $ampl
  py "$AQUI/finalizar.py" "$DIR/02_hotfix_renumerar_dtm_0057_a_0557.sql" "$out/hotfix_fiscal.sql" $real fk:facturacion=1
  py "$AQUI/finalizar.py" "$DIR/02_hotfix_renumerar_dtm_0057_a_0557.sql" "$out/hotfix_mov_otro.sql" $real \
     ref:movimientos_silla.numero_contrato=$mo ref:movimientos_silla.contrato_manual=$mo
  py "$AQUI/finalizar.py" "$DIR/02_hotfix_renumerar_dtm_0057_a_0557.sql" "$out/hotfix_fk_ausente.sql" $real fk:cuotas=ausente
  py "$AQUI/finalizar.py" "$DIR/02_hotfix_renumerar_dtm_0057_a_0557.sql" "$out/borrador_hotfix.sql" $real fk:cuotas=null
  py "$AQUI/finalizar.py" "$DIR/04_rollback_dtm_0557_a_0057.sql"         "$out/borrador_rollback.sql" $real fk:cuotas=null
}
if [ "${1:-}" = "--solo-finalizar" ]; then
  generar "$2/ausente" ausente 0
  generar "$2/0" 0 ausente
  echo "finalizados en $2/{ausente,0}"; exit 0
fi

CONT="${1:-hotfix_dtm0557_pg}"
PLANTILLA="${2:-base200}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if [ "$CONT" = "local" ]; then
  P()  { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
  PA() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
else
  P()  { docker exec -i -u postgres "$CONT" psql -X -q -v ON_ERROR_STOP=1 "$@"; }
  PA() { docker exec -i -u postgres "$CONT" psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
fi
falla() { echo "FALLO: $*"; exit 1; }
nueva() {  # $1 base, $2.. semillas
  local b="$1"; shift
  P -d postgres -c "drop database if exists $b" -c "create database $b template $PLANTILLA" >/dev/null 2>&1
  for s in "$@"; do P -d "$b" -f - < "$AQUI/$s" >/dev/null; done
}
huella() { PA -d "$1" -f - < "$AQUI/huella.sql"; }
seq_()   { PA -d "$1" -c "select last_value||','||(case when is_called then 't' else 'f' end) from public.contrato_seq_mayorista"; }
debe_abortar() {  # $1 base, $2 archivo, $3 texto esperado — y sin ningún cambio
  local antes salida; antes=$(huella "$1")
  if salida=$(P -d "$1" -f - < "$2" 2>&1); then falla "debía abortar ($3)"; fi
  echo "$salida" | grep -q -- "$3" || { echo "$salida"; falla "error inesperado (esperaba: $3)"; }
  [ "$(huella "$1")" = "$antes" ] || falla "quedaron cambios parciales ($3)"
}
postcheck_ok() {
  local malos; malos=$(PA -d "$1" -F'|' -f - < "$DIR/03_postcheck_lectura.sql" | awk -F'|' '$5=="f"')
  [ -z "$malos" ] || { echo "$malos"; falla "postcheck con filas ok=false en $1"; }
}
lento() {  # $1 base, $2 segundos: el UPDATE de contrato_items del hotfix tarda
  P -d "$1" >/dev/null <<SQL
create function zz_lento() returns trigger language plpgsql as \$\$
begin perform pg_sleep($2); return new; end \$\$;
create trigger zz_lento before update on public.contrato_items for each row
  when (new.numero_contrato = 'DTM-0557') execute function zz_lento();
SQL
}
sin_lento() { P -d "$1" -c "drop trigger zz_lento on public.contrato_items; drop function zz_lento();" >/dev/null; }

# Antes de la migración 194, movimientos_silla no tiene numero_contrato ni
# contrato_manual: el inventario lo declara 'ausente' (no 0). OTRO es lo
# contrario, para probar que el motor distingue las dos cosas.
if [ "$(PA -d "$PLANTILLA" -c "select count(*) from pg_attribute where attrelid='public.movimientos_silla'::regclass and attname in ('numero_contrato','contrato_manual') and not attisdropped")" = "2" ]; then
  ESQUEMA="con columnas de la 194"; MOV_VAL=0; MOV_OTRO=ausente
else
  ESQUEMA="anterior a la 194"; MOV_VAL=ausente; MOV_OTRO=0
fi
echo "== Plantilla $PLANTILLA: esquema $ESQUEMA"
if [ -n "${FINALIZADOS:-}" ]; then
  cp "$FINALIZADOS/$MOV_VAL"/*.sql "$TMP"/
else
  generar "$TMP" "$MOV_VAL" "$MOV_OTRO"
fi

echo "== 0. MOTOR y ESPERADOS idénticos en hotfix y rollback"
bloque() { sed -n "/^-- >>> $2/,/^-- <<< $2/p" "$1" | grep -v '^--'; }
diff <(bloque "$DIR/02_hotfix_renumerar_dtm_0057_a_0557.sql" MOTOR) \
     <(bloque "$DIR/04_rollback_dtm_0557_a_0057.sql" MOTOR) >/dev/null || falla "MOTOR distinto"
diff <(bloque "$DIR/02_hotfix_renumerar_dtm_0057_a_0557.sql" ESPERADOS) \
     <(bloque "$DIR/04_rollback_dtm_0557_a_0057.sql" ESPERADOS) >/dev/null || falla "ESPERADOS distinto"
echo "   OK"

echo "== 1. Una expectativa en NULL (pendiente) aborta sin tocar nada"
nueva t_borrador semilla_caso_real.sql
debe_abortar t_borrador "$TMP/borrador_hotfix.sql" "BORRADOR: faltan expectativas del catálogo de producción (fk:cuotas)"
debe_abortar t_borrador "$TMP/borrador_rollback.sql" "BORRADOR: faltan expectativas del catálogo de producción (fk:cuotas)"
[ "$(seq_ t_borrador)" = "57,t" ] || falla "la secuencia se movió"
echo "   OK"

echo "== 2. Caso real: preflight de solo lectura, hotfix, postcheck"
nueva t_real semilla_caso_real.sql
PRE=$(huella t_real)
MAXAUD=$(PA -d t_real -c "select max(id) from auditoria")
AUD=$(PA -d t_real -c "select md5(string_agg(row(a.*)::text, '' order by id)) from auditoria a")
PF=$(PA -d t_real -F'|' -f - < "$DIR/01_preflight_lectura.sql") || falla "el preflight falló"
[ "$(huella t_real)" = "$PRE" ] || falla "el preflight cambió datos"
for col in numero_contrato contrato_manual; do
  fila=$(echo "$PF" | awk -F'|' -v d="movimientos_silla.$col" '$1=="30" && $3==d')
  if [ "$MOV_VAL" = "ausente" ]; then
    echo "$fila" | grep -q "|ausente: la columna no existe" || { echo "$fila"; falla "preflight: $col debía salir 'ausente'"; }
  else
    echo "$fila" | grep -qE "\|0\|$" || { echo "$fila"; falla "preflight: $col debía contar 0"; }
  fi
done
echo "$PF" | grep -q "^90|barrido|public.movimientos_silla\.\|^91|barrido|columnas revisadas" || falla "preflight: falta el barrido general"
[ "$(seq_ t_real)" = "57,t" ] || falla "el preflight consumió la secuencia"
P -d t_real -f - < "$TMP/hotfix.sql" 2>&1 | grep -q "OK: DTM-0057 → DTM-0557" || falla "el hotfix no terminó OK"
postcheck_ok t_real
[ "$(PA -d t_real -c "select md5(string_agg(row(a.*)::text, '' order by id)) from auditoria a where id <= $MAXAUD")" = "$AUD" ] \
  || falla "la auditoría histórica cambió"
[ "$(PA -d t_real -c "select public.siguiente_numero_contrato_para_tenant('mayorista')")" = "DTM-0558" ] || falla "el próximo no es DTM-0558"
[ "$(PA -d t_real -c "select public.siguiente_numero_contrato_para_tenant('mayorista')")" = "DTM-0559" ] || falla "el siguiente no es DTM-0559"
echo "   OK: preflight sin efectos, postcheck limpio, auditoría histórica intacta, próximo DTM-0558"

echo "== 3. Fallo a mitad del proceso, segundo intento y tercer intento"
nueva t_fallo semilla_caso_real.sql
PRE=$(huella t_fallo)
P -d t_fallo >/dev/null <<'SQL'
create function zz_falla() returns trigger language plpgsql as $$
begin raise exception 'FALLO SIMULADO a mitad del hotfix'; end $$;
create trigger zz_falla before update on public.contrato_hoteles for each row
  when (new.numero_contrato = 'DTM-0557') execute function zz_falla();
SQL
debe_abortar t_fallo "$TMP/hotfix.sql" "FALLO SIMULADO"
[ "$(seq_ t_fallo)" = "57,t" ] || falla "la secuencia no se revirtió"
[ "$(PA -d t_fallo -c "select count(*) from pg_constraint where contype='f' and condeferrable")" = "0" ] || falla "quedó una FK deferrable"
P -d t_fallo -c "drop trigger zz_falla on public.contrato_hoteles; drop function zz_falla();" >/dev/null
[ "$(huella t_fallo)" = "$PRE" ] || falla "huella distinta tras el fallo"
P -d t_fallo -f - < "$TMP/hotfix.sql" 2>&1 | grep -q "OK: DTM-0057 → DTM-0557" || falla "el segundo intento no terminó OK"
postcheck_ok t_fallo
POST=$(huella t_fallo)
P -d t_fallo -f - < "$TMP/hotfix.sql" 2>&1 | grep -q "YA APLICADO" || falla "el tercer intento no detectó 'ya aplicado'"
[ "$(huella t_fallo)" = "$POST" ] || falla "el tercer intento cambió algo"
echo "   OK: el fallo revierte todo (secuencia y DDL incluidos), el reintento termina OK y re-ejecutar no hace nada"

echo "== 4. Conexión cortada a mitad del proceso"
nueva t_corte semilla_caso_real.sql
PRE=$(huella t_corte)
lento t_corte 8
(P -d t_corte -f - < "$TMP/hotfix.sql" > "$TMP/corte.log" 2>&1 || true) &
sleep 3
PA -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity
                    where datname = 't_corte' and pid <> pg_backend_pid() and query like '%pg_sleep%' or
                          (datname = 't_corte' and state = 'active' and pid <> pg_backend_pid())" >/dev/null
wait
grep -qiE "terminat|closed|lost" "$TMP/corte.log" || { cat "$TMP/corte.log"; falla "no se cortó la sesión"; }
sin_lento t_corte
[ "$(huella t_corte)" = "$PRE" ] || falla "quedaron cambios tras cortar la conexión"
P -d t_corte -f - < "$TMP/hotfix.sql" 2>&1 | grep -q "OK: DTM-0057" || falla "reintento tras corte"
postcheck_ok t_corte
echo "   OK: nada a medias tras el corte; el reintento termina OK"

echo "== 5. Escritores concurrentes durante el hotfix"
nueva t_conc semilla_caso_real.sql
lento t_conc 4
(P -d t_conc -f - < "$TMP/hotfix.sql" > "$TMP/conc_hotfix.log" 2>&1) &
sleep 1.5
INI=$(date +%s)
NUM=$(PA -d t_conc -c "select public.siguiente_numero_contrato_para_tenant('mayorista')")
ESPERA=$(( $(date +%s) - INI ))
wait
if PA -d t_conc -c "insert into public.contrato_pasajeros (numero_contrato, nombre, fecha_nacimiento) values ('DTM-0057','TARDIO','1990-01-01')" > "$TMP/conc_ins.log" 2>&1; then
  falla "un pasajero nuevo quedó colgado del número viejo"; fi
grep -q "OK: DTM-0057" "$TMP/conc_hotfix.log" || { cat "$TMP/conc_hotfix.log"; falla "hotfix concurrente"; }
[ "$NUM" = "DTM-0558" ] || falla "nextval concurrente dio $NUM (debía esperar y dar DTM-0558)"
[ "$ESPERA" -ge 1 ] || falla "nextval concurrente no esperó al hotfix"
grep -q "violates foreign key" "$TMP/conc_ins.log" || { cat "$TMP/conc_ins.log"; falla "el insert sobre DTM-0057 no falló por FK"; }
echo "   OK: nextval esperó ${ESPERA}s y dio DTM-0558; un insert sobre DTM-0057 falla por FK"

nueva t_conc2 semilla_caso_real.sql
lento t_conc2 4
(P -d t_conc2 -f - < "$TMP/hotfix.sql" > "$TMP/conc2_hotfix.log" 2>&1) &
sleep 1.5
INI=$(date +%s)
if PA -d t_conc2 -c "insert into public.contrato_pasajeros (numero_contrato, nombre, fecha_nacimiento) values ('DTM-0057','EN VUELO','1990-01-01')" > "$TMP/conc2_ins.log" 2>&1; then
  falla "un insert concurrente quedó colgado del número viejo"; fi
ESPERA=$(( $(date +%s) - INI ))
wait
grep -q "OK: DTM-0057" "$TMP/conc2_hotfix.log" || { cat "$TMP/conc2_hotfix.log"; falla "hotfix concurrente 2"; }
grep -q "violates foreign key" "$TMP/conc2_ins.log" || { cat "$TMP/conc2_ins.log"; falla "el insert concurrente no falló por FK"; }
[ "$(PA -d t_conc2 -c "select count(*) from contrato_pasajeros where numero_contrato in ('DTM-0057','DTM-0557')")" = "3" ] || falla "pasajeros"
echo "   OK: un insert DURANTE el hotfix esperó ${ESPERA}s y falló por FK; no quedan huérfanos"

echo "== 6. Guardas: abortan sin cambios"
nueva t_g1 semilla_caso_real.sql
P -d t_g1 -c "select public.siguiente_numero_contrato_para_tenant('mayorista')" -c "insert into ventas (numero_contrato, tenant, cliente) values ('DTM-0058','mayorista','nuevo')" >/dev/null
debe_abortar t_g1 "$TMP/hotfix.sql" "La secuencia se movió"
nueva t_g2 semilla_caso_real.sql
P -d t_g2 -c "insert into ventas (numero_contrato, tenant, cliente) values ('DTM-0557','mayorista','choque')" >/dev/null
debe_abortar t_g2 "$TMP/hotfix.sql" "Colisión"
nueva t_g3 semilla_caso_real.sql
P -d t_g3 -c "insert into contrato_pasajeros (numero_contrato, nombre, fecha_nacimiento) values ('DTM-0057','CUARTO','1990-01-01')" >/dev/null
debe_abortar t_g3 "$TMP/hotfix.sql" "inventario de DTM-0057 cambió"
nueva t_g4 semilla_caso_real.sql
P -d t_g4 -c "update ventas set observaciones = 'ver también DTM-0057' where numero_contrato = 'DTM-0056'" >/dev/null
debe_abortar t_g4 "$TMP/hotfix.sql" "sigue apareciendo en public.ventas.observaciones"
nueva t_g5 semilla_caso_real.sql
P -d t_g5 -c "create table public.zz_nueva (id serial, numero_contrato text references public.ventas(numero_contrato))" >/dev/null
debe_abortar t_g5 "$TMP/hotfix.sql" "catálogo de FKs no es el esperado"
nueva t_g6 semilla_caso_real.sql
P -d t_g6 -c "insert into facturacion (numero_contrato) values ('DTM-0057')" >/dev/null
debe_abortar t_g6 "$TMP/hotfix.sql" "inventario de DTM-0057 cambió"
debe_abortar t_g6 "$TMP/hotfix_fiscal.sql" "FUERA DE ALCANCE"
nueva t_g7 semilla_caso_real.sql
P -d t_g7 -c "insert into storage.buckets (id,name) values ('contratos','contratos') on conflict do nothing" -c "insert into storage.objects (bucket_id, name) values ('contratos','DTM-0057/pasaporte.pdf')" >/dev/null
debe_abortar t_g7 "$TMP/hotfix.sql" "inventario de DTM-0057 cambió"
nueva t_g9 semilla_caso_real.sql
debe_abortar t_g9 "$TMP/hotfix_mov_otro.sql" "ref:movimientos_silla.numero_contrato: vivo=$MOV_VAL esperado=$MOV_OTRO"
debe_abortar t_g9 "$TMP/hotfix_fk_ausente.sql" "fk:cuotas no puede ser 'ausente'"
nueva t_g10 semilla_caso_real.sql
# Una referencia dentro de movimientos_silla en una columna que existe en
# todos los esquemas (motivo): la guarda específica no la mide, el barrido sí.
# (Fila de fixture sin silla real: `replica` omite triggers y FK solo en esta sesión.)
P -d t_g10 -c "set session_replication_role = replica" \
  -c "insert into public.movimientos_silla (silla_id, motivo) values (-1, 'cambio por DTM-0057')" >/dev/null
debe_abortar t_g10 "$TMP/hotfix.sql" "sigue apareciendo en public.movimientos_silla.motivo"
nueva t_g8 semilla_caso_real.sql
P -d t_g8 -c "insert into ventas (numero_contrato, tenant, cliente) values ('DTM-0058','mayorista','sin secuencia')" >/dev/null
debe_abortar t_g8 "$TMP/hotfix.sql" "Hay otro contrato DTM con número 58 "
echo "   OK: secuencia movida, colisión con DTM-0557 y con DTM-0558, inventario, referencia no inventariada, FK nueva, factura, Storage"

echo "== 7. Variante ampliada: condiciones permanentes, control de emisión, cotización"
nueva t_ampl semilla_caso_real.sql semilla_ampliado.sql
IDS=$(PA -d t_ampl -c "select string_agg(id||':'||creado_en||':'||monto_exigido, ',' order by id) from contrato_condiciones")
P -d t_ampl -f - < "$TMP/hotfix_ampl.sql" 2>&1 | grep -q "2 condiciones reinsertadas" || falla "ampliado"
# (Sin 03: su inventario es el de producción, sin condiciones ni control.)
[ "$(PA -d t_ampl -c "select string_agg(id||':'||creado_en||':'||monto_exigido, ',' order by id) from contrato_condiciones where numero_contrato='DTM-0557'")" = "$IDS" ] \
  || falla "condiciones con id/fecha/monto distintos"
[ "$(PA -d t_ampl -c "select count(*) from contrato_vuelo_control_cambios where numero_contrato='DTM-0557'")" = "1" ] || falla "historial de control"
[ "$(PA -d t_ampl -c "select count(*) from cotizaciones where numero_contrato='DTM-0557'")" = "1" ] || falla "cotización"
echo "   OK: condiciones conservan id, fecha y montos; control, historial y cotización renumerados"

echo "== 8. Rollback"
nueva t_rb semilla_caso_real.sql
PRE=$(huella t_rb)
P -d t_rb -f - < "$TMP/hotfix.sql" >/dev/null 2>&1
P -d t_rb -f - < "$TMP/rollback.sql" 2>&1 | grep -q "OK: DTM-0557 → DTM-0057" || falla "rollback"
[ "$(huella t_rb)" = "$PRE" ] || falla "el rollback no dejó todo igual que antes del hotfix"
P -d t_rb -f - < "$TMP/rollback.sql" 2>&1 | grep -q "YA APLICADO" || falla "rollback repetido"
P -d t_rb -f - < "$TMP/hotfix.sql" 2>&1 | grep -q "OK: DTM-0057" || falla "re-hotfix tras rollback"
postcheck_ok t_rb
P -d t_rb -c "select public.siguiente_numero_contrato_para_tenant('mayorista')" -c "insert into ventas (numero_contrato, tenant, cliente) values ('DTM-0558','mayorista','nuevo')" >/dev/null
debe_abortar t_rb "$TMP/rollback.sql" "La secuencia se movió"
echo "   OK: hotfix + rollback = estado original idéntico; el rollback se bloquea si ya se emitió DTM-0558"

echo "== 9. Archivos FINALES tal cual se entregan (02, 03, 04 sin finalizar.py)"
nueva t_final semilla_caso_real.sql
PRE=$(huella t_final)
if [ "$MOV_VAL" = "ausente" ]; then
  P -d t_final -f - < "$DIR/02_hotfix_renumerar_dtm_0057_a_0557.sql" 2>&1 | grep -q "OK: DTM-0057 → DTM-0557" || falla "02 final"
  postcheck_ok t_final
  P -d t_final -f - < "$DIR/02_hotfix_renumerar_dtm_0057_a_0557.sql" 2>&1 | grep -q "YA APLICADO" || falla "02 final repetido"
  P -d t_final -f - < "$DIR/04_rollback_dtm_0557_a_0057.sql" 2>&1 | grep -q "OK: DTM-0557 → DTM-0057" || falla "04 final"
  [ "$(huella t_final)" = "$PRE" ] || falla "02 + 04 finales no dejaron el estado original"
  echo "   OK: 02 → 03 limpio → 02 repetido no-op → 04 deja todo idéntico"
else
  debe_abortar t_final "$DIR/02_hotfix_renumerar_dtm_0057_a_0557.sql" "ref:movimientos_silla.numero_contrato: vivo=0 esperado=ausente"
  echo "   OK: en un esquema con la 194, el 02 final (de producción) aborta sin cambios"
fi

for b in t_final t_borrador t_real t_fallo t_corte t_conc t_conc2 t_g1 t_g2 t_g3 t_g4 t_g5 t_g6 t_g7 t_g8 t_g9 t_g10 t_ampl t_rb; do
  P -d postgres -c "drop database if exists $b" >/dev/null 2>&1; done
echo "== TODO OK"
