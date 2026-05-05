export type Channel = 'WhatsApp' | 'Instagram' | 'Web' | 'Email'
export type ClientStatus = 'active' | 'lead' | 'inactive' | 'churned'
export type ConversationSentiment = 'positive' | 'neutral' | 'negative'
export type MessageSender = 'client' | 'agent' | 'ai'
export type AutomationStatus = 'active' | 'paused' | 'draft'
export type EventType = 'call' | 'demo' | 'meeting' | 'follow-up'
export type InvoiceStatus = 'paid' | 'pending' | 'overdue'
export type AIInsightType = 'warning' | 'opportunity' | 'info'
export type ActivityType = 'email' | 'call' | 'message' | 'deal' | 'note'
export type AutomationEmailStatus = 'delivered' | 'opened' | 'clicked' | 'bounced'

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
}

export type Conversation = {
  id: string
  clientId: string
  clientName: string
  clientAvatar: string
  lastMessage: string
  timestamp: string
  unread: boolean
  sentiment: ConversationSentiment
  channel: Channel
  intent?: string
}

export type Message = {
  id: string
  conversationId: string
  content: string
  sender: MessageSender
  timestamp: string
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
