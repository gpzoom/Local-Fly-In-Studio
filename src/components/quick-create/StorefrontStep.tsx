import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';

interface StorefrontStepProps {
  onNext: (file: File) => void;
}

export function StorefrontStep({ onNext }: StorefrontStepProps) {
  const [selected, setSelected] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Object URLs are not garbage collected — revoke the previous preview when a new
  // photo is picked, and whatever is outstanding when this step goes away.
  useEffect(
    () => () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    },
    [],
  );

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    const nextUrl = URL.createObjectURL(file);
    previewUrlRef.current = nextUrl;
    setSelected(file);
    setPreviewUrl(nextUrl);
  }

  return (
    <div className="quick-create-step">
      <h2>1. Storefront</h2>
      <label className="quick-create-photo-input">
        <Camera size={20} />
        <span>Take / Select Photo</span>
        <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} />
      </label>
      {previewUrl && <img className="quick-create-thumbnail" src={previewUrl} alt="Selected storefront" />}
      <button type="button" disabled={!selected} onClick={() => selected && onNext(selected)}>
        Next
      </button>
    </div>
  );
}
