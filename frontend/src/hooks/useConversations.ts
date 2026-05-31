import * as React from "react";
import type { Conversation } from "@/types";
import { deleteConversationGql, updateConversationNameGql } from "@/services/graphql";
import { useToast } from "@/components/ui/Toast";

interface UseConversationsProps {
  apiBaseUrl: string;
  userId: string;
  isLoggedIn: boolean;
}

export function useConversations({ apiBaseUrl, userId, isLoggedIn }: UseConversationsProps) {
  const { toast } = useToast();

  const [conversations, setConversations] = React.useState<Conversation[]>(
    () => {
      const saved = localStorage.getItem("conversations");
      return saved ? JSON.parse(saved) : [];
    },
  );

  const [activeConversationId, setActiveConversationId] = React.useState<
    string | null
  >(() => {
    return localStorage.getItem("active_conversation_id") || null;
  });

  React.useEffect(() => {
    if (isLoggedIn) {
      localStorage.setItem("conversations", JSON.stringify(conversations));
    }
  }, [conversations, isLoggedIn]);

  React.useEffect(() => {
    if (isLoggedIn && activeConversationId) {
      localStorage.setItem("active_conversation_id", activeConversationId);
    } else if (isLoggedIn) {
      localStorage.removeItem("active_conversation_id");
    }
  }, [activeConversationId, isLoggedIn]);

  const handleCreateConversation = React.useCallback(() => {
    const newId = Math.random().toString(36).substring(2, 9);
    const newConv: Conversation = {
      id: newId,
      name: "New Chat...",
      created_at: new Date().toISOString(),
      user_id: userId,
      isLocal: true,
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(newId);
    return newId;
  }, [userId]);

  const handleDeleteConversation = React.useCallback(
    (id: string, e: React.MouseEvent, onDeleteMessages?: (id: string) => void) => {
      e.stopPropagation();

      // Optimistic UI updates
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
      }
      if (onDeleteMessages) {
        onDeleteMessages(id);
      }

      // Backend deletion
      deleteConversationGql(id, apiBaseUrl).catch((err) => {
        console.error(`Failed to delete conversation ${id} from backend:`, err);
        toast({
          title: "Delete Failed",
          description: "Could not delete conversation from server.",
          type: "error",
        });
      });
    },
    [activeConversationId, apiBaseUrl, toast],
  );

  const handleUpdateConversationName = React.useCallback(
    (id: string, name: string) => {
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === id);
        if (!conv) return prev;

        // If it's a local unsaved conversation, do not send update mutation
        if (!conv.isLocal) {
          updateConversationNameGql(id, name, apiBaseUrl).catch((err) => {
            console.error("Failed to update conversation name:", err);
            toast({
              title: "Rename Failed",
              description: "Could not rename conversation on the server.",
              type: "error",
            });
            // Revert optimistic updates
            setConversations((rollbackPrev) =>
              rollbackPrev.map((c) => (c.id === id ? { ...c, name: conv.name } : c)),
            );
          });
        }

        return prev.map((c) => (c.id === id ? { ...c, name } : c));
      });
    },
    [apiBaseUrl, toast],
  );

  return {
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    handleCreateConversation,
    handleDeleteConversation,
    handleUpdateConversationName,
  };
}
