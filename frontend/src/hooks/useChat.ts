import * as React from "react";
import type { Message, Conversation, RagDocument } from "@/types";
import { useToast } from "@/components/ui/Toast";
import { getCurrentSessionToken } from "@/services/auth";
import { sendChatMessageStream } from "@/services/api";
import { fetchInitialData, fetchConversationMessagesGql } from "@/services/graphql";
import { useConversations } from "./useConversations";
import { useImageUpload } from "./useImageUpload";

interface UseChatProps {
  apiBaseUrl: string;
  functionUrl: string;
  isLoggedIn: boolean;
  userId: string;
}

export function useChat({ apiBaseUrl, functionUrl, isLoggedIn, userId }: UseChatProps) {
  const { toast } = useToast();

  const {
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    handleCreateConversation,
    handleDeleteConversation: rawDeleteConversation,
    handleUpdateConversationName,
  } = useConversations({ apiBaseUrl, userId, isLoggedIn });

  const {
    selectedImages,
    imagePreviewUrls,
    fileInputRef,
    handleImageChange,
    handleRemoveImage,
    clearImages,
  } = useImageUpload();

  const [messages, setMessages] = React.useState<Record<string, Message[]>>(
    () => {
      const saved = localStorage.getItem("messages_cache");
      return saved ? JSON.parse(saved) : {};
    },
  );

  const [inputText, setInputText] = React.useState("");
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [useRag, setUseRag] = React.useState(false);
  const [ragDocumentsText, setRagDocumentsText] = React.useState("");
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [ragDocuments, setRagDocuments] = React.useState<RagDocument[]>([]);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Wrapper for handleDeleteConversation to also clean up local messages cache
  const handleDeleteConversation = React.useCallback(
    (id: string, e: React.MouseEvent) => {
      rawDeleteConversation(id, e, (deletedId) => {
        setMessages((prev) => {
          const copy = { ...prev };
          delete copy[deletedId];
          return copy;
        });
      });
    },
    [rawDeleteConversation],
  );

  const refetchRagDocuments = React.useCallback(async () => {
    if (!apiBaseUrl || !isLoggedIn) return;
    try {
      const data = await fetchInitialData(apiBaseUrl);
      setConversations(data.conversations);
      setRagDocuments(data.ragDocuments);
    } catch (err: unknown) {
      console.error("Failed to refresh initial data:", err);
    }
  }, [apiBaseUrl, isLoggedIn, setConversations]);

  React.useEffect(() => {
    if (isLoggedIn) {
      localStorage.setItem("messages_cache", JSON.stringify(messages));
    }
  }, [messages, isLoggedIn]);

  // Fetch initial conversations + RAG documents on login/URL change
  React.useEffect(() => {
    if (!apiBaseUrl || !isLoggedIn) return;

    let active = true;
    async function loadInitialData() {
      try {
        const data = await fetchInitialData(apiBaseUrl);
        if (active) {
          setConversations(data.conversations);
          setRagDocuments(data.ragDocuments);
        }
      } catch (err: unknown) {
        console.error("Failed to fetch initial data via GraphQL:", err);
      }
    }
    void loadInitialData();
    return () => {
      active = false;
    };
  }, [apiBaseUrl, isLoggedIn, userId, setConversations]);

  const isStreamingRef = React.useRef(isStreaming);
  React.useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Keep a reference to the conversations list to avoid trigger effects on rename/deletions
  const conversationsRef = React.useRef(conversations);
  React.useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Fetch messages when active conversation changes
  React.useEffect(() => {
    if (!activeConversationId || !apiBaseUrl || !isLoggedIn) return;

    const convId = activeConversationId;
    const conv = conversationsRef.current.find((c) => c.id === convId);
    if (conv?.isLocal) return;
    if (isStreamingRef.current) return;

    let active = true;
    async function loadMessages() {
      try {
        const backendMessages = await fetchConversationMessagesGql(
          convId,
          apiBaseUrl,
        );
        if (active) {
          setMessages((prev) => ({
            ...prev,
            [convId]: backendMessages,
          }));
        }
      } catch (err: any) {
        console.error(
          `Failed to fetch messages for conversation ${convId}:`,
          err,
        );
      }
    }
    loadMessages();
    return () => {
      active = false;
    };
  }, [activeConversationId, apiBaseUrl, isLoggedIn]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && selectedImages.length === 0) return;

    let base64Images: string[] | null = null;
    if (selectedImages.length > 0) {
      try {
        base64Images = await Promise.all(
          selectedImages.map((file) => {
            return new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.readAsDataURL(file);
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = (err) => reject(err);
            });
          }),
        );
      } catch (err: any) {
        toast({
          title: "Error processing image",
          description: err.message || "Failed to read image files",
          type: "error",
        });
        return;
      }
    }

    let currentConvId = activeConversationId;
    if (!currentConvId) {
      const newId = Math.random().toString(36).substring(2, 9);
      const newConv: Conversation = {
        id: newId,
        name: inputText.trim() ? inputText.trim().slice(0, 30) : "Image Chat",
        created_at: new Date().toISOString(),
        user_id: userId,
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveConversationId(newId);
      setMessages((prev) => ({ ...prev, [newId]: [] }));
      currentConvId = newId;
    }

    const tempUserMsg: Message = {
      id: "temp-user-msg",
      role: "user",
      content: inputText.trim(),
      created_at: new Date().toISOString(),
      attachment:
        selectedImages.length > 0
          ? {
            s3_key: "",
            mime_type: selectedImages[0].type,
            size_bytes: selectedImages[0].size,
            presigned_url: imagePreviewUrls[0],
          }
          : null,
      attachments:
        selectedImages.length > 0
          ? selectedImages.map((img, i) => ({
            s3_key: "",
            mime_type: img.type,
            size_bytes: img.size,
            presigned_url: imagePreviewUrls[i],
          }))
          : null,
    };

    setMessages((prev) => {
      const currentList = prev[currentConvId!] || [];
      return {
        ...prev,
        [currentConvId!]: [...currentList, tempUserMsg],
      };
    });

    const parsedRagDocs = ragDocumentsText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    setIsStreaming(true);

    const tempAssistantMsgId = "temp-assistant-msg";
    const tempAssistantMsg: Message = {
      id: tempAssistantMsgId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => {
      const currentList = prev[currentConvId!] || [];
      return {
        ...prev,
        [currentConvId!]: [...currentList, tempAssistantMsg],
      };
    });

    const token = await getCurrentSessionToken();
    sendChatMessageStream(
      inputText.trim(),
      functionUrl || apiBaseUrl,
      token,
      currentConvId,
      (chunkText, citations, finalContent) => {
        setMessages((prev) => {
          const currentList = prev[currentConvId!] || [];
          return {
            ...prev,
            [currentConvId!]: currentList.map((m) => {
              if (m.id === tempAssistantMsgId) {
                let content = m.content + chunkText;
                if (finalContent !== null && finalContent !== undefined) {
                  content = finalContent;
                }
                return {
                  ...m,
                  content,
                  citations: citations || m.citations,
                };
              }
              return m;
            }),
          };
        });
      },
      (finalConvId, assistantMsgId, userMsgId, citations) => {
        setMessages((prev) => {
          const currentList = prev[finalConvId] || [];
          return {
            ...prev,
            [finalConvId]: currentList.map((m) => {
              if (m.id === "temp-user-msg") {
                return { ...m, id: userMsgId || m.id };
              }
              if (m.id === tempAssistantMsgId) {
                return {
                  ...m,
                  id: assistantMsgId || m.id,
                  citations: citations || m.citations,
                };
              }
              return m;
            }),
          };
        });

        const newName = inputText.trim().slice(0, 30) || "New Chat...";
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id === currentConvId) {
              return {
                ...c,
                id: finalConvId,
                name: c.name === "New Chat..." ? newName : c.name,
                isLocal: false,
              };
            }
            return c;
          }),
        );

        if (
          activeConversationId === currentConvId &&
          currentConvId !== finalConvId
        ) {
          setActiveConversationId(finalConvId);
        }

        setIsStreaming(false);
      },
      (errorMsg) => {
        toast({
          title: "Error streaming response",
          description: errorMsg,
          type: "error",
        });

        setMessages((prev) => {
          const currentList = prev[currentConvId!] || [];
          return {
            ...prev,
            [currentConvId!]: currentList.map((m) => {
              if (m.id === "temp-user-msg") {
                return { ...m, error: errorMsg };
              }
              if (m.id === tempAssistantMsgId) {
                return { ...m, error: errorMsg };
              }
              return m;
            }),
          };
        });

        setIsStreaming(false);
      },
      {
        use_rag: useRag,
        rag_documents: parsedRagDocs.length > 0 ? parsedRagDocs : null,
        rag_tags: selectedTags.length > 0 ? selectedTags : null,
      },
      base64Images,
    );

    setInputText("");
    clearImages();
  };

  const activeMessages = activeConversationId
    ? messages[activeConversationId] || []
    : [];

  return {
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    handleCreateConversation,
    handleDeleteConversation,
    handleUpdateConversationName,
    selectedImages,
    imagePreviewUrls,
    fileInputRef,
    handleImageChange,
    handleRemoveImage,
    clearImages,
    messages,
    setMessages,
    inputText,
    setInputText,
    isStreaming,
    useRag,
    setUseRag,
    ragDocumentsText,
    setRagDocumentsText,
    selectedTags,
    setSelectedTags,
    ragDocuments,
    refetchRagDocuments,
    messagesEndRef,
    handleSendMessage,
    activeMessages,
  };
}
