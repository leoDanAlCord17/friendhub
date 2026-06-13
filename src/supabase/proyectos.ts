import * as vscode from "vscode";
import { getSupabase } from "./client";
import { Proyecto } from "../types";

const TABLA = "proyectos";

/** Obtiene el proyecto activo de un usuario (el más reciente activo). */
export async function obtenerProyectoActivo(
  usuario_id: string,
): Promise<Proyecto | null> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .select("*")
    .eq("usuario_id", usuario_id)
    .eq("estatus", "activo")
    .order("actualizado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data as Proyecto | null;
}

/** Crea o actualiza el proyecto de un usuario (upsert por usuario_id). */
export async function crearOActualizarProyecto(
  datos: Partial<Proyecto>,
): Promise<Proyecto> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .upsert(
      { ...datos, actualizado_en: new Date().toISOString() },
      { onConflict: "usuario_id" },
    )
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return data as Proyecto;
}

/** Lista todos los proyectos activos (para el matching). */
export async function listarProyectos(): Promise<Proyecto[]> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .select("*")
    .eq("estatus", "activo");
  if (error) {
    throw error;
  }
  return (data ?? []) as Proyecto[];
}

// ---------------------------------------------------------------------------
// Detección automática del workspace
// ---------------------------------------------------------------------------

interface MarcadorLenguaje {
  archivo: string;
  lenguaje: string;
}

const MARCADORES: MarcadorLenguaje[] = [
  { archivo: "package.json", lenguaje: "JavaScript/TypeScript" },
  { archivo: "requirements.txt", lenguaje: "Python" },
  { archivo: "pubspec.yaml", lenguaje: "Dart/Flutter" },
  { archivo: "Cargo.toml", lenguaje: "Rust" },
  { archivo: "go.mod", lenguaje: "Go" },
  { archivo: "pom.xml", lenguaje: "Java" },
];

/**
 * Inspecciona el workspace abierto y deduce lenguaje, dominio, stack y si
 * tiene tests. Devuelve un `Partial<Proyecto>` listo para persistir.
 */
export async function detectarWorkspace(): Promise<Partial<Proyecto>> {
  const carpeta = vscode.workspace.workspaceFolders?.[0];
  const resultado: Partial<Proyecto> = {
    nombre: carpeta?.name ?? "proyecto",
    lenguajes: [],
    stack: [],
    tiene_tests: false,
    lenguaje_principal: null,
    dominio: null,
  };
  if (!carpeta) {
    return resultado;
  }

  const lenguajes = new Set<string>();
  let lenguajePrincipal: string | null = null;

  for (const marcador of MARCADORES) {
    const encontrados = await vscode.workspace.findFiles(
      `**/${marcador.archivo}`,
      "**/node_modules/**",
      1,
    );
    if (encontrados.length > 0) {
      lenguajes.add(marcador.lenguaje);
      if (!lenguajePrincipal) {
        lenguajePrincipal = marcador.lenguaje;
      }
    }
  }

  resultado.lenguajes = [...lenguajes];
  resultado.lenguaje_principal = lenguajePrincipal;

  // Tests: carpetas o archivos típicos.
  const tests = await vscode.workspace.findFiles(
    "**/{test,tests,__tests__}/**/*.*",
    "**/node_modules/**",
    1,
  );
  let tieneTests = tests.length > 0;
  if (!tieneTests) {
    const specs = await vscode.workspace.findFiles(
      "**/*.{test,spec}.*",
      "**/node_modules/**",
      1,
    );
    tieneTests = specs.length > 0;
  }
  resultado.tiene_tests = tieneTests;

  // Stack y dominio a partir de package.json si existe.
  const stack = new Set<string>();
  const pkgUris = await vscode.workspace.findFiles(
    "**/package.json",
    "**/node_modules/**",
    1,
  );
  let dominio: string | null = null;

  if (pkgUris.length > 0) {
    const deps = await leerDependenciasPackage(pkgUris[0]);
    for (const d of deps) {
      stack.add(d);
    }
    if (deps.some((d) => /^(react|next|vue|@angular\/core|svelte)$/.test(d))) {
      dominio = "web";
    }
    if (deps.some((d) => /^(express|fastify|koa|@nestjs\/core)$/.test(d))) {
      dominio = dominio ?? "backend";
    }
  }

  if (lenguajes.has("Dart/Flutter")) {
    dominio = "mobile";
  }
  if (!dominio) {
    const apiDir = await vscode.workspace.findFiles(
      "**/api/**/*.*",
      "**/node_modules/**",
      1,
    );
    if (apiDir.length > 0) {
      dominio = "backend";
    }
  }

  resultado.dominio = dominio;
  resultado.stack = [...stack].slice(0, 12);
  return resultado;
}

async function leerDependenciasPackage(uri: vscode.Uri): Promise<string[]> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const pkg = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
  } catch {
    return [];
  }
}
