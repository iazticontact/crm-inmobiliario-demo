// Evals de coherencia del Asistente con el CRM final (P10 + ampliado en P12.1).
//
// El repo NO tiene runner de evals (sin jest/vitest, y ejecutar el LLM real sería costoso y
// flaky). Este fichero es la FUENTE DE VERDAD de las expectativas: cada caso documenta qué tool
// debería usar el agente y qué vocabulario DEBE / NO DEBE aparecer en la respuesta visible.
// Sirve para QA manual (staging) y para enchufar un runner en el futuro sin reinventar los casos.

export type AssistantEval = {
  /** Pregunta del usuario. */
  question: string
  /** Tool(s) esperada(s). 'llm' = el router difiere y el LLM elige (se indica la tool objetivo). */
  expectedTool: string
  /** Vocabulario que DEBE aparecer en la respuesta (CRM actual). */
  mustMention: string[]
  /** Vocabulario PROHIBIDO en la respuesta visible. */
  mustNotMention: string[]
  notes?: string
}

const FORBIDDEN_GLOBAL = ['pipeline', 'expediente', 'oportunidad', 'probabilidad', 'lead score']

export const ASSISTANT_COHERENCE_EVALS: AssistantEval[] = [
  {
    question: '¿Qué inmuebles tengo activos?',
    expectedTool: 'list_properties',
    mustMention: ['inmueble', 'activo'],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'propiedad del pipeline'],
    notes: 'Activos = En preparación / Publicado / Reservado. No incluir histórico (vendido/alquilado/archivado).',
  },
  {
    question: '¿Qué operaciones están en gestión?',
    expectedTool: 'list_opportunities',
    mustMention: ['operación', 'en gestión'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Estado comercial "En gestión" (etapas internas contacted/qualified/visit_scheduled/offer/negotiation).',
  },
  {
    question: '¿Qué trámites vencen?',
    expectedTool: 'list_pending_items',
    mustMention: ['trámite', 'vence'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Trámites abiertos con due_date próximo o vencido. Alternativa: list_service_cases.',
  },
  {
    question: '¿Qué citas tengo hoy?',
    expectedTool: 'upcoming_events',
    mustMention: ['cita'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Router determinista → upcoming_events ("citas de hoy").',
  },
  {
    question: '¿Qué comisiones tengo pendientes?',
    expectedTool: 'workspace_overview',
    mustMention: ['comisión', 'pendiente'],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'factura', 'facturación'],
    notes: 'Comisión = control interno (prevista/pendiente/cobrada de operaciones cerradas). Nunca "facturación".',
  },
  {
    question: '¿Este inmueble está vendido o activo?',
    expectedTool: 'list_properties',
    mustMention: ['estado'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Responder por el estado del inmueble: activo (En preparación/Publicado/Reservado) o histórico (Vendido/Alquilado/Archivado).',
  },
  {
    question: 'Enséñame el resumen de Roberto Díaz',
    expectedTool: 'get_client_context',
    mustMention: ['operaciones', 'trámites', 'citas'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Ficha 360: contacto + operaciones + trámites + tareas + citas + actividad. Nunca mostrar lead score.',
  },
  // --- Añadidos en P12.1 ---
  {
    question: 'Hola',
    expectedTool: 'none',
    mustMention: [],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'estoy operativo'],
    notes: 'Saludo natural y breve; NO soltar parrafada ni lista de capacidades sin que la pidan.',
  },
  {
    question: 'Dame un resumen del día',
    expectedTool: 'recommended_actions',
    mustMention: ['citas', 'vencimientos', 'operaciones'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Cruza citas de hoy, trámites/tareas que vencen y operaciones importantes. Alternativa: workspace_overview.',
  },
  {
    question: 'Completa la tarea de llamar a Lucía',
    expectedTool: 'update_task',
    mustMention: ['confirm'],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'completed'],
    notes: 'Prepara la acción y pide CONFIRMACIÓN. Al confirmar, escribe status="done" (NUNCA "completed"; viola tasks_status_check).',
  },
  {
    question: 'Crea una operación de venta para Roberto Díaz',
    expectedTool: 'create_opportunity',
    mustMention: ['confirm'],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'won', 'lost'],
    notes: 'Prepara la acción con confirmación; no escribe directo. Estado comercial en humano (Nueva/En gestión/Reserva/Vendida-Alquilada).',
  },
  {
    question: '¿Qué comisiones tengo pendientes? (workspace sin datos)',
    expectedTool: 'workspace_overview',
    mustMention: ['no'],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'factura'],
    notes: 'Si no hay datos reales, decir que no consta / no hay comisiones pendientes. NUNCA inventar cifras.',
  },
  // --- Comportamiento / personalidad / coste (P12.2) ---
  {
    question: 'Hola buenas',
    expectedTool: 'none',
    mustMention: [],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'dime que quieres mirar del crm', 'estoy operativo'],
    notes: 'Saludo humano y corto (p. ej. "¡Buenas! 👋 ¿Qué tal?"). NO "Dime qué quieres mirar del CRM". Sin tools.',
  },
  {
    question: 'Qué tal todo?',
    expectedTool: 'none',
    mustMention: [],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Cortesía breve y natural. Sin tools, sin parrafada, sin capability spam.',
  },
  {
    question: 'Ya estoy de vuelta',
    expectedTool: 'none',
    mustMention: [],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Reapertura = inicio fresco: "Perfecto, bienvenido de vuelta. ¿Seguimos con el CRM?". Sin arrastrar tema previo.',
  },
  {
    question: 'Estoy leyendo Padre rico padre pobre',
    expectedTool: 'none',
    mustMention: [],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Off-topic 1ª vez: 1 línea sobre el libro + reconducción suave al CRM. Sin tools, sin ranking largo.',
  },
  {
    question: 'Hazme un ranking de 10 libros de finanzas (3er turno off-topic)',
    expectedTool: 'none',
    mustMention: ['CRM'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Off-topic persistente: límite amable y foco CRM ("…soy el Asistente IA del CRM y estoy pensado para…"). NO listar 10 libros.',
  },
  {
    question: '(repetición) cualquier consulta CRM seguida de otra',
    expectedTool: 'varía',
    mustMention: [],
    mustNotMention: ['¿quieres mirar algo del CRM?'],
    notes: 'No cerrar SIEMPRE con la misma coletilla ("¿quieres mirar algo del CRM?"). Varía los cierres.',
  },
  // --- Guía funcional del CRM vs arquitectura técnica (P12.4) ---
  {
    question: '¿Cómo funciona el Dashboard?',
    expectedTool: 'none',
    mustMention: ['cartera', 'comisiones'],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'no puedo explicar', 'soporte'],
    notes: 'AYUDA FUNCIONAL: explica (sin tools) que resume el negocio: cartera activa, operaciones, citas, vencimientos, rendimiento comercial; comisiones = control interno. NUNCA "no puedo explicar el Dashboard".',
  },
  {
    question: '¿Cómo funciona el CRM? ¿Para qué sirve cada módulo?',
    expectedTool: 'none',
    mustMention: ['inmuebles', 'operaciones', 'trámites'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Explica módulos en lenguaje de usuario (Clientes, Cartera, Operaciones, Trámites, Calendario, Dashboard, Comisiones). Sin tools, sin tecnicismos.',
  },
  {
    question: '¿Qué base de datos usas? ¿Esto va con n8n o Supabase?',
    expectedTool: 'none',
    mustMention: ['equipo técnico'],
    mustNotMention: ['n8n', 'Supabase', 'OpenAI', 'webhook', 'RLS', 'service_role'],
    notes: 'ARQUITECTURA: NO la revela. Dice que lo gestiona el equipo técnico y reconduce a datos o funcionamiento del CRM. No confundir con ayuda funcional (esa SÍ se da).',
  },
  // --- Fiabilidad: consultas ordenadas + no negar errores (P12.6) ---
  {
    question: 'Dame el último cliente registrado',
    expectedTool: 'get_latest_client',
    mustMention: [],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Último/más reciente: get_latest_client o crm_read_query orderBy=created_at desc limit 1. Datos reales.',
  },
  {
    question: 'Dame el primer cliente registrado',
    expectedTool: 'crm_read_query',
    mustMention: [],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Primero/más antiguo: crm_read_query entity=clients orderBy=created_at orderDirection=asc offset=0 limit=1.',
  },
  {
    question: 'Dame el tercer cliente registrado',
    expectedTool: 'crm_read_query',
    mustMention: [],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'Inversiones Atlantico'],
    notes: 'Tercero: crm_read_query orderBy=created_at asc offset=2 limit=1. NUNCA reutilizar get_latest_client/entidad activa ni devolver el último.',
  },
  {
    question: 'Y el quinto?',
    expectedTool: 'crm_read_query',
    mustMention: [],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Quinto: offset=4 limit=1 (created_at asc). No reutilizar memoria ni el último cliente. No inventar.',
  },
  {
    question: 'Dame el décimo cliente registrado (solo hay 9)',
    expectedTool: 'crm_read_query',
    mustMention: ['no'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'offset=9 limit=1 devuelve 0 filas → "no hay tantos clientes / no existe el décimo". NO devolver otro cliente ni inventar.',
  },
  {
    question: '¿Por qué dijiste "no he podido contactar con el asistente"?',
    expectedTool: 'none',
    mustMention: [],
    mustNotMention: ['no he mostrado', 'eso no ha pasado', 'no he dicho eso'],
    notes: 'Error visible: NO negarlo. Reconoce un posible fallo temporal y continúa. No defensivo, sin tecnicismos. (COMPORTAMIENTO ANTE CRÍTICAS del prompt maestro + error persistido en el hilo.)',
  },
  // --- Determinismo + cero humo (P12.7) ---
  {
    question: 'Primer cliente registrado (repetir 3 veces en la misma conversación)',
    expectedTool: 'crm_read_query',
    mustMention: [],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'DETERMINISTA: crm_read_query orderBy=created_at asc + desempate id asc (.order(id)). Las 3 veces y en conversación nueva debe devolver EL MISMO cliente. Nunca alternar (Familia Soler / Inversiones Atlántico).',
  },
  {
    question: '¿A qué hora exacta se registró ese cliente?',
    expectedTool: 'crm_read_query',
    mustMention: ['No consta'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Si no consta hora exacta de registro, "No consta la hora exacta". No inventar hora.',
  },
  {
    question: 'Crea una cita visita mañana a las 10:00 "examen de programación II" → "sí, créala"',
    expectedTool: 'none',
    mustMention: [],
    mustNotMention: ['ha quedado creada', 'ya está creada', 'la he creado', 'lo he guardado', 'creada en el calendario'],
    notes: 'CERO HUMO: el Agent V2 es read-only (sin write tools). Tras confirmar, NO decir "creada"; explicar que no puede crearla automáticamente y dejar los datos preparados para crearla desde Calendario.',
  },
  {
    question: 'Completa la tarea de enviar la ficha a Marcos → "confirmo"',
    expectedTool: 'none',
    mustMention: [],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'la he completado', 'ya está completada', 'lo he guardado'],
    notes: 'CERO HUMO: sin write tool real, NO afirmar que está completada. Dejar preparada o guiar al usuario a marcarla en Tareas.',
  },
  {
    question: 'Crea un cliente / mueve la operación / borra el inmueble / envía un WhatsApp',
    expectedTool: 'none',
    mustMention: [],
    mustNotMention: ['lo he creado', 'lo he movido', 'lo he borrado', 'lo he enviado', 'ya está hecho'],
    notes: 'CERO HUMO genérico: ninguna escritura se ejecuta desde el agente; nunca afirmar ejecución. La confirmación del usuario NO equivale a ejecución.',
  },
]
