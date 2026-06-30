// Mapa funcional del producto (P14). Fuente única y SIMPLE del estado real de cada sección visible del
// CRM. Objetivo: cero humo. La UI lo usa para pintar badges honestos ("Activo", "Solo lectura",
// "Configurable", "Próximamente") y el Asistente IA (fallback local) lo usa para RAZONAR sobre la
// pantalla de Configuración sin inventar funciones que no existen.
//
// No describe arquitectura interna (tablas, tools, endpoints): describe PRODUCTO de cara al usuario.
// Si mañana cambia una sección, se actualiza aquí y tanto la UI como el razonamiento del Asistente
// quedan alineados sin tocar prompts ni duplicar conocimiento.

export type CapabilityState = 'active' | 'readonly' | 'configurable' | 'upcoming' | 'hidden'

export type ProductCapability = {
  /** Identificador estable (sección.bloque). */
  id: string
  /** Sección visible para el usuario. */
  module: string
  /** Estado real del bloque. */
  state: CapabilityState
  /** Explicación de producto (guía, no soporte técnico). */
  userExplanation: string
  /** Acciones que el usuario SÍ puede hacer hoy. */
  canDo?: string[]
  /** Acciones que NO están disponibles (futuras o no conectadas). */
  cannotDo?: string[]
  /** Si el Asistente IA puede explicarlo con seguridad. */
  assistantCanExplain: boolean
}

export const CAPABILITY_STATE_LABEL: Record<CapabilityState, string> = {
  active: 'Activo',
  readonly: 'Solo lectura',
  configurable: 'Configurable',
  upcoming: 'Próximamente',
  hidden: 'Oculto',
}

export const CAPABILITY_STATE_VARIANT: Record<CapabilityState, 'success' | 'default' | 'indigo' | 'warning'> = {
  active: 'success',
  readonly: 'default',
  configurable: 'indigo',
  upcoming: 'warning',
  hidden: 'default',
}

// --- Configuración: estado real de cada bloque visible (P16: sin roadmap ni "Próximamente") -------
export const PRODUCT_CAPABILITIES: ProductCapability[] = [
  {
    id: 'settings.profile',
    module: 'Configuración · Perfil',
    state: 'configurable',
    userExplanation:
      'Tu identidad en el CRM. El nombre visible es editable y se guarda, y puedes subir o cambiar tu foto de perfil (JPG, PNG o WebP, hasta 2 MB); email, rol, idioma y estado de la cuenta son informativos.',
    canDo: ['Editar el nombre visible y guardarlo', 'Subir, cambiar o eliminar la foto de perfil'],
    cannotDo: ['Cambiar el email o el rol desde aquí'],
    assistantCanExplain: true,
  },
  {
    id: 'settings.company',
    module: 'Configuración · Empresa',
    state: 'configurable',
    userExplanation:
      'Datos de tu inmobiliaria: nombre comercial, descripción, teléfono, web y email de contacto. Son editables, se guardan y dan contexto al CRM y al Asistente IA. La actividad principal es Inmobiliaria.',
    canDo: ['Editar el nombre comercial', 'Editar la descripción', 'Editar teléfono, web y email de contacto', 'Guardar los cambios'],
    assistantCanExplain: true,
  },
  {
    id: 'settings.team',
    module: 'Configuración · Equipo',
    state: 'active',
    userExplanation:
      'Invita a miembros de tu equipo (comerciales, administradores, gestores) para que accedan al workspace y trabajen sobre los mismos clientes, inmuebles, operaciones y tareas. La invitación se envía por email con un rol y un enlace seguro para definir la contraseña. No es para clientes finales.',
    canDo: ['Ver el equipo', 'Invitar miembro por email', 'Asignar rol', 'Eliminar usuario según permisos'],
    assistantCanExplain: true,
  },
  {
    id: 'settings.assistant',
    module: 'Configuración · Asistente IA',
    state: 'active',
    userExplanation:
      'Acceso al Asistente IA, que ya está en el menú lateral. Consulta datos reales del CRM y prepara acciones con tu confirmación.',
    canDo: ['Abrir el Asistente IA'],
    assistantCanExplain: true,
  },
]

const BY_ID = new Map(PRODUCT_CAPABILITIES.map((c) => [c.id, c]))

export function getCapability(id: string): ProductCapability | undefined {
  return BY_ID.get(id)
}

export function capabilityState(id: string): CapabilityState | undefined {
  return BY_ID.get(id)?.state
}

// Resumen funcional de Configuración en texto plano, pensado para que el Asistente IA RAZONE sobre la
// pantalla (no para memorizar una respuesta fija). Si la pantalla cambia, este texto cambia con el mapa.
export function configCapabilitiesSummary(): string {
  return PRODUCT_CAPABILITIES
    .filter((c) => c.assistantCanExplain && c.state !== 'hidden')
    .map((c) => `- ${c.module} [${CAPABILITY_STATE_LABEL[c.state]}]: ${c.userExplanation}`)
    .join('\n')
}
