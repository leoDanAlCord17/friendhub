'use strict';

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
    workspace: { getConfiguration: () => ({ get: (_, d) => d ?? '' }), workspaceFolders: null, findFiles: async () => [], fs: { readFile: async () => Buffer.alloc(0) } },
    window: { showWarningMessage: async () => {} },
    EventEmitter: class { constructor() { this._l = []; } get event() { return fn => { this._l.push(fn); return { dispose: () => {} }; }; } fire(d) { this._l.forEach(f => f(d)); } dispose() { this._l = []; } },
    Uri: { parse: s => ({ toString: () => s }), file: p => ({ fsPath: p }) },
    env: { openExternal: async () => {} },
    commands: { registerCommand: () => ({ dispose: () => {} }), executeCommand: async () => {} },
    ViewColumn: { One: 1 },
  },
};

const { createClient }  = require('@supabase/supabase-js');
const { setSupabase }   = require('../out/supabase/client');
const { crearFeedback } = require('../out/supabase/feedback');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
setSupabase(supabase);

const GH_ID = 'test-feedback-1';

let pasados = 0, fallados = 0;
function pass(msg) { console.log(`    ✓ PASS  ${msg}`); pasados++; }
function fail(msg) { console.log(`    ✗ FAIL  ${msg}`); fallados++; }

async function main() {
  console.log('\nTermPals — Test: crearFeedback()');
  console.log('─'.repeat(52));

  // ── Crear usuario de prueba ───────────────────────────────────────────────
  process.stdout.write('  creando usuario de prueba... ');
  const { data: usuario, error: errU } = await supabase
    .from('usuarios')
    .upsert({
      github_id:          GH_ID,
      github_login:       'feedback-testuser',
      nombre_usuario:     'feedback-testuser',
      estatus:            true,
      searches_hoy:       0,
      ultima_busqueda_en: null,
    }, { onConflict: 'github_id' })
    .select('id, github_login')
    .single();
  if (errU) { console.log(`ERROR: ${errU.message}`); process.exit(1); }
  console.log(`OK (id: ${usuario.id})`);

  // ── Test 1: insertar un bug ───────────────────────────────────────────────
  console.log('\n  Test 1 — insertar feedback tipo=bug:');
  const mensajeBug = 'el comando /tp search se congela al buscar';
  try {
    await crearFeedback(usuario.id, 'bug', mensajeBug, usuario.id);
    pass('crearFeedback() resolvió sin error');
  } catch (err) {
    fail(`crearFeedback() lanzó error: ${err.message}`);
  }

  // ── Test 2: insertar una sugerencia ──────────────────────────────────────
  console.log('\n  Test 2 — insertar feedback tipo=sugerencia:');
  const mensajeSug = 'agregar filtro por zona horaria en el match';
  try {
    await crearFeedback(usuario.id, 'sugerencia', mensajeSug, usuario.id);
    pass('crearFeedback() resolvió sin error');
  } catch (err) {
    fail(`crearFeedback() lanzó error: ${err.message}`);
  }

  // ── Test 3: verificar que los registros quedaron en la DB ─────────────────
  console.log('\n  Test 3 — confirmar persistencia en tabla feedback:');
  const { data: rows, error: errQ } = await supabase
    .from('feedback')
    .select('tipo, mensaje, creado_por')
    .eq('usuario_id', usuario.id)
    .order('creado_en');

  if (errQ) {
    fail(`error al consultar feedback: ${errQ.message}`);
  } else {
    const bug = rows.find(r => r.tipo === 'bug');
    const sug = rows.find(r => r.tipo === 'sugerencia');

    if (!bug)                         fail('no se encontró el registro tipo=bug');
    else if (bug.mensaje !== mensajeBug) fail(`mensaje bug incorrecto: "${bug.mensaje}"`);
    else if (bug.creado_por !== usuario.id) fail(`creado_por incorrecto: "${bug.creado_por}"`);
    else                              pass(`bug guardado — mensaje="${bug.mensaje}" creado_por=${bug.creado_por.slice(0,8)}...`);

    if (!sug)                         fail('no se encontró el registro tipo=sugerencia');
    else if (sug.mensaje !== mensajeSug) fail(`mensaje sugerencia incorrecto: "${sug.mensaje}"`);
    else if (sug.creado_por !== usuario.id) fail(`creado_por incorrecto: "${sug.creado_por}"`);
    else                              pass(`sugerencia guardada — mensaje="${sug.mensaje}"`);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  process.stdout.write('\n  limpiando datos del test... ');
  await supabase.from('feedback').delete().eq('usuario_id', usuario.id);
  await supabase.from('usuarios').delete().eq('github_id', GH_ID);
  console.log('OK');

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
