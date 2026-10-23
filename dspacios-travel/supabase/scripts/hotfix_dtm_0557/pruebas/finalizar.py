"""Genera una copia FINALIZADA (solo para pruebas locales) del hotfix o del
rollback: reemplaza las expectativas NULL por los valores dados.
Uso: python finalizar.py ENTRADA SALIDA clave=valor [clave=valor ...]
valor = número de filas, 'ausente' (la columna no existe en ese esquema) o
null (pendiente: sirve para probar que el script aborta).
Las claves no mencionadas que sigan en NULL pasan a '0'."""
import re, sys
entrada, salida, *pares = sys.argv[1:]
valores = dict(p.split('=', 1) for p in pares)
for k, v in valores.items():
    if not re.fullmatch(r'[0-9]+|ausente|null', v):
        sys.exit(f'valor inválido para {k}: {v}')
s = open(entrada, encoding='utf-8').read()
ini, fin = s.index('-- >>> ESPERADOS'), s.index('-- <<< ESPERADOS')
bloque = s[ini:fin]
def fijar(m):
    clave, actual = m.group(1), m.group(3)
    v = valores.pop(clave, None)
    if v is None:
        return m.group(0) if actual != 'null' else f"('{clave}',{m.group(2)}'0')"
    return f"('{clave}',{m.group(2)}{'null' if v == 'null' else repr(v)})"
bloque = re.sub(r"\('([a-z0-9_:.]+)',(\s*)(null|'[^']*')\)", fijar, bloque)
if valores:
    sys.exit(f'claves desconocidas: {sorted(valores)}')
open(salida, 'w', encoding='utf-8', newline='\n').write(s[:ini] + bloque + s[fin:])
