export type Channel = 'WhatsApp' | 'Instagram' | 'Web' | 'Email'
export type ClientStatus = 'active' | 'lead' | 'inactive' | 'churned'
export type ConversationSentiment = 'positive' | 'neutral' | 'negative'
export type MessageSender = 'client' | 'agent' | 'ai'
export type AssistantMode = 'inbox' | 'copilot'
export type AutomationStatus = 'active' | 'paused' | 'draft'
export type EventType = 'call' | 'demo' | 'meeting' | 'follow-up'
export type InvoiceStatus = 'paid' | 'pending' | 'overdue'
export type AIInsightType = 'warning' | 'opportunity' | 'info'
export type ActivityType = 'email' | 'call' | 'message' | 'deal' | 'note'
export type AutomationEmailStatus = 'delivered' | 'opened' | 'clicked' | 'bounced'
export type N8nFlowStatus = 'active' | 'inactive' | 'demo' | 'pending_config' | 'error'
export type N8nRequirement = 'Supabase' | 'n8n' | 'WhatsApp/API' | 'Email/API' | 'Billing/API' | 'Payment/API' | 'IA/API'
export type IntegrationStatus = 'connected' | 'demo_connected' | 'demo_ready' | 'disconnected' | 'pending' | 'pending_config' | 'error'

export type Client = {
  id: string
  name: string
  email: string
  phone: string
  channel: Channel
  status: ClientStatus
  leadScore: number
  lastInteraction: string
  company: string
  avatar: string
  notes?: string
}

export type Conversation = {
  id: string
  workspaceId?: string
  clientId: string
  clientName: string
  clientAvatar: string
  lastMessage: string
  timestamp: string
  unread: boolean
  sentiment: ConversationSentiment
  channel: Channel
  intent?: string
  assistantMode?: AssistantMode
  status?: string
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export type Message = {
  id: string
  conversationId: string
  workspaceId?: string
  content: string
  sender: MessageSender
  timestamp: string
  metadata?: Record<string, unknown>
  createdAt?: string
}

export type Automation = {
  id: string
  name: string
  description: string
  status: AutomationStatus
  trigger: string
  emailsSent: number
  openRate: number
  clickRate: number
  conversions: number
  lastRun: string
}

export type AutomationEmail = {
  id: string
  automationId: string
  recipient: string
  subject: string
  sentAt: string
  status: AutomationEmailStatus
}

export type CalendarEvent = {
  id: string
  title: string
  date: string
  startHour: number
  startMinute: number
  duration: number
  type: EventType
  clientName?: string
  description?: string
}

export type Invoice = {
  id: string
  clientName: string
  amount: number
  status: InvoiceStatus
  date: string
  dueDate: string
  plan: string
  notes?: string
}

export type AIInsight = {
  id: string
  type: AIInsightType
  title: string
  description: string
  action?: string
}

export type Activity = {
  id: string
  type: ActivityType
  description: string
  timestamp: string
  clientName?: string
}

export type WeeklyLeads = {
  day: string
  WhatsApp: number
  Instagram: number
  Web: number
  Email: number
}

export type RevenueByPlan = {
  plan: string
  revenue: number
  count: number
}

export type N8nFlow = {
  id: string
  event: string
  label: string
  description: string
  trigger: string
  webhookUrl: string
  status: N8nFlowStatus
  requires: N8nRequirement[]
  updatedAt?: string
}

export type IntegrationSetting = {
  id: string
  key: string
  name: string
  description: string
  status: IntegrationStatus
  category: string
  info?: string
}

export type DocumentType = 'client_file' | 'invoice_pdf' | 'proposal_pdf' | 'conversation_attachment' | 'workspace_asset'

export type WorkspaceDocument = {
  id: string
  workspaceId: string
  clientId?: string
  title: string
  type: DocumentType
  storageBucket: string
  storagePath: string
  mimeType?: string
  size?: number
  createdBy?: string
  createdAt?: string
}
