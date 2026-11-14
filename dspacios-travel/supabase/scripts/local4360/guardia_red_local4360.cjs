// GUARDIA DE RED del entorno local #43/#60. Se precarga (NODE_OPTIONS=--require) en TODOS los procesos Node de
// la app local (Next dev/build/start y sus workers): cualquier conexión TCP/TLS que no sea loopback se rechaza
// ANTES de resolver DNS o abrir el socket, así ninguna integración (correo, pagos, webhooks, Supabase alojado,
// telemetría…) puede alcanzar un servicio real aunque tuviera credenciales. Única excepción: las fuentes públicas
// de Google que descarga next/font (lectura de un CSS/woff, sin datos del sistema).
// Cada intento bloqueado queda en LOCAL4360_REGISTRO_RED (solo host, puerto y hora; nunca cabeceras ni cuerpos).
"use strict";
const net = require("node:net");
const fs = require("node:fs");

const FUENTES = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
// Loopback = el nombre exacto «localhost» o una IP LITERAL válida de loopback (127.0.0.0/8, ::1, ::ffff:127.0.0.0/104).
// Un nombre de dominio que empiece por «127.» (p. ej. 127.ejemplo.com) NO es una IP: se rechaza sin resolver DNS.
const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");
LOOPBACK.addSubnet("::ffff:127.0.0.0", 104, "ipv6");
const esLoopback = (h) => h === "localhost"
  || (net.isIPv4(h) && LOOPBACK.check(h, "ipv4"))
  || (net.isIPv6(h) && LOOPBACK.check(h, "ipv6"));
const registro = process.env.LOCAL4360_REGISTRO_RED;

function revisar(hostCrudo, puerto) {
  const h = String(hostCrudo ?? "localhost").replace(/^\[|\]$/g, "").toLowerCase();
  if (esLoopback(h) || FUENTES.has(h)) return;
  if (registro) { try { fs.appendFileSync(registro, `${new Date().toISOString()} bloqueado ${h}:${puerto ?? ""} pid=${process.pid}\n`); } catch { /* sin registro */ } }
  const e = new Error(`local4360: conexión externa bloqueada a ${h} (entorno local aislado)`);
  e.code = "ELOCAL4360_BLOQUEADO";
  throw e;
}

const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = Array.isArray(args[0]) ? args[0] : args;   // net.connect pasa los argumentos ya normalizados
  const o = a[0];
  if (o && typeof o === "object") {
    if (o.path == null) revisar(o.host, o.port);       // con path = tubería/socket local: se permite
  } else if (typeof o === "number" || (typeof o === "string" && /^\d+$/.test(o))) {
    revisar(a[1], o);
  }
  return original.apply(this, args);
};
// Expuesto solo para la sonda de aislamiento (la decisión, no un atajo para saltarla).
module.exports = { esLoopback };
