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
  userId,
  theme,
  setTheme,
  handleLogout,
  onOpenDocuments,
}: SidebarProps) {
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
            className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:text-zinc-400 transition cursor-pointer block"
            aria-label="Collapse sidebar"
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
                onClick={() => setActiveConversationId(conv.id)}
                className={`group flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-all ${
                  activeConversationId === conv.id
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white font-medium"
                    : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/55 hover:text-zinc-850 dark:hover:text-zinc-200"
                }`}
              >
                <span className="truncate text-sm">{conv.name}</span>
                <button
                  onClick={(e) => handleDeleteConversation(conv.id, e)}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-500 text-zinc-400 text-xs px-1 cursor-pointer transition-opacity"
                >
                  ✕
                </button>
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
            <div className="flex flex-col min-w-0">
              <span
                className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate"
                title={userId}
              >
                {userId}
              </span>
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
