import * as React from "react";
import type { RagDocument } from "../types";

interface InputBarProps {
  inputText: string;
  setInputText: (text: string) => void;
  selectedImages: File[];
  imagePreviewUrls: string[];
  handleSendMessage: (e: React.FormEvent) => void;
  handleImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRemoveImage: (index?: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  isPending: boolean;
  useRag: boolean;
  setUseRag: (enabled: boolean) => void;
  ragDocumentsText: string;
  setRagDocumentsText: (text: string) => void;
  ragDocuments: RagDocument[];
  selectedTags: string[];
  setSelectedTags: React.Dispatch<React.SetStateAction<string[]>>;
}

export function InputBar({
  inputText,
  setInputText,
  selectedImages,
  imagePreviewUrls,
  handleSendMessage,
  handleImageChange,
  handleRemoveImage,
  fileInputRef,
  isPending,
  useRag,
  setUseRag,
  ragDocumentsText,
  setRagDocumentsText,
  ragDocuments,
  selectedTags,
  setSelectedTags,
}: InputBarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = React.useState(false);
  const [docSearchQuery, setDocSearchQuery] = React.useState("");
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const selectedDocuments = ragDocumentsText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const toggleDocument = (filename: string) => {
    const next = selectedDocuments.includes(filename)
      ? selectedDocuments.filter((item) => item !== filename)
      : [...selectedDocuments, filename];
    setRagDocumentsText(next.join(", "));
  };

  // Dynamically extract all unique tags from documents
  const allTags = React.useMemo(() => {
    const tagsSet = new Set<string>();
    ragDocuments.forEach((doc) => {
      if (doc.tags) {
        doc.tags.forEach((tag) => tagsSet.add(tag));
      }
    });
    return Array.from(tagsSet);
  }, [ragDocuments]);

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  // Filter documents by selected tags
  const visibleDocuments = React.useMemo(() => {
    if (selectedTags.length === 0) {
      return ragDocuments;
    }
    return ragDocuments.filter((doc) => {
      if (!doc.tags) return false;
      return doc.tags.some((tag) => selectedTags.includes(tag));
    });
  }, [ragDocuments, selectedTags]);

  const searchedDocuments = React.useMemo(() => {
    return visibleDocuments.filter((doc) =>
      doc.filename.toLowerCase().includes(docSearchQuery.toLowerCase())
    );
  }, [visibleDocuments, docSearchQuery]);

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 z-25">
      <form
        onSubmit={handleSendMessage}
        className="max-w-3xl mx-auto flex flex-col gap-2"
      >
        {/* Attachment previews */}
        {imagePreviewUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 p-1.5 border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-955 rounded-lg max-w-full overflow-x-auto">
            {imagePreviewUrls.map((url, i) => (
              <div
                key={url}
                className="flex items-center gap-1.5 p-1 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-md shrink-0"
              >
                <div className="relative h-10 w-10 rounded overflow-hidden border border-zinc-200 dark:border-zinc-850 shrink-0">
                  <img
                    src={url}
                    alt="Preview"
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(i)}
                    className="absolute top-0.5 right-0.5 h-3.5 w-3.5 bg-black/70 rounded-full flex items-center justify-center text-[8px] text-white cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                <span className="text-[10px] max-w-20 truncate font-mono text-zinc-500">
                  {selectedImages[i]?.name}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-955 sm:flex-row sm:items-center relative">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-650 dark:text-zinc-300 select-none shrink-0">
            <input
              type="checkbox"
              checked={useRag}
              onChange={(e) => setUseRag(e.target.checked)}
              disabled={selectedImages.length > 0}
              className="h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40 cursor-pointer"
            />
            Ground with RAG Knowledge
          </label>
          {useRag && selectedImages.length === 0 && (
            <div className="sm:ml-auto w-full sm:w-auto relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full sm:w-64 flex items-center justify-between px-3 py-1.5 text-[11px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-lg hover:border-zinc-300 dark:hover:border-zinc-700 transition cursor-pointer text-zinc-700 dark:text-zinc-300 font-semibold"
              >
                <span className="truncate">
                  {selectedDocuments.length === 0
                    ? "Select documents (Search all)"
                    : `${selectedDocuments.length} document${selectedDocuments.length > 1 ? "s" : ""} selected`}
                </span>
                <span className="text-[9px] text-zinc-400">▼</span>
              </button>

              {isDropdownOpen && (
                <div className="absolute bottom-full mb-2 right-0 w-72 sm:w-80 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-50 flex flex-col max-h-72 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
                  <div className="p-2 border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex gap-2 items-center justify-between">
                    <input
                      type="text"
                      placeholder="Filter documents..."
                      value={docSearchQuery}
                      onChange={(e) => setDocSearchQuery(e.target.value)}
                      className="flex-1 px-2 py-1 text-[11px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500 font-medium"
                    />
                    {selectedDocuments.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setRagDocumentsText("")}
                        className="px-2 py-1 text-[10px] text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 font-bold rounded transition cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-850 max-h-48">
                    {searchedDocuments.length === 0 ? (
                      <div className="p-4 text-center text-xs text-zinc-450 dark:text-zinc-500">
                        {docSearchQuery
                          ? "No matching documents found"
                          : "No documents available"}
                      </div>
                    ) : (
                      searchedDocuments.map((doc: RagDocument) => {
                        const isSelected = selectedDocuments.includes(doc.source_doc);
                        const isProcessing = doc.status === "processing";
                        const isFailed = doc.status === "failed";

                        return (
                          <label
                            key={doc.document_id}
                            className={`flex items-start gap-2.5 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-850/40 cursor-pointer select-none transition ${isSelected ? "bg-blue-50/10 dark:bg-blue-950/10" : ""
                              } ${isProcessing || isFailed ? "opacity-60 cursor-not-allowed" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={isProcessing || isFailed}
                              onChange={() => toggleDocument(doc.source_doc)}
                              className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                            <div className="flex-1 min-w-0 text-left">
                              <p className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-200 truncate" title={doc.filename}>
                                {isProcessing ? "⏳ " : isFailed ? "⚠️ " : ""}
                                {doc.filename}
                              </p>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                <span className="text-[9px] text-zinc-400 font-mono">
                                  {doc.status === "ready" ? `${doc.chunks_ingested} chunks` : doc.status}
                                </span>
                                {doc.tags && doc.tags.map((t: string) => (
                                  <span key={t} className="text-[8px] px-1 py-0.2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded font-bold">
                                    #{t}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {useRag && allTags.length > 0 && selectedImages.length === 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs mb-1">
            <span className="text-zinc-550 font-semibold dark:text-zinc-400">Filter by tags:</span>
            {allTags.map((tag) => {
              const selected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition cursor-pointer ${
                    selected
                    ? "border-blue-500 bg-blue-600 text-white dark:bg-blue-500"
                    : "border-zinc-200 bg-white text-zinc-650 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                  }`}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        )}

        {useRag && selectedDocuments.length > 0 && selectedImages.length === 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 py-1 max-h-16 overflow-y-auto border-t border-zinc-100 dark:border-zinc-850 pt-2">
            {selectedDocuments.map((docName) => {
              const docItem = ragDocuments.find(d => d.source_doc === docName);
              return (
                <div
                  key={docName}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950 dark:text-blue-200 text-[11px] font-semibold"
                >
                  <span className="truncate max-w-40">{docItem?.filename || docName}</span>
                  <button
                    type="button"
                    onClick={() => toggleDocument(docName)}
                    className="hover:bg-blue-100 dark:hover:bg-blue-900 p-0.5 rounded cursor-pointer text-[10px] leading-none text-blue-500"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Input Row matching user image search style */}
        <div className="relative flex items-center bg-zinc-50 dark:bg-zinc-955 border border-zinc-200 dark:border-zinc-800 rounded-full px-4 py-1.5 focus-within:ring-2 focus-within:ring-blue-500 transition shadow-xs">
          <input
            type="file"
            multiple
            ref={fileInputRef as any}
            onChange={handleImageChange}
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`text-sm mr-2.5 transition cursor-pointer ${
              selectedImages.length > 0
                ? "text-blue-500 font-semibold"
                : "text-zinc-400 hover:text-zinc-650"
            }`}
            title="Upload image"
          >
            📎
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Ask anything..."
            className="flex-1 bg-transparent border-none outline-hidden text-sm py-1.5 placeholder-zinc-450 text-zinc-800 dark:text-zinc-100"
          />

          <button
            type="submit"
            disabled={
              (!inputText.trim() && selectedImages.length === 0) || isPending
            }
            className="h-8 px-3 rounded-full bg-blue-600 hover:bg-blue-505 text-white text-xs font-semibold transition disabled:opacity-30 shrink-0 flex items-center justify-center cursor-pointer"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
