import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface CitationLinkProps {
  index: number;
  citation: {
    text: string;
    source: string;
    page?: number;
    score?: number;
  };
  onClick: () => void;
}

export function CitationLink({ index, citation, onClick }: CitationLinkProps) {
  const [showTooltip, setShowTooltip] = React.useState(false);
  const hideTimeoutRef = React.useRef<number | null>(null);

  const handleMouseEnter = () => {
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    // Delay hiding slightly to allow smooth transition between trigger and tooltip
    hideTimeoutRef.current = window.setTimeout(() => {
      setShowTooltip(false);
    }, 180);
  };

  React.useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        className="inline-flex items-center justify-center font-mono text-[9px] font-bold bg-blue-100 hover:bg-blue-200 dark:bg-blue-950 dark:hover:bg-blue-900 text-blue-600 dark:text-blue-400 rounded-full w-4.5 h-4.5 mx-0.5 align-super transform -translate-y-0.5 transition-all select-none cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-blue-500"
      >
        {index}
      </button>

      {showTooltip && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-50 text-zinc-800 dark:text-zinc-200 text-xs text-left animate-in fade-in duration-100"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Tooltip Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-white dark:border-t-zinc-900" />
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1.5 border-4 border-transparent border-t-zinc-200 dark:border-t-zinc-800 -z-10" />

          {/* Header Metadata */}
          <div className="flex items-center justify-between border-b border-zinc-150 dark:border-zinc-800 pb-1.5 mb-1.5 gap-2">
            <span className="font-semibold text-zinc-900 dark:text-white truncate max-w-[170px]" title={citation.source}>
              📄 {citation.source}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {citation.page && (
                <span className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[10px] text-zinc-500 font-medium">
                  Page {citation.page}
                </span>
              )}
              {citation.score !== undefined && (
                <span className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                  {Math.round(citation.score * 100)}% Match
                </span>
              )}
            </div>
          </div>

          {/* Snippet Preview */}
          <div className="text-[11px] leading-relaxed max-h-28 overflow-y-auto pr-1 scrollbar-thin italic text-zinc-600 dark:text-zinc-450 prose prose-zinc dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {citation.text}
            </ReactMarkdown>
          </div>

          {/* Action indicator */}
          <div className="mt-2 pt-1.5 border-t border-zinc-150 dark:border-zinc-800 flex justify-between items-center text-[9px] text-zinc-400">
            <span>Click to see full reference</span>
            <button
              type="button"
              onClick={() => {
                setShowTooltip(false);
                onClick();
              }}
              className="text-blue-500 hover:text-blue-600 font-semibold cursor-pointer"
            >
              Open Full View →
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
