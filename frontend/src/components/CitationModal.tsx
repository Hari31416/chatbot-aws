import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface CitationModalProps {
  isOpen: boolean;
  onClose: () => void;
  index: number;
  citation: {
    text: string;
    source: string;
    page?: number;
    score?: number;
  };
}

export function CitationModal({ isOpen, onClose, index, citation }: CitationModalProps) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      setCopied(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(citation.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 text-zinc-800 dark:text-zinc-100 flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-zinc-150 dark:border-zinc-800 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-450 px-2.5 py-0.5 rounded-full shrink-0">
              Source [{index}]
            </span>
            <h2 className="font-bold text-base leading-tight truncate max-w-xs md:max-w-md" title={citation.source}>
              Reference: {citation.source}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-650 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
            type="button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 flex flex-col min-h-0">
          {/* Metadata Row */}
          <div className="flex flex-wrap gap-4 border-b border-zinc-150 dark:border-zinc-800 pb-4 text-xs font-semibold text-zinc-500 dark:text-zinc-400 shrink-0">
            <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/60 px-2.5 py-1 rounded">
              <span>Location:</span>
              <span className="text-zinc-800 dark:text-zinc-200">
                {citation.page ? `Page ${citation.page}` : "N/A"}
              </span>
            </div>
            {citation.score !== undefined && (
              <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800/60 px-2.5 py-1 rounded">
                <span>Match Relevance:</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {Math.round(citation.score * 100)}%
                </span>
                <div className="w-12 bg-zinc-250 dark:bg-zinc-700 rounded-full h-1 overflow-hidden shrink-0">
                  <div
                    className="bg-emerald-500 h-full"
                    style={{ width: `${Math.round(citation.score * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Citation Text */}
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/30 dark:bg-zinc-900/20 overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-4 py-2 bg-zinc-100/70 dark:bg-zinc-800/40 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                Ingested Document Segment Text
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="text-xs font-semibold text-blue-500 hover:text-blue-650 flex items-center gap-1 cursor-pointer transition-colors"
              >
                {copied ? "Copied!" : "Copy Snippet"}
              </button>
            </div>
            <div className="p-4 overflow-y-auto prose prose-zinc dark:prose-invert max-w-none text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed font-sans italic pr-2 select-text flex-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {citation.text}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="border-t border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-750 transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
