// scripts/simular-chats.js
// Crea 50 conversaciones entre los usuarios de prueba y simula mensajes
// en tiempo real via Supabase Realtime Broadcast.
//
// Uso:
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=tu-anon-key node scripts/simular-chats.js
//
// Prerequisito: ejecutar seed-usuarios.js antes de este script.
// ADVERTENCIA: este script escribe directamente en la base de datos real.

'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: define SUPABASE_URL y SUPABASE_ANON_KEY antes de ejecutar.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Debe coincidir exactamente con src/websocket/chat.ts
const NOMBRE_CANAL = (conversacion_id) => `chat:${conversacion_id}`;
const EVENTO_MENSAJE = 'mensaje';
const MENSAJES_POR_CANAL = 5;
const DELAY_ENTRE_MENSAJES_MS = 500;
const TIMEOUT_CONEXION_MS = 10_000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Espera a que el canal confirme suscripción o lanza error por timeout. */
function esperarSuscripcion(canal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout de conexión al canal'));
    }, timeoutMs);

    canal.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error(`error de canal: ${status}${err ? ' — ' + err.message : ''}`));
      }
    });
  });
}

/** Construye un mensaje con la misma forma que enviarMensaje() en chat.ts. */
function construirMensaje(conversacion_id, autor_id, contenido) {
  const ahora = Date.now();
  return {
    id:               `${ahora}-${autor_id}`,
    conversacion_id,
    remitente_id:     autor_id,
    contenido,
    estatus:          true,
    creado_en:        new Date(ahora).toISOString(),
    creado_por:       autor_id,
    actualizado_en:   new Date(ahora).toISOString(),
    actualizado_por:  autor_id,
  };
}

async function main() {
  console.log('\nTermPals — Simulación de chats en tiempo real');
  console.log('━'.repeat(50));

  // ── 1. Traer usuarios de prueba ───────────────────────────────────────────

  process.stdout.write('  cargando usuarios de prueba... ');
  const { data: usuarios, error: errUsuarios } = await supabase
    .from('usuarios')
    .select('id, github_login')
    .like('github_id', 'test-%')
    .order('github_login');

  if (errUsuarios) {
    console.log('ERROR');
    console.error(`  ${errUsuarios.message}`);
    process.exit(1);
  }
  console.log(`OK (${usuarios.length} usuarios)`);

  if (usuarios.length < 2) {
    console.error('  ERROR: se necesitan al menos 2 usuarios de prueba. Ejecuta seed-usuarios.js primero.');
    process.exit(1);
  }

  // ── 2. Emparejar consecutivamente ─────────────────────────────────────────

  const pares = [];
  for (let i = 0; i + 1 < usuarios.length; i += 2) {
    pares.push({ a: usuarios[i], b: usuarios[i + 1] });
  }
  console.log(`  pares formados: ${pares.length}`);

  // ── 3. Crear conversaciones en la BD ──────────────────────────────────────

  process.stdout.write('  creando conversaciones... ');
  const filas = pares.map(p => ({
    usuario_a:    p.a.id,
    usuario_b:    p.b.id,
    puntaje:      Math.floor(Math.random() * 101),
    abierta:      true,
    motivo_cierre:null,
    ultimo_mensaje:null,
    estatus:      true,
    creado_por:   'seed-script',
    actualizado_por: 'seed-script',
  }));

  const { data: conversaciones, error: errConv } = await supabase
    .from('conversaciones')
    .insert(filas)
    .select('id, usuario_a, usuario_b');

  if (errConv) {
    console.log('ERROR');
    console.error(`  ${errConv.message}`);
    process.exit(1);
  }
  console.log(`OK (${conversaciones.length})`);

  // ── 4 + 5. Conectar canales y enviar mensajes ─────────────────────────────

  console.log('\n  Conectando canales y enviando mensajes...\n');

  const totalEsperado = conversaciones.length * MENSAJES_POR_CANAL;
  const errores = [];
  let canalesOk = 0;
  let mensajesOk = 0;
  const tiemposConexion = [];

  for (let i = 0; i < conversaciones.length; i++) {
    const conv = conversaciones[i];
    const par  = pares[i];
    const label = `[${String(i + 1).padStart(2)}/${conversaciones.length}] ${par.a.github_login} ↔ ${par.b.github_login}`;

    // ── 6. Medir tiempo de conexión ────────────────────────────────────────

    const t0 = Date.now();
    const canal = supabase.channel(NOMBRE_CANAL(conv.id), {
      config: { broadcast: { self: true } },
    });

    try {
      await esperarSuscripcion(canal, TIMEOUT_CONEXION_MS);
      const ms = Date.now() - t0;
      tiemposConexion.push(ms);
      canalesOk++;
      process.stdout.write(`  ${label} — conectado (${ms}ms) — mensajes: `);
    } catch (connErr) {
      errores.push({ tipo: 'conexión', canal: conv.id, error: connErr.message });
      console.log(`  ${label} — ERROR conexión: ${connErr.message}`);
      continue;
    }

    // ── 5. Enviar mensajes alternando autor ────────────────────────────────

    let mensajesEnviados = 0;
    const autores = [conv.usuario_a, conv.usuario_b];

    for (let m = 0; m < MENSAJES_POR_CANAL; m++) {
      const autorId   = autores[m % 2];
      const contenido = `mensaje de prueba ${m + 1} / ${MENSAJES_POR_CANAL}`;
      const payload   = construirMensaje(conv.id, autorId, contenido);

      const estado = await canal.send({
        type:    'broadcast',
        event:   EVENTO_MENSAJE,
        payload,
      });

      if (estado === 'ok') {
        mensajesOk++;
        mensajesEnviados++;
        process.stdout.write('.');
      } else {
        errores.push({ tipo: 'mensaje', canal: conv.id, mensaje: m + 1, error: estado });
        process.stdout.write('✗');
      }

      if (m < MENSAJES_POR_CANAL - 1) {
        await sleep(DELAY_ENTRE_MENSAJES_MS);
      }
    }
    console.log(` (${mensajesEnviados}/${MENSAJES_POR_CANAL})`);

    // Cerrar canal antes de pasar al siguiente
    await supabase.removeChannel(canal);
  }

  // ── 7. Resumen ────────────────────────────────────────────────────────────

  const promedioMs = tiemposConexion.length
    ? Math.round(tiemposConexion.reduce((a, b) => a + b, 0) / tiemposConexion.length)
    : 0;
  const maxMs = tiemposConexion.length ? Math.max(...tiemposConexion) : 0;
  const minMs = tiemposConexion.length ? Math.min(...tiemposConexion) : 0;

  console.log('\n' + '━'.repeat(50));
  console.log(`  canales conectados:  ${canalesOk} / ${conversaciones.length}`);
  console.log(`  mensajes enviados:   ${mensajesOk} / ${totalEsperado}`);
  console.log(`  tiempo de conexión:  promedio ${promedioMs}ms  min ${minMs}ms  max ${maxMs}ms`);

  if (errores.length > 0) {
    console.log(`\n  ERRORES (${errores.length}):`);
    errores.forEach(e => {
      if (e.tipo === 'conexión') {
        console.log(`  [conexión] canal ${e.canal}: ${e.error}`);
      } else {
        console.log(`  [mensaje #${e.mensaje}] canal ${e.canal}: ${e.error}`);
      }
    });
    process.exit(1);
  } else {
    console.log('  sin errores.\n');
  }
}

main().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
