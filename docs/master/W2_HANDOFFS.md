# CRM TELECOM — Handoffs W2

- Versión: 1.0
- Fecha: 2026-09-25
- Commit base: `6ea06e4`
- Owner: W2
- Estado: solicitudes abiertas

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
