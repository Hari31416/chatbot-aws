import * as React from "react";
import { useToast } from "@/components/ui/Toast";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@clerk/react";
import { AuthGate } from "./components/AuthGate";
import { ClerkAuthSync } from "./components/ClerkAuthSync";
import { Sidebar } from "./components/Sidebar";
import { ChatFeed } from "./components/ChatFeed";
import { InputBar } from "./components/InputBar";
import { SettingsModal } from "./components/SettingsModal";
import { DocumentsModal } from "./components/DocumentsModal";
import { CitationModal } from "./components/CitationModal";
import { ConnectionScreen } from "./components/ConnectionScreen";
import { useHealth } from "./hooks/useHealth";
import { useChat } from "./hooks/useChat";
import type { ActiveCitationInfo } from "./types";

export function App() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const { isLoaded: isClerkLoaded, signOut } = useAuth();

  // --- Authentication State ---
  const [isLoggedIn, setIsLoggedIn] = React.useState(false);
  const [userId, setUserId] = React.useState<string>("Guest");
  const handleAuthChange = React.useCallback(
    (signedIn: boolean, displayLabel: string) => {
      setIsLoggedIn(signedIn);
      if (signedIn) {
        setUserId(displayLabel);
      } else {
        setUserId("Guest");
      }
    },
    [],
  );

  React.useEffect(() => {
    localStorage.setItem("user_id", userId);
  }, [userId]);

  // --- UI Layout State ---
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(() => {
    return typeof window !== "undefined" ? window.innerWidth >= 768 : true;
  });
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [isDocumentsOpen, setIsDocumentsOpen] = React.useState(false);
  const [lightboxImage, setLightboxImage] = React.useState<string | null>(null);
  const [activeCitation, setActiveCitation] =
    React.useState<ActiveCitationInfo | null>(null);

  // --- Custom Hooks for Health/Config & Chat Logic ---
  const {
    apiBaseUrl,
    setApiBaseUrl,
    functionUrl,
    setFunctionUrl,
    isBackendOnline,
    recheckBackendHealth,
    isCheckingHealth,
    backendHealthStatus,
    isFunctionOnline,
    recheckFunctionHealth,
    isCheckingFunction,
    functionHealthStatus,
  } = useHealth();

  const {
    conversations,
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
  } = useChat({
    apiBaseUrl,
    functionUrl,
    isLoggedIn,
    userId,
  });

  // Reset active citation if the conversation changes
  React.useEffect(() => {
    setActiveCitation(null);
  }, [activeConversationId]);

  // Automatic logout on unauthorized API errors (session expired)
  React.useEffect(() => {
    const handleUnauthorized = () => {
      void signOut();
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
  }, [toast, signOut, setActiveConversationId]);

  const handleLogout = () => {
    void signOut();
    setIsLoggedIn(false);
    setActiveConversationId(null);
    toast({
      title: "Logged Out",
      description: "Session terminated successfully.",
      type: "info",
    });
  };

  if (!isClerkLoaded) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  const isHealthPending =
    backendHealthStatus === "pending" || functionHealthStatus === "pending";
  const isAnyOffline = isBackendOnline !== true || isFunctionOnline !== true;

  if (isHealthPending || isAnyOffline) {
    return (
      <ConnectionScreen
        apiBaseUrl={apiBaseUrl}
        setApiBaseUrl={setApiBaseUrl}
        functionUrl={functionUrl}
        setFunctionUrl={setFunctionUrl}
        isBackendOnline={isBackendOnline}
        isFunctionOnline={isFunctionOnline}
        isCheckingBackend={isCheckingHealth}
        isCheckingFunction={isCheckingFunction}
        onRetry={() => {
          void recheckBackendHealth();
          void recheckFunctionHealth();
        }}
      />
    );
  }

  if (!isLoggedIn) {
    return (
      <>
        <ClerkAuthSync onAuthChange={handleAuthChange} />
        <AuthGate />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-50 font-sans text-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
      <ClerkAuthSync onAuthChange={handleAuthChange} />
      {/* Sidebar Component */}
      <Sidebar
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        conversations={conversations}
        activeConversationId={activeConversationId}
        setActiveConversationId={setActiveConversationId}
        handleCreateConversation={handleCreateConversation}
        handleDeleteConversation={handleDeleteConversation}
        handleUpdateConversationName={handleUpdateConversationName}
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
              xmlns="http://www.w3.org/2000/svg"
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
            isStreaming &&
            !(
              activeMessages[activeMessages.length - 1]?.role === "assistant" &&
              activeMessages[activeMessages.length - 1]?.content.length > 0
            )
          }
          setLightboxImage={setLightboxImage}
          setInputText={setInputText}
          isSidebarOpen={isSidebarOpen}
          messagesEndRef={messagesEndRef}
          isStreaming={isStreaming}
          activeConversationId={activeConversationId}
          activeCitation={activeCitation}
          setActiveCitation={setActiveCitation}
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
          isPending={isStreaming}
          useRag={useRag}
          setUseRag={setUseRag}
          ragDocumentsText={ragDocumentsText}
          setRagDocumentsText={setRagDocumentsText}
          ragDocuments={ragDocuments}
          selectedTags={selectedTags}
          setSelectedTags={setSelectedTags}
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
        isFunctionOnline={isFunctionOnline}
        recheckFunctionHealth={recheckFunctionHealth}
        isCheckingFunction={isCheckingFunction}
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

      {/* --- CITATION MODAL --- */}
      {activeCitation && (
        <CitationModal
          isOpen={activeCitation !== null}
          onClose={() => setActiveCitation(null)}
          index={activeCitation.index}
          citation={activeCitation.citation}
        />
      )}
    </div>
  );
}

export default App;
