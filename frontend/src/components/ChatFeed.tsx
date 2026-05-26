import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../types";

interface ChatFeedProps {
  activeMessages: Message[];
  isPending: boolean;
  setLightboxImage: (url: string | null) => void;
  setInputText: (text: string) => void;
  isSidebarOpen: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  isStreaming?: boolean;
  activeConversationId?: string | null;
}

export function ChatFeed({
  activeMessages,
  isPending,
  setLightboxImage,
  setInputText,
  isSidebarOpen,
  messagesEndRef,
  isStreaming = false,
  activeConversationId = null,
}: ChatFeedProps) {
  const [copiedBlockId, setCopiedBlockId] = React.useState<string | null>(null);

  // --- Scrolling and stream-following state refs ---
  const containerRef = React.useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = React.useRef<boolean>(true);
  const prevConversationIdRef = React.useRef<string | null>(null);
  const prevMessagesLengthRef = React.useRef<number>(0);

  const scrollToBottom = () => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
  };

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    // Check if the scroll position is near the bottom (within a 100px threshold).
    // If the user scrolls up (distance > 100px), we pause auto-scrolling to follow the user.
    // If they scroll back down (distance <= 100px), we resume auto-scrolling.
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <=
      100;

    shouldAutoScrollRef.current = isAtBottom;
  };

  // Reset auto-scroll flag and scroll to bottom when conversation changes
  React.useEffect(() => {
    if (activeConversationId !== prevConversationIdRef.current) {
      prevConversationIdRef.current = activeConversationId;
      shouldAutoScrollRef.current = true;
      scrollToBottom(); // instant scroll for different conversation
    }
  }, [activeConversationId]);

  // Monitor messages and stream chunks
  React.useEffect(() => {
    if (!activeMessages || activeMessages.length === 0) {
      prevMessagesLengthRef.current = 0;
      return;
    }

    const prevLength = prevMessagesLengthRef.current;
    const newLength = activeMessages.length;
    prevMessagesLengthRef.current = newLength;

    if (newLength > prevLength) {
      const lastMessage = activeMessages[newLength - 1];
      // When user sends a message, force scroll to bottom and enable follow
      if (lastMessage.role === "user") {
        shouldAutoScrollRef.current = true;
        scrollToBottom();
      } else {
        // New assistant message or other event, scroll if we are in auto-scroll mode
        if (shouldAutoScrollRef.current) {
          scrollToBottom();
        }
      }
    } else if (isStreaming && shouldAutoScrollRef.current) {
      // Stream chunk received while we are following the stream, use instant scroll
      scrollToBottom();
    }
  }, [activeMessages, isStreaming]);

  const handleCopyCode = (codeText: string, id: string) => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopiedBlockId(id);
      setTimeout(() => setCopiedBlockId(null), 2000);
    });
  };

  // --- Beautiful React Markdown/Code Block Parser ---
  const markdownComponents = React.useMemo(
    () => ({
      h1: ({ children, ...props }: any) => (
        <h1
          className="text-xl font-bold mt-4 mb-2 text-zinc-900 dark:text-white"
          {...props}
        >
          {children}
        </h1>
      ),
      h2: ({ children, ...props }: any) => (
        <h2
          className="text-lg font-bold mt-3 mb-1.5 text-zinc-900 dark:text-white"
          {...props}
        >
          {children}
        </h2>
      ),
      h3: ({ children, ...props }: any) => (
        <h3
          className="text-base font-bold mt-2.5 mb-1 text-zinc-900 dark:text-white"
          {...props}
        >
          {children}
        </h3>
      ),
      p: ({ children, ...props }: any) => (
        <p
          className="text-zinc-700 dark:text-zinc-300 leading-relaxed my-2"
          {...props}
        >
          {children}
        </p>
      ),
      ul: ({ children, ...props }: any) => (
        <ul
          className="list-disc pl-5 my-2 space-y-1 text-zinc-700 dark:text-zinc-300"
          {...props}
        >
          {children}
        </ul>
      ),
      ol: ({ children, ...props }: any) => (
        <ol
          className="list-decimal pl-5 my-2 space-y-1 text-zinc-700 dark:text-zinc-300"
          {...props}
        >
          {children}
        </ol>
      ),
      li: ({ children, ...props }: any) => (
        <li className="leading-relaxed" {...props}>
          {children}
        </li>
      ),
      strong: ({ children, ...props }: any) => (
        <strong
          className="font-semibold text-zinc-900 dark:text-white"
          {...props}
        >
          {children}
        </strong>
      ),
      em: ({ children, ...props }: any) => (
        <em className="italic text-zinc-800 dark:text-zinc-200" {...props}>
          {children}
        </em>
      ),
      a: ({ children, href, ...props }: any) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-650 dark:text-blue-400 hover:underline font-medium"
          {...props}
        >
          {children}
        </a>
      ),
      blockquote: ({ children, ...props }: any) => (
        <blockquote
          className="border-l-4 border-zinc-300 dark:border-zinc-700 pl-4 py-1 italic my-3 text-zinc-600 dark:text-zinc-400"
          {...props}
        >
          {children}
        </blockquote>
      ),
      table: ({ children, ...props }: any) => (
        <div className="overflow-x-auto my-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table
            className="w-full border-collapse text-left text-sm"
            {...props}
          >
            {children}
          </table>
        </div>
      ),
      thead: ({ children, ...props }: any) => (
        <thead
          className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800"
          {...props}
        >
          {children}
        </thead>
      ),
      tbody: ({ children, ...props }: any) => (
        <tbody
          className="divide-y divide-zinc-200 dark:divide-zinc-800"
          {...props}
        >
          {children}
        </tbody>
      ),
      tr: ({ children, ...props }: any) => (
        <tr
          className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 transition-colors"
          {...props}
        >
          {children}
        </tr>
      ),
      th: ({ children, ...props }: any) => (
        <th
          className="px-4 py-2 font-semibold text-zinc-900 dark:text-white border-r last:border-r-0 border-zinc-200 dark:border-zinc-800"
          {...props}
        >
          {children}
        </th>
      ),
      td: ({ children, ...props }: any) => (
        <td
          className="px-4 py-2 text-zinc-700 dark:text-zinc-300 border-r last:border-r-0 border-zinc-200 dark:border-zinc-800"
          {...props}
        >
          {children}
        </td>
      ),
      code: ({ className, children, ...props }: any) => {
        const match = /language-(\w+)/.exec(className || "");
        const codeText = String(children).replace(/\n$/, "");
        const isInline = !match && !codeText.includes("\n");

        const blockId = React.useId();

        if (isInline) {
          return (
            <code
              className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 font-mono text-xs text-blue-600 dark:text-blue-400"
              {...props}
            >
              {children}
            </code>
          );
        }

        const language = match ? match[1] : "code";
        return (
          <div className="my-3 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 text-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-400">
              <span className="uppercase">{language}</span>
              <button
                type="button"
                onClick={() => handleCopyCode(codeText, blockId)}
                className="hover:text-zinc-200 transition-colors cursor-pointer"
              >
                {copiedBlockId === blockId ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-zinc-100">
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
          </div>
        );
      },
    }),
    [copiedBlockId],
  );

  const renderMarkdown = (text: string) => {
    if (!text) return null;
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    );
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-thin ${!isSidebarOpen ? "pt-16" : ""}`}
    >
      {activeMessages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center max-w-lg mx-auto text-center space-y-4 py-20">
          <h1 className="text-xl font-semibold text-zinc-850 dark:text-white">
            Serverless Chatbot Platform
          </h1>
          <p className="text-sm text-zinc-450 max-w-sm">
            Securely authenticated via AWS Cognito. Deployed on AWS Lambda.
          </p>

          <div className="flex gap-2 w-full max-w-md pt-4 justify-center">
            <button
              onClick={() =>
                setInputText("How does AWS Lambda work in a serverless app?")
              }
              className="p-3 text-xs border border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-lg shadow-xs hover:bg-zinc-50 transition text-left w-full cursor-pointer"
            >
              Cloud Architecture Lambda
            </button>
            <button
              onClick={() =>
                setInputText(
                  "Explain how an S3 bucket hosts static React applications.",
                )
              }
              className="p-3 text-xs border border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-lg shadow-xs hover:bg-zinc-50 transition text-left w-full cursor-pointer"
            >
              SPA Hosting Guidelines
            </button>
          </div>
        </div>
      ) : (
        <div className="max-w-3xl mx-auto space-y-5">
          {activeMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className="flex flex-col max-w-[85%] gap-0.5">
                {/* Role Tag Label */}
                <span
                  className={`text-[10px] uppercase font-semibold tracking-wider px-2 ${
                    msg.role === "user"
                      ? "text-right text-blue-500"
                      : "text-left text-zinc-400"
                  }`}
                >
                  {msg.role === "user" ? "YOU" : "ASSISTANT"}
                </span>

                {/* Chat Bubble */}
                <div
                  className={`rounded-xl px-4 py-2.5 text-sm shadow-xs ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white font-medium"
                      : "bg-white border border-zinc-200 text-zinc-900 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {/* Presigned image attachments */}
                  {msg.attachments && msg.attachments.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {msg.attachments.map((att, idx) => (
                        <div
                          key={att.s3_key || idx}
                          className="max-w-[180px] overflow-hidden rounded-lg border border-black/10 dark:border-white/10 shrink-0"
                        >
                          <img
                            src={att.presigned_url || ""}
                            alt="Attached file"
                            onClick={() =>
                              setLightboxImage(att.presigned_url || null)
                            }
                            className="w-full max-h-36 object-cover cursor-zoom-in hover:opacity-90"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Legacy single attachment fallback */
                    msg.attachment && (
                      <div className="mb-2 max-w-xs overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
                        <img
                          src={msg.attachment.presigned_url || ""}
                          alt="Attached file"
                          onClick={() =>
                            setLightboxImage(
                              msg.attachment?.presigned_url || null,
                            )
                          }
                          className="w-full max-h-40 object-cover cursor-zoom-in hover:opacity-90"
                        />
                      </div>
                    )
                  )}

                  {/* Content Render */}
                  {msg.role === "user" ? (
                    <p className="whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </p>
                  ) : (
                    <div className="prose prose-zinc dark:prose-invert max-w-none">
                      {renderMarkdown(msg.content)}
                    </div>
                  )}

                  {/* Error feedback */}
                  {msg.error && (
                    <div className="mt-1.5 text-xs text-red-300 bg-red-950/20 border border-red-500/20 px-2 py-1 rounded">
                      Failed: {msg.error}
                    </div>
                  )}
                </div>

                {/* Timestamp */}
                <span
                  className={`text-[9px] text-zinc-400 px-1 font-mono ${msg.role === "user" ? "text-right" : "text-left"}`}
                >
                  {new Date(msg.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
            </div>
          ))}

          {/* Pulsing loading state */}
          {isPending && (
            <div className="flex justify-start">
              <div className="flex flex-col gap-0.5 max-w-[85%]">
                <span className="text-[10px] uppercase font-semibold tracking-wider text-zinc-400">
                  ASSISTANT
                </span>
                <div className="rounded-xl px-4 py-2 border border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-800 text-xs text-zinc-450 italic">
                  Thinking...
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
}
