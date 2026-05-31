import * as React from "react";
import { useToast } from "@/components/ui/Toast";

export function useImageUpload() {
  const { toast } = useToast();
  const [selectedImages, setSelectedImages] = React.useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = React.useState<string[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const allCreatedUrls = React.useRef<Set<string>>(new Set());

  const handleImageChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
      const validFiles: File[] = [];
      const validUrls: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 5242880) {
          toast({
            title: "File Too Large",
            description: `${file.name} exceeds the maximum 5 MB limit.`,
            type: "error",
          });
          continue;
        }
        if (!allowedTypes.includes(file.type)) {
          toast({
            title: "Unsupported Format",
            description: `${file.name} format is not supported (PNG, JPEG, and WebP are supported).`,
            type: "error",
          });
          continue;
        }
        validFiles.push(file);
        const url = URL.createObjectURL(file);
        validUrls.push(url);
        allCreatedUrls.current.add(url);
      }

      if (validFiles.length > 0) {
        setSelectedImages((prev) => [...prev, ...validFiles]);
        setImagePreviewUrls((prev) => [...prev, ...validUrls]);
      }
    },
    [toast],
  );

  const handleRemoveImage = React.useCallback((index?: number) => {
    if (typeof index === "number") {
      setImagePreviewUrls((prev) => {
        const urlToRevoke = prev[index];
        if (urlToRevoke) {
          URL.revokeObjectURL(urlToRevoke);
          allCreatedUrls.current.delete(urlToRevoke);
        }
        return prev.filter((_, i) => i !== index);
      });
      setSelectedImages((prev) => prev.filter((_, i) => i !== index));
    } else {
      setImagePreviewUrls((prev) => {
        prev.forEach((url) => {
          URL.revokeObjectURL(url);
          allCreatedUrls.current.delete(url);
        });
        return [];
      });
      setSelectedImages([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, []);

  // Cleanup object URLs on unmount
  React.useEffect(() => {
    return () => {
      allCreatedUrls.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          console.error("Error revoking URL:", e);
        }
      });
    };
  }, []);

  const clearSelection = React.useCallback(() => {
    setSelectedImages([]);
    setImagePreviewUrls([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  return {
    selectedImages,
    setSelectedImages,
    imagePreviewUrls,
    setImagePreviewUrls,
    fileInputRef,
    handleImageChange,
    handleRemoveImage,
    clearSelection,
  };
}

