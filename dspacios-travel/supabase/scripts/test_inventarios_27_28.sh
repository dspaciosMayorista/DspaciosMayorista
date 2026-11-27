#!/bin/sh
# PRUEBA de los inventarios de SOLO LECTURA #27 (clientes de contratos frente al CRM) y #28 (identidad duplicada venta/freelance) sobre una base DESECHABLE con datos sintéticos.
# Comprueba, contra los archivos *.esperado.txt calculados A MANO: (1) la salida exacta de cada consulta; (2) que cada una corre en transacción de SOLO LECTURA (una escritura fallaría);
# (3) que ninguna salida contiene nombres ni documentos de los fixtures; (4) que cada archivo es UNA sola sentencia.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_inventarios_27_28.sh <contenedor_pg> <plantilla>      NUNCA contra una base real.
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"
D=supabase/scripts
D28="${INV28_DIR:-$D}"   # copia mutada de los scripts #28 para los controles negativos (los fixtures y esperados siguen en $D)
hex() { od -An -N6 -tx1 /dev/urandom | tr -d ' \n'; }
DB="tinv_$(hex)"; DB28="${DB}b"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; $PS -d postgres -c "drop database if exists $DB28" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
FALLOS=0
ok() { echo "OK    $1"; }
mal() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
$PS -d "$DB" < $D/test_27_inventario_fixture.sql >/dev/null
$PS -d postgres -c "create database $DB28 template $PLANTILLA" >/dev/null
$PS -d "$DB28" < $D/test_28_inventario_fixture.sql >/dev/null

# Quita el punto y coma final para poder envolver la consulta como subconsulta.
consulta() { sed -e 's/[[:space:]]*;[[:space:]]*$//' "$1"; }
# Una sola sentencia: exactamente un ';' fuera de comentarios (el final).
una_sentencia() { n="$(grep -v '^[[:space:]]*--' "$1" | tr -cd ';' | wc -c | tr -d ' ')"; [ "$n" = 1 ]; }
# Ejecuta la consulta envuelta en una transacción de solo lectura.
correr() { # $1 archivo, $2 expresión de selección sobre q, $3 base (por defecto la del #27)
  { echo "begin read only;"; echo "select $2 from ("; consulta "$1"; echo ") q order by 1;"; echo "commit;"; } | $PS -d "${3:-$DB}"
}

for f in inventario_27_clientes_contratos inventario_28_conteos_identidad_duplicada inventario_28_mapeo_revisable; do
  dd="$D"; case "$f" in inventario_28_*) dd="$D28" ;; esac
  if una_sentencia "$dd/$f.sql"; then ok "$f.sql es UNA sola sentencia"; else mal "$f.sql tiene más de una sentencia"; fi
done

correr $D/inventario_27_clientes_contratos.sql "concat_ws('|', tenant, tipo_contrato, orden, observado, estado)" | sort -t'|' -k1,1 -k2,2 -k3,3n > /tmp/inv27.$$ || mal "inventario 27 falló al ejecutarse en solo lectura"
sort -t'|' -k1,1 -k2,2 -k3,3n $D/test_27_inventario.esperado.txt > /tmp/inv27e.$$
if diff /tmp/inv27.$$ /tmp/inv27e.$$ >/dev/null; then ok "inventario 27: 48 filas idénticas a lo calculado a mano"; else mal "inventario 27 difiere"; diff /tmp/inv27.$$ /tmp/inv27e.$$ | head -20; fi

correr $D28/inventario_28_conteos_identidad_duplicada.sql "case when orden in (1, 3) then concat_ws('|', orden, contratos, estado) else concat_ws('|', orden, grupo, tenant, perfil_venta, perfil_freelance, tipo_asesor, canal, b2b_usuario_id, aliado_id, contratos, por_texto_asesor, por_texto_freelance, por_id_b2b, por_id_aliado, con_comision_b2b, estado) end" "$DB28" > /tmp/inv28a.$$ || mal "inventario 28 etapa 1 falló al ejecutarse en solo lectura"
if diff /tmp/inv28a.$$ $D/test_28_conteos.esperado.txt >/dev/null; then ok "inventario 28 etapa 1 (C28-1/C28-2): 12 filas idénticas a lo calculado a mano"; else mal "inventario 28 etapa 1 difiere"; diff /tmp/inv28a.$$ $D/test_28_conteos.esperado.txt | head -20; fi

correr $D28/inventario_28_mapeo_revisable.sql "concat_ws('|', grupo, numero_contrato, perfil_venta, perfil_freelance, clasificacion, evidencias, case when con_comision_b2b then 't' else 'f' end)" "$DB28" | sort > /tmp/inv28b.$$ || mal "inventario 28 etapa 2 falló al ejecutarse en solo lectura"
sort $D/test_28_mapeo.esperado.txt > /tmp/inv28be.$$
if diff /tmp/inv28b.$$ /tmp/inv28be.$$ >/dev/null; then ok "inventario 28 etapa 2 (C28-1/C28-2): 15 contratos con clasificación, evidencias y UUID completos esperados"; else mal "inventario 28 etapa 2 difiere"; diff /tmp/inv28b.$$ /tmp/inv28be.$$ | head -20; fi

# C28-2 — regresión de prefijos idénticos: los usuarios del fixture comparten los 8 primeros caracteres del UUID (`00000000`), así que un prefijo NO distingue los dos grupos.
# Cada etapa debe devolver UUID COMPLETOS (36 caracteres) y 2 identificadores distintos por perfil aunque solo 1 prefijo de 8 caracteres.
for par in "conteos:inventario_28_conteos_identidad_duplicada:perfil_venta:perfil_freelance:where perfil_freelance is not null" "mapeo:inventario_28_mapeo_revisable:perfil_venta:perfil_freelance:"; do
  et="${par%%:*}"; r="${par#*:}"; f="${r%%:*}"; r="${r#*:}"; cv="${r%%:*}"; r="${r#*:}"; cf="${r%%:*}"; filtro="${r#*:}"
  res="$({ echo "begin read only;"; echo "select count(distinct $cf), count(distinct left($cf, 8)), min(length($cf)), min(length($cv)), count(distinct $cv) from ("; consulta "$D28/$f.sql"; echo ") q $filtro;"; echo "commit;"; } | $PS -d "$DB28")"
  if [ "$res" = "2|1|36|36|2" ]; then ok "C28-2 etapa $et: UUID completos y distintos (2) aunque comparten un único prefijo de 8 caracteres"; else mal "C28-2 etapa $et: esperado 2|1|36|36|2, obtenido $res"; fi
done

# Sin datos personales: se vuelcan las TRES salidas completas y se busca cualquier nombre/documento de los fixtures.
for par in "inventario_27_clientes_contratos:$DB" "inventario_28_conteos_identidad_duplicada:$DB28" "inventario_28_mapeo_revisable:$DB28"; do
  f="${par%%:*}"; b="${par##*:}"
  dd="$D"; case "$f" in inventario_28_*) dd="$D28" ;; esac
  { echo "begin read only;"; consulta "$dd/$f.sql"; echo ";"; echo "commit;"; } | $PS -d "$b" -F '|' ; done > /tmp/inv_todo.$$
# Fichas y datos de los fixtures (las palabras genéricas de las etiquetas, como «titular», no cuentan).
if grep -Eqi 'titular (uno|dos|tres|ocho|nueve|diez)|contacto (uno|ocho|nueve)|pepe|luis|ana sola|rosa|cliente (s[0-9]|ana|luis|pepe)|[^0-9](1000001|1000002|1000003|1000010|2000001|2000002)[^0-9]|@x\.test|aliado a[12] sintetico' /tmp/inv_todo.$$; then mal "alguna salida contiene datos personales de los fixtures"; else ok "ninguna salida contiene nombres, documentos ni correos de los fixtures"; fi

# Una escritura dentro de la transacción de solo lectura DEBE fallar (prueba de la propia protección del arnés).
if { echo "begin read only;"; echo "update public.ventas set cliente = cliente;"; echo "commit;"; } | $PS -d "$DB" >/dev/null 2>&1; then mal "el arnés permitió escribir en solo lectura"; else ok "el arnés rechaza escrituras (transacción de solo lectura)"; fi

rm -f /tmp/inv27.$$ /tmp/inv27e.$$ /tmp/inv28a.$$ /tmp/inv28b.$$ /tmp/inv28be.$$ /tmp/inv_todo.$$
[ "$FALLOS" = 0 ] && { echo "TODO OK"; exit 0; } || { echo "$FALLOS FALLO(S)"; exit 1; }
