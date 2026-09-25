# CRM TELECOM — Handoffs W2

- Versión: 1.0
- Fecha: 2026-09-25
- Commit base: `6ea06e4`
- Commit W2 remoto: `f8b6466989f5b54a18fb5a9b70b25b9c883ddb41`
- Rama remota: `origin/w2/frontend-audit-foundation`
- Owner: W2
- Estado: solicitudes abiertas

## Estado de coordinación

- Persistencia Git verificada el 2026-09-25: la rama remota apunta exactamente a `f8b6466`.
- Último `fetch --all --prune`: no hay ramas remotas nuevas identificadas como W1, W3 o W4.
- Referencias remotas revisadas: `main`, `general-semantic-planner`, `p71/conversation-state-core` y la rama W2.
- Las solicitudes siguientes continúan abiertas hasta que se publiquen contratos o gates versionados.

## W1 — contratos de datos necesarios

Publicar tipos/API o repositorios versionados para:

- empresa/cliente y CIF;
- contactos y responsable;
- servicios y líneas;
- operador, producto y tarifa;
- contrato, alta, fin de permanencia y ventana de renovación;
- estado contractual;
- oportunidades telecom;
- incidencias;
- documentos y actividad;
- métricas de dashboard disponibles sin agregaciones inventadas.

W2 necesita además estados explícitos de loading/error/empty y reglas de paginación/filtros para cada listado. Hasta entonces se construirán shells y slots desacoplados, no campos definitivos.

## W3 — contrato UI del asistente

Publicar un contrato discriminado y versionado para respuestas UI:

- texto;
- referencia de entidad con `entityType`, `entityId`, label y deep link;
- tabla con columnas tipadas;
- card de cliente/contrato/renovación/tarea;
- acción propuesta con preview, riesgo, permisos y confirmación;
- resultado de acción y estado de ejecución;
- error recuperable/no recuperable;
- sugerencias de siguiente acción.

W2 no moverá interpretación semántica ni reglas de negocio al frontend.

## W4 — gates solicitados

- P0: verificar y corregir con W0 la visibilidad del repositorio; GitHub lo reporta `public` aunque el Project exige privado.
- Runner de unit/component tests acordado para lógica extraída.
- Axe o equivalente en flujos autenticados.
- Matriz visual responsive: 320, 375, 768, 1024 y 1440 px.
- Smoke de rutas SaaS y fallback `error.tsx` en staging.
- Gate de bundle/performance para asistente, calendario y cartera.
- Confirmar estrategia de logging del error boundary antes de producción.
