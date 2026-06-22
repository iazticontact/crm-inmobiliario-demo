-- P4.6.2 — Saneo de PII real en el WORKSPACE DE EJEMPLO (showcase) únicamente.
-- Todo acotado por workspace_id del ejemplo (d0000000-...-000000000001).
-- NO toca auth.users ni workspaces/clientes reales. Sin literales de PII
-- (se usan ids de seed + patrón de dominio). Idempotente (re-ejecutable sin efecto).
--
-- Contexto: una cuenta ficticia (Roberto Díaz) tenía el email real del propietario, y un
-- hilo de prueba del asistente contenía PII real (nombre/DNI/teléfono/dirección). Ambos
-- se eliminan/sustituyen para que el entorno de ejemplo sea comercial, ficticio y seguro.
DO $$
DECLARE
  ex_ws       constant uuid := 'd0000000-0000-4000-8000-000000000001';
  test_thread constant uuid := '47fcfa59-e813-43bf-96dd-0c9e4274543c';
BEGIN
  -- 1) Cliente ficticio con email real del propietario → email ficticio @example.com.
  UPDATE public.clients
     SET email = 'roberto.diaz@example.com'
   WHERE workspace_id = ex_ws
     AND id = 'd1000000-0000-4000-8000-000000000004'
     AND email NOT ILIKE '%@example%';

  -- 2) Hilo de prueba del asistente con PII real: eliminar hilo + mensajes + memoria
  --    (active_entity) asociada, sólo en el workspace de ejemplo.
  DELETE FROM public.assistant_agent_memory
   WHERE workspace_id = ex_ws AND thread_id = test_thread;

  DELETE FROM public.assistant_messages
   WHERE workspace_id = ex_ws AND thread_id = test_thread;

  DELETE FROM public.assistant_threads
   WHERE workspace_id = ex_ws AND id = test_thread;
END $$;
