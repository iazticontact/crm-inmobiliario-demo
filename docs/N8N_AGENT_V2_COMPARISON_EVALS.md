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

## Qué esperamos de V2 vs V1
- **Memoria** más robusta (sessionId persistente por workspace+usuario+hilo).
- **Separación** cerebro (n8n) / datos (endpoint CRM seguro).
- **Mismo** rigor de no-inventar y honestidad (depende del prompt + tools).
- **Pendiente** en V2: get_latest_client, per-cliente de operaciones/expedientes,
  propiedades (gaps del endpoint, ver spec) y escritura (fase futura).
