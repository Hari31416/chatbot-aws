import type {
  ChatRequest,
  ChatResponse,
  Conversation,
  Message,
  RagDocument,
} from "../types";
import { getCurrentSessionToken } from "./auth";

/**
 * Custom error class for API failures
 */
export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Processes responses from the API, throwing ApiError on errors and dispatching a global
 * event on 401 Unauthorized status.
 */
async function handleResponse<T>(
  response: Response,
  defaultErrorMessage: string,
): Promise<T> {
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const status = response.status;
    if (status === 401) {
      window.dispatchEvent(new Event("unauthorized-api-error"));
    }
    throw new ApiError(
      errorBody.detail || `${defaultErrorMessage}: ${response.statusText}`,
      status,
    );
  }
  return response.json() as Promise<T>;
}

/**
 * Checks connection health of backend API.
 */
export async function checkHealth(apiBaseUrl: string): Promise<boolean> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  try {
    const response = await fetch(`${cleanUrl}/health`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === "ok";
  } catch (err) {
    console.error("Health check failed:", err);
    return false;
  }
}

/**
 * Sends a text chat request to POST /chat
 */
export async function sendTextMessage(
  payload: ChatRequest,
  apiBaseUrl: string,
): Promise<ChatResponse> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  const token = getCurrentSessionToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${cleanUrl}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const data = await handleResponse<ChatResponse>(
    response,
    `Server responded with ${response.status}`,
  );
  if (data.error) {
    throw new ApiError(data.error);
  }
  return data;
}

/**
 * Sends an image-based chat request to POST /chat/image
 */
export async function sendImageMessage(
  fileOrFiles: File | File[],
  message: string | null,
  conversationId: string | null,
  userId: string | null,
  apiBaseUrl: string,
): Promise<ChatResponse> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  const formData = new FormData();
  if (Array.isArray(fileOrFiles)) {
    fileOrFiles.forEach((file) => {
      formData.append("files", file);
    });
  } else {
    formData.append("file", fileOrFiles);
  }
  if (message) {
    formData.append("message", message);
  }
  if (conversationId) {
    formData.append("conversation_id", conversationId);
  }
  if (userId) {
    formData.append("user_id", userId);
  }

  const token = getCurrentSessionToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${cleanUrl}/chat/image`, {
    method: "POST",
    headers,
    body: formData,
  });

  const data = await handleResponse<ChatResponse>(
    response,
    `Server responded with ${response.status}`,
  );
  if (data.error) {
    throw new ApiError(data.error);
  }
  return data;
}

/**
 * Fetches all conversations of the user
 */
export async function fetchConversations(
  apiBaseUrl: string,
): Promise<Conversation[]> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  const token = getCurrentSessionToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${cleanUrl}/conversations`, {
    method: "GET",
    headers,
  });

  return handleResponse<Conversation[]>(
    response,
    "Failed to fetch conversations",
  );
}

/**
 * Fetches all messages in a specific conversation
 */
export async function fetchConversationMessages(
  conversationId: string,
  apiBaseUrl: string,
): Promise<Message[]> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  const token = getCurrentSessionToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(
    `${cleanUrl}/conversations/${conversationId}/messages`,
    {
      method: "GET",
      headers,
    },
  );

  return handleResponse<Message[]>(response, "Failed to fetch messages");
}

/**
 * Updates the conversation name
 */
export async function updateConversationName(
  conversationId: string,
  name: string,
  apiBaseUrl: string,
): Promise<Conversation> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  const token = getCurrentSessionToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${cleanUrl}/conversations/${conversationId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ name }),
  });

  return handleResponse<Conversation>(
    response,
    "Failed to update conversation name",
  );
}

/**
 * Deletes a conversation and its messages
 */
export async function deleteConversationApi(
  conversationId: string,
  apiBaseUrl: string,
): Promise<{ deleted: boolean; conversation_id: string }> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  const token = getCurrentSessionToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${cleanUrl}/conversations/${conversationId}`, {
    method: "DELETE",
    headers,
  });

  return handleResponse<{ deleted: boolean; conversation_id: string }>(
    response,
    "Failed to delete conversation",
  );
}

/**
 * Fetches the user's ingested RAG document catalogue.
 */
export async function fetchRagDocuments(
  apiBaseUrl: string,
): Promise<RagDocument[]> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  const token = getCurrentSessionToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${cleanUrl}/rag/documents`, {
    method: "GET",
    headers,
  });

  return handleResponse<RagDocument[]>(
    response,
    "Failed to fetch RAG documents",
  );
}

/**
 * Ingests a new document for RAG
 */
export async function ingestRagDocument(
  filename: string,
  content: string,
  apiBaseUrl: string,
): Promise<{
  status: string;
  filename: string;
  document_id: string;
  chunks_ingested: number;
}> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  const token = getCurrentSessionToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${cleanUrl}/rag/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify({ filename, content }),
  });

  return handleResponse<{
    status: string;
    filename: string;
    document_id: string;
    chunks_ingested: number;
  }>(response, "Failed to ingest RAG document");
}

/**
 * Ingests a physical document file (e.g. PDF, Image, or text file) using multipart/form-data
 */
export async function ingestRagFile(
  file: File,
  apiBaseUrl: string,
): Promise<{
  status: string;
  filename: string;
  document_id: string;
  chunks_ingested: number;
}> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  const token = getCurrentSessionToken();
  const formData = new FormData();
  formData.append("file", file);

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${cleanUrl}/rag/ingest/file`, {
    method: "POST",
    headers,
    body: formData,
  });

  return handleResponse<{
    status: string;
    filename: string;
    document_id: string;
    chunks_ingested: number;
  }>(response, "Failed to ingest physical RAG document");
}

/**
 * Progressive chunk structure for Response Streaming
 */
export interface StreamChunk {
  text?: string;
  conversation_id?: string;
  assistant_message_id?: string;
  user_message_id?: string;
  error?: string;
}

/**
 * Sends a chat message and reads a real-time event-stream response using the standard Fetch API stream reader
 */
export async function sendChatMessageStream(
  message: string,
  apiBaseUrl: string,
  token: string | null,
  conversationId?: string | null,
  onChunk?: (text: string) => void,
  onComplete?: (
    finalConversationId: string,
    assistantMsgId: string,
    userMsgId: string,
  ) => void,
  onError?: (error: string) => void,
  ragOptions?: Pick<ChatRequest, "use_rag" | "rag_documents">,
): Promise<void> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${cleanUrl}/chat/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
        use_rag: ragOptions?.use_rag ?? false,
        rag_documents: ragOptions?.rag_documents ?? null,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = "Failed to initiate stream";
      try {
        const errorJSON = JSON.parse(errorText);
        errorMsg = errorJSON.detail || errorMsg;
      } catch {
        errorMsg = errorText || errorMsg;
      }
      throw new Error(errorMsg);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    if (!reader) {
      throw new Error("No stream reader available");
    }

    let buffer = "";
    let activeConversationId = conversationId || "";
    let activeAssistantMsgId = "";
    let activeUserMsgId = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");

      // Save trailing incomplete line back to the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim() || !line.startsWith("data: ")) continue;

        const dataStr = line.replace(/^data:\s*/, "");
        if (dataStr === "[DONE]") continue;

        try {
          const chunk: StreamChunk = JSON.parse(dataStr);
          if (chunk.error) {
            if (onError) onError(chunk.error);
            return;
          }
          if (chunk.text && onChunk) {
            onChunk(chunk.text);
          }
          if (chunk.conversation_id) {
            activeConversationId = chunk.conversation_id;
          }
          if (chunk.assistant_message_id) {
            activeAssistantMsgId = chunk.assistant_message_id;
          }
          if (chunk.user_message_id) {
            activeUserMsgId = chunk.user_message_id;
          }
        } catch (e) {
          console.warn("Failed to parse SSE chunk", dataStr, e);
        }
      }
    }

    if (onComplete && activeConversationId) {
      onComplete(activeConversationId, activeAssistantMsgId, activeUserMsgId);
    }
  } catch (error: any) {
    if (onError) {
      onError(error.message || "An unexpected error occurred during streaming");
    }
  }
}
