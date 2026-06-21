// Filtro de seguridad de contenido para superficies cliente-facing.
//
// Los datos de demo/pruebas pueden contener texto que un usuario tecleó al
// trastear (lenguaje vulgar, basura sin sentido comercial). Nunca queremos
// renderizar eso en el producto. Esto es una RED DEFENSIVA: el dato origen
// también debe sanearse (ver migración 20260621_p34_*), pero este filtro evita
// que cualquier texto inapropiado llegue a pintarse en el dashboard.
//
// Lista deliberadamente corta y centrada en stems con límite de palabra para no
// generar falsos positivos en texto comercial normal.
const BLOCKED_TEXT = /\b(follar|folla|folle|sexo|sexual|puta|putas|polla|pollas|co(?:ñ|n)o|joder|mierda|cabr(?:o|ó)n|gilipollas|zorra|capullo|porno|maric|verga|chocho|pendej)\b/i

/**
 * Devuelve true si CUALQUIERA de los textos contiene contenido bloqueado.
 * Pensado para usarse como guard antes de mostrar texto libre del usuario.
 */
export function containsBlockedText(...values: (string | null | undefined)[]): boolean {
  return values.some((value) => typeof value === 'string' && BLOCKED_TEXT.test(value))
}
