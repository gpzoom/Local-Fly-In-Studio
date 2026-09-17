import { ImagePlus } from 'lucide-react';

interface InteriorTourStepProps {
  /** Controlled selection — owned by QuickCreateWizard so it survives remounts. */
  files: File[];
  onFilesChange: (files: File[]) => void;
  onCreateDraft: () => void;
  onBack: () => void;
  submitting: boolean;
}

export function InteriorTourStep({
  files,
  onFilesChange,
  onCreateDraft,
  onBack,
  submitting,
}: InteriorTourStepProps) {
  function handleFilesChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files;
    if (!selected) return;
    onFilesChange(Array.from(selected));
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
          {files.map((file, index) => (
            // Filenames alone collide (camera defaults like IMG_0001.jpg from two sources).
            <li key={`${file.name}-${file.size}-${index}`}>{file.name}</li>
          ))}
        </ul>
      )}
      <div className="quick-create-actions">
        <button type="button" onClick={onBack} disabled={submitting}>
          Back
        </button>
        <button type="button" onClick={onCreateDraft} disabled={submitting}>
          {submitting ? 'Creating…' : 'Create Draft'}
        </button>
      </div>
    </div>
  );
}
