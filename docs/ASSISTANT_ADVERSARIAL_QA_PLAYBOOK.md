# Playbook de QA adversarial del Asistente (P50)

> Categorías, no frases únicas. Para cada una: `turnType` esperado, si debe leer datos, si debe llamar a
> n8n, y el comportamiento correcto. Prueba variando entidad, acentos, mayúsculas y forma.

| # | Categoría | Ejemplo (variar) | turnType | shouldReadData | shouldCallN8n | Comportamiento correcto |
|---|---|---|---|---|---|---|
| 1 | Conversación normal | «hola», «gracias» | social | ❌ | ❌ | Saluda / reconoce y ofrece ayuda. |
| 2 | Capacidades | «¿qué puedes hacer?», «¿tienes acceso a los clientes?» | capability | ❌ | ❌ | Explica qué puede/no puede. **No** lista datos. |
| 3 | Cómo funciona | «¿cómo funciona la cartera?» | how_it_works | ❌ | ❌ | Explica el módulo. **No** consulta datos. |
| 4 | Hipótesis/futuro | «si creo un cliente, ¿podrás verlo?» | hypothetical | ❌ | ❌ | Responde condicional. **No** lee. |
| 5 | Pedir datos reales | «muéstrame los clientes», «¿qué inmuebles hay?» | data_read | ✅ | según cobertura | Lee (local-first) y lista. |
| 6 | Corregir al Asistente | «no me refiero a los clientes» | user_correction | ❌ | ❌ | Repara, pide aclaración. **No** repite la lectura. |
| 7 | Quejarse | «esto está mal», «no me ayudas» | user_complaint | ❌ | ❌ | Se disculpa, pregunta qué esperaba. |
| 8 | Por qué respondió | «¿por qué me listas los clientes?» | assistant_meta | ❌ | ❌ | Explica su interpretación. **No** vuelve a listar. |
| 9 | Cambio de tema | de datos → «¿cómo funciona esto?» | how_it_works | ❌ | ❌ | Cambia de acto sin forzar contexto. |
| 10 | Entidad dentro de pregunta conceptual | «¿puedes leer los trámites nuevos?» | capability/hypothetical | ❌ | ❌ | Explica capacidad. **No** lee trámites. |
| 11 | Follow-up sobre datos | «solo los de Malasaña» (tras inmuebles) | data_followup | ✅ | según cobertura | Aplica filtro al último conjunto. |
| 12 | Follow-up sobre el Asistente | «¿por qué me diste esos?» | assistant_meta | ❌ | ❌ | Explica, no re-consulta. |
| 13 | Ambiguo | «mmm», «y eso?» sin contexto | ambiguous | ❌ | ✅ (cerebro) | Pide aclaración / deriva; nunca lectura a ciegas. |
| 14 | Errores simulados | lectura que falla | data_read | ✅ (intento) | — | Error humano con código; vacío ≠ error; no borra resultado válido. |
| 15 | n8n caído | cualquier lectura básica | data_read | ✅ (local) | ❌ | Local-first responde sin n8n. |
| 16 | Tools prohibidas | «¿cuánto he facturado?» | data_read (invoicing) | ❌ | ❌ | Redirige a Facturación; `allowedTools=[]`. |

**Regla transversal:** mencionar una entidad CRM (cliente, inmueble, trámite, cita, factura, comisión,
documento) **no** basta para leer. Primero manda el acto comunicativo.

**Traza:** cada turno registra en servidor `[assistant.turn] { turnType, domain, action, shouldReadData,
shouldCallN8n, reason }` para depurar por qué leyó o no.
