'use strict';
// scripts/test-consentimiento.js — verifica el sistema de consentimiento GDPR

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: define SUPABASE_URL y SUPABASE_ANON_KEY');
  process.exit(1);
}

// ── Stub vscode ────────────────────────────────────────────────────────────
const Module = require('module');
const _orig = Module._resolveFilename;
Module._resolveFilename = function (req, p, m, o) {
  if (req === 'vscode') return 'vscode';
  return _orig.call(this, req, p, m, o);
};
require.cache['vscode'] = {
  id: 'vscode', filename: 'vscode', loaded: true,
  exports: {
    workspace: { getConfiguration: () => ({ get: (_, d) => d ?? '' }), workspaceFolders: null, findFiles: async () => [], fs: { readFile: async () => Buffer.alloc(0) } },
    window: { showWarningMessage: async () => {} },
    EventEmitter: class { constructor() { this._l = []; } get event() { return fn => { this._l.push(fn); return { dispose: () => {} }; }; } fire(d) { this._l.forEach(f => f(d)); } dispose() { this._l = []; } },
    Uri: { parse: s => ({ toString: () => s }), file: p => ({ fsPath: p }) },
    env: { openExternal: async () => {} },
    commands: { registerCommand: () => ({ dispose: () => {} }), executeCommand: async () => {} },
    ViewColumn: { One: 1 },
  },
};

const { createClient }              = require('@supabase/supabase-js');
const { setSupabase }               = require('../out/supabase/client');
const { obtenerVersionActiva, registrarConsentimiento } = require('../out/supabase/consentimientos');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
setSupabase(supabase);

let pasados = 0, fallados = 0;
function pass(msg) { console.log(`    ✓ PASS  ${msg}`); pasados++; }
function fail(msg) { console.log(`    ✗ FAIL  ${msg}`); fallados++; }

async function main() {
  console.log('\nTermPals — Test: sistema de consentimiento GDPR');
  console.log('─'.repeat(54));

  // ── Test 1: obtener @leoDanAlCord17 ───────────────────────────────────────
  console.log('\n  Test 1 — obtener usuario @leoDanAlCord17:');
  const { data: usuario, error: errU } = await supabase
    .from('usuarios')
    .select('id, github_login, consentimiento_activo, consentimiento_id')
    .eq('github_login', 'leoDanAlCord17')
    .maybeSingle();

  let usuarioId;
  if (errU || !usuario) {
    fail(`usuario no encontrado: ${errU?.message ?? 'null'}`);
    process.exit(1);
  }
  usuarioId = usuario.id;
  pass(`@${usuario.github_login}  id: ${usuarioId.slice(0, 8)}...  activo_antes: ${usuario.consentimiento_activo}`);

  // ── Test 2: obtenerVersionActiva devuelve v1.0 ────────────────────────────
  console.log('\n  Test 2 — obtenerVersionActiva() devuelve v1.0:');
  let version;
  try {
    version = await obtenerVersionActiva();
    if (!version) {
      fail('devolvió null — no hay versión activa en la DB');
    } else if (version.version !== '1.0') {
      fail(`versión inesperada: "${version.version}" (esperaba "1.0")`);
    } else {
      pass(`versión activa: v${version.version}  id: ${version.id.slice(0, 8)}...`);
    }
  } catch (err) {
    fail(`excepción: ${err.message}`);
    process.exit(1);
  }
  if (!version) { process.exit(1); }

  // ── Test 3: registrar consentimiento 'aceptado' ───────────────────────────
  console.log('\n  Test 3 — registrarConsentimiento(aceptado, todos granulares=true):');
  let cons;
  try {
    cons = await registrarConsentimiento(
      usuarioId,
      version.id,
      'aceptado',
      { acepta_perfil: true, acepta_stack: true, acepta_readme: true, acepta_matching: true },
      '0.1.0',
    );
    pass(`consentimiento creado  id: ${cons.id.slice(0, 8)}...`);
  } catch (err) {
    fail(`excepción al registrar: ${err.message}`);
    process.exit(1);
  }

  // ── Test 4: verificar registro en tabla consentimientos ───────────────────
  console.log('\n  Test 4 — verificar fila en tabla consentimientos:');
  const { data: rowCons, error: errCons } = await supabase
    .from('consentimientos')
    .select('id, accion, acepta_perfil, acepta_stack, acepta_readme, acepta_matching, extension_version')
    .eq('id', cons.id)
    .maybeSingle();

  if (errCons || !rowCons) {
    fail(`no se encontró el registro: ${errCons?.message ?? 'null'}`);
  } else if (rowCons.accion !== 'aceptado') {
    fail(`accion incorrecta: "${rowCons.accion}"`);
  } else if (!rowCons.acepta_perfil || !rowCons.acepta_stack || !rowCons.acepta_readme || !rowCons.acepta_matching) {
    fail(`granulares incorrectos: ${JSON.stringify(rowCons)}`);
  } else if (rowCons.extension_version !== '0.1.0') {
    fail(`extension_version incorrecta: "${rowCons.extension_version}"`);
  } else {
    pass(`accion=aceptado  todos granulares=true  extension_version=0.1.0`);
  }

  // ── Test 5: verificar consentimiento_activo = true en usuarios ────────────
  console.log('\n  Test 5 — usuarios.consentimiento_activo = true:');
  const { data: u1, error: err1 } = await supabase
    .from('usuarios')
    .select('consentimiento_activo, consentimiento_id')
    .eq('id', usuarioId)
    .maybeSingle();

  if (err1 || !u1) {
    fail(`error al leer usuario: ${err1?.message ?? 'null'}`);
  } else if (!u1.consentimiento_activo) {
    fail('consentimiento_activo sigue en false — UPDATE no funcionó');
  } else if (u1.consentimiento_id !== cons.id) {
    fail(`consentimiento_id incorrecto: "${u1.consentimiento_id}"`);
  } else {
    pass(`consentimiento_activo=true  consentimiento_id correcto`);
  }

  // ── Test 6: registrar 'retirado' ──────────────────────────────────────────
  console.log('\n  Test 6 — registrarConsentimiento(retirado):');
  try {
    await registrarConsentimiento(
      usuarioId,
      version.id,
      'retirado',
      { acepta_perfil: false, acepta_stack: false, acepta_readme: false, acepta_matching: false },
      '0.1.0',
    );
    pass('registrarConsentimiento(retirado) completó sin error');
  } catch (err) {
    fail(`excepción al retirar: ${err.message}`);
  }

  // ── Test 7: verificar consentimiento_activo = false ───────────────────────
  console.log('\n  Test 7 — usuarios.consentimiento_activo = false:');
  const { data: u2, error: err2 } = await supabase
    .from('usuarios')
    .select('consentimiento_activo')
    .eq('id', usuarioId)
    .maybeSingle();

  if (err2 || !u2) {
    fail(`error al leer usuario: ${err2?.message ?? 'null'}`);
  } else if (u2.consentimiento_activo) {
    fail('consentimiento_activo sigue true — UPDATE no funcionó');
  } else {
    pass('consentimiento_activo=false correctamente');
  }

  // ── Test 8: restaurar con 'aceptado' ─────────────────────────────────────
  console.log('\n  Test 8 — restaurar: registrarConsentimiento(aceptado):');
  try {
    await registrarConsentimiento(
      usuarioId,
      version.id,
      'aceptado',
      { acepta_perfil: true, acepta_stack: true, acepta_readme: true, acepta_matching: true },
      '0.1.0',
    );
    pass('estado restaurado — usuario queda con consentimiento_activo=true');
  } catch (err) {
    fail(`excepción al restaurar: ${err.message}`);
  }

  // ── Resultado ─────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(54));
  const total = pasados + fallados;
  console.log(`  ${pasados}/${total} PASS${fallados > 0 ? `  (${fallados} FAIL)` : ''}`);
  console.log(`  resultado final: ${fallados === 0 ? '✓ PASS' : '✗ FAIL'}\n`);
  process.exit(fallados === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('\nError fatal:', err.message);
  process.exit(1);
});
