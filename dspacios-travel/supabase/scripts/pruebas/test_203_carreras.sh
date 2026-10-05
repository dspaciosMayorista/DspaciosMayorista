#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL · migración 203 — CARRERAS con dos sesiones/usuarios REALES
# (dos conexiones de Postgres a la vez). Base DESECHABLE en el contenedor de
# Supabase LOCAL; se borra al final, pase o falle. Nunca remota.
#
# En cada escenario la sesión B (beto) deja ABIERTA una escritura (8 s) y la sesión A
# (ana) llama a `generar_tarifas_hotel_calculadora` con la foto que vio antes.
# Se comprueba que A ESPERA el bloqueo (> 1 s), que después RECHAZA con
# "recarga", y que lo escrito por B queda intacto.
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/pruebas/test_203_carreras.sh [contenedor]
# ───────────────────────────────────────────────────────────────────────────
set -eu
CT="${1:-supabase_db_sbqvrckukbjzhtzqpyzg}"
DB="carreras_203_$(date +%s)"
AQUI="$(cd "$(dirname "$0")" && pwd)"
MIGRACION="$AQUI/../../migrations/20260601000203_tarifas_generacion_acotada_historial.sql"
ESQUEMA="$AQUI/test_203_esquema_minimo.sql"
PSQL="psql -h 127.0.0.1 -U postgres -X -q -t -A -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0

limpiar() {
  docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap limpiar EXIT

sql() { docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f -; }
ANA="select set_config('test.rol','operaciones',false), set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false), set_config('test.email','ana@prueba.local',false);"
BETO="select set_config('test.rol','operaciones',false), set_config('test.uid','00000000-0000-0000-0000-0000000000b2',false), set_config('test.email','beto@prueba.local',false);"

# A llama la RPC dentro de un bloque que captura el error y reporta cuánto esperó.
cuerpo_a() { # $1 = argumentos SQL de la RPC
  printf '%s\n' "do \$\$ declare t0 timestamptz := clock_timestamp(); r jsonb; begin
    begin
      r := public.generar_tarifas_hotel_calculadora($1);
      raise notice 'RESULTADO escribio % s %', round(extract(epoch from clock_timestamp() - t0)::numeric, 1), r;
    exception when others then
      raise notice 'RESULTADO rechazo % s | %', round(extract(epoch from clock_timestamp() - t0)::numeric, 1), sqlerrm;
    end;
  end \$\$;"
}
llamar_a() { # sin carrera: A sola
  printf '%s\n' "$ANA" "$(cuerpo_a "$1")" | sql 2>&1 | grep RESULTADO | sed 's/.*RESULTADO //'
}

# Carrera REAL entre dos conexiones. A se conecta primero y espera DENTRO de
# su sesión a que B esté en su pg_sleep — B ya escribió y NO confirmó —; recién
# entonces llama la RPC. Así el arranque lento de `docker exec` no influye.
carrera() { # $1 = sentencias de B ; $2 = argumentos de la RPC de A
  printf '%s\n' "$ANA" "do \$\$ declare i int := 0; begin
      loop
        perform pg_stat_clear_snapshot();
        exit when exists (select 1 from pg_stat_activity where application_name = 'sesion_b' and state = 'active' and query like '%pg_sleep(8)%');
        i := i + 1;
        if i > 1200 then raise exception 'la sesión B no llegó a su pg_sleep'; end if;
        perform pg_sleep(0.05);
      end loop;
    end \$\$;" "$(cuerpo_a "$2")" | sql > "$TMP/a.out" 2>&1 &
  printf '%s\n' "$BETO" "begin;" "$1" "select pg_sleep(8);" "commit;" \
    | docker exec -i -e PGPASSWORD=postgres -e PGAPPNAME=sesion_b "$CT" $PSQL -d "$DB" -f - > "$TMP/b.out" 2>&1 &
  wait
  OUT="$(grep RESULTADO "$TMP/a.out" | sed 's/.*RESULTADO //')"
  [ -n "$OUT" ] || OUT="(A sin resultado: $(tail -2 "$TMP/a.out" | tr '\n' ' '))"
}

esperar_rechazo() { # $1 = nombre, $2 = salida de A, $3 = texto esperado
  seg="$(printf '%s' "$2" | sed -n 's/^rechazo \([0-9.]*\) s.*/\1/p')"
  if printf '%s' "$2" | grep -q "^rechazo" && printf '%s' "$2" | grep -q "$3" \
     && [ -n "$seg" ] && [ "$(echo "$seg >= 1.0" | bc 2>/dev/null || awk "BEGIN{print ($seg >= 1.0)}")" = "1" ]; then
    echo "OK    $1 (A esperó ${seg} s y rechazó)"
  else
    echo "FALLO $1: $2"; FALLOS=$((FALLOS + 1))
  fi
}

verificar() { # $1 = nombre, $2 = consulta que debe devolver t
  r="$(printf '%s\n' "$2" | sql 2>&1 | tail -1)"
  if [ "$r" = "t" ]; then echo "OK    $1"; else echo "FALLO $1: $r"; FALLOS=$((FALLOS + 1)); fi
}

foto() { printf '%s\n' "insert into public.foto_prueba values ('$1', public._foto_prueba(10)) on conflict (nombre) do update set foto = excluded.foto;" | sql >/dev/null; }

# ── Base y datos ──────────────────────────────────────────────────────────
docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "create database $DB" >/dev/null
{ cat "$ESQUEMA"; cat "$MIGRACION"; } | sql >/dev/null 2>&1
sql >/dev/null <<'SQL'
create table public.foto_prueba (nombre text primary key, foto jsonb not null);
insert into public.hoteles values (10, 'Hotel carreras');
insert into public.hotel_calculadora (hotel_id, tipo) values (10, 'mixta');
insert into public.hotel_temporadas (hotel_id, nombre, tipo, descuento_valor, prioridad, fecha_inicio, fecha_fin) values
  (10, 'BAJA', 'tarifa', null, 1, '2026-10-01', '2026-12-14'),
  (10, 'SUNSALE', 'descuento_pct', 6, 5, '2026-10-05', '2026-11-30');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante, precio_final_autoritativo, temporada_base) values
  (10, 'Estandar', 'FULL', 'BAJA',    514000, 454000, 454000, 454000, 227000, 150000, 50000, false, null),
  (10, 'Superior', 'FULL', 'BAJA',    600000, 500000, 500000, 500000, 250000, null,   0,     false, null),
  (10, 'Estandar', 'FULL', 'SUNSALE', 483160, 426760, 426760, 426760, 213380, 141000, 50000, true,  'BAJA');
SQL

# Lote de "Generar" de la calculadora: base + promo derivada (precio final).
PROMO_EST="jsonb_build_object('tipo_habitacion','Estandar','alimentacion','FULL','temporada','SUNSALE','neto_sencilla',483160,'neto_doble',426760,'neto_triple',426760,'neto_multiple',426760,'neto_nino',213380,'neto_nino2',141000,'neto_infante',50000,'precio_final_autoritativo',true,'temporada_base','BAJA')"
PROMO_SUP="jsonb_build_object('tipo_habitacion','Superior','alimentacion','FULL','temporada','SUNSALE','neto_sencilla',564000,'neto_doble',470000,'neto_triple',470000,'neto_multiple',470000,'neto_nino',235000,'neto_infante',0,'precio_final_autoritativo',true,'temporada_base','BAJA')"
BASE_EST="jsonb_build_object('tipo_habitacion','Estandar','alimentacion','FULL','temporada','BAJA','neto_sencilla',514000,'neto_doble',454000,'neto_triple',454000,'neto_multiple',454000,'neto_nino',227000,'neto_nino2',150000,'neto_infante',50000)"
F() { echo "(select foto from public.foto_prueba where nombre = '$1')"; }

# ── C1 · Generar vs. EDICIÓN manual concurrente de la promo ───────────────
foto F1
carrera "update public.tarifa_hotel set neto_doble = 400000, precio_final_autoritativo = false, temporada_base = null where hotel_id = 10 and temporada = 'SUNSALE' and tipo_habitacion = 'Estandar';" "10, jsonb_build_array($BASE_EST, $PROMO_EST), $(F F1)"
esperar_rechazo "C1 Generar con la promo editada a mano en otra sesión" "$OUT" "cambió después de cargar la vista previa"
verificar "C1 lo escrito por B quedó intacto (400000, escrita a mano)" \
  "select exists (select 1 from public.tarifa_hotel where hotel_id = 10 and temporada = 'SUNSALE' and tipo_habitacion = 'Estandar' and neto_doble = 400000 and not precio_final_autoritativo)"
foto F1b
OUT="$(llamar_a "10, jsonb_build_array($BASE_EST, $PROMO_EST), $(F F1b)")"
if printf '%s' "$OUT" | grep -q "^rechazo.*escrita a mano"; then echo "OK    C1 recargando la foto, Generar igual se niega: la promo ahora es escrita a mano"; else echo "FALLO C1 recarga: $OUT"; FALLOS=$((FALLOS + 1)); fi

# ── C2 · Generar vs. INSERT manual de una celda nueva de la promo ─────────
foto F2
carrera "insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble) values (10, 'Superior', 'FULL', 'SUNSALE', 480000);" "10, jsonb_build_array($PROMO_SUP), $(F F2)"
esperar_rechazo "C2 Generar con una celda nueva escrita a mano en otra sesión (bloqueo del hotel)" "$OUT" "cambió después de cargar la vista previa"
verificar "C2 la celda de B existe una sola vez y sin tocar" \
  "select count(*) = 1 and bool_and(neto_doble = 480000 and not precio_final_autoritativo) from public.tarifa_hotel where hotel_id = 10 and temporada = 'SUNSALE' and tipo_habitacion = 'Superior'"

# ── C3 · Reemplazar TODAS vs. INSERT manual en una clave fuera del lote ───
foto F3
carrera "insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble) values (10, 'Suite', 'FULL', 'SUNSALE', 900000);" "10, jsonb_build_array($BASE_EST), $(F F3), true"
esperar_rechazo "C3 Reemplazar TODAS con una promo nueva escrita a mano en otra sesión" "$OUT" "cambiaron después de cargar la vista previa"
verificar "C3 Reemplazar TODAS no borró nada" \
  "select count(*) = 5 from public.tarifa_hotel where hotel_id = 10"

# ── C4 · Dos usuarios generan a la vez sobre la misma celda ───────────────
foto F4
carrera "select public.generar_tarifas_hotel_calculadora(10, jsonb_build_array(jsonb_build_object('tipo_habitacion','Superior','alimentacion','FULL','temporada','BAJA','neto_sencilla',610000,'neto_doble',510000,'neto_triple',510000,'neto_multiple',510000,'neto_nino',255000,'neto_infante',0)), $(F F4));" "10, jsonb_build_array(jsonb_build_object('tipo_habitacion','Superior','alimentacion','FULL','temporada','BAJA','neto_sencilla',620000,'neto_doble',520000,'neto_triple',520000,'neto_multiple',520000,'neto_nino',260000,'neto_infante',0)), $(F F4)"
esperar_rechazo "C4 segunda generación simultánea con la misma foto (sin actualización perdida)" "$OUT" "cambió después de cargar la vista previa"
verificar "C4 quedó lo de B (510000) y una sola fila" \
  "select count(*) = 1 and bool_and(neto_doble = 510000) from public.tarifa_hotel where hotel_id = 10 and temporada = 'BAJA' and tipo_habitacion = 'Superior'"

# ── C5 · Sustituir vs. edición concurrente de la misma celda manual ───────
foto F5
carrera "update public.tarifa_hotel set neto_doble = 410000 where hotel_id = 10 and temporada = 'SUNSALE' and tipo_habitacion = 'Estandar';" "10, jsonb_build_array($PROMO_EST), $(F F5), false, 'calculadora_sustituir_manual'"
esperar_rechazo "C5 Sustituir con la celda editada en otra sesión después de confirmar" "$OUT" "cambió después de cargar la vista previa"
verificar "C5 la edición de B (410000) quedó intacta" \
  "select exists (select 1 from public.tarifa_hotel where hotel_id = 10 and temporada = 'SUNSALE' and tipo_habitacion = 'Estandar' and neto_doble = 410000 and not precio_final_autoritativo)"
foto F5b
OUT="$(llamar_a "10, jsonb_build_array($PROMO_EST), $(F F5b), false, 'calculadora_sustituir_manual'")"
if printf '%s' "$OUT" | grep -q "^escribio"; then echo "OK    C5 con la foto recargada, Sustituir escribe"; else echo "FALLO C5 recarga: $OUT"; FALLOS=$((FALLOS + 1)); fi
verificar "C5 fila sustituida: −6 % adultos/Niño 1/Niño 2, infante intacto, precio final" \
  "select exists (select 1 from public.tarifa_hotel where hotel_id = 10 and temporada = 'SUNSALE' and tipo_habitacion = 'Estandar' and neto_doble = 426760 and neto_nino = 213380 and neto_nino2 = 141000 and neto_infante = 50000 and precio_final_autoritativo and temporada_base = 'BAJA')"
verificar "C5 historial: versión de B (410000) guardada por la sustitución de ana" \
  "select exists (select 1 from public.tarifa_hotel_historial where hotel_id = 10 and motivo = 'calculadora_sustituir_manual' and operacion = 'DELETE' and (datos->>'neto_doble')::numeric = 410000 and autor_email = 'ana@prueba.local' and autor_id = '00000000-0000-0000-0000-0000000000a1')"
verificar "C1/C5 historial: las ediciones de beto quedaron con su autor" \
  "select count(*) >= 2 from public.tarifa_hotel_historial where hotel_id = 10 and motivo = 'edicion' and autor_email = 'beto@prueba.local'"
verificar "ningún rechazo dejó rastro en el historial (solo ediciones de B + 1 generación de B + 1 sustitución)" \
  "select count(*) filter (where motivo = 'calculadora_generar') = 1 and count(*) filter (where motivo = 'calculadora_sustituir_manual') = 1 and count(*) filter (where motivo = 'calculadora_reemplazar_todo') = 0 from public.tarifa_hotel_historial where hotel_id = 10"

if [ "$FALLOS" -eq 0 ]; then echo "TODAS LAS CARRERAS DE LA 203 PASARON"; else echo "$FALLOS FALLO(S)"; exit 1; fi
