import { getCurrentSessionToken } from "./auth";
import type { Conversation, Message, RagDocument } from "../types";

// ── Response types ────────────────────────────────────────────────────────────

/**
 * Shape of the combined GraphQL InitialData query response.
 * Used to replace three parallel REST calls with a single round-trip.
 */
export interface InitialData {
  health: { status: string };
  conversations: Conversation[];
  ragDocuments: RagDocument[];
}

interface GqlError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: string[];
}

interface GqlResponse<T> {
  data?: T;
  errors?: GqlError[];
}

// ── GraphQL queries & mutations ───────────────────────────────────────────────

const INITIAL_DATA_QUERY = /* GraphQL */ `
  query GetInitialData {
    health {
      status
    }
    conversations {
      id
      name
      createdAt
      updatedAt
      userId
    }
    ragDocuments {
      documentId
      filename
      status
      chunksIngested
      createdAt
      tags
    }
  }
`;

const CONVERSATION_MESSAGES_QUERY = /* GraphQL */ `
  query GetConversationMessages($conversationId: String!) {
    conversationMessages(conversationId: $conversationId) {
      id
      role
      content
      createdAt
      attachment {
        s3Key
        mimeType
        sizeBytes
        presignedUrl
      }
      attachments {
        s3Key
        mimeType
        sizeBytes
        presignedUrl
      }
      citations {
        text
        source
        score
        key
        page
      }
    }
  }
`;

const UPDATE_CONVERSATION_NAME_MUTATION = /* GraphQL */ `
  mutation UpdateConversationName($conversationId: String!, $name: String!) {
    updateConversationName(conversationId: $conversationId, name: $name) {
      id
      name
      createdAt
      updatedAt
      userId
    }
  }
`;

const DELETE_CONVERSATION_MUTATION = /* GraphQL */ `
  mutation DeleteConversation($conversationId: String!) {
    deleteConversation(conversationId: $conversationId) {
      deleted
      conversationId
    }
  }
`;

const DELETE_RAG_DOCUMENT_MUTATION = /* GraphQL */ `
  mutation DeleteRagDocument($documentId: String!) {
    deleteRagDocument(documentId: $documentId) {
      deleted
      documentId
    }
  }
`;

const INGEST_RAG_TEXT_MUTATION = /* GraphQL */ `
  mutation IngestRagText(
    $filename: String!
    $content: String!
    $tags: [String!]!
  ) {
    ingestRagText(filename: $filename, content: $content, tags: $tags) {
      status
      filename
      documentId
      chunksIngested
    }
  }
`;

// ── Fetch helper ──────────────────────────────────────────────────────────────

/**
 * Sends a raw GraphQL query or mutation to ``POST /graphql`` and returns the typed
 * ``data`` object. Throws on network errors or when the response contains
 * only GraphQL errors (no partial data).
 */
async function gqlFetch<T>(
  apiBaseUrl: string,
  query: string,
  variables: Record<string, any> | null,
  token: string | null,
): Promise<GqlResponse<T>> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${cleanUrl}/graphql`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables: variables || undefined }),
  });

  if (!response.ok) {
    throw new Error(
      `GraphQL request failed: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<GqlResponse<T>>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches health status, conversations, and RAG documents in a **single**
 * GraphQL request, eliminating the parallel REST cold-start wave.
 *
 * Strawberry returns camelCase field names, which are mapped back to the
 * snake_case shapes expected by the existing frontend types.
 */
export async function fetchInitialData(
  apiBaseUrl: string,
): Promise<InitialData> {
  const token = await getCurrentSessionToken();
  const result = await gqlFetch<{
    health: { status: string };
    conversations: Array<{
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      userId: string | null;
    }>;
    ragDocuments: Array<{
      documentId: string;
      filename: string;
      status: string;
      chunksIngested: number;
      createdAt: string;
      tags: string[] | null;
    }>;
  }>(apiBaseUrl, INITIAL_DATA_QUERY, null, token);

  if (!result.data) {
    const messages =
      result.errors?.map((e) => e.message).join("; ") ??
      "Unknown GraphQL error";
    throw new Error(`GraphQL initial data failed: ${messages}`);
  }

  const { health, conversations, ragDocuments } = result.data;

  // Map camelCase GraphQL response → snake_case frontend types
  const mappedConversations: Conversation[] = (conversations ?? []).map(
    (c) => ({
      id: c.id,
      name: c.name,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
      user_id: c.userId ?? "",
    }),
  );

  const mappedRagDocuments: RagDocument[] = (ragDocuments ?? []).map((d) => ({
    document_id: d.documentId,
    filename: d.filename,
    source_doc: d.filename,
    status: d.status,
    chunks_ingested: d.chunksIngested,
    created_at: d.createdAt,
    updated_at: d.createdAt,
    tags: d.tags ?? undefined,
  }));

  return {
    health,
    conversations: mappedConversations,
    ragDocuments: mappedRagDocuments,
  };
}

/**
 * Fetches all messages in a specific conversation via GraphQL.
 */
export async function fetchConversationMessagesGql(
  conversationId: string,
  apiBaseUrl: string,
): Promise<Message[]> {
  const token = await getCurrentSessionToken();
  const result = await gqlFetch<{
    conversationMessages: Array<{
      id: string;
      role: string;
      content: string;
      createdAt: string;
      attachment: {
        s3Key: string;
        mimeType: string;
        sizeBytes: number;
        presignedUrl: string | null;
      } | null;
      attachments: Array<{
        s3Key: string;
        mimeType: string;
        sizeBytes: number;
        presignedUrl: string | null;
      }> | null;
      citations: Array<{
        text: string;
        source: string;
        score: number;
        key: string | null;
        page: number | null;
      }> | null;
    }>;
  }>(apiBaseUrl, CONVERSATION_MESSAGES_QUERY, { conversationId }, token);

  if (!result.data || result.errors) {
    const messages =
      result.errors?.map((e) => e.message).join("; ") ??
      "Unknown GraphQL error";
    throw new Error(`Failed to fetch messages via GraphQL: ${messages}`);
  }

  return (result.data.conversationMessages ?? []).map((msg) => ({
    id: msg.id,
    role: msg.role as "user" | "assistant",
    content: msg.content,
    created_at: msg.createdAt,
    attachment: msg.attachment
      ? {
        s3_key: msg.attachment.s3Key,
        mime_type: msg.attachment.mimeType,
        size_bytes: msg.attachment.sizeBytes,
        presigned_url: msg.attachment.presignedUrl ?? undefined,
      }
      : null,
    attachments: msg.attachments
      ? msg.attachments.map((att) => ({
        s3_key: att.s3Key,
        mime_type: att.mimeType,
        size_bytes: att.sizeBytes,
        presigned_url: att.presignedUrl ?? undefined,
      }))
      : null,
    citations: msg.citations
      ? msg.citations.map((cit) => ({
        text: cit.text,
        source: cit.source,
        score: cit.score,
        key: cit.key ?? undefined,
        page: cit.page ?? undefined,
      }))
      : undefined,
  }));
}

/**
 * Updates the conversation name via GraphQL mutation.
 */
export async function updateConversationNameGql(
  conversationId: string,
  name: string,
  apiBaseUrl: string,
): Promise<Conversation> {
  const token = await getCurrentSessionToken();
  const result = await gqlFetch<{
    updateConversationName: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      userId: string | null;
    };
  }>(
    apiBaseUrl,
    UPDATE_CONVERSATION_NAME_MUTATION,
    { conversationId, name },
    token,
  );

  if (!result.data || result.errors) {
    const messages =
      result.errors?.map((e) => e.message).join("; ") ??
      "Unknown GraphQL error";
    throw new Error(
      `Failed to update conversation name via GraphQL: ${messages}`,
    );
  }

  const conv = result.data.updateConversationName;
  return {
    id: conv.id,
    name: conv.name,
    created_at: conv.createdAt,
    user_id: conv.userId ?? "",
  };
}

/**
 * Deletes a conversation via GraphQL mutation.
 */
export async function deleteConversationGql(
  conversationId: string,
  apiBaseUrl: string,
): Promise<{ deleted: boolean; conversation_id: string }> {
  const token = await getCurrentSessionToken();
  const result = await gqlFetch<{
    deleteConversation: {
      deleted: boolean;
      conversationId: string;
    };
  }>(apiBaseUrl, DELETE_CONVERSATION_MUTATION, { conversationId }, token);

  if (!result.data || result.errors) {
    const messages =
      result.errors?.map((e) => e.message).join("; ") ??
      "Unknown GraphQL error";
    throw new Error(`Failed to delete conversation via GraphQL: ${messages}`);
  }

  return {
    deleted: result.data.deleteConversation.deleted,
    conversation_id: result.data.deleteConversation.conversationId,
  };
}

/**
 * Deletes an ingested RAG document via GraphQL mutation.
 */
export async function deleteRagDocumentGql(
  documentId: string,
  apiBaseUrl: string,
): Promise<{ deleted: boolean; document_id: string }> {
  const token = await getCurrentSessionToken();
  const result = await gqlFetch<{
    deleteRagDocument: {
      deleted: boolean;
      documentId: string;
    };
  }>(apiBaseUrl, DELETE_RAG_DOCUMENT_MUTATION, { documentId }, token);

  if (!result.data || result.errors) {
    const messages =
      result.errors?.map((e) => e.message).join("; ") ??
      "Unknown GraphQL error";
    throw new Error(`Failed to delete RAG document via GraphQL: ${messages}`);
  }

  return {
    deleted: result.data.deleteRagDocument.deleted,
    document_id: result.data.deleteRagDocument.documentId,
  };
}

/**
 * Ingests a new text document for RAG via GraphQL mutation.
 */
export async function ingestRagDocumentGql(
  filename: string,
  content: string,
  tags: string[],
  apiBaseUrl: string,
): Promise<{
  status: string;
  filename: string;
  document_id: string;
  chunks_ingested: number;
}> {
  const token = await getCurrentSessionToken();
  const result = await gqlFetch<{
    ingestRagText: {
      status: string;
      filename: string;
      documentId: string;
      chunksIngested: number;
    };
  }>(apiBaseUrl, INGEST_RAG_TEXT_MUTATION, { filename, content, tags }, token);

  if (!result.data || result.errors) {
    const messages =
      result.errors?.map((e) => e.message).join("; ") ??
      "Unknown GraphQL error";
    throw new Error(`Failed to ingest document via GraphQL: ${messages}`);
  }

  const ingest = result.data.ingestRagText;
  return {
    status: ingest.status,
    filename: ingest.filename,
    document_id: ingest.documentId,
    chunks_ingested: ingest.chunksIngested,
  };
}
