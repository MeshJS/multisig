import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { X } from "lucide-react"; // "X" icon for close button
import { Input } from "@/components/ui/input";

interface ImgDragAndDropProps {
  onImageUpload: (url: string) => void;
}

export default function ImgDragAndDrop({ onImageUpload }: ImgDragAndDropProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string>("");

  const onDrop = async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;

    const file = acceptedFiles[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/vercel-storage/image/put", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Upload failed");
      }

      const { url } = await response.json();
      setImageUrl(url);
      setFilePath(url);
      onImageUpload(url);
    } catch (err) {
      console.error("Image upload error:", err);
      setError("Failed to upload image.");
    } finally {
      setUploading(false);
    }
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    multiple: false,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        {/* Image Preview */}
        {imageUrl && (
          <div className="relative h-32 w-32">
            <img
              src={imageUrl}
              alt="Uploaded Preview"
              className="h-full w-full rounded-md object-cover"
            />
            <button
              onClick={() => {
                setImageUrl(null);
                setFilePath("");
              }}
              className="absolute right-1 top-1 rounded-full p-1 shadow-md transition"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Drag & Drop Zone */}
        <div
          {...getRootProps()}
          className={`w-full cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition ${
            uploading
              ? "border-gray-500"
              : "border-gray-300 hover:border-gray-500"
          }`}
        >
          <input {...getInputProps()} disabled={uploading} />
          <p className="text-gray-500">
            {uploading
              ? "Uploading..."
              : "Drag & Drop an image here, or click to select"}
          </p>
        </div>
      </div>

      {/* File Path Input Field */}
      <Input
        type="url"
        className="w-full rounded-md border border-gray-300 p-2"
        placeholder="Enter your own image URL..."
        value={filePath}
        onChange={(e) => {
          const url = e.target.value.trim(); 
          setFilePath(url);
          setImageUrl(url); 
        }}
      />

      {/* Error Message */}
      {error && <p className="mt-2 text-red-500">{error}</p>}
    </div>
  );
}
