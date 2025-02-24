import { useState, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import Image from "next/image"; // Using next/image for optimized images

// Define expected types for API responses
interface ImageExistsResponse {
  exists: boolean;
  url?: string;
}

interface UploadResponse {
  url: string;
}

interface ErrorResponse {
  error: string;
}

interface ImgDragAndDropProps {
  onImageUpload: (url: string, digest: string) => void;
}

export default function ImgDragAndDrop({ onImageUpload }: ImgDragAndDropProps) {
  const [uploading, setUploading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string>("");
  const [digest, setDigest] = useState<string>("");
  const lastComputedUrlRef = useRef<string>("");

  async function computeSha256(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function checkImageExists(shortHash: string): Promise<string | null> {
    try {
      const response = await fetch(`/api/vercel-storage/image/exists?shortHash=${shortHash}`, {
        method: "GET",
      });
      if (response.ok) {
        // Type the parsed JSON response
        const data = (await response.json()) as ImageExistsResponse;
        if (data.exists && data.url) {
          return data.url;
        }
      }
    } catch (err) {
      console.error("Error checking image existence:", err);
    }
    return null;
  }

  async function handleDropAsync(acceptedFiles: File[]): Promise<void> {
    if (!acceptedFiles.length) return;
    const file = acceptedFiles[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const fileDigest = await computeSha256(file);
      setDigest(fileDigest);
      const shortHash = fileDigest.slice(-10);

      const existingUrl = await checkImageExists(shortHash);
      if (existingUrl) {
        setImageUrl(existingUrl);
        setFilePath(existingUrl);
        onImageUpload(existingUrl, fileDigest);
        setUploading(false);
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("shortHash", shortHash);
      formData.append("filename", file.name);

      const response = await fetch("/api/vercel-storage/image/put", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = (await response.json()) as ErrorResponse;
        throw new Error(errorData.error || "Upload failed");
      }

      const uploadRes = (await response.json()) as UploadResponse;
      setImageUrl(uploadRes.url);
      setFilePath(uploadRes.url);
      onImageUpload(uploadRes.url, fileDigest);
    } catch (err) {
      console.error("Image upload error:", err);
      setError("Failed to upload image.");
    } finally {
      setUploading(false);
    }
  }

  // Wrap the async drop handler in a synchronous function
  const onDrop = (acceptedFiles: File[]): void => {
    void handleDropAsync(acceptedFiles);
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    multiple: false,
  });

  // Compute image digest for manually entered URLs
  useEffect(() => {
    if (filePath && filePath.startsWith("http") && filePath !== lastComputedUrlRef.current) {
      void (async () => {
        try {
          const response = await fetch(filePath);
          if (!response.ok) throw new Error("Image fetch failed");
          const arrayBuffer = await response.arrayBuffer();
          const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const urlDigest = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
          setDigest(urlDigest);
          lastComputedUrlRef.current = filePath;
          onImageUpload(filePath, urlDigest);
        } catch (err) {
          console.error("Failed to generate digest from URL:", err);
        }
      })();
    }
  }, [filePath, onImageUpload]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        {imageUrl && (
          <div className="relative h-32 w-32">
            <Image
              src={imageUrl}
              alt="Uploaded Preview"
              width={128}
              height={128}
              className="rounded-md object-cover"
            />
            <button
              onClick={() => {
                setImageUrl(null);
                setFilePath("");
                lastComputedUrlRef.current = "";
                setDigest("");
              }}
              className="absolute right-1 top-1 rounded-full p-1 shadow-md transition"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div
          {...getRootProps()}
          className={`w-full cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition ${
            uploading ? "border-gray-500" : "border-gray-300 hover:border-gray-500"
          }`}
        >
          <input {...getInputProps()} disabled={uploading} />
          <p className="text-gray-500">
            {uploading ? "Uploading..." : "Drag & Drop an image here, or click to select"}
          </p>
        </div>
      </div>
      <Input
        type="url"
        className="w-full rounded-md border border-gray-300 p-2"
        placeholder="Enter your own image URL..."
        value={filePath}
        onChange={(e) => {
          const url = e.target.value.trim();
          if (url !== filePath) {
            setDigest("");
            lastComputedUrlRef.current = "";
          }
          setFilePath(url);
          setImageUrl(url);
        }}
      />
      {error && <p className="mt-2 text-red-500">{error}</p>}
      {digest && <p className="mt-2 text-gray-500">SHA-256: {digest}</p>}
    </div>
  );
}