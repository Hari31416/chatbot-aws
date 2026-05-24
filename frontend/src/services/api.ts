import type { ChatRequest, ChatResponse, Conversation, Message } from "../types"
import { getCurrentSessionToken } from "./auth"

/**
 * Custom error class for API failures
 */
export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

/**
 * Checks connection health of backend API.
 */
export async function checkHealth(apiBaseUrl: string): Promise<boolean> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "")
  try {
    const response = await fetch(`${cleanUrl}/health`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    })
    if (!response.ok) return false
    const data = await response.json()
    return data.status === "ok"
  } catch (err) {
    console.error("Health check failed:", err)
    return false
  }
}

/**
 * Sends a text chat request to POST /chat
 */
export async function sendTextMessage(
  payload: ChatRequest,
  apiBaseUrl: string
): Promise<ChatResponse> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "")
  const token = getCurrentSessionToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${cleanUrl}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiError(
      errorBody.detail || `Server responded with ${response.status}: ${response.statusText}`,
      response.status
    )
  }

  const data: ChatResponse = await response.json()
  if (data.error) {
    throw new ApiError(data.error)
  }
  return data
}

/**
 * Sends an image-based chat request to POST /chat/image
 */
export async function sendImageMessage(
  file: File,
  message: string | null,
  conversationId: string | null,
  userId: string | null,
  apiBaseUrl: string
): Promise<ChatResponse> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "")
  const formData = new FormData()
  formData.append("file", file)
  if (message) {
    formData.append("message", message)
  }
  if (conversationId) {
    formData.append("conversation_id", conversationId)
  }
  if (userId) {
    formData.append("user_id", userId)
  }

  const token = getCurrentSessionToken()
  const headers: Record<string, string> = {
    Accept: "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${cleanUrl}/chat/image`, {
    method: "POST",
    headers,
    body: formData,
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiError(
      errorBody.detail || `Server responded with ${response.status}: ${response.statusText}`,
      response.status
    )
  }

  const data: ChatResponse = await response.json()
  if (data.error) {
    throw new ApiError(data.error)
  }
  return data
}

/**
 * Fetches all conversations of the user
 */
export async function fetchConversations(apiBaseUrl: string): Promise<Conversation[]> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "")
  const token = getCurrentSessionToken()
  const headers: Record<string, string> = {
    Accept: "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${cleanUrl}/conversations`, {
    method: "GET",
    headers,
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiError(
      errorBody.detail || `Failed to fetch conversations: ${response.statusText}`,
      response.status
    )
  }

  return response.json()
}

/**
 * Fetches all messages in a specific conversation
 */
export async function fetchConversationMessages(
  conversationId: string,
  apiBaseUrl: string
): Promise<Message[]> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "")
  const token = getCurrentSessionToken()
  const headers: Record<string, string> = {
    Accept: "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${cleanUrl}/conversations/${conversationId}/messages`, {
    method: "GET",
    headers,
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiError(
      errorBody.detail || `Failed to fetch messages: ${response.statusText}`,
      response.status
    )
  }

  return response.json()
}

/**
 * Updates the conversation name
 */
export async function updateConversationName(
  conversationId: string,
  name: string,
  apiBaseUrl: string
): Promise<Conversation> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "")
  const token = getCurrentSessionToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${cleanUrl}/conversations/${conversationId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ name }),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiError(
      errorBody.detail || `Failed to update conversation name: ${response.statusText}`,
      response.status
    )
  }

  return response.json()
}

/**
 * Deletes a conversation and its messages
 */
export async function deleteConversationApi(
  conversationId: string,
  apiBaseUrl: string
): Promise<{ deleted: boolean; conversation_id: string }> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "")
  const token = getCurrentSessionToken()
  const headers: Record<string, string> = {
    Accept: "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${cleanUrl}/conversations/${conversationId}`, {
    method: "DELETE",
    headers,
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiError(
      errorBody.detail || `Failed to delete conversation: ${response.statusText}`,
      response.status
    )
  }

  return response.json()
}
