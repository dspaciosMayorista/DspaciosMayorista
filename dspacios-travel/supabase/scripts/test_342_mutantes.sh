#!/bin/sh
# Controles NEGATIVOS de la 342: cada mutante rompe UNA regla en una copia de la migración y la prueba SQL (test_342_registro_codigo_referido.sql) DEBE fallar; el original debe pasar.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_342_mutantes.sh <contenedor_pg> <plantilla>        Solo bases desechables.
set -u
CT="${1:?contenedor}"; PL="${2:?plantilla}"
T="$(mktemp -d)"; cp supabase/migrations/20260601000340_*.sql supabase/migrations/20260601000341_*.sql supabase/migrations/20260601000342_*.sql "$T"/
M42="$T/20260601000342_registro_b2b_codigo_referido.sql"; ORIG="$T/original.sql"; cp "$M42" "$ORIG"
corre() { MIG_DIR="$T" sh supabase/scripts/test_341_referidos.sh "$CT" "$PL" 342 2>&1 | grep -E "FALLO|aciertos|^ +[0-9]+ \||ERROR" | sed 's/NOTICE:  //' | head -4; }
mutante() { # nombre, patrón sed
  cp "$ORIG" "$M42"; sed -i "$2" "$M42"
  if cmp -s "$ORIG" "$M42"; then echo "[$1] el mutante NO cambió nada: revisar el patrón"; return; fi
  echo "== MUTANTE $1"; corre
}
echo "== ORIGINAL"; cp "$ORIG" "$M42"; corre
mutante "M1 administración puede decidir" "s#u := f341_priv.actor(p_actor, array\['superadmin', 'gerencia'\]);\n  if p_decision#XX#; /referido_decidir_solicitud/,/end \$\$;/ s#array\['superadmin', 'gerencia'\]#array['superadmin', 'gerencia', 'administracion']#"
mutante "M2 confirmar ignora lo que la persona vio (sin F4712)" "s#if p_referidor_id is distinct from c.referidor_id or round(p_pct, 4) is distinct from c.pct then#if false then#"
mutante "M3 formato del código no se valida en la función" "s#if cod !~ '^\[A-Z0-9\]\[A-Z0-9-\]{3,19}\$' then cod := null; end if;##"
mutante "M4 asignar sin exigir registro aprobado" "s#if s.estado <> 'aprobada' or cuenta.aliado_id is null then#if false then#"
mutante "M5 candidatos sin alcance de agencia" "s#where s.codigo_referido is not null and f341_priv.ve_tenant(u, cu.tenant)#where s.codigo_referido is not null#"
mutante "M6 el candidato se confirma solo (asigna al registrarse)" "s#coalesce((d ->> 'acepta_notificaciones') = 'true', false), 'pendiente', p_usuario, cod, case when cod is null then 'sin_codigo' else 'candidato' end#coalesce((d ->> 'acepta_notificaciones') = 'true', false), 'pendiente', p_usuario, cod, case when cod is null then 'sin_codigo' else 'confirmado' end#"
rm -rf "$T"
