import { useState } from 'react';
import { ImagePlus } from 'lucide-react';

interface InteriorTourStepProps {
  onCreateDraft: (files: File[]) => void;
  onBack: () => void;
  submitting: boolean;
}

export function InteriorTourStep({ onCreateDraft, onBack, submitting }: InteriorTourStepProps) {
  const [files, setFiles] = useState<File[]>([]);

  function handleFilesChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files;
    if (!selected) return;
    setFiles(Array.from(selected));
  }

  return (
    <div className="quick-create-step">
      <h2>2. Interior Tour</h2>
      <label className="quick-create-photo-input">
        <ImagePlus size={20} />
        <span>Add Photos or Video</span>
        <input type="file" accept="image/*,video/*" multiple onChange={handleFilesChange} />
      </label>
      {files.length > 0 && (
        <ul className="quick-create-file-list">
          {files.map((file) => (
            <li key={file.name}>{file.name}</li>
          ))}
        </ul>
      )}
      <div className="quick-create-actions">
        <button type="button" onClick={onBack} disabled={submitting}>
          Back
        </button>
        <button type="button" onClick={() => onCreateDraft(files)} disabled={submitting}>
          {submitting ? 'Creating…' : 'Create Draft'}
        </button>
      </div>
    </div>
  );
}
