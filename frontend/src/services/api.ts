import type { ChatRequest, ChatResponse } from "../types"

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
  const response = await fetch(`${cleanUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
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

  const response = await fetch(`${cleanUrl}/chat/image`, {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
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
