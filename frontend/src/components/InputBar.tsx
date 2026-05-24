import * as React from 'react'

interface InputBarProps {
  inputText: string
  setInputText: (text: string) => void
  selectedImage: File | null
  imagePreviewUrl: string | null
  handleSendMessage: (e: React.FormEvent) => void
  handleImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleRemoveImage: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  isPending: boolean
}

export function InputBar({
  inputText,
  setInputText,
  selectedImage,
  imagePreviewUrl,
  handleSendMessage,
  handleImageChange,
  handleRemoveImage,
  fileInputRef,
  isPending,
}: InputBarProps) {
  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 z-25">
      <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto flex flex-col gap-2">
        {/* Attachment preview */}
        {imagePreviewUrl && (
          <div className="flex items-center gap-2 p-1.5 border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-955 rounded-lg max-w-xs">
            <div className="relative h-10 w-10 rounded overflow-hidden border border-zinc-200 dark:border-zinc-850 shrink-0">
              <img src={imagePreviewUrl} alt="Preview" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={handleRemoveImage}
                className="absolute top-0.5 right-0.5 h-3.5 w-3.5 bg-black/70 rounded-full flex items-center justify-center text-[8px] text-white cursor-pointer"
              >
                ✕
              </button>
            </div>
            <span className="text-xs truncate font-mono text-zinc-500">
              {selectedImage?.name}
            </span>
          </div>
        )}

        {/* Input Row matching user image search style */}
        <div className="relative flex items-center bg-zinc-50 dark:bg-zinc-955 border border-zinc-200 dark:border-zinc-800 rounded-full px-4 py-1.5 focus-within:ring-2 focus-within:ring-blue-500 transition shadow-xs">
          <input
            type="file"
            ref={fileInputRef as any}
            onChange={handleImageChange}
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`text-sm mr-2.5 transition cursor-pointer ${
              selectedImage ? 'text-blue-500 font-semibold' : 'text-zinc-400 hover:text-zinc-650'
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
            disabled={(!inputText.trim() && !selectedImage) || isPending}
            className="h-8 px-3 rounded-full bg-blue-600 hover:bg-blue-505 text-white text-xs font-semibold transition disabled:opacity-30 shrink-0 flex items-center justify-center cursor-pointer"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
