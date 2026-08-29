"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveProfileImage } from "@/lib/actions/member-profile";
import { Avatar } from "@/components/Avatar";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 512;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Profile picture upload (spec §38).
 * The image is resized in the browser before upload, so a 6 MB phone photo
 * becomes a ~50 KB avatar and never passes through Vercel.
 */
export function AvatarUpload({
  userId,
  currentUrl,
  name,
}: {
  userId: string;
  currentUrl: string | null;
  name: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    if (!ALLOWED.includes(file.type)) {
      setError("Please choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That image is larger than 2 MB.");
      return;
    }

    setBusy(true);

    try {
      const blob = await resize(file);
      const supabase = createClient();
      // Path is namespaced by uid — the storage policy keys off the first folder.
      const path = `${userId}/avatar.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("profile-images")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });

      if (uploadError) throw uploadError;

      // Private bucket, so the readable URL is a time-limited signed one.
      const { data: signed } = await supabase.storage
        .from("profile-images")
        .createSignedUrl(path, 60 * 60 * 24 * 365);

      if (signed?.signedUrl) {
        const result = await saveProfileImage(signed.signedUrl);
        if (!result.ok) throw new Error(result.error);
        setPreview(URL.createObjectURL(blob));
        router.refresh();
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const src = preview ?? currentUrl;

  return (
    <div className="shrink-0 text-center">
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="block"
        aria-label="Change profile picture"
      >
        <span className="relative block">
          <Avatar name={name} src={src} size={80} />
          {/* Camera affordance, so it reads as tappable. */}
          <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border-2 border-nova-card bg-nova-red text-white">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <path d="M4 8h3l2-2h6l2 2h3v11H4z" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3.2" />
            </svg>
          </span>
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED.join(",")}
        className="hidden"
        onChange={handleFile}
      />

      <p className="mt-1 text-[11px] text-nova-muted">{busy ? "Uploading…" : "Change photo"}</p>
      {error && <p className="mt-1 max-w-[120px] text-[11px] text-nova-red">{error}</p>}
    </div>
  );
}

/** Square-crops and downscales to MAX_DIMENSION, re-encoded as JPEG. */
async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(side, MAX_DIMENSION);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) return file;

  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );

  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.85),
  );
}
