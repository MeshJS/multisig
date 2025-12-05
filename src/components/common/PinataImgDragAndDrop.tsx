import { useState, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import Image from "next/image";

interface UploadResponse {
  url: string;
  hash: string;
}

interface ErrorResponse {
  error: string;
}

interface PinataImgDragAndDropProps {
  onImageUpload: (url: string, digest: string) => void;
}

export default function PinataImgDragAndDrop({ onImageUpload }: PinataImgDragAndDropProps) {
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

  async function handleDropAsync(acceptedFiles: File[]): Promise<void> {
    if (!acceptedFiles.length) return;
    const file = acceptedFiles[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      // Compute SHA256 for the file
      const fileDigest = await computeSha256(file);
      setDigest(fileDigest);

      // Try Pinata first, fallback to Vercel Blob
      const formData = new FormData();
      formData.append("file", file);

      let response = await fetch("/api/pinata/upload-image", {
        method: "POST",
        body: formData,
      });

      let imageUrl: string;

      if (!response.ok) {
        const errorData = (await response.json()) as ErrorResponse;
        
        // If Pinata is not configured (503) or unavailable, fallback to Vercel Blob
        if (errorData.error === "Pinata configuration not available" || response.status === 503) {
          console.log("Pinata not configured, falling back to Vercel Blob storage for image");
          
          // Use existing Vercel Blob image upload
          const shortHash = fileDigest.slice(-10);
          const blobFormData = new FormData();
          blobFormData.append("file", file);
          blobFormData.append("shortHash", shortHash);
          blobFormData.append("filename", file.name);

          response = await fetch("/api/vercel-storage/image/put", {
            method: "POST",
            body: blobFormData,
          });

          if (!response.ok) {
            const blobErrorData = (await response.json()) as ErrorResponse;
            throw new Error(blobErrorData.error || "Upload failed");
          }

          const blobUploadRes = (await response.json()) as UploadResponse;
          imageUrl = blobUploadRes.url;
        } else {
          throw new Error(errorData.error || "Upload failed");
        }
      } else {
        const uploadRes = (await response.json()) as UploadResponse;
        imageUrl = uploadRes.url;
      }

      setImageUrl(imageUrl);
      setFilePath(imageUrl);
      onImageUpload(imageUrl, fileDigest);
    } catch (err) {
      console.error("Image upload error:", err);
      setError("Failed to upload image to Pinata.");
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
          <p className="text-xs text-gray-400 mt-1">
            Images will be uploaded to IPFS (via Pinata) or Vercel Blob storage
          </p>
        </div>
      </div>
      <Input
        type="url"
        className="w-full rounded-md border border-gray-300 p-2"
        placeholder="Or enter an image URL (IPFS/HTTP)..."
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
