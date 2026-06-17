# Assistant CRM Intelligence — Eval Suite

> **Fecha:** 2026-06-16 · Banco de pruebas para validar que el copiloto cubre el
> CRM actual en lenguaje natural usando **tools reales** (no if/else, no inventar).
> Ejecutar manualmente en `/assistant` con sesión real. **Read-only salvo §7**
> (acciones, siempre con confirmación; usa Cancelar para no escribir).

**Criterios transversales (todas):** ✅ usa tool(s), no inventa; ✅ workspace-scoped
(RLS); ✅ si no hay datos dice "No encuentro datos reales…"; ✅ tono majo/claro,
≤1–2 emojis; ✅ no escribe sin confirmación; ✅ no expone UUIDs.

## 1. Clientes (8)
| # | Prompt | Tool(s) esperadas | Esperado / aprobado si |
|---|---|---|---|
| C1 | ¿Qué clientes tengo activos? | `list_clients` | lista clientes con status activo, sin inventar |
| C2 | ¿Quiénes necesitan seguimiento? | `recommended_actions` / `list_pending_items` / `hot_leads` | señala leads/clientes a seguir con criterio |
| C3 | Busca a Lucía Herrera | `search_clients` | encuentra el cliente o dice que no existe |
| C4 | Dame un resumen de este cliente | `get_client_context` | 360: operaciones/tareas/citas/actividad reales |
| C5 | ¿Qué clientes están inactivos? | `list_clients` | filtra inactivos; vacío → lo dice |
| C6 | ¿Cuáles son mis leads calientes? | `hot_leads` | leads por score, prioriza |
| C7 | ¿Quién es mi cliente más reciente? | `latest_clients` | el más reciente, real |
| C8 | Cuéntame de "Cliente que no existe" | `search_clients` | "No encuentro datos reales…", no inventa |

## 2. Operaciones (8)
| # | Prompt | Tool(s) | Aprobado si |
|---|---|---|---|
| O1 | ¿Qué operaciones abiertas tengo? | `list_opportunities` | lista operaciones abiertas reales |
| O2 | ¿Qué operaciones están en negociación? | `list_opportunities` | filtra por etapa negociación |
| O3 | ¿Cuál es el valor total del pipeline? | `list_opportunities` / `workspace_overview` | suma valores reales |
| O4 | ¿Qué operación está más avanzada? | `list_opportunities` | razona por etapa/probabilidad |
| O5 | ¿Qué operaciones están paradas? | `list_opportunities` | infiere estancadas o dice que no puede inferir |
| O6 | ¿Qué operaciones tiene Lucía? | `get_client_context` / `list_opportunities` | operaciones del cliente |
| O7 | Resumen del pipeline | `workspace_overview` / `crm_overview` | KPIs reales del pipeline |
| O8 | ¿Hay operaciones sin actividad reciente? | `list_opportunities` + `recent_activity` | cruza datos o lo acota honestamente |

## 3. Expedientes (6)
| # | Prompt | Tool(s) | Aprobado si |
|---|---|---|---|
| E1 | ¿Qué expedientes abiertos hay? | `list_service_cases` | expedientes abiertos reales |
| E2 | ¿Qué expedientes vencen pronto? | `list_service_cases` | ordena por vencimiento o lo dice |
| E3 | ¿Qué pasa con el expediente de Lucía? | `get_client_context` / `list_service_cases` | expediente del cliente |
| E4 | ¿Qué expedientes tienen prioridad alta? | `list_service_cases` | filtra prioridad alta |
| E5 | ¿Cuántos expedientes hay por estado? | `list_service_cases` / `workspace_overview` | conteo real por estado |
| E6 | Expediente de "ClienteX" inexistente | `search_clients` | no inventa, lo dice |

## 4. Tareas (6)
| # | Prompt | Tool(s) | Aprobado si |
|---|---|---|---|
| T1 | ¿Qué tengo pendiente hoy? | `pending_tasks` / `list_pending_items` | tareas pendientes reales |
| T2 | ¿Qué tareas vencidas hay? | `pending_tasks` | vencidas o "ninguna vencida" |
| T3 | ¿Qué tareas son urgentes? | `pending_tasks` | prioridad alta/urgente |
| T4 | ¿Qué tareas tiene Lucía? | `get_client_context` / `pending_tasks` | tareas del cliente |
| T5 | ¿Cuántas tareas pendientes tengo? | `pending_tasks` / `workspace_overview` | conteo real |
| T6 | ¿Tengo algo sin asignar? | `pending_tasks` | filtra/acota honestamente |

## 5. Calendario (5)
| # | Prompt | Tool(s) | Aprobado si |
|---|---|---|---|
| K1 | ¿Qué eventos tengo esta semana? | `upcoming_events` / `search_calendar_events` | eventos reales del rango |
| K2 | ¿Qué visitas hay próximas? | `upcoming_events` | próximas citas/visitas |
| K3 | ¿Cuándo es la próxima cita con Lucía? | `search_calendar_events` / `get_client_context` | cita del cliente |
| K4 | ¿Qué tengo mañana? | `upcoming_events` | eventos de mañana o "nada" |
| K5 | ¿Hay choques de agenda? | `check_calendar_conflicts` | detecta conflictos o dice que no hay |

## 6. Actividad / resumen (5)
| # | Prompt | Tool(s) | Aprobado si |
|---|---|---|---|
| A1 | ¿Qué ha pasado recientemente? | **`recent_activity`** (NUEVO) | lee tabla `activities` real, no inbox |
| A2 | ¿Qué actividad tiene este cliente? | `recent_activity` (client) / `get_client_context` | actividad del cliente |
| A3 | Hazme un resumen del CRM | `crm_overview` / `workspace_overview` | KPIs cruzados reales |
| A4 | ¿Qué requiere mi atención? | `recommended_actions` / `list_pending_items` | prioridades reales |
| A5 | Plan del día / próxima acción | `recommended_actions` | plan accionable, sin inventar |

## 7. Acciones confirmadas (4) — usar Cancelar para no escribir
| # | Prompt | Tool(s) | Aprobado si |
|---|---|---|---|
| X1 | Crea una operación para Lucía Herrera | `create_opportunity` → preparedAction | **card** de confirmación; Cancelar no escribe |
| X2 | Abre un expediente para Lucía Herrera | `create_service_case` → preparedAction | card; al Confirmar persiste + activity |
| X3 | Mueve la operación de Lucía a negociación | `update_opportunity_stage` → preparedAction | card con etapa actual→nueva |
| X4 | Pon la tarea de Lucía como alta | `update_task` (vía resolver) → preparedAction | card; confirma para aplicar |

## 8. Negativos / off-topic (4)
| # | Prompt | Esperado / aprobado si |
|---|---|---|
| N1 | Crea una operación para ClienteQueNoExiste | no card falsa; "No encuentro ese cliente", no escribe |
| N2 | Borra este cliente | no soportado; lo explica amable, no ejecuta |
| N3 | Cuéntame una receta de cocina | **off-topic:** 1 frase, reconduce al CRM, **sin tool calls** |
| N4 | ¿Quién ganará el mundial? | off-topic; reconduce, sin inventar, sin tools |

## 9. Conversación natural + ficha completa + score (H11)
| # | Prompt | Esperado / aprobado si |
|---|---|---|
| H1 | "Hola buenas" | saludo natural y cálido, sin volcar capacidades |
| H2 | "Muy bien y tú?" | responde humano ("Yo bien, gracias 😊"), no "estoy operativo" |
| H3 | "Pero te he preguntado qué tal estás" | reconoce y contesta natural, sin robotizar |
| H4 | "Pues no sé jejeje a ver dime" | cordial, reconduce suave al CRM (sin sonar seco) |
| H5 | "Coge un cliente al azar y mírame sus datos enteros, te estoy testeando" | **elige un cliente REAL** (list_clients), dice que es ejemplo real, NO "no he encontrado…" primero |
| H6 | "Sí, dame sus datos" | **ficha por secciones** (identificación/interés/operaciones/expedientes/tareas/citas/actividad/datos por completar), combina get_client_context + list_opportunities + list_service_cases |
| H7 | "No hay más datos? El NIF?" | si no hay NIF → **"No registrado"** (no "no tengo"); ofrece completarlo |
| H8 | "Dame la ficha completa de Inversiones Atlántico SL" | ficha completa real del cliente nombrado |
| H9 | "Qué datos faltan de este cliente" | lista "datos por completar" reales (NIF, dirección, presupuesto…) |
| H10 | "Qué próxima acción recomiendas" | recomendación accionable basada en datos reales |
| H11 | (cualquier ficha/listado) | **NUNCA** aparece "Lead Score"/"score"/número; si acaso "prioridad comercial" cualitativa |
| H12 | "Vale perfecto gracias y un saludo" | cierre amable y humano (con nombre si procede) |

## 10. Productización H12 (delete + empleado IA)
| # | Prompt / acción | Esperado / aprobado si |
|---|---|---|
| P1 | Crear consulta → enviar → **Eliminar** | hilo desaparece; **sin error** "public.messages"; empty state u otro hilo |
| P2 | Tras eliminar, crear otra consulta | funciona con normalidad |
| P3 | "¿Cómo funcionas? ¿qué hay detrás de ti?" | explica honesto y no técnico (copiloto + datos reales + confirmación); no "no tengo detalles técnicos" |
| P4 | "¿De qué eres capaz exactamente?" | capacidades concretas + 1-2 ejemplos |
| P5 | Cualquier respuesta informativa | **no termina con pregunta forzada** tipo "¿quieres revisar algo?" |
| P6 | (UI) cabecera/panel del copiloto | sin "Backend agent"/"OpenAI/tools server-side"/"Agente local"/score visibles al cliente |

## 11. Product knowledge + sin falsas promesas (H13)
| # | Prompt | Esperado / aprobado si |
|---|---|---|
| K1 | "Estoy enseñando este CRM a una inmobiliaria, ¿qué enseño?" | recomienda ficha cliente, operaciones, calendario, asistente con confirmación; **no** facturación/WhatsApp |
| K2 | "¿Cómo funciona Configuración?" | explica el apartado Configuración (workspace, cuenta, vertical, plataforma IA gestionada); **no** "no tengo acceso"; no lo confunde con su arquitectura |
| K3 | "¿Y el dashboard qué muestra?" | clientes/operaciones/expedientes/citas/tareas/actividad; **NO facturas/cobros** |
| K4 | "¿Qué puedo ver en operaciones?" | pipeline comercial/oportunidades por etapa; **sin** pregunta final forzada |
| K5 | "¿Cómo funcionas tú?" | datos reales + tools + confirmación + historial; sin secretos; no "no tengo detalles" |
| K6 | "Solo estoy probando, no me preguntes todo el rato qué quiero hacer" | ajusta tono, no termina con pregunta forzada |
| K7 | "¿Puedo mandar facturas / WhatsApp desde aquí?" | "está previsto como fase futura; aún no activo"; no lo promete |

## Cómo puntuar
Por eval: **PASA** si cumple "aprobado si" + criterios transversales. **FALLA** si
inventa datos, no usa tool cuando debía, escribe sin confirmación, o expone UUIDs.
Registrar: nº, PASA/FALLA, tool(s) realmente usadas (panel debug si está), nota.

---

## S8 — Cobertura de datos CRM exactos (2026-06-17)
Transversal a TODOS: usa el valor EXACTO de la tool (nunca inventa email/teléfono/
fecha), campo null = "No consta", NUNCA muestra UUID ni "score".

| # | Pregunta | Tool esperada | Respuesta esperada |
|---|---|---|---|
| S8-1 | "¿Cuál es el email de [cliente real]?" | get_client_context | email exacto del JSON, o "No consta email registrado" |
| S8-2 | "¿Cuál es el teléfono de [cliente]?" | get_client_context | teléfono exacto, o "No consta teléfono registrado" |
| S8-3 | "Dame todos los datos de [cliente]." | get_client_context | ficha: contacto + operaciones + expedientes + tareas + citas |
| S8-4 | "Busca clientes de [zona real]." | search_clients | candidatos reales por nombre/notas; sin score/UUID |
| S8-5 | "Elige un cliente al azar y resúmelo." | list_clients/search_clients + get_client_context | uno REAL de los resultados, no inventado |
| S8-6 | "¿Quién no tiene email registrado?" | list_clients | lista clientes con email vacío; "No consta" |
| S8-7 | "¿Qué clientes están activos?" | list_clients(status=active) | lista real activos |
| S8-8 | "¿Qué operaciones abiertas hay?" | list_opportunities | operaciones reales con etapa/valor |
| S8-9 | "¿Qué operaciones tiene [cliente]?" | get_client_context | array operations del cliente |
| S8-10 | "¿Cuál es la operación de mayor valor?" | list_opportunities | la de value máximo real |
| S8-11 | "¿Qué operaciones están en negociación?" | list_opportunities | filtra por stage negociación |
| S8-12 | "¿Qué expedientes abiertos tiene [cliente]?" | get_client_context | array service_cases del cliente |
| S8-13 | "¿Qué expedientes urgentes hay?" | list_service_cases | priority alta reales |
| S8-14 | "¿Qué tareas tengo pendientes?" | pending_tasks/list_pending_items | tareas reales pendientes |
| S8-15 | "¿Qué tareas vencen pronto?" | pending_tasks | por due_date próxima |
| S8-16 | "¿Qué tareas hay para [cliente]?" | get_client_context | array tasks del cliente |
| S8-17 | "¿Qué tengo hoy?" | upcoming_events/list_pending_items | citas/tareas de hoy reales |
| S8-18 | "¿Qué citas tiene [cliente]?" | get_client_context | array calendar_events del cliente |
| S8-19 | "¿Qué visitas hay esta semana?" | upcoming_events | eventos del rango real |
| S8-20 | "¿Qué ha pasado recientemente?" | recent_activity | actividad real reciente |
| S8-21 | "Última actividad de [cliente]." | get_client_context | activities del cliente |
| S8-22 | "Busca a Ana." | search_clients | 1 → ficha; varios → candidatos + "¿a cuál?" |
| S8-23 | "Dame el email de Juan." (varios) | search_clients | lista Juanes + pide cuál (no inventa) |
| S8-24 | "Ese cliente, ¿qué operaciones tiene?" (contexto) | get_client_context(ID activo) | operaciones del cliente activo |
| S8-25 | "Dame el cliente de Bilbao." (varios) | search_clients | candidatos + pide cuál |
| S8-26 | cliente inexistente | search_clients | "No encontré ningún cliente con..." |
| S8-27 | email null | get_client_context | "No consta email registrado" |
| S8-28 | teléfono null | get_client_context | "No consta teléfono registrado" |
| S8-29 | campo que no existe (p. ej. NIF) | — | "No consta" / no inventa |
| S8-30 | "¿Puedo facturar desde aquí?" | — | "fase futura, no activo" |
| S8-31 | WhatsApp/inbox | — | "fase futura, no activo" |
| S8-32 | documentos/PDF | — | "fase futura, no activo" |
| S8-33 | "Crea una tarea para [cliente]." | prepare_task → confirm | tarjeta de confirmación; no escribe sin confirmar |
| S8-34 | "Mueve operación X a negociación." | deterministic-db-actions → confirm | tarjeta; ejecuta tras confirmar |
| S8-35 | "Marca tarea X completada." | update_task → confirm | tarjeta; ejecuta tras confirmar |

> Causa raíz corregida en S8: el agente enviaba al modelo solo `result.text`
> (resumen sin email/teléfono); ahora envía también `DATOS_JSON` con los campos
> exactos, y `get_client_context` devuelve el perfil completo real (operaciones/
> expedientes/tareas/citas/actividad). Ver
> `PHASE_S8_ASSISTANT_CRM_FULL_DATA_COVERAGE_REPORT.md`.

---

## S9 — Campos personalizados (DNI/metadata), memoria contextual y cliente nuevo (2026-06-17)
Transversal: SÍ tiene acceso vía tools (PROHIBIDO "no tengo acceso directo");
lee campos personalizados (metadata: DNI/dirección/zona…); recuerda el cliente
activo del hilo; nunca inventa; nunca UUID/score.

### Bug real reproducido (obligatorio PASA)
| # | Turno | Esperado |
|---|---|---|
| S9-1 | "Hay un nuevo cliente que he registrado. ¿Cuál es?" | get_latest_client → "El último cliente registrado es Oier Duñabeitia Berezo…" y queda como cliente activo |
| S9-2 | "Necesito su DNI para emitir una factura." | get_client_field_exact(field=dni, client_id=activo) → "El DNI/NIF de Oier Duñabeitia Berezo es [DNI real del cliente]" (lee metadata.document_id) |
| S9-3 | "Si lo tienes porque lo he metido antes a mano. ¿No tienes acceso a ese campo?" | NO dice "no tengo acceso"; confirma que lo leyó de la ficha |
| S9-4 | "Pásame la ficha completa de este cliente." | get_client_context(client_id=activo) — NO pregunta "¿a qué cliente?" |
| S9-5 | "De Oier Duñabeitia si te acabo de decir que es el último." | usa cliente activo; no se reinicia |

### Campos exactos (metadata + columnas)
| # | Pregunta | Tool | Esperado |
|---|---|---|---|
| S9-6 | "¿Cuál es su DNI?" (con activo) | get_client_field_exact(dni) | valor metadata.document_id o "No consta DNI/NIF/CIF registrado" |
| S9-7 | "Dame el NIF de [cliente]" | get_client_field_exact(nif) | igual que DNI (mismos aliases) |
| S9-8 | "¿Qué dirección tiene registrada?" | get_client_field_exact(direccion) | metadata.address o "No consta" |
| S9-9 | "¿De qué zona es?" | get_client_field_exact(zona) | metadata.city_area o "No consta" |
| S9-10 | "¿Qué nacionalidad consta?" | get_client_field_exact(nacionalidad) | metadata.nationality o "No consta" |
| S9-11 | "¿Cuál es su email?" | get_client_field_exact(email) | columna email exacta |
| S9-12 | "¿Y su teléfono?" | get_client_field_exact(telefono) | columna phone exacta |
| S9-13 | "Pásame su ficha completa" | get_client_context | contacto + DNI/dirección/zona + operaciones/expedientes/tareas/citas |
| S9-14 | DNI de cliente que NO lo tiene | get_client_field_exact(dni) | "No consta DNI/NIF/CIF registrado de X" (tras comprobar) |
| S9-15 | "su DNI" sin cliente activo ni nombre | — | pide a qué cliente (no inventa) |

### Memoria contextual del hilo
| # | Secuencia | Esperado |
|---|---|---|
| S9-16 | "Busca a Oier" → "su email" | 2º turno usa el cliente activo |
| S9-17 | "ficha de [A]" → "y sus tareas" | tareas de A |
| S9-18 | "[A]…" → "ahora [B]" → "su DNI" | DNI de B (cliente activo actualizado) |
| S9-19 | "este cliente" sin contexto previo | pide aclaración |

### Cliente nuevo / recientes
| # | Pregunta | Tool | Esperado |
|---|---|---|---|
| S9-20 | "el último cliente" | get_latest_client | el más reciente real |
| S9-21 | "los últimos 5 clientes" | get_latest_client(limit=5) | 5 más recientes |
| S9-22 | "el cliente que acabo de crear" | get_latest_client | el más reciente, queda activo |

### Documentos (honesto)
| # | Pregunta | Esperado |
|---|---|---|
| S9-23 | "léeme el PDF / el contrato de X" | "guarda documentos pero no indexa su texto todavía" — NO finge leerlo |
| S9-24 | "¿puedo facturar desde aquí?" | "fase futura, no activo" |

> Causa raíz S9: (1) las tools de cliente no seleccionaban `metadata`, donde vive
> el DNI (`metadata.document_id`) → el modelo nunca lo recibía; (2) el "nuevo
> cliente" se respondía con una tool de lista que no fijaba cliente activo →
> contexto perdido. Corregido: metadata en selects + get_client_field_exact +
> get_latest_client (fija activo) + prompt anti-"no tengo acceso". Ver
> `PHASE_S9_ASSISTANT_PRO_360_FIELD_MEMORY_TOOL_SUITE_REPORT.md`.
