export interface Attachment {
  s3_key: string
  mime_type: string
  size_bytes: number
  presigned_url?: string | null
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  created_at: string
  attachment?: Attachment | null
  error?: string | null
}

export interface Conversation {
  id: string
  name: string
  created_at: string
  user_id: string
}

export interface ChatRequest {
  message: string
  conversation_id?: string | null
  user_id?: string | null
}

export interface ChatResponse {
  conversation_id?: string | null
  user_message_id?: string | null
  assistant_message_id?: string | null
  assistant_message?: string | null
  created_at?: string | null
  error?: string | null
  attachment?: Attachment | null
}
