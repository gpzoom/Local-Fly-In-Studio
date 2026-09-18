import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { listProjectTemplates } from '../../persistence/projectTemplateRepository';
import { BUILTIN_PROJECT_TEMPLATE_ID } from '../../models/projectTemplate';

interface StorefrontStepProps {
  onNext: (file: File, templateId: string | null) => void;
}

interface TemplateOption {
  id: string;
  name: string;
}

const BUILTIN_OPTION: TemplateOption = { id: BUILTIN_PROJECT_TEMPLATE_ID, name: 'Standard Local Business Tour' };

export function StorefrontStep({ onNext }: StorefrontStepProps) {
  const [selected, setSelected] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([BUILTIN_OPTION]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(BUILTIN_PROJECT_TEMPLATE_ID);

  useEffect(() => {
    let cancelled = false;
    void listProjectTemplates()
      .then((templates) => {
        if (cancelled) return;
        setTemplateOptions([BUILTIN_OPTION, ...templates.map((t) => ({ id: t.id, name: t.name }))]);
      })
      .catch(() => {
        // Leave the picker on its built-in-only default (already the initial state) — there is
        // nothing more to show the user here, just avoid an unhandled rejection.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      <label>
        Style
        <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
          {templateOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      <label className="quick-create-photo-input">
        <Camera size={20} />
        <span>Take / Select Photo</span>
        <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} />
      </label>
      {previewUrl && <img className="quick-create-thumbnail" src={previewUrl} alt="Selected storefront" />}
      <button
        type="button"
        disabled={!selected}
        onClick={() =>
          selected &&
          onNext(selected, selectedTemplateId === BUILTIN_PROJECT_TEMPLATE_ID ? null : selectedTemplateId)
        }
      >
        Next
      </button>
    </div>
  );
}
