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
}: InputBarProps) {
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

        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-955 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-650 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={useRag}
              onChange={(e) => setUseRag(e.target.checked)}
              disabled={selectedImages.length > 0}
              className="h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
            />
            RAG
          </label>
          <input
            type="text"
            value={ragDocumentsText}
            onChange={(e) => setRagDocumentsText(e.target.value)}
            disabled={!useRag || selectedImages.length > 0}
            placeholder="Optional documents: company_rules.txt, handbook.txt"
            className="min-w-0 flex-1 bg-transparent text-xs text-zinc-700 outline-hidden placeholder:text-zinc-400 disabled:opacity-45 dark:text-zinc-200"
          />
        </div>

        {useRag && ragDocuments.length > 0 && selectedImages.length === 0 && (
          <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto px-1">
            {ragDocuments.map((document) => {
              const selected = selectedDocuments.includes(document.source_doc);
              const isProcessing = document.status === "processing";
              const isFailed = document.status === "failed";
              return (
                <button
                  key={document.document_id}
                  type="button"
                  disabled={isProcessing || isFailed}
                  onClick={() => toggleDocument(document.source_doc)}
                  className={`rounded-md border px-2 py-1 text-xs transition ${
                    selected
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200"
                      : isProcessing
                        ? "border-amber-250 bg-amber-50/30 text-amber-600 dark:border-amber-900/50 dark:bg-amber-955 dark:text-amber-450 opacity-60 cursor-not-allowed"
                        : isFailed
                          ? "border-red-250 bg-red-50/30 text-red-600 dark:border-red-900/50 dark:bg-amber-955 dark:text-red-450 opacity-60 cursor-not-allowed"
                          : "border-zinc-200 bg-white text-zinc-650 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                  }`}
                  title={
                    isProcessing
                      ? "Document is currently being vectorized..."
                      : isFailed
                        ? "Document ingestion failed."
                        : `${document.chunks_ingested} chunks ingested`
                  }
                >
                  {isProcessing ? "⏳ " : isFailed ? "⚠️ " : ""}
                  {document.filename}
                </button>
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
