'use strict';

// scripts/test-uuid-validation.js
// Verifica que las funciones con validación UUID (confirmarAmistad,
// obtenerConversacionActiva) lanzan error con IDs inválidos,
// y retornan el resultado correcto con UUIDs válidos que no existen.

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: define SUPABASE_URL y SUPABASE_ANON_KEY');
  process.exit(1);
}

// ── Stub vscode ───────────────────────────────────────────────────────────────
const Module = require('module');
const _orig = Module._resolveFilename;
Module._resolveFilename = function (req, p, m, o) {
  if (req === 'vscode') return 'vscode';
  return _orig.call(this, req, p, m, o);
};
require.cache['vscode'] = {
  id: 'vscode', filename: 'vscode', loaded: true,
  exports: {
    workspace: { getConfiguration: () => ({ get: (_, d) => d ?? '' }), workspaceFolders: null },
    window: { showWarningMessage: async () => {} },
    EventEmitter: class { constructor() { this._l = []; } get event() { return fn => { this._l.push(fn); return { dispose: () => {} }; }; } fire(d) { this._l.forEach(f => f(d)); } dispose() { this._l = []; } },
    Uri: { parse: s => ({ toString: () => s }), file: p => ({ fsPath: p }) },
    env: { openExternal: async () => {} },
  },
};

const { createClient }           = require('@supabase/supabase-js');
const { setSupabase }            = require('../out/supabase/client');
const { confirmarAmistad }       = require('../out/supabase/amigos');
const { obtenerConversacionActiva } = require('../out/supabase/conversaciones');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
setSupabase(supabase);

// UUIDs de prueba — no existen en la DB
const UUID_VALIDO_A = '00000000-0000-0000-0000-000000000001';
const UUID_VALIDO_B = '00000000-0000-0000-0000-000000000002';
const ID_INVALIDO   = 'no-es-un-uuid';
const ID_INYECCION  = "' OR 1=1 --";

let pasados = 0, fallados = 0;
function pass(msg) { console.log(`    ✓ PASS  ${msg}`); pasados++; }
function fail(msg) { console.log(`    ✗ FAIL  ${msg}`); fallados++; }

async function main() {
  console.log('\nTermPals — Test: validación de UUIDs en queries Supabase');
  console.log('─'.repeat(52));

  // ── Test 1: confirmarAmistad con ID inválido debe lanzar error ────────────
  console.log('\n  Test 1 — confirmarAmistad() con ID inválido lanza error:');
  try {
    await confirmarAmistad(ID_INVALIDO, UUID_VALIDO_B);
    fail('no lanzó error con ID inválido en posición A');
  } catch (err) {
    if (err.message === 'ID de usuario inválido') {
      pass(`lanzó Error("ID de usuario inválido") — ID inválido en posición A`);
    } else {
      fail(`lanzó error pero mensaje incorrecto: "${err.message}"`);
    }
  }

  // ── Test 2: confirmarAmistad con segundo ID inválido ─────────────────────
  console.log('\n  Test 2 — confirmarAmistad() con ID inválido en posición B:');
  try {
    await confirmarAmistad(UUID_VALIDO_A, ID_INVALIDO);
    fail('no lanzó error con ID inválido en posición B');
  } catch (err) {
    if (err.message === 'ID de usuario inválido') {
      pass(`lanzó Error("ID de usuario inválido") — ID inválido en posición B`);
    } else {
      fail(`lanzó error pero mensaje incorrecto: "${err.message}"`);
    }
  }

  // ── Test 3: confirmarAmistad con string de inyección SQL ─────────────────
  console.log('\n  Test 3 — confirmarAmistad() con string de inyección SQL:');
  try {
    await confirmarAmistad(ID_INYECCION, UUID_VALIDO_B);
    fail('no lanzó error con string de inyección SQL');
  } catch (err) {
    if (err.message === 'ID de usuario inválido') {
      pass(`lanzó Error("ID de usuario inválido") — inyección SQL bloqueada`);
    } else {
      fail(`error inesperado: "${err.message}"`);
    }
  }

  // ── Test 4: obtenerConversacionActiva con ID inválido ────────────────────
  console.log('\n  Test 4 — obtenerConversacionActiva() con ID inválido lanza error:');
  try {
    await obtenerConversacionActiva(ID_INVALIDO);
    fail('no lanzó error con ID inválido');
  } catch (err) {
    if (err.message === 'ID de usuario inválido') {
      pass(`lanzó Error("ID de usuario inválido")`);
    } else {
      fail(`lanzó error pero mensaje incorrecto: "${err.message}"`);
    }
  }

  // ── Test 5: obtenerConversacionActiva con UUID válido que no existe ───────
  console.log('\n  Test 5 — obtenerConversacionActiva() con UUID válido inexistente → null:');
  try {
    const resultado = await obtenerConversacionActiva(UUID_VALIDO_A);
    if (resultado === null) {
      pass('retornó null para UUID válido sin conversación activa');
    } else {
      fail(`esperaba null, obtuvo: ${JSON.stringify(resultado)}`);
    }
  } catch (err) {
    fail(`lanzó error inesperado: ${err.message}`);
  }

  // ── Test 6: confirmarAmistad con UUIDs válidos que no existen ───────────
  // La validación UUID pasa. Supabase puede devolver FK/RLS error al intentar
  // el UPDATE — eso es aceptable: lo que importa es que NO se lanzó
  // 'ID de usuario inválido'.
  console.log('\n  Test 6 — confirmarAmistad() con UUIDs válidos: validación UUID pasa:');
  try {
    await confirmarAmistad(UUID_VALIDO_A, UUID_VALIDO_B);
    pass('no lanzó error — validación UUID pasó, UPDATE afectó 0 filas (esperado)');
  } catch (err) {
    if (err.message === 'ID de usuario inválido') {
      fail(`UUID válido rechazado por validación UUID: "${err.message}"`);
    } else {
      pass(`validación UUID pasó — error de DB esperado: "${err.message.slice(0, 70)}"`);
    }
  }

  console.log('\n' + '─'.repeat(52));
  const total = pasados + fallados;
  console.log(`  ${pasados}/${total} PASS${fallados > 0 ? `  (${fallados} FAIL)` : ''}`);
  console.log(`  resultado final: ${fallados === 0 ? '✓ PASS' : '✗ FAIL'}\n`);

  process.exit(fallados === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('\nError fatal:', err.message);
  process.exit(1);
});
