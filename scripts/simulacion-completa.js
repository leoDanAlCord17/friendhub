'use strict';

// ── Credenciales ─────────────────────────────────────────────────────────────
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: define SUPABASE_URL y SUPABASE_ANON_KEY antes de ejecutar.');
  process.exit(1);
}

// ── Stub 'vscode' ─────────────────────────────────────────────────────────────
// Los módulos compilados en out/ importan 'vscode' al nivel de módulo.
// Registramos un stub antes de cualquier require('./out/...') para que
// Node.js resuelva el módulo sin lanzar "Cannot find module 'vscode'".
// Las funciones que usamos (getSupabase, crearInvitacion, etc.) llaman a
// workspace.getConfiguration solo dentro de leerCredenciales(), que nunca
// se ejecuta porque inyectamos el cliente via setSupabase().
const Module = require('module');
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'vscode') return 'vscode';
  return _origResolve.call(this, request, parent, isMain, options);
};
require.cache['vscode'] = {
  id: 'vscode', filename: 'vscode', loaded: true,
  exports: {
    workspace: {
      getConfiguration: () => ({ get: (_k, def) => def ?? '' }),
      workspaceFolders: null,
      findFiles: async () => [],
      fs: { readFile: async () => Buffer.alloc(0) },
    },
    window: {
      showWarningMessage: async () => {},
      showInputBox: async () => undefined,
      showInformationMessage: async () => {},
    },
    EventEmitter: class {
      constructor() { this._l = []; }
      get event() { return fn => { this._l.push(fn); return { dispose: () => {} }; }; }
      fire(d) { this._l.forEach(f => f(d)); }
      dispose() { this._l = []; }
    },
    Uri: { parse: s => ({ toString: () => s }), file: p => ({ fsPath: p }) },
    env: { openExternal: async () => {} },
    commands: {
      registerCommand: () => ({ dispose: () => {} }),
      executeCommand: async () => {},
    },
    ViewColumn: { One: 1 },
  },
};

// ── Importar desde out/ (CommonJS compilado desde TypeScript) ─────────────────
const { createClient }                              = require('@supabase/supabase-js');
const { setSupabase }                               = require('../out/supabase/client');
const { actualizarConversacionActiva, buscarMatch } = require('../out/supabase/usuarios');
const { crearInvitacion, responderInvitacion }      = require('../out/supabase/invitaciones');
const { crearConversacion }                         = require('../out/supabase/conversaciones');
const { calcularCompatibilidad }                    = require('../out/compatibility/score');

// ── Inicializar cliente Supabase e inyectarlo en out/ ─────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});
setSupabase(supabase);

// ── Constantes ────────────────────────────────────────────────────────────────
const MENSAJES_POR_CANAL  = 5;
const DELAY_MENSAJES_MS   = 300;
const TIMEOUT_CONEXION_MS = 10_000;
// Nombre de canal idéntico al de src/websocket/chat.ts
const nombreCanal = id => `chat:${id}`;
const EVENTO_MENSAJE = 'mensaje';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function avg(arr) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

function esperarSuscripcion(canal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout esperando SUBSCRIBED')),
      TIMEOUT_CONEXION_MS,
    );
    canal.subscribe((status, err) => {
      if (status === 'SUBSCRIBED')              { clearTimeout(timer); resolve(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error(`${status}${err ? ': ' + err.message : ''}`));
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  const tiempoInicio = Date.now();
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   TermPals — Simulación completa de flujo de usuario  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ── FASE 1: Cargar datos base ─────────────────────────────────────────────
  console.log('FASE 1 — Setup');
  console.log('─'.repeat(54));

  // Reset de conversacion_activa_id para que buscarMatch() funcione
  process.stdout.write('  reseteando conversacion_activa_id de usuarios de prueba... ');
  {
    const { error } = await supabase
      .from('usuarios')
      .update({ conversacion_activa_id: null })
      .like('github_id', 'test-%');
    if (error) {
      console.log(`ERROR: ${error.message}`);
      process.exit(1);
    }
    console.log('OK');
  }

  process.stdout.write('  cargando usuarios de prueba... ');
  const { data: usuarios, error: errU } = await supabase
    .from('usuarios')
    .select('id, github_id, github_login, busca, conversacion_activa_id')
    .like('github_id', 'test-%')
    .order('github_login');
  if (errU) { console.log(`ERROR: ${errU.message}`); process.exit(1); }
  console.log(`OK (${usuarios.length} usuarios)`);

  process.stdout.write('  cargando proyectos de usuarios de prueba... ');
  const { data: proyectos, error: errP } = await supabase
    .from('proyectos')
    .select('*')
    .in('usuario_id', usuarios.map(u => u.id));
  if (errP) { console.log(`ERROR: ${errP.message}`); process.exit(1); }
  console.log(`OK (${proyectos.length} proyectos)`);

  // Índice proyecto por usuario_id
  const proyectoPorUsuario = {};
  for (const p of proyectos) proyectoPorUsuario[p.usuario_id] = p;

  // Emparejar consecutivamente
  const pares = [];
  for (let i = 0; i + 1 < usuarios.length; i += 2) {
    pares.push({ a: usuarios[i], b: usuarios[i + 1] });
  }
  console.log(`  pares formados: ${pares.length}/50\n`);

  // ── FASE 2: Matching ──────────────────────────────────────────────────────
  console.log('FASE 2 — Matching (search → invite → accept → conversación)');
  console.log('─'.repeat(54));

  const statsMatch = {
    procesados: 0,
    errores: [],
    tiemposCiclo: [],
    compatibilidades: [],
  };
  const conversaciones = []; // {id, usuario_a, usuario_b, puntaje}

  for (let i = 0; i < pares.length; i++) {
    const { a, b } = pares[i];
    const label = `[${String(i + 1).padStart(2)}/50]`;
    const t0 = Date.now();

    try {
      // Paso 1: buscarMatch — replica la lógica real de /tp search
      // Usamos buscarMatch() de out/supabase/usuarios.js que consulta la BD
      // con los filtros exactos: busca compatible, sin conv activa, no descartados.
      // El resultado puede o no ser el usuario B de nuestro par (es una prueba
      // de carga de la query, no de la lógica de matching).
      await buscarMatch(a.id, a.busca ?? 'colaborar');

      // Paso 2: calcular compatibilidad entre proyectos del par
      const proyA = proyectoPorUsuario[a.id];
      const proyB = proyectoPorUsuario[b.id];
      let puntaje = 0;
      if (proyA && proyB) {
        const resultado = calcularCompatibilidad(proyA, proyB);
        puntaje = resultado.puntaje;
        statsMatch.compatibilidades.push(puntaje);
      }

      // Paso 3: crear invitación (estado: 'pendiente')
      const invitacion = await crearInvitacion(
        a.id,
        b.id,
        proyA?.readme ?? null,
        puntaje,
      );

      // Paso 4: aceptar la invitación (estado: 'aceptada')
      const conv = await crearConversacion(a.id, b.id, puntaje);

      await responderInvitacion(invitacion.id, 'aceptada', conv.id);

      // Paso 5: actualizar conversacion_activa_id de ambos usuarios
      await actualizarConversacionActiva(a.id, conv.id);
      await actualizarConversacionActiva(b.id, conv.id);

      const ms = Date.now() - t0;
      statsMatch.tiemposCiclo.push(ms);
      statsMatch.procesados++;
      conversaciones.push({ id: conv.id, usuario_a: a.id, usuario_b: b.id, puntaje });

      console.log(`  ${label} ${a.github_login} ↔ ${b.github_login}  compat=${puntaje}%  ${ms}ms`);
    } catch (err) {
      const ms = Date.now() - t0;
      statsMatch.errores.push(`par ${i + 1} (${a.github_login}↔${b.github_login}): ${err.message}`);
      console.log(`  ${label} ${a.github_login} ↔ ${b.github_login}  ERROR (${ms}ms): ${err.message}`);
    }
  }
  console.log();

  // ── FASE 3: Chat en tiempo real ───────────────────────────────────────────
  console.log('FASE 3 — Chat en tiempo real (Realtime Broadcast)');
  console.log('─'.repeat(54));

  const statsChat = {
    canalesConectados: 0,
    tiemposConexion: [],
    mensajesOk: 0,
    latencias: [],
    errores: [],
  };

  for (let i = 0; i < conversaciones.length; i++) {
    const conv = conversaciones[i];
    const par  = pares[i];
    const label = `[${String(i + 1).padStart(2)}/${conversaciones.length}]`;
    const autores = [conv.usuario_a, conv.usuario_b];

    // Abrir canal — mismo formato que src/websocket/chat.ts
    const t0 = Date.now();
    const canal = supabase.channel(nombreCanal(conv.id), {
      config: { broadcast: { self: true } },
    });

    try {
      await esperarSuscripcion(canal);
    } catch (err) {
      statsChat.errores.push(`canal ${conv.id}: conexión: ${err.message}`);
      console.log(`  ${label} ${par.a.github_login} ↔ ${par.b.github_login}  ERROR conexión: ${err.message}`);
      await supabase.removeChannel(canal);
      continue;
    }

    const msConexion = Date.now() - t0;
    statsChat.tiemposConexion.push(msConexion);
    statsChat.canalesConectados++;

    process.stdout.write(`  ${label} conectado ${msConexion}ms — mensajes: `);

    // Enviar mensajes alternando autor
    for (let m = 0; m < MENSAJES_POR_CANAL; m++) {
      const autorId = autores[m % 2];
      const ahora   = Date.now();
      const tEnvio  = Date.now();

      const estado = await canal.send({
        type:    'broadcast',
        event:   EVENTO_MENSAJE,
        payload: {
          id:              `${ahora}-${autorId}`,
          conversacion_id: conv.id,
          remitente_id:    autorId,
          contenido:       `mensaje de prueba ${m + 1}/${MENSAJES_POR_CANAL}`,
          estatus:         true,
          creado_en:       new Date(ahora).toISOString(),
          creado_por:      autorId,
          actualizado_en:  new Date(ahora).toISOString(),
          actualizado_por: autorId,
        },
      });

      const latencia = Date.now() - tEnvio;

      if (estado === 'ok') {
        statsChat.mensajesOk++;
        statsChat.latencias.push(latencia);
        process.stdout.write('·');
      } else {
        statsChat.errores.push(`canal ${conv.id} msg${m + 1}: ${estado}`);
        process.stdout.write('✗');
      }

      if (m < MENSAJES_POR_CANAL - 1) await sleep(DELAY_MENSAJES_MS);
    }
    console.log(` (${msConexion}ms conexión)`);

    await supabase.removeChannel(canal);
  }
  console.log();

  // ── FASE 4: Reporte final ─────────────────────────────────────────────────
  const duracionTotal = ((Date.now() - tiempoInicio) / 1000).toFixed(1);

  console.log('═'.repeat(54));
  console.log('=== REPORTE DE CARGA: 50 PARES SIMULADOS ===');
  console.log('═'.repeat(54));

  console.log('\nMATCHING:');
  console.log(`  Pares procesados:               ${statsMatch.procesados}/50`);
  console.log(`  Tiempo promedio de ciclo:       ${avg(statsMatch.tiemposCiclo)}ms`);
  console.log(`  Tiempo máximo de ciclo:         ${Math.max(0, ...statsMatch.tiemposCiclo)}ms`);
  console.log(`  Tiempo mínimo de ciclo:         ${Math.min(Infinity, ...statsMatch.tiemposCiclo) === Infinity ? 0 : Math.min(...statsMatch.tiemposCiclo)}ms`);
  console.log(`  Compatibilidad promedio:        ${avg(statsMatch.compatibilidades)}%`);
  if (statsMatch.errores.length === 0) {
    console.log('  Errores:                        ninguno');
  } else {
    console.log(`  Errores (${statsMatch.errores.length}):`);
    statsMatch.errores.forEach(e => console.log(`    - ${e}`));
  }

  console.log('\nCHAT EN TIEMPO REAL:');
  console.log(`  Canales conectados:             ${statsChat.canalesConectados}/${conversaciones.length}`);
  console.log(`  Tiempo promedio de conexión:    ${avg(statsChat.tiemposConexion)}ms`);
  console.log(`  Tiempo máximo de conexión:      ${Math.max(0, ...statsChat.tiemposConexion)}ms`);
  console.log(`  Mensajes entregados:            ${statsChat.mensajesOk}/${conversaciones.length * MENSAJES_POR_CANAL}`);
  console.log(`  Latencia promedio por mensaje:  ${avg(statsChat.latencias)}ms`);
  if (statsChat.errores.length === 0) {
    console.log('  Errores:                        ninguno');
  } else {
    console.log(`  Errores (${statsChat.errores.length}):`);
    statsChat.errores.forEach(e => console.log(`    - ${e}`));
  }

  console.log(`\nDURACIÓN TOTAL DEL TEST: ${duracionTotal}s`);
  console.log('═'.repeat(54) + '\n');

  process.exit(statsMatch.errores.length + statsChat.errores.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\nError fatal:', err.message);
  process.exit(1);
});
