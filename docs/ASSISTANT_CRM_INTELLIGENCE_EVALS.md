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

## Cómo puntuar
Por eval: **PASA** si cumple "aprobado si" + criterios transversales. **FALLA** si
inventa datos, no usa tool cuando debía, escribe sin confirmación, o expone UUIDs.
Registrar: nº, PASA/FALLA, tool(s) realmente usadas (panel debug si está), nota.
