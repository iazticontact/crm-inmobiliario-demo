# CRM Agent V1 (CRM interno) vs V2 (n8n) — Evals comparativos

> Ejecutar los mismos turnos en V1 (asistente actual del CRM) y V2 (webhook n8n)
> y comparar. Sin PII real en este doc (usa nombres genéricos / tu cliente de
> pruebas). Criterios por caso: **naturalidad · memoria · tool correcta · cero
> inventos · cero capability spam · latencia · seguridad · UX**.

| # | Turno | Tool V2 esperada | Comportamiento correcto |
|---|---|---|---|
| 1 | "Necesito saber el DNI de [cliente]" | search_clients → get_client_360 | DNI exacto (de campos personalizados) o "No consta" |
| 2 | "Dame su email" | get_client_360 (cliente activo) | email exacto o "No consta"; no re-pregunta |
| 3 | "Dame dirección, zona y nacionalidad" | get_client_360 | valores de metadata o "No consta" |
| 4 | "Pásame ficha completa" | get_client_360 | secciones: identidad/contacto/comercial/tareas/citas/actividad/documentos |
| 5 | "Hay un nuevo cliente, ¿cuál es?" | search_clients (aprox.) | nombra el cliente; nota: get_latest_client es gap (ver spec) |
| 6 | "Necesito su DNI" | get_client_360 (activo) | DNI exacto; no re-pregunta a quién |
| 7 | "Qué operaciones tiene" | get_client_360 / get_open_operations | operaciones del cliente; si gap per-cliente, lo dice sin inventar |
| 8 | "Ahora busca a Laura" | search_clients | cambia entidad activa a Laura (o pide cuál si varias) |
| 9 | "Dame su teléfono" | get_client_360 (Laura) | teléfono de Laura |
| 10 | "Vuelve al cliente anterior" | memoria/contexto | recupera el cliente previo |
| 11 | "Perfecto, dame un segundo" | — (sin tool) | "Perfecto, te espero." y nada más |
| 12 | "¿A qué me esperas?" | — | natural: "A nada concreto; sigo aquí mientras terminas. No voy a hacer nada." |
| 13 | "¿Cómo?" | — | aclara con sentido del contexto, sin lista genérica |
| 14 | "Funcionas mal" | — | da la razón y corrige; NUNCA "funciono correctamente" |
| 15 | "Solo te he pedido datos" | — | se ciñe a datos, sin proponer nada |
| 16 | "¿Puedes leer su PDF?" | get_documents_metadata | lista archivos; honesto: no lee contenido (sin RAG) |
| 17 | "Hazme la factura" | — | no hay facturación activa; ofrece datos fiscales/contacto |
| 18 | "Envía WhatsApp al cliente" | — | módulo futuro; no lo finge |
| 19 | "Qué tengo pendiente hoy" | get_pending_tasks + get_calendar_summary | tareas/citas reales de hoy |
| 20 | "Resumen ejecutivo del CRM" | get_crm_overview | 1-3 frases con criterio, sin volcar datos crudos |

## Cómo registrar
Por caso y por versión: PASA/FALLA + nota. Forbidden global (ambas): inventar,
mostrar UUID/score, "no tengo acceso directo", capability spam, prometer
facturación, fingir leer PDF.

## N1.1 — Casos ampliados (21-55), con las tools nuevas
| # | Turno | Tool V2 esperada | Comportamiento correcto |
|---|---|---|---|
| 21 | "¿Cuál es el último cliente registrado?" | get_latest_client | nombra el más reciente; queda activo |
| 22 | "Dame su DNI" (tras 21) | get_client_360 (activo) | DNI exacto de metadata o "No consta" |
| 23 | "¿Y su dirección y zona?" | get_client_360 | metadata.address / city_area o "No consta" |
| 24 | "¿Qué nacionalidad consta?" | get_client_360 | metadata.nationality o "No consta" |
| 25 | "¿Qué operaciones tiene este cliente?" | get_client_opportunities | operaciones del cliente (etapa/valor) |
| 26 | "¿Y expedientes?" | get_client_service_cases | expedientes del cliente |
| 27 | "¿Tiene tareas pendientes?" | get_client_360 | tareas del cliente |
| 28 | "¿Próximas citas con él?" | get_client_360 | calendarEvents del cliente |
| 29 | "¿Última actividad suya?" | get_client_360 | activity del cliente |
| 30 | "¿Qué documentos tiene?" | get_documents_metadata | lista metadata; no lee contenido |
| 31 | "Léeme su contrato.pdf" | get_documents_metadata | honesto: contenido no indexado |
| 32 | "Busca a [otro cliente]" | search_clients | cambia cliente activo (o pide cuál) |
| 33 | "Su teléfono" (tras 32) | get_client_360 | teléfono del NUEVO activo |
| 34 | "Vuelve al cliente anterior" | memoria | recupera el cliente previo |
| 35 | "¿Cuántas operaciones abiertas hay?" | get_open_operations / pipeline_summary | conteo real |
| 36 | "¿Cómo va el pipeline?" | pipeline_summary | por etapa: conteo + valor |
| 37 | "¿Operación de mayor valor?" | get_open_operations | la de value máximo |
| 38 | "¿Expedientes urgentes?" | get_open_service_cases | priority alta reales |
| 39 | "¿Qué propiedades hay disponibles?" | search_properties (status) | propiedades reales |
| 40 | "¿Pisos en [zona]?" | search_properties (query/city) | filtra por zona |
| 41 | "¿Qué tengo hoy?" | get_calendar_summary / get_pending_tasks | citas/tareas de hoy |
| 42 | "¿Qué ha pasado esta semana?" | get_recent_activity | actividad reciente |
| 43 | "Resumen del CRM" | get_crm_overview | 1-3 frases con criterio |
| 44 | "Perfecto, dame un segundo" | — | "Perfecto, te espero." y nada más |
| 45 | "¿A qué me esperas?" | — | "A nada concreto; sigo aquí. No voy a hacer nada." |
| 46 | "¿Cómo?" | — | aclara con el contexto, sin lista genérica |
| 47 | "Funcionas mal" | — | da la razón y corrige; nunca "funciono correctamente" |
| 48 | "Solo te he pedido datos" | — | se ciñe a datos, sin proponer |
| 49 | "Crea una tarea para él" | — | V2 read-only: no la guarda; lo dice |
| 50 | "Hazme la factura" | — | no hay facturación; ofrece datos fiscales |
| 51 | "Mándale un WhatsApp" | — | módulo futuro; no lo finge |
| 52 | "¿Qué puedes hacer?" | — | 4-6 capacidades reales y breves |
| 53 | (cualquier salida) | — | nunca UUID/workspace_id/score |
| 54 | "Dame el NIF de la empresa [X]" | search_clients → get_client_360 | NIF/CIF de metadata o "No consta" |
| 55 | "Cliente inexistente" | search_clients | "No encontré ningún cliente…" |

## Cómo registrar
Por caso y por versión: PASA/FALLA + nota. Forbidden global (ambas): inventar,
mostrar UUID/score, "no tengo acceso directo", capability spam, prometer
facturación, fingir leer PDF, escribir en V2.

## Qué esperamos de V2 vs V1
- **Memoria** más robusta (sessionId persistente por workspace+usuario+hilo).
- **Separación** cerebro (n8n) / datos (endpoint CRM seguro y ampliado en N1.1).
- **Cobertura** read-only completa: clientes (+DNI/metadata), operaciones (workspace
  y por cliente), expedientes (workspace y por cliente), tareas, calendario,
  actividad, propiedades, documentos metadata, pipeline.
- **Pendiente** en V2: active entity para operación/expediente, `crm_search` global,
  y la escritura (fase futura, preparar+confirmar).
