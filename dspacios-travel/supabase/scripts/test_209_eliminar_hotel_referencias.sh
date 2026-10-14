#!/bin/bash
# Pruebas de la migración 209 en PostgreSQL local desechable con el esquema previo instalado.
# Uso: PG209_TEST_DISPOSABLE=pg_eliminar_hotel ./test_209_eliminar_hotel_referencias.sh antes|despues
FASE=${1:-}; C=pg_eliminar_hotel
if [ "$FASE" != "antes" ] && [ "$FASE" != "despues" ]; then
  echo "Uso: $0 antes|despues" >&2
  exit 2
fi
if [ "${PG209_TEST_DISPOSABLE:-}" != "$C" ]; then
  echo "Se requiere PG209_TEST_DISPOSABLE=$C para usar el contenedor desechable." >&2
  exit 2
fi
psqlc() { docker exec -i $C psql -U supabase_admin -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
q()     { psqlc -At -c "$1"; }
falla=0
chk() { # descripción, esperado, obtenido
  if [ "$2" == "$3" ]; then echo "  OK   $1 -> $3"; else echo "  FALLA $1 -> esperado [$2] obtenido [$3]"; falla=1; fi; }

preexistentes=$(q "select
  (select count(*) from public.destinos where id=9000)
  + (select count(*) from public.armado_paquetes where id in (9001,9002))
  + (select count(*) from public.hoteles where id between 901 and 906)
  + (select count(*) from public.armado_hoteles where paquete_id in (9001,9002) or hotel_id between 901 and 906)
  + (select count(*) from public.tarifario_resultado where paquete_id in (9001,9002) or hotel_id between 901 and 906)") || exit 2
if [ "$preexistentes" != "0" ]; then
  echo "Los IDs de prueba ya existen; no se borrará ningún dato preexistente." >&2
  exit 2
fi
OUT=$(mktemp -d)
sembrar() { q "insert into public.destinos(id,nombre) values (9000,'DESTINO PRUEBA');
  insert into public.armado_paquetes(id,nombre,activo) values (9001,'Paquete Uno',true),(9002,'Paquete Dos',true);
  insert into public.hoteles(id,destino_id,nombre) select g,9000,'Hotel '||g from generate_series(901,906) g;" >/dev/null; }
intento() { # id -> código SQLSTATE del DELETE (o OK)
  docker exec -i $C psql -U supabase_admin -h 127.0.0.1 -d postgres -q -v VERBOSITY=verbose -c "delete from public.hoteles where id=$1" 2>&1 | grep -o 'ERROR:  [0-9A-Z]*' | head -1 | sed 's/ERROR:  //' ; }

echo "== FASE: $FASE =="; sembrar || exit 2
echo "-- T1 caso 99: hotel con tarifario generado (tarifario_resultado) y en el armado"
q "insert into public.armado_hoteles(paquete_id,hotel_id) values (9001,901);
   insert into public.tarifario_resultado(paquete_id,modulo,hotel_id,hotel_nombre,precio_pvp) values (9001,'porcion_terrestre',901,'Hotel 901',1000),(9001,'porcion_terrestre',901,'Hotel 901',2000);"
r=$(intento 901); chk "DELETE rechazado" "23503" "$r"
chk "hotel 901 sigue" "1" "$(q "select count(*) from public.hoteles where id=901")"
chk "tarifario intacto" "2" "$(q "select count(*) from public.tarifario_resultado where hotel_id=901")"
chk "armado intacto" "1" "$(q "select count(*) from public.armado_hoteles where hotel_id=901")"

echo "-- T2 solo en el armado (sin tarifario): no debe quitarlo del paquete"
q "insert into public.armado_hoteles(paquete_id,hotel_id) values (9001,903)"
r=$(intento 903)
if [ "$FASE" == "antes" ]; then chk "[línea base] el DELETE PASA (hay CASCADE)" "" "$r"
  chk "[línea base] el hotel se quitó del paquete EN SILENCIO" "0" "$(q "select count(*) from public.armado_hoteles where hotel_id=903")"
else chk "DELETE rechazado (foreign_key_violation por RESTRICT)" "23503" "$r"
  chk "hotel 903 sigue" "1" "$(q "select count(*) from public.hoteles where id=903")"
  chk "vínculo con el paquete intacto" "1" "$(q "select count(*) from public.armado_hoteles where hotel_id=903 and paquete_id=9001")"; fi

echo "-- T3 sin vínculos (con tarifas propias): se borra, los demás no se tocan"
q "insert into public.hotel_temporadas(hotel_id,nombre) values (902,'ALTA')" >/dev/null 2>&1 || true
r=$(intento 902); chk "DELETE exitoso" "" "$r"
chk "hotel 902 borrado" "0" "$(q "select count(*) from public.hoteles where id=902")"
chk "otros hoteles intactos" "$([ "$FASE" == antes ] && echo 4 || echo 5)" "$(q "select count(*) from public.hoteles where id between 901 and 906")"
chk "vínculos de otros hoteles intactos" "1" "$(q "select count(*) from public.armado_hoteles where hotel_id=901")"

echo "-- T4 CARRERA: A vincula hotel 904 al paquete (tx abierta 3s) vs B elimina hotel 904"
( docker exec -i $C psql -U supabase_admin -h 127.0.0.1 -d postgres -q -c "begin; insert into public.armado_hoteles(paquete_id,hotel_id) values (9001,904); select pg_sleep(3); commit;" >$OUT/a4 2>&1 ) &
sleep 1; t0=$(date +%s%N)
r=$(intento 904); t1=$(date +%s%N); ms=$(( (t1-t0)/1000000 )); wait
if [ "$FASE" == "antes" ]; then chk "[línea base] DELETE pasa tras esperar y se lleva el vínculo" "0" "$(q "select count(*) from public.armado_hoteles where hotel_id=904")"
else
 [ $ms -ge 1500 ] && echo "  OK   el DELETE esperó al INSERT (${ms} ms)" || { echo "  FALLA el DELETE no esperó (${ms} ms)"; falla=1; }
 chk "DELETE rechazado tras el commit del INSERT" "23503" "$r"
 chk "hotel 904 sigue" "1" "$(q "select count(*) from public.hoteles where id=904")"
 chk "hotel 904 sigue en el paquete" "1" "$(q "select count(*) from public.armado_hoteles where hotel_id=904")"; fi

echo "-- T5 CARRERA inversa: A elimina hotel 905 (tx abierta 3s) vs B vincula 905 al paquete"
( docker exec -i $C psql -U supabase_admin -h 127.0.0.1 -d postgres -q -c "begin; delete from public.hoteles where id=905; select pg_sleep(3); commit;" >$OUT/a5 2>&1 ) &
sleep 1; t0=$(date +%s%N)
docker exec -i $C psql -U supabase_admin -h 127.0.0.1 -d postgres -q -v VERBOSITY=verbose -c "insert into public.armado_hoteles(paquete_id,hotel_id) values (9002,905)" >$OUT/b5 2>&1
t1=$(date +%s%N); ms=$(( (t1-t0)/1000000 )); wait
[ $ms -ge 1500 ] && echo "  OK   el INSERT esperó al DELETE (${ms} ms)" || { echo "  FALLA el INSERT no esperó (${ms} ms)"; falla=1; }
chk "INSERT rechazado por FK (hotel ya no existe)" "23503" "$(grep -o 'ERROR:  [0-9A-Z]*' $OUT/b5 | head -1 | sed 's/ERROR:  //')"
chk "hotel 905 borrado" "0" "$(q "select count(*) from public.hoteles where id=905")"
chk "sin vínculo huérfano" "0" "$(q "select count(*) from public.armado_hoteles where hotel_id=905")"

echo "-- Invariante final"
chk "armado_hoteles sin filas huérfanas" "0" "$(q "select count(*) from public.armado_hoteles a left join public.hoteles h on h.id=a.hotel_id where h.id is null")"
q "delete from public.tarifario_resultado where paquete_id in (9001,9002);
  delete from public.armado_hoteles where paquete_id in (9001,9002);
  delete from public.hoteles where id between 901 and 906;
  delete from public.armado_paquetes where id in (9001,9002);
  delete from public.destinos where id=9000" >/dev/null || falla=1
[ $falla -eq 0 ] && echo "RESULTADO $FASE: TODO OK" || echo "RESULTADO $FASE: HAY FALLAS"
exit $falla
