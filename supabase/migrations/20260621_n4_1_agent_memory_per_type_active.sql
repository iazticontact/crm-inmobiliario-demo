-- ============================================================================
-- Fase N4.1 - Memoria de entidad activa POR TIPO
-- ----------------------------------------------------------------------------
-- N4 permitía una única entidad activa por (thread,user). N4.1 la separa por
-- `entity_type` para que resolver una propiedad/documento NO machaque al cliente
-- activo (el cliente es el contexto principal de "su / este cliente / el
-- anterior"). El servidor sigue siendo quien escribe (RLS), nunca el LLM.
-- Idempotente. Solo crm-inmobiliario-demo (ref ylhdbawrllqygfvllhdo).
-- ============================================================================

drop index if exists public.uq_agent_mem_active;

create unique index if not exists uq_agent_mem_active_type
  on public.assistant_agent_memory (thread_id, user_id, entity_type)
  where memory_type = 'active_entity';

create unique index if not exists uq_agent_mem_prev_type
  on public.assistant_agent_memory (thread_id, user_id, entity_type)
  where memory_type = 'previous_entity';
