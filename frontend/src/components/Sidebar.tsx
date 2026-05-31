import * as React from "react";
import type { Conversation } from "../types";

interface SidebarProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  handleCreateConversation: () => void;
  handleDeleteConversation: (id: string, e: React.MouseEvent) => void;
  handleUpdateConversationName?: (id: string, name: string) => void;
  userId: string;
  theme: string;
  setTheme: (theme: "light" | "dark") => void;
  handleLogout: () => void;
  onOpenDocuments?: () => void;
}

export function Sidebar({
  isSidebarOpen,
  setIsSidebarOpen,
  conversations,
  activeConversationId,
  setActiveConversationId,
  handleCreateConversation,
  handleDeleteConversation,
  handleUpdateConversationName,
  userId,
  theme,
  setTheme,
  handleLogout,
  onOpenDocuments,
}: SidebarProps) {
  const [isEmailRevealed, setIsEmailRevealed] = React.useState(false);
  const [editingConvId, setEditingConvId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [deletingConvId, setDeletingConvId] = React.useState<string | null>(null);

  const garbleEmail = (email: string): string => {
    if (!email || email === "Guest") return email;
    if (!email.includes("@")) return email;
    const [local, domain] = email.split("@");
    if (local.length <= 3) {
      return `${local.charAt(0)}${"•".repeat(local.length - 1)}@${domain}`;
    }
    return `${local.slice(0, 2)}${"•".repeat(local.length - 4)}${local.slice(-2)}@${domain}`;
  };

  return (
    <>
      {/* Mobile Sidebar Overlay Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* --- LEFT SIDEBAR (Ultra-Clean, White Background) --- */}
      <aside
        className={`fixed md:relative flex flex-col border-r border-zinc-200 bg-white dark:bg-zinc-900 transition-all duration-300 z-40 shrink-0 h-full shadow-lg md:shadow-none ${
          isSidebarOpen
            ? "w-64 translate-x-0"
            : "w-64 -translate-x-full md:w-0 md:translate-x-0 overflow-hidden border-none"
        }`}
      >
        {/* Sidebar Brand Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-150 dark:border-zinc-800">
          <span className="text-lg font-bold tracking-tight text-blue-600 dark:text-blue-500">
            Chatbot
          </span>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/55 dark:text-zinc-400 transition cursor-pointer block"
            aria-label="Collapse sidebar"
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
                d="M15.75 19.5 8.25 12l7.5-7.5"
              />
            </svg>
          </button>
        </div>

        {/* Action Buttons: Create Chat & Document Library */}
        <div className="p-4 space-y-2">
          <button
            onClick={handleCreateConversation}
            className="w-full flex items-center justify-start gap-3 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-sm font-medium transition-all cursor-pointer"
          >
            <span>+</span>
            <span>New Chat</span>
          </button>

          <button
            onClick={onOpenDocuments}
            className="w-full flex items-center justify-start gap-3 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-sm font-medium transition-all cursor-pointer"
          >
            <span>📚</span>
            <span>Document Library</span>
          </button>
        </div>

        {/* Navigation / History list */}
        <div className="flex-1 overflow-y-auto px-3 space-y-1 scrollbar-thin">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-450 dark:text-zinc-550 px-2.5 py-2">
            History
          </div>

          {conversations.length === 0 ? (
            <div className="text-xs text-zinc-400 px-3 py-2 italic">
              No recent chats.
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => {
                  if (editingConvId !== conv.id && deletingConvId !== conv.id) {
                    setActiveConversationId(conv.id);
                  }
                }}
                className={`group flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-all ${
                  activeConversationId === conv.id
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white font-medium"
                    : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/55 hover:text-zinc-850 dark:hover:text-zinc-200"
                }`}
              >
                {editingConvId === conv.id ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (editName.trim() && handleUpdateConversationName) {
                          handleUpdateConversationName(conv.id, editName.trim());
                        }
                        setEditingConvId(null);
                      } else if (e.key === "Escape") {
                        setEditingConvId(null);
                      }
                    }}
                    onBlur={() => {
                      if (
                        editName.trim() &&
                        handleUpdateConversationName &&
                        editName.trim() !== conv.name
                      ) {
                        handleUpdateConversationName(conv.id, editName.trim());
                      }
                      setEditingConvId(null);
                    }}
                    className="flex-1 bg-transparent border-b border-blue-500 focus:outline-hidden text-sm py-0.5 text-zinc-900 dark:text-white"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate text-sm flex-1 mr-2">{conv.name}</span>
                )}

                {deletingConvId === conv.id ? (
                  <div
                    className="flex items-center gap-1.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteConversation(conv.id, e);
                        setDeletingConvId(null);
                      }}
                      className="text-red-500 hover:text-red-700 text-xs p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer font-bold"
                      title="Confirm Delete"
                    >
                      ✓
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingConvId(null);
                      }}
                      className="text-zinc-400 hover:text-zinc-650 text-xs p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                      title="Cancel Delete"
                    >
                      ✕
                    </button>
                  </div>
                ) : editingConvId === conv.id ? null : (
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingConvId(conv.id);
                        setEditName(conv.name);
                      }}
                      className="hover:text-blue-500 text-zinc-400 dark:text-zinc-500 text-xs p-1 cursor-pointer"
                      title="Rename Chat"
                    >
                      ✏️
                    </button>
                    <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingConvId(conv.id);
                        }}
                        className="hover:text-red-500 text-zinc-400 dark:text-zinc-500 text-xs p-1 cursor-pointer"
                        title="Delete Chat"
                      >
                        ✕
                      </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Sidebar Bottom Actions */}
        <div className="p-4 border-t border-zinc-150 dark:border-zinc-800 space-y-3 bg-zinc-50/50 dark:bg-zinc-900/50">
          {/* User Profile Card */}
          <div className="flex items-center gap-2.5 px-1 py-0.5">
            <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-semibold select-none shadow-xs shrink-0">
              {userId.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              {userId === "Guest" ? (
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                  Guest
                </span>
              ) : (
                <div className="flex items-center justify-between gap-1 min-w-0">
                  <span
                    className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 select-none flex-1"
                    onClick={() => setIsEmailRevealed(!isEmailRevealed)}
                    title={
                      isEmailRevealed
                        ? "Click to hide email"
                        : "Click to show email"
                    }
                  >
                    {isEmailRevealed ? userId : garbleEmail(userId)}
                  </span>
                  <button
                    onClick={() => setIsEmailRevealed(!isEmailRevealed)}
                    className="text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-300 focus:outline-hidden p-0.5 shrink-0 cursor-pointer"
                    title={isEmailRevealed ? "Hide email" : "Show email"}
                  >
                    {isEmailRevealed ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-3.5 h-3.5"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.824 7.824 3 3m-3-3-3.867-3.867m0 0a3 3 0 1 1-4.243-4.243m4.242 4.242L9.88 9.88"
                        />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2050/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-3.5 h-3.5"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              )}
              <span className="text-[10px] text-zinc-400 font-medium">
                Active Session
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center text-xs text-zinc-550 dark:text-zinc-300 px-1 pt-1 border-t border-zinc-200/50 dark:border-zinc-800/50">
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="hover:text-zinc-750 dark:hover:text-zinc-100 cursor-pointer"
            >
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
            <button
              onClick={handleLogout}
              className="text-red-500 hover:text-red-750 font-semibold cursor-pointer"
            >
              Log Out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
