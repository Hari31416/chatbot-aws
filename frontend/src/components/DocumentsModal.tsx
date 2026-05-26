import * as React from "react";
import type { RagDocument } from "../types";
import { ingestRagDocument, ingestRagFile } from "../services/api";
import { useToast } from "./ui/Toast";
import { Button } from "./ui/button";
import {
  Search,
  UploadCloud,
  FileText,
  X,
  Calendar,
  Database,
  Sparkles,
  Clock,
} from "lucide-react";

interface DocumentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiBaseUrl: string;
  documents: RagDocument[];
  refetchDocuments: () => void;
}

export function DocumentsModal({
  isOpen,
  onClose,
  apiBaseUrl,
  documents,
  refetchDocuments,
}: DocumentsModalProps) {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = React.useState<"catalog" | "ingest">(
    "catalog",
  );
  const [ingestMode, setIngestMode] = React.useState<"file" | "text">("file");
  const [searchQuery, setSearchQuery] = React.useState("");

  // Paste text form state
  const [pasteFilename, setPasteFilename] = React.useState("");
  const [pasteContent, setPasteContent] = React.useState("");

  // File upload state
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);

  // General status
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Clean up state when closing/opening
  React.useEffect(() => {
    if (!isOpen) {
      setSelectedFile(null);
      setPasteFilename("");
      setPasteContent("");
      setSearchQuery("");
      setActiveTab("catalog");
    }
  }, [isOpen]);

  // Auto-poll if any document is processing
  React.useEffect(() => {
    const hasProcessing = documents.some((doc) => doc.status === "processing");
    if (hasProcessing && isOpen) {
      const interval = setInterval(() => {
        refetchDocuments();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [documents, isOpen, refetchDocuments]);

  if (!isOpen) return null;

  // Filter documents
  const filteredDocuments = documents.filter((doc) =>
    (doc.filename || doc.source_doc || "")
      .toLowerCase()
      .includes(searchQuery.toLowerCase()),
  );

  const handleFileIngestion = async (file: File) => {
    setIsSubmitting(true);

    // Enforce maximum file size limit (20MB)
    const maxBytes = 20 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast({
        title: "File Too Large",
        description: `"${file.name}" exceeds the maximum supported size of 20MB.`,
        type: "warning",
      });
      setIsSubmitting(false);
      return;
    }

    try {
      await ingestRagFile(file, apiBaseUrl);
      toast({
        title: "Ingestion Success!",
        description: `"${file.name}" has been successfully chunked and vectorized.`,
        type: "success",
      });
      setSelectedFile(null);
      refetchDocuments();
      setActiveTab("catalog");
    } catch (err: any) {
      toast({
        title: "Ingestion Failed",
        description: err.message || "An error occurred during vectorization.",
        type: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Paste Ingestion
  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteFilename.trim() || !pasteContent.trim()) {
      toast({
        title: "Validation Error",
        description: "Please provide both a document name and some content.",
        type: "warning",
      });
      return;
    }

    // Ensure extension
    let name = pasteFilename.trim();
    if (!name.includes(".")) {
      name += ".txt";
    }

    setIsSubmitting(true);
    try {
      await ingestRagDocument(name, pasteContent, apiBaseUrl);
      toast({
        title: "Ingestion Success!",
        description: `"${name}" has been successfully vectorized.`,
        type: "success",
      });
      setPasteFilename("");
      setPasteContent("");
      refetchDocuments();
      setActiveTab("catalog");
    } catch (err: any) {
      toast({
        title: "Ingestion Failed",
        description: err.message || "An error occurred during vectorization.",
        type: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // File Drop Handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return "N/A";
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-4xl h-[85vh] md:h-[75vh] flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 text-zinc-800 dark:text-zinc-100">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-zinc-150 dark:border-zinc-800 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-450">
              <Database className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="font-bold text-base leading-tight">
                Knowledge Base Library
              </h2>
              <p className="text-xs text-zinc-400 font-medium">
                Manage and ingest documents for context-aware RAG queries
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-650 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Sub-navigation tabs */}
        <div className="flex border-b border-zinc-150 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6">
          <button
            onClick={() => setActiveTab("catalog")}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "catalog"
                ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500"
                : "border-transparent text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-200"
            }`}
          >
            📁 View Library ({documents.length})
          </button>
          <button
            onClick={() => setActiveTab("ingest")}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "ingest"
                ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500"
                : "border-transparent text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-200"
            }`}
          >
            ➕ Ingest New Document
          </button>
        </div>

        {/* Modal Content body */}
        <div className="flex-1 overflow-y-auto p-6 bg-zinc-50/20 dark:bg-zinc-950/20">
          {/* TAB 1: CATALOG */}
          {activeTab === "catalog" && (
            <div className="space-y-4 h-full flex flex-col">
              {/* Search and stats bar */}
              <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                <div className="relative w-full sm:max-w-xs">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-zinc-400">
                    <Search className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    placeholder="Search documents..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:text-zinc-100"
                  />
                </div>
                <div className="text-xs font-semibold text-zinc-450 dark:text-zinc-400 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5" />
                  <span>
                    Total database footprint:{" "}
                    {documents.reduce((acc, d) => acc + d.chunks_ingested, 0)}{" "}
                    text vectors
                  </span>
                </div>
              </div>

              {/* Document table/list view */}
              <div className="flex-1 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 shadow-xs">
                {filteredDocuments.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-center p-6">
                    <FileText className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mb-3" />
                    <p className="text-sm font-semibold text-zinc-650 dark:text-zinc-300">
                      No documents found
                    </p>
                    <p className="text-xs text-zinc-450 mt-1 max-w-xs">
                      {searchQuery
                        ? "Try adjusting your search criteria."
                        : "Begin by ingesting text or markdown files to populate your AI Knowledge Base."}
                    </p>
                    {!searchQuery && (
                      <Button
                        onClick={() => setActiveTab("ingest")}
                        size="sm"
                        className="mt-4"
                      >
                        Create First Document
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto h-full">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/70 text-[10px] uppercase font-bold tracking-wider text-zinc-400">
                          <th className="px-6 py-3.5">Document Title</th>
                          <th className="px-6 py-3.5">Footprint</th>
                          <th className="px-6 py-3.5">Ingested Date</th>
                          <th className="px-6 py-3.5 text-right">Identifier</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-150 dark:divide-zinc-800 text-xs">
                        {filteredDocuments.map((doc) => (
                          <tr
                            key={doc.document_id}
                            className="hover:bg-zinc-50/50 dark:hover:bg-zinc-850/30 transition-colors"
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2.5">
                                <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                                <span
                                  className="font-semibold text-zinc-800 dark:text-zinc-100 truncate max-w-xs md:max-w-sm"
                                  title={doc.source_doc}
                                >
                                  {doc.source_doc || doc.filename}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {doc.status === "processing" ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 animate-pulse">
                                  <Clock className="w-3 h-3 animate-spin shrink-0" />
                                  Processing...
                                </span>
                              ) : doc.status === "failed" ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                                  ⚠️ Failed
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                                  <Sparkles className="w-3 h-3" />
                                  {doc.chunks_ingested} chunks
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-zinc-450 dark:text-zinc-400 flex items-center gap-1.5 mt-0.5">
                              <Calendar className="w-3.5 h-3.5" />
                              {formatDate(doc.created_at)}
                            </td>
                            <td className="px-6 py-4 text-right font-mono text-[9px] text-zinc-400">
                              {doc.document_id.slice(0, 8)}...
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: INGESTION */}
          {activeTab === "ingest" && (
            <div className="max-w-2xl mx-auto space-y-6">
              {/* Selector for Ingest Mode */}
              <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl max-w-xs">
                <button
                  type="button"
                  onClick={() => setIngestMode("file")}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    ingestMode === "file"
                      ? "bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 shadow-xs"
                      : "text-zinc-450 hover:text-zinc-650 dark:hover:text-zinc-200"
                  }`}
                >
                  📁 File Ingest
                </button>
                <button
                  type="button"
                  onClick={() => setIngestMode("text")}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    ingestMode === "text"
                      ? "bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 shadow-xs"
                      : "text-zinc-450 hover:text-zinc-650 dark:hover:text-zinc-200"
                  }`}
                >
                  ✍️ Paste Text
                </button>
              </div>

              {/* Mode A: Local File Upload */}
              {ingestMode === "file" && (
                <div className="space-y-4">
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-2xl p-8 text-center flex flex-col items-center justify-center transition duration-200 ${
                      isDragOver
                        ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
                        : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-zinc-400"
                    }`}
                  >
                    <input
                      type="file"
                      id="rag-file-picker"
                      onChange={handleFileChange}
                      accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif,.txt,.md,.markdown,.json,.csv,.js,.ts,.py,.html,.css"
                      className="hidden"
                    />

                    <div className="p-4 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 mb-3 shadow-xs">
                      <UploadCloud className="w-8 h-8" />
                    </div>

                    <h3 className="font-bold text-sm text-zinc-700 dark:text-zinc-200">
                      Drag and drop your file here
                    </h3>
                    <p className="text-xs text-zinc-450 mt-1 mb-4">
                      Supports PDF, Images, Text, Markdown, CSV, JSON and code
                      (up to 20MB, max 100 pages)
                    </p>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        document.getElementById("rag-file-picker")?.click()
                      }
                    >
                      Browse Files
                    </Button>
                  </div>

                  {selectedFile && (
                    <div className="flex items-center justify-between p-3.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-xl animate-in slide-in-from-top-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="w-5 h-5 text-blue-500 shrink-0" />
                        <div className="text-left min-w-0">
                          <p
                            className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 truncate"
                            title={selectedFile.name}
                          >
                            {selectedFile.name}
                          </p>
                          <p className="text-[10px] text-zinc-400 mt-0.5">
                            {(selectedFile.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedFile(null)}
                          className="text-xs text-zinc-450 hover:text-zinc-650 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <Button
                          onClick={() => handleFileIngestion(selectedFile)}
                          disabled={isSubmitting}
                          size="sm"
                        >
                          {isSubmitting ? "Ingesting..." : "Ingest Document"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Mode B: Copy-Paste Text Area Form */}
              {ingestMode === "text" && (
                <form
                  onSubmit={handlePasteSubmit}
                  className="space-y-4 text-left"
                >
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-550 dark:text-zinc-350">
                      Document Title
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. employee_onboarding.txt"
                      value={pasteFilename}
                      onChange={(e) => setPasteFilename(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-zinc-800 dark:text-zinc-100 font-semibold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-550 dark:text-zinc-350">
                      Content to Ingest
                    </label>
                    <textarea
                      placeholder="Paste your handbook, policies, or general knowledge content here. The backend will automatically split, embed, and index it into context chunks..."
                      value={pasteContent}
                      onChange={(e) => setPasteContent(e.target.value)}
                      required
                      rows={8}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-zinc-800 dark:text-zinc-100 font-normal leading-relaxed"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button
                      type="submit"
                      disabled={
                        isSubmitting ||
                        !pasteFilename.trim() ||
                        !pasteContent.trim()
                      }
                    >
                      {isSubmitting ? "Ingesting..." : "Ingest Document"}
                    </Button>
                  </div>
                </form>
              )}

              {/* RAG Informational Card */}
              <div className="p-4 rounded-2xl border border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 flex gap-3 text-left">
                <Sparkles className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                    How does this help my queries?
                  </h4>
                  <p className="text-[11px] text-zinc-450 dark:text-zinc-400 leading-normal">
                    Ingested files are partitioned into semantic overlap chunks
                    and converted to high-dimensional embedding vectors. When
                    you toggle <strong>RAG</strong> mode in the chat interface
                    and select these documents, relevant sections will be
                    automatically loaded as grounding context to produce
                    extremely accurate answers.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="border-t border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-semibold">
            <Clock className="w-3.5 h-3.5" />
            <span>
              Automatic semantic chunking size: 800 chars (overlap 80 chars)
            </span>
          </div>
          <Button onClick={onClose} variant="secondary" size="sm">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
