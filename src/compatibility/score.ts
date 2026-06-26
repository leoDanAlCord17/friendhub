import { Proyecto, ResultadoCompatibilidad } from "../types";

/**
 * Puntaje de compatibilidad técnica entre dos proyectos.
 *
 * Reparto de puntos:
 *  - Lenguaje principal coincide ........ 40
 *  - Dominio similar .................... 25
 *  - Ambos tienen tests ................. 20
 *  - Zona horaria compatible (±3h) ...... 15
 *                                        ----
 *  Total máximo ......................... 100
 */

const PUNTOS_LENGUAJE = 40;
const PUNTOS_DOMINIO = 25;
const PUNTOS_TESTS = 20;
const PUNTOS_ZONA = 15;

/** Margen máximo de diferencia horaria considerado compatible. */
const HORAS_MARGEN = 3;

/**
 * Calcula la compatibilidad (0-100) y su desglose entre dos proyectos.
 * zonaA / zonaB provienen del objeto Usuario (no del proyecto).
 */
export function calcularCompatibilidad(
  a: Proyecto,
  b: Proyecto,
  zonaA?: string | null,
  zonaB?: string | null,
): ResultadoCompatibilidad {
  const lenguaje = lenguajeCoincide(a, b) ? PUNTOS_LENGUAJE : 0;
  const dominio = dominioSimilar(a, b) ? PUNTOS_DOMINIO : 0;
  const tests = a.tiene_tests && b.tiene_tests ? PUNTOS_TESTS : 0;
  const zonaHoraria = zonaCompatible(zonaA, zonaB) ? PUNTOS_ZONA : 0;

  const puntaje = lenguaje + dominio + tests + zonaHoraria;

  return {
    puntaje: Math.max(0, Math.min(100, puntaje)),
    desglose: { lenguaje, dominio, tests, zonaHoraria },
  };
}

/** El lenguaje principal coincide (sin distinguir mayúsculas). */
function lenguajeCoincide(a: Proyecto, b: Proyecto): boolean {
  if (!a.lenguajes?.length || !b.lenguajes?.length) {
    return false;
  }
  return (
    a.lenguajes[0].trim().toLowerCase() ===
    b.lenguajes[0].trim().toLowerCase()
  );
}

/** Los dominios son iguales (normalizados). */
function dominioSimilar(a: Proyecto, b: Proyecto): boolean {
  if (!a.dominio || !b.dominio) {
    return false;
  }
  return a.dominio.trim().toLowerCase() === b.dominio.trim().toLowerCase();
}

/** La diferencia de offset UTC entre ambas zonas es ≤ ±3 horas. */
function zonaCompatible(
  zonaA: string | null | undefined,
  zonaB: string | null | undefined,
): boolean {
  const offsetA = offsetUtc(zonaA ?? null);
  const offsetB = offsetUtc(zonaB ?? null);
  if (offsetA === null || offsetB === null) {
    return false;
  }
  return Math.abs(offsetA - offsetB) <= HORAS_MARGEN;
}

/**
 * Convierte una zona horaria a su offset UTC en horas.
 *
 * Acepta formatos como "UTC-6", "UTC+5:30", "-3", "+02:00".
 * Devuelve `null` si no se puede interpretar.
 */
function offsetUtc(zona: string | null): number | null {
  if (!zona) {
    return null;
  }
  const limpio = zona.trim().toUpperCase().replace("UTC", "").replace("GMT", "");
  const match = limpio.match(/^([+-]?)(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const signo = match[1] === "-" ? -1 : 1;
  const horas = parseInt(match[2], 10);
  const minutos = match[3] ? parseInt(match[3], 10) : 0;
  return signo * (horas + minutos / 60);
}
