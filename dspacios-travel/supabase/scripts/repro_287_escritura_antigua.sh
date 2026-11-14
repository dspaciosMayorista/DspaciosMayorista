#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
# REPRODUCCIÓN (#75 · migración 287): una escritura hecha desde una pantalla ANTIGUA, después de reutilizar el
# número, ¿llega al contrato NUEVO?  Uso:  sh supabase/scripts/repro_287_escritura_antigua.sh <contenedor> [base]
#
# NO es una prueba de aprobación: documenta un RIESGO ABIERTO. Cada línea «AFECTA AL CONTRATO NUEVO» es una operación
# que hoy escribiría sobre el contrato B si el usuario la dispara desde la pantalla del contrato A (abierta antes de
# que A se eliminara y su número se reutilizara). El script habilita el interruptor SOLO en la base de prueba y lo
# deja apagado al terminar. Requiere el esquema hasta la 281 + la 287. NUNCA contra producción.
# ──────────────────────────────────────────────────────────────────────────────
CT="${1:?uso: repro_287_escritura_antigua.sh <contenedor> [base]}"
DB="${2:-postgres}"
export MSYS_NO_PATHCONV=1
S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
SU='aaaaaaaa-1111-1111-1111-111111111111'; GE='cccccccc-3333-3333-3333-333333333333'
claims() { echo "select set_config('request.jwt.claims','{\"sub\":\"$1\",\"role\":\"authenticated\"}',false), set_config('request.jwt.claim.sub','$1',false);"; }
Q()  { { claims "$SU"; echo "$1"; } | S | grep -v '^{' | grep -v "^$SU" | grep -v '^$'; }
QG() { { claims "$GE"; echo "set role authenticated;"; echo "$1;"; echo "reset role;"; } | S | grep -v '^{' | grep -v "^$GE" | grep -v '^SET$' | grep -v '^RESET$' | grep -v '^$'; }
# Número distinto en cada corrida (un abono con asiento contable impide borrar el contrato de una corrida anterior).
N="DTM-8$(printf %03d $(( $(date +%s) % 1000 )))"
S -c "insert into auth.users(id,email) values ('$SU','s@t.l'),('$GE','g@t.l') on conflict do nothing" \
  -c "insert into public.usuarios(id,email,nombre,rol,activo,tenant) values ('$SU','s@t.l','Super','superadmin',true,'mayorista'),('$GE','g@t.l','Gerente','gerencia',true,'mayorista') on conflict (id) do update set rol=excluded.rol,activo=true,tenant='mayorista'" >/dev/null
S -c "insert into storage.buckets(id,name,public) values ('contratos','contratos',false) on conflict do nothing" >/dev/null
# el pool de la base de prueba se vacía para que el único número en juego sea $N
S -c "delete from public.numeros_dtm_liberados" >/dev/null
S -c "update public.dtm_reuso_config set habilitado = true" >/dev/null

echo "== Preparación: A (pendiente, vacío, cliente 'Cliente A') → pantalla de A abierta → A se elimina con reuso → B nace con el MISMO número"
Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('$N','mayorista','Cliente A','pendiente','Asesor A');" >/dev/null
R=$(Q "select public.eliminar_contrato('$N', true)"); echo "eliminar A con reuso: ${R:-ok}"
RES=$(Q "select numero||' '||token from public.reservar_numero_contrato('mayorista')"); NUM=$(printf '%s' "$RES" | cut -d' ' -f1); TOK=$(printf '%s' "$RES" | cut -d' ' -f2)
Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$NUM','$TOK','mayorista','Cliente B','pendiente','Asesor B');" >/dev/null
echo "B creado con $NUM: $(Q "select cliente||' | estado='||estado||' | asesor='||asesor from public.ventas where numero_contrato='$N'")"
echo
echo "== La pantalla antigua de A (que sigue mostrando 'Cliente A' y el número $N) dispara sus operaciones:"
rep() { # rep <operación> <sql de la operación> <sql que mide el efecto sobre B> <regex del efecto que prueba que llegó a B>
  r=$(Q "$2"); e=$(Q "$3")
  if printf '%s' "$e" | grep -Eq "$4"; then v="AFECTA AL CONTRATO NUEVO"; AFECTAN=$((AFECTAN+1)); else v="no afecta                "; fi
  printf '%s  %-60s -> %s\n' "$v" "$1" "$e"
  [ -n "$r" ] && printf '                           (respuesta de la operación: %s)\n' "$(printf '%s' "$r" | tr '\n' ' ' | cut -c1-110)"
}
AFECTAN=0
rep "registrar abono (RPC registrar_abono; la Server Action la llama como servidor)" \
  "set role service_role; select public.registrar_abono('$N','mayorista','$SU',500000,1,'efectivo',null,current_date,true,gen_random_uuid()); reset role" \
  "select 'abonos de B: '||count(*)||', total '||coalesce(sum(valor_abono),0) from public.abonos where numero_contrato='$N'" 'abonos de B: [1-9]'
rep "confirmar venta (RPC confirmar_venta)" \
  "select public.confirmar_venta('$N')" \
  "select 'estado de B: '||estado from public.ventas where numero_contrato='$N'" 'estado de B: confirmado'
rep "editar datos del contrato (UPDATE ventas, EditarVentaForm)" \
  "update public.ventas set cliente='Editado desde la pantalla de A', destino='Cancún', precio_venta=4200000 where numero_contrato='$N'" \
  "select 'B ahora: cliente='||cliente||', destino='||coalesce(destino,'-')||', precio='||precio_venta from public.ventas where numero_contrato='$N'" 'Editado desde la pantalla de A'
rep "agregar pasajero (INSERT contrato_pasajeros)" \
  "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$N','Pasajero de la pantalla de A')" \
  "select 'pasajeros de B: '||count(*) from public.contrato_pasajeros where numero_contrato='$N'" 'pasajeros de B: [1-9]'
rep "agregar servicio (INSERT contrato_servicios)" \
  "insert into public.contrato_servicios(numero_contrato,descripcion) values ('$N','Traslado agregado desde A')" \
  "select 'servicios de B: '||count(*) from public.contrato_servicios where numero_contrato='$N'" 'servicios de B: [1-9]'
rep "registrar cuenta por pagar / proveedor (INSERT cuentas_por_pagar)" \
  "insert into public.cuentas_por_pagar(numero_contrato,valor_total) values ('$N',900000)" \
  "select 'CxP de B: '||count(*) from public.cuentas_por_pagar where numero_contrato='$N'" 'CxP de B: [1-9]'
Q "insert into storage.objects(bucket_id,name) values ('contratos','$N/comprobante-de-A.pdf')" >/dev/null
rep "subir un archivo a contratos/$N/ (Storage; lo ve quien abra B)" \
  "select 1" \
  "select 'un gerente (RLS real) accede al archivo en el prefijo de B: '||(select public.acceso_archivo_contratos('$N/comprobante-de-A.pdf'))" 'true'
rep "eliminar el contrato (botón de la pantalla de A; RPC eliminar_contrato)" \
  "select public.eliminar_contrato('$N', false)" \
  "select 'B existe todavía: '||(count(*)>0)::text from public.ventas where numero_contrato='$N'" 'B existe todavía: false'
echo
echo "== Auditoría: todas estas escrituras quedan registradas como operaciones sobre '$N' sin forma de distinguir de qué pantalla vinieron:"
Q "select tabla||' '||accion||' x'||count(*) from public.auditoria where registro_id='$N' and creado_en > now() - interval '5 minutes' group by tabla, accion order by 1"
S -c "update public.dtm_reuso_config set habilitado = false" >/dev/null
echo
echo "RESULTADO: $AFECTAN de 8 operaciones de la pantalla antigua AFECTAN al contrato nuevo."
echo "CONCLUSIÓN: toda operación identifica el contrato solo por el texto del número; el contrato nuevo no es distinguible del anterior."
