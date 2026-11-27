#!/bin/sh
# Revisión consolidada — cadena COMBINADA de migraciones 344→349 sobre una base DESECHABLE (copia de una plantilla con la cadena hasta la 343), en el orden numérico del repositorio, con el preflight y el postcheck de cada bloque
# (cada uno es UNA consulta integral: la última columna es el veredicto; todo debe ser OK). Se detiene en el primer fallo. Nunca toca una base de revisión del dueño.
# Uso (desde dspacios-travel/):  sh supabase/scripts/revision_consolidada/cadena_rev2.sh <contenedor_pg> <plantilla> <base_desechable>
set -u
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PL="${2:?plantilla}"; DB="${3:?base desechable}"
case "$DB" in rev_*|dspacios_*|*revision*|plantilla*|postgres) echo "NO: '$DB' parece una base de revisión/plantilla; usa un nombre desechable (cons_cadena_*)"; exit 2;; esac
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -v ON_ERROR_STOP=1"
M=supabase/migrations; S=supabase/scripts
$PS -q -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PL' and pid <> pg_backend_pid()" >/dev/null
$PS -q -d postgres -c "drop database if exists $DB with (force)" >/dev/null
$PS -q -d postgres -c "create database $DB template $PL" || { echo "no se pudo crear $DB"; exit 2; }
verificar() { # $1 = archivo de chequeo, $2 = etiqueta
  [ -f "$1" ] || { echo "  (sin $2: $1)"; return 0; }
  v_sal="$($PS -q -t -A -F '|' -d "$DB" < "$1" 2>&1)"; v_rc=$?
  v_mal="$(printf '%s
' "$v_sal" | awk -F'|' 'NF>=3 && $NF != "OK" && $NF != "INFO" && $NF != "APLICABLE" && $NF != "CORRECTA" && $NF != "LISTA PARA APLICAR" && $NF != "" {print}')"
  v_n="$(printf '%s
' "$v_sal" | awk -F'|' 'NF>=3 {n++} END {print n+0}')"
  if [ $v_rc -ne 0 ] || [ -n "$v_mal" ] || [ "$v_n" -eq 0 ]; then echo "  FALLO $2 (filas $v_n, rc $v_rc):"; printf '%s
' "$v_sal" | cut -c1-230 | head -20; exit 1; fi
  echo "  $2: $v_n controles, todos OK"
}
aplicar() {
  f_mig="$(ls $M/20260601000$1_*.sql)"; echo "== aplicar $1 · $(basename "$f_mig")"
  $PS -q -d "$DB" < "$f_mig" >/dev/null 2>"/tmp/rev2_cadena_$1.err" || { echo "  FALLO al aplicar $1:"; head -8 "/tmp/rev2_cadena_$1.err"; exit 1; }
}
for N in 344 345 346 347 348 349; do
  verificar "$(ls $S/preflight_${N}_*.sql 2>/dev/null | head -1)" "preflight $N"; aplicar $N; verificar "$(ls $S/postcheck_${N}_*.sql 2>/dev/null | head -1)" "postcheck $N"
  [ "$N" = 348 ] && continue; [ "$N" = 349 ] && continue   # la 348 y la 349 se niegan a reaplicarse a propósito (guarda propia)
  aplicar $N   # idempotencia: reaplicar no falla
  verificar "$(ls $S/postcheck_${N}_*.sql 2>/dev/null | head -1)" "postcheck $N tras reaplicar"
done
echo "== cadena 344→349 aplicada y verificada en $DB"
