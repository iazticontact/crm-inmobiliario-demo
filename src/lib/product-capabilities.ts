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

// --- Configuración: estado real de cada bloque visible -------------------------------------------
export const PRODUCT_CAPABILITIES: ProductCapability[] = [
  {
    id: 'settings.account',
    module: 'Configuración · Mi cuenta',
    state: 'readonly',
    userExplanation:
      'Muestra el nombre del workspace, el administrador y el estado de la cuenta. Es informativo: de momento estos datos no se editan desde aquí.',
    cannotDo: ['Editar el nombre del workspace', 'Cambiar el email del administrador'],
    assistantCanExplain: true,
  },
  {
    id: 'settings.workspaceType',
    module: 'Configuración · Tipo de workspace',
    state: 'configurable',
    userExplanation:
      'Define el tipo de operación que domina en el workspace (Inmobiliaria, Extranjería, Servicios, Mixto o General). Se guarda y sirve de contexto para el CRM y el Asistente IA.',
    canDo: ['Elegir el tipo de workspace', 'Guardar el cambio'],
    assistantCanExplain: true,
  },
  {
    id: 'settings.team',
    module: 'Configuración · Equipo',
    state: 'active',
    userExplanation:
      'Muestra los usuarios con acceso al workspace y permite invitar a nuevos por email con un rol (Usuario o Administrador). La invitación envía un enlace seguro para que el usuario defina su contraseña.',
    canDo: ['Ver el equipo', 'Invitar usuario por email', 'Asignar rol', 'Eliminar usuario según permisos'],
    assistantCanExplain: true,
  },
  {
    id: 'settings.assistant',
    module: 'Configuración · Asistente IA',
    state: 'active',
    userExplanation:
      'El Asistente IA está incluido y activo: consulta datos reales del CRM, explica cómo usar los módulos y prepara acciones de forma segura. Las acciones no conectadas se dejan preparadas para realizarlas desde la interfaz.',
    canDo: ['Consultar datos reales del CRM', 'Explicar los módulos', 'Preparar acciones con confirmación'],
    cannotDo: ['Crear o guardar automáticamente sin confirmación', 'Enviar mensajes, emails o notificaciones'],
    assistantCanExplain: true,
  },
  {
    id: 'settings.notifications',
    module: 'Configuración · Notificaciones',
    state: 'upcoming',
    userExplanation:
      'Las notificaciones automáticas (avisos por email o resumen diario) están previstas para una fase posterior. Ahora mismo el CRM no envía avisos automáticos.',
    cannotDo: ['Enviar avisos por email', 'Resumen diario automático', 'Notificaciones push o por campana'],
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
