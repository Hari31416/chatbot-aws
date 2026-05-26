import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Message, Conversation } from "./types";
import {
  sendTextMessage,
  sendImageMessage,
  checkHealth,
  fetchConversations,
  fetchConversationMessages,
  deleteConversationApi,
  sendChatMessageStream,
  fetchRagDocuments,
} from "./services/api";
import { useToast } from "@/components/ui/Toast";
import { useTheme } from "@/components/theme-provider";
import {
  signUpUser,
  confirmSignUpUser,
  signInUser,
  signOutUser,
  isUserLoggedIn,
  getCurrentUserEmail,
  getCurrentSessionToken,
} from "./services/auth";
import { AuthGate } from "./components/AuthGate";
import { Sidebar } from "./components/Sidebar";
import { ChatFeed } from "./components/ChatFeed";
import { InputBar } from "./components/InputBar";
import { SettingsModal } from "./components/SettingsModal";
import { DocumentsModal } from "./components/DocumentsModal";

export function App() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();

  // --- Authentication State ---
  const [isLoggedIn, setIsLoggedIn] = React.useState(isUserLoggedIn());
  const [authMode, setAuthMode] = React.useState<"LOGIN" | "SIGNUP" | "VERIFY">(
    "LOGIN",
  );
  const [authEmail, setAuthEmail] = React.useState("");
  const [authPassword, setAuthPassword] = React.useState("");
  const [authCode, setAuthCode] = React.useState("");
  const [authLoading, setAuthLoading] = React.useState(false);

  // --- Configuration State ---
  const [apiBaseUrl, setApiBaseUrl] = React.useState<string>(() => {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isLocalhost && import.meta.env.VITE_API_BASE_URL) {
      return import.meta.env.VITE_API_BASE_URL;
    }
    return (
      localStorage.getItem("api_base_url") ||
      import.meta.env.VITE_API_BASE_URL ||
      "http://localhost:8080"
    );
  });
  const [userId, setUserId] = React.useState<string>(() => {
    return isLoggedIn ? getCurrentUserEmail() : "admin";
  });

  // --- UI Layout State ---
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(() => {
    return typeof window !== "undefined" ? window.innerWidth >= 768 : true;
  });
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [isDocumentsOpen, setIsDocumentsOpen] = React.useState(false);
  const [lightboxImage, setLightboxImage] = React.useState<string | null>(null);

  // --- Chat & Conversation State ---
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
  const [messages, setMessages] = React.useState<Record<string, Message[]>>(
    () => {
      const saved = localStorage.getItem("messages_cache");
      return saved ? JSON.parse(saved) : {};
    },
  );

  const [inputText, setInputText] = React.useState("");
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [selectedImages, setSelectedImages] = React.useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = React.useState<string[]>([]);
  const [useRag, setUseRag] = React.useState(false);
  const [ragDocumentsText, setRagDocumentsText] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // --- API Health Status ---
  const {
    data: isBackendOnline,
    refetch: recheckBackendHealth,
    isFetching: isCheckingHealth,
  } = useQuery({
    queryKey: ["backendHealth", apiBaseUrl],
    queryFn: () => checkHealth(apiBaseUrl),
    refetchInterval: 30000,
  });

  const { data: ragDocuments = [], refetch: refetchRagDocuments } = useQuery({
    queryKey: ["ragDocuments", apiBaseUrl, isLoggedIn],
    queryFn: () => fetchRagDocuments(apiBaseUrl),
    enabled: Boolean(apiBaseUrl && isLoggedIn),
    refetchInterval: 30000,
  });

  // --- Sync configs and sessions ---
  React.useEffect(() => {
    localStorage.setItem("api_base_url", apiBaseUrl);
  }, [apiBaseUrl]);

  React.useEffect(() => {
    localStorage.setItem("user_id", userId);
  }, [userId]);

  React.useEffect(() => {
    localStorage.setItem("conversations", JSON.stringify(conversations));
  }, [conversations]);

  React.useEffect(() => {
    if (activeConversationId) {
      localStorage.setItem("active_conversation_id", activeConversationId);
    } else {
      localStorage.removeItem("active_conversation_id");
    }
  }, [activeConversationId]);

  React.useEffect(() => {
    localStorage.setItem("messages_cache", JSON.stringify(messages));
  }, [messages]);

  // Sync userId state dynamically with logged in user email
  React.useEffect(() => {
    if (isLoggedIn) {
      setUserId(getCurrentUserEmail());
    } else {
      setUserId("admin");
    }
  }, [isLoggedIn]);

  // Fetch conversations from backend on mount or when API URL / Login State changes
  React.useEffect(() => {
    if (!apiBaseUrl) return;

    let active = true;
    async function loadConversations() {
      try {
        const backendConvs = await fetchConversations(apiBaseUrl);
        if (active) {
          setConversations(backendConvs);
        }
      } catch (err: any) {
        console.error("Failed to fetch conversations from backend:", err);
      }
    }
    loadConversations();
    return () => {
      active = false;
    };
  }, [apiBaseUrl, isLoggedIn, userId]);

  // Fetch messages for active conversation from backend when activeConversationId changes
  React.useEffect(() => {
    if (!activeConversationId || !apiBaseUrl) return;

    const convId = activeConversationId;
    const currentMessages = messages[convId] || [];
    if (currentMessages.length === 0) {
      const conv = conversations.find((c) => c.id === convId);
      if (conv && conv.isLocal) {
        return;
      }
    }

    let active = true;
    async function loadMessages() {
      try {
        const backendMessages = await fetchConversationMessages(
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
  }, [activeConversationId, apiBaseUrl]);

  // Automatic logout on unauthorized API errors (session expired)
  React.useEffect(() => {
    const handleUnauthorized = () => {
      signOutUser();
      setIsLoggedIn(false);
      setActiveConversationId(null);
      toast({
        title: "Session Expired",
        description: "Your session has expired. Please log in again.",
        type: "error",
      });
    };

    window.addEventListener("unauthorized-api-error", handleUnauthorized);
    return () => {
      window.removeEventListener("unauthorized-api-error", handleUnauthorized);
    };
  }, [toast]);

  // --- Authentication Handlers ---
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim() || (!authPassword && authMode !== "VERIFY")) return;

    setAuthLoading(true);
    try {
      if (authMode === "LOGIN") {
        await signInUser(authEmail.trim(), authPassword);
        setIsLoggedIn(true);
        toast({
          title: "Welcome back!",
          description: "Login successful.",
          type: "success",
        });
      } else if (authMode === "SIGNUP") {
        await signUpUser(authEmail.trim(), authPassword);
        setAuthMode("VERIFY");
        toast({
          title: "Account Created",
          description: "Please check your email for the verification code.",
          type: "info",
        });
      } else if (authMode === "VERIFY") {
        if (!authCode.trim()) {
          toast({
            title: "Verification Code Required",
            description: "Please enter the 6-digit confirmation code.",
            type: "error",
          });
          setAuthLoading(false);
          return;
        }
        await confirmSignUpUser(authEmail.trim(), authCode.trim());
        setAuthMode("LOGIN");
        setAuthCode("");
        setAuthPassword("");
        toast({
          title: "Account Verified!",
          description: "Verification successful. You can now log in.",
          type: "success",
        });
      }
    } catch (err: any) {
      toast({
        title: "Authentication Failed",
        description: err.message || "Operation failed",
        type: "error",
      });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    signOutUser();
    setIsLoggedIn(false);
    setActiveConversationId(null);
    toast({
      title: "Logged Out",
      description: "Session terminated successfully.",
      type: "info",
    });
  };

  // --- Message mutation handlers ---
  const sendMutation = useMutation({
    mutationFn: async ({
      text,
      imageFiles,
      convId,
    }: {
      text: string;
      imageFiles: File[];
      convId: string;
    }) => {
      if (imageFiles.length > 0) {
        return sendImageMessage(
          imageFiles,
          text || null,
          convId,
          userId,
          apiBaseUrl,
        );
      } else {
        return sendTextMessage(
          { message: text, conversation_id: convId, user_id: userId },
          apiBaseUrl,
        );
      }
    },
    onSuccess: (data, variables) => {
      const convId = variables.convId;
      const assistantMsgId =
        data.assistant_message_id || Math.random().toString();
      const assistantText = data.assistant_message || "";

      const assistantMsg: Message = {
        id: assistantMsgId,
        role: "assistant",
        content: assistantText,
        created_at: data.created_at || new Date().toISOString(),
        attachment: data.attachment,
        attachments: data.attachments,
      };

      setMessages((prev) => {
        const currentList = prev[convId] || [];
        const updatedList = currentList.map((m) => {
          if (m.id === "temp-user-msg") {
            return {
              ...m,
              id: data.user_message_id || m.id,
              attachment: data.attachment || m.attachment,
              attachments: data.attachments || m.attachments,
            };
          }
          return m;
        });
        return {
          ...prev,
          [convId]: [...updatedList, assistantMsg],
        };
      });

      const newName = variables.text.slice(0, 30) || "Image Chat";
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === convId) {
            return {
              ...c,
              name: c.name === "New Chat..." ? newName : c.name,
              isLocal: false,
            };
          }
          return c;
        }),
      );
    },
    onError: (error: any, variables) => {
      const convId = variables.convId;
      toast({
        title: "Error sending message",
        description: error.message || "Server is not responding",
        type: "error",
      });

      setMessages((prev) => {
        const currentList = prev[convId] || [];
        return {
          ...prev,
          [convId]: currentList.map((m) => {
            if (m.id === "temp-user-msg") {
              return { ...m, error: error.message || "Error occurred" };
            }
            return m;
          }),
        };
      });
    },
  });

  // --- Chat Handlers ---
  const handleCreateConversation = () => {
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
    setMessages((prev) => ({ ...prev, [newId]: [] }));
  };

  const handleDeleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Optimistic UI updates
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setMessages((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    if (activeConversationId === id) {
      setActiveConversationId(null);
    }

    // Backend deletion
    deleteConversationApi(id, apiBaseUrl).catch((err) => {
      console.error(`Failed to delete conversation ${id} from backend:`, err);
      toast({
        title: "Delete Failed",
        description: "Could not delete conversation from server.",
        type: "error",
      });
    });
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    const validFiles: File[] = [];
    const validUrls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 5242880) {
        toast({
          title: "File Too Large",
          description: `${file.name} exceeds the maximum 5 MB limit.`,
          type: "error",
        });
        continue;
      }
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: "Unsupported Format",
          description: `${file.name} format is not supported (PNG, JPEG, and WebP are supported).`,
          type: "error",
        });
        continue;
      }
      validFiles.push(file);
      validUrls.push(URL.createObjectURL(file));
    }

    if (validFiles.length > 0) {
      setSelectedImages((prev) => [...prev, ...validFiles]);
      setImagePreviewUrls((prev) => [...prev, ...validUrls]);
    }
  };

  const handleRemoveImage = (index?: number) => {
    if (typeof index === "number") {
      const urlToRevoke = imagePreviewUrls[index];
      if (urlToRevoke) {
        URL.revokeObjectURL(urlToRevoke);
      }
      setSelectedImages((prev) => prev.filter((_, i) => i !== index));
      setImagePreviewUrls((prev) => prev.filter((_, i) => i !== index));
    } else {
      imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
      setSelectedImages([]);
      setImagePreviewUrls([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && selectedImages.length === 0) return;

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

    const ragDocuments = ragDocumentsText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (selectedImages.length > 0) {
      sendMutation.mutate({
        text: inputText.trim(),
        imageFiles: selectedImages,
        convId: currentConvId,
      });
    } else {
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

      const token = getCurrentSessionToken();
      sendChatMessageStream(
        inputText.trim(),
        apiBaseUrl,
        token,
        currentConvId,
        (chunkText) => {
          setMessages((prev) => {
            const currentList = prev[currentConvId!] || [];
            return {
              ...prev,
              [currentConvId!]: currentList.map((m) =>
                m.id === tempAssistantMsgId
                  ? { ...m, content: m.content + chunkText }
                  : m,
              ),
            };
          });
        },
        (finalConvId, assistantMsgId, userMsgId) => {
          setMessages((prev) => {
            const currentList = prev[finalConvId] || [];
            return {
              ...prev,
              [finalConvId]: currentList.map((m) => {
                if (m.id === "temp-user-msg") {
                  return { ...m, id: userMsgId || m.id };
                }
                if (m.id === tempAssistantMsgId) {
                  return { ...m, id: assistantMsgId || m.id };
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
          rag_documents: ragDocuments.length > 0 ? ragDocuments : null,
        },
      );
    }

    setInputText("");
    setSelectedImages([]);
    setImagePreviewUrls([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const activeMessages = activeConversationId
    ? messages[activeConversationId] || []
    : [];

  if (!isLoggedIn) {
    return (
      <AuthGate
        authMode={authMode}
        setAuthMode={setAuthMode}
        authEmail={authEmail}
        setAuthEmail={setAuthEmail}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        authCode={authCode}
        setAuthCode={setAuthCode}
        authLoading={authLoading}
        handleAuthSubmit={handleAuthSubmit}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-50 font-sans text-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Sidebar Component */}
      <Sidebar
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        conversations={conversations}
        activeConversationId={activeConversationId}
        setActiveConversationId={setActiveConversationId}
        handleCreateConversation={handleCreateConversation}
        handleDeleteConversation={handleDeleteConversation}
        userId={userId}
        theme={theme}
        setTheme={setTheme as any}
        handleLogout={handleLogout}
        onOpenDocuments={() => setIsDocumentsOpen(true)}
      />

      {/* --- MAIN CONTENT WINDOW --- */}
      <main className="flex-1 flex flex-col relative h-full min-w-0 bg-slate-50 dark:bg-zinc-950">
        {/* Floating Sidebar Toggle (ChatGPT/Claude style) */}
        {!isSidebarOpen && (
          <button
            className="absolute top-4 left-4 p-2.5 z-20 border border-zinc-200 dark:border-zinc-850 rounded-lg bg-white/90 dark:bg-zinc-900/90 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-650 dark:text-zinc-300 backdrop-blur-xs transition-all shadow-xs hover:shadow-sm cursor-pointer block"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <svg
              xmlns="http://www.w3.org/2050/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
              />
            </svg>
          </button>
        )}

        {/* Settings button floating on top right */}
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="absolute top-4 right-4 p-2.5 z-20 border border-zinc-200 dark:border-zinc-850 rounded-lg bg-white/90 dark:bg-zinc-900/90 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-650 dark:text-zinc-300 backdrop-blur-xs transition-all shadow-xs hover:shadow-sm cursor-pointer block"
          aria-label="Open settings"
        >
          ⚙️
        </button>

        {/* Chat Feed */}
        <ChatFeed
          activeMessages={activeMessages}
          isPending={
            sendMutation.isPending ||
            (isStreaming &&
              !(
                activeMessages[activeMessages.length - 1]?.role ===
                  "assistant" &&
                activeMessages[activeMessages.length - 1]?.content.length > 0
              ))
          }
          setLightboxImage={setLightboxImage}
          setInputText={setInputText}
          isSidebarOpen={isSidebarOpen}
          messagesEndRef={messagesEndRef}
          isStreaming={isStreaming}
          activeConversationId={activeConversationId}
        />

        {/* Input Bar */}
        <InputBar
          inputText={inputText}
          setInputText={setInputText}
          selectedImages={selectedImages}
          imagePreviewUrls={imagePreviewUrls}
          handleSendMessage={handleSendMessage}
          handleImageChange={handleImageChange}
          handleRemoveImage={handleRemoveImage}
          fileInputRef={fileInputRef}
          isPending={sendMutation.isPending || isStreaming}
          useRag={useRag}
          setUseRag={setUseRag}
          ragDocumentsText={ragDocumentsText}
          setRagDocumentsText={setRagDocumentsText}
          ragDocuments={ragDocuments}
        />
      </main>

      {/* --- LIGHTBOX MODAL --- */}
      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightboxImage(null)}
        >
          <img
            src={lightboxImage}
            alt="Large Attachment"
            className="max-w-full max-h-[90vh] object-contain rounded"
          />
        </div>
      )}

      {/* --- SETTINGS DRAWER MODAL --- */}
      <SettingsModal
        isSettingsOpen={isSettingsOpen}
        setIsSettingsOpen={setIsSettingsOpen}
        isBackendOnline={isBackendOnline}
        recheckBackendHealth={recheckBackendHealth}
        isCheckingHealth={isCheckingHealth}
        apiBaseUrl={apiBaseUrl}
        setApiBaseUrl={setApiBaseUrl}
        userId={userId}
      />

      {/* --- DOCUMENTS MANAGEMENT MODAL --- */}
      <DocumentsModal
        isOpen={isDocumentsOpen}
        onClose={() => setIsDocumentsOpen(false)}
        apiBaseUrl={apiBaseUrl}
        documents={ragDocuments}
        refetchDocuments={refetchRagDocuments}
      />
    </div>
  );
}

export default App;
