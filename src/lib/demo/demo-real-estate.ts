// Demo dataset — Vertical Pack inmobiliario.
//
// Datos FICTICIOS para el modo demo offline (cuando `DEMO_MODE_KEY === 'true'`).
// Cubren el hueco de `/opportunities` y `/dashboard`, que leen de Supabase y no
// tienen fallback mock. Enlazados a los clientes de `mock-data.ts` (ids 1..10).
//
// No representan datos reales. Nombres, propiedades, precios y zonas inventados.
// No usar en despliegues de cliente — solo demo. Ver `mock-data.ts`.

import type { OpportunityRow, PropertyRow, ServiceCaseRow } from '@/lib/vertical-queries'

const WS = 'demo-workspace'
const T = '2026-06-08T09:00:00.000Z'

// -----------------------------------------------------------------------------
// Propiedades — cartera de la inmobiliaria
// -----------------------------------------------------------------------------
export const demoProperties: PropertyRow[] = [
  { id: 'pr1', workspace_id: WS, client_id: '3', title: 'Piso 3 dorm. · Calle Mayor 14', property_type: 'piso', operation_type: 'venta', status: 'listed', city: 'Valencia', area: 'Centro', address: 'Calle Mayor 14, 3ºB', price: 245000, currency: 'EUR', owner_name: 'Familia Soler', owner_phone: '+34 600 103 203', notes: '95 m², 2 baños, exterior. Listo para entrar.', metadata: { rooms: 3, baths: 2, m2: 95 }, created_at: T, updated_at: T },
  { id: 'pr2', workspace_id: WS, client_id: '4', title: 'Ático con terraza · Plaza España 5', property_type: 'atico', operation_type: 'venta', status: 'listed', city: 'Valencia', area: 'Eixample', address: 'Plaza España 5, ático', price: 320000, currency: 'EUR', owner_name: 'Roberto Díaz', owner_phone: '+34 600 104 204', notes: '110 m² + 40 m² terraza. Alta rentabilidad para alquiler.', metadata: { rooms: 2, baths: 2, m2: 110 }, created_at: T, updated_at: T },
  { id: 'pr3', workspace_id: WS, client_id: '5', title: 'Chalet · Urbanización Los Robles', property_type: 'chalet', operation_type: 'venta', status: 'under_contract', city: 'Paterna', area: 'Los Robles', address: 'C/ Roble 22', price: 480000, currency: 'EUR', owner_name: 'Promociones Roble SL', owner_phone: '+34 600 222 110', notes: '220 m², parcela 600 m², piscina. Reserva firmada.', metadata: { rooms: 5, baths: 3, m2: 220 }, created_at: T, updated_at: T },
  { id: 'pr4', workspace_id: WS, client_id: '8', title: 'Adosado · Calle Olivar 9', property_type: 'adosado', operation_type: 'venta', status: 'prospecting', city: 'Torrent', area: 'El Olivar', address: 'Calle Olivar 9', price: 350000, currency: 'EUR', owner_name: 'Carmen Lozano', owner_phone: '+34 600 108 208', notes: 'Captación reciente. Pendiente reportaje fotográfico.', metadata: { rooms: 4, baths: 3, m2: 180 }, created_at: T, updated_at: T },
  { id: 'pr5', workspace_id: WS, client_id: null, title: 'Local comercial · Av. del Puerto 8', property_type: 'local', operation_type: 'alquiler', status: 'listed', city: 'Valencia', area: 'El Grao', address: 'Av. del Puerto 8, bajo', price: 1800, currency: 'EUR', owner_name: 'Inversiones Atlántico SL', owner_phone: '+34 600 106 206', notes: '120 m² a pie de calle. Renta mensual.', metadata: { m2: 120 }, created_at: T, updated_at: T },
  { id: 'pr6', workspace_id: WS, client_id: null, title: 'Piso reformado · Calle del Sol 31', property_type: 'piso', operation_type: 'venta', status: 'sold', city: 'Valencia', area: 'Ruzafa', address: 'Calle del Sol 31, 2ºA', price: 210000, currency: 'EUR', owner_name: 'Particular', owner_phone: '+34 600 333 221', notes: 'Operación cerrada el mes pasado.', metadata: { rooms: 2, baths: 1, m2: 70 }, created_at: T, updated_at: T },
]

// -----------------------------------------------------------------------------
// Oportunidades — pipeline comercial
// -----------------------------------------------------------------------------
export const demoOpportunities: OpportunityRow[] = [
  { id: 'op1', workspace_id: WS, client_id: '7', title: 'Comprador 1 dorm. — Pablo Ferrer', vertical: 'real_estate', pipeline: 'real_estate', stage: 'new', value: 150000, probability: 10, currency: 'EUR', source: 'WhatsApp', assigned_to: null, expected_close_date: '2026-08-30', notes: 'Lead entrante, sin contactar aún.', metadata: null, created_at: T, updated_at: T },
  { id: 'op2', workspace_id: WS, client_id: '6', title: 'Cartera inversión — Inversiones Atlántico', vertical: 'real_estate', pipeline: 'real_estate', stage: 'contacted', value: 600000, probability: 20, currency: 'EUR', source: 'Web', assigned_to: null, expected_close_date: '2026-09-15', notes: 'Busca 2-3 inmuebles para alquiler.', metadata: null, created_at: T, updated_at: T },
  { id: 'op3', workspace_id: WS, client_id: '2', title: 'Obra nueva — Marcos Beltrán', vertical: 'real_estate', pipeline: 'real_estate', stage: 'qualified', value: 280000, probability: 40, currency: 'EUR', source: 'Portal', assigned_to: null, expected_close_date: '2026-08-10', notes: 'Cualificado: financiación preaprobada.', metadata: null, created_at: T, updated_at: T },
  { id: 'op4', workspace_id: WS, client_id: '1', title: 'Compra piso Calle Mayor — Lucía Herrera', vertical: 'real_estate', pipeline: 'real_estate', stage: 'visit_scheduled', value: 245000, probability: 55, currency: 'EUR', source: 'WhatsApp', assigned_to: null, expected_close_date: '2026-07-20', notes: 'Visita el jueves 18:00.', metadata: { property_id: 'pr1' }, created_at: T, updated_at: T },
  { id: 'op5', workspace_id: WS, client_id: '3', title: 'Venta piso Calle Mayor — Familia Soler', vertical: 'real_estate', pipeline: 'real_estate', stage: 'offer', value: 245000, probability: 70, currency: 'EUR', source: 'Portal', assigned_to: null, expected_close_date: '2026-07-15', notes: 'Oferta recibida, pendiente de aceptar.', metadata: { property_id: 'pr1' }, created_at: T, updated_at: T },
  { id: 'op6', workspace_id: WS, client_id: '5', title: 'Reserva chalet Los Robles — Marta Vidal', vertical: 'real_estate', pipeline: 'real_estate', stage: 'offer', value: 480000, probability: 75, currency: 'EUR', source: 'Instagram', assigned_to: null, expected_close_date: '2026-07-25', notes: 'Reserva firmada, gestionando financiación.', metadata: { property_id: 'pr3' }, created_at: T, updated_at: T },
  { id: 'op7', workspace_id: WS, client_id: '4', title: 'Inversión ático Plaza España — Roberto Díaz', vertical: 'real_estate', pipeline: 'real_estate', stage: 'negotiation', value: 320000, probability: 85, currency: 'EUR', source: 'Referido', assigned_to: null, expected_close_date: '2026-07-10', notes: 'Negociando precio final.', metadata: { property_id: 'pr2' }, created_at: T, updated_at: T },
  { id: 'op8', workspace_id: WS, client_id: null, title: 'Venta piso reformado Calle del Sol', vertical: 'real_estate', pipeline: 'real_estate', stage: 'won', value: 210000, probability: 100, currency: 'EUR', source: 'Portal', assigned_to: null, expected_close_date: '2026-05-30', notes: 'Operación cerrada con éxito.', metadata: { property_id: 'pr6' }, created_at: T, updated_at: T },
]

// -----------------------------------------------------------------------------
// Expedientes — documentación / gestión de operaciones
// -----------------------------------------------------------------------------
export const demoServiceCases: ServiceCaseRow[] = [
  { id: 'sc1', workspace_id: WS, client_id: '3', opportunity_id: 'op5', case_type: 'Venta de vivienda', vertical: 'real_estate', title: 'Documentación venta — Familia Soler', status: 'documentation_pending', priority: 'high', due_date: '2026-06-20', assigned_to: null, notes: 'Faltan nota simple y certificado energético.', metadata: null, created_at: T, updated_at: T },
  { id: 'sc2', workspace_id: WS, client_id: '1', opportunity_id: 'op4', case_type: 'Financiación / hipoteca', vertical: 'real_estate', title: 'Gestión hipoteca — Lucía Herrera', status: 'in_review', priority: 'normal', due_date: '2026-07-01', assigned_to: null, notes: 'Comparando ofertas con dos entidades.', metadata: null, created_at: T, updated_at: T },
  { id: 'sc3', workspace_id: WS, client_id: '4', opportunity_id: 'op7', case_type: 'Tasación', vertical: 'real_estate', title: 'Tasación ático — Roberto Díaz', status: 'open', priority: 'normal', due_date: '2026-06-28', assigned_to: null, notes: 'Tasador asignado, visita pendiente.', metadata: null, created_at: T, updated_at: T },
]

// -----------------------------------------------------------------------------
// Tareas comerciales
// -----------------------------------------------------------------------------
export type DemoTask = {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  client_name: string | null
}

export const demoTasks: DemoTask[] = [
  { id: 'tk1', title: 'Llamar a Pablo Ferrer (piso 1 dorm.)', status: 'pending', priority: 'high', due_date: '2026-06-13', client_name: 'Pablo Ferrer' },
  { id: 'tk2', title: 'Preparar visita piso Calle Mayor — Lucía', status: 'pending', priority: 'normal', due_date: '2026-06-15', client_name: 'Lucía Herrera' },
  { id: 'tk3', title: 'Enviar dossier de inversión a Inversiones Atlántico', status: 'pending', priority: 'normal', due_date: '2026-06-16', client_name: 'Inversiones Atlántico SL' },
  { id: 'tk4', title: 'Seguimiento oferta chalet — Marta Vidal', status: 'pending', priority: 'high', due_date: '2026-06-14', client_name: 'Marta Vidal' },
]
