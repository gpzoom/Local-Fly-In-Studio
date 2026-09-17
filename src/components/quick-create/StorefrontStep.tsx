import { useState } from 'react';
import { Camera } from 'lucide-react';

interface StorefrontStepProps {
  onNext: (file: File) => void;
}

export function StorefrontStep({ onNext }: StorefrontStepProps) {
  const [selected, setSelected] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelected(file);
    setPreviewUrl(URL.createObjectURL(file));
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
