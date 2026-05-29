import { getCurrentSessionToken } from './auth'
import type { Conversation, RagDocument } from '../types'

// ── Response types ────────────────────────────────────────────────────────────

/**
 * Shape of the combined GraphQL InitialData query response.
 * Used to replace three parallel REST calls with a single round-trip.
 */
export interface InitialData {
  health: { status: string }
  conversations: Conversation[]
  ragDocuments: RagDocument[]
}

interface GqlError {
  message: string
  locations?: Array<{ line: number; column: number }>
  path?: string[]
}

interface GqlResponse<T> {
  data?: T
  errors?: GqlError[]
}

// ── GraphQL query ─────────────────────────────────────────────────────────────

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
`

// ── Fetch helper ──────────────────────────────────────────────────────────────

/**
 * Sends a raw GraphQL query to ``POST /graphql`` and returns the typed
 * ``data`` object.  Throws on network errors or when the response contains
 * only GraphQL errors (no partial data).
 */
async function gqlFetch<T>(
  apiBaseUrl: string,
  query: string,
  token: string | null,
): Promise<GqlResponse<T>> {
  const cleanUrl = apiBaseUrl.replace(/\/$/, '')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${cleanUrl}/graphql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<GqlResponse<T>>
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches health status, conversations, and RAG documents in a **single**
 * GraphQL request, eliminating the parallel REST cold-start wave.
 *
 * Strawberry returns camelCase field names, which are mapped back to the
 * snake_case shapes expected by the existing frontend types.
 *
 * @throws when the network request itself fails.  GraphQL field-level errors
 *   (e.g. auth failure on individual fields) are surfaced as partial data or
 *   thrown when there is no usable ``data`` at all.
 */
export async function fetchInitialData(apiBaseUrl: string): Promise<InitialData> {
  const token = await getCurrentSessionToken()
  const result = await gqlFetch<{
    health: { status: string }
    conversations: Array<{
      id: string
      name: string
      createdAt: string
      updatedAt: string
      userId: string | null
    }>
    ragDocuments: Array<{
      documentId: string
      filename: string
      status: string
      chunksIngested: number
      createdAt: string
      tags: string[] | null
    }>
  }>(apiBaseUrl, INITIAL_DATA_QUERY, token)

  if (!result.data) {
    const messages = result.errors?.map((e) => e.message).join('; ') ?? 'Unknown GraphQL error'
    throw new Error(`GraphQL initial data failed: ${messages}`)
  }

  const { health, conversations, ragDocuments } = result.data

  // Map camelCase GraphQL response → snake_case frontend types
  const mappedConversations: Conversation[] = (conversations ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    user_id: c.userId ?? '',
  }))

  const mappedRagDocuments: RagDocument[] = (ragDocuments ?? []).map((d) => ({
    document_id: d.documentId,
    filename: d.filename,
    source_doc: d.filename,
    status: d.status,
    chunks_ingested: d.chunksIngested,
    created_at: d.createdAt,
    updated_at: d.createdAt,
    tags: d.tags ?? undefined,
  }))

  return {
    health,
    conversations: mappedConversations,
    ragDocuments: mappedRagDocuments,
  }
}
