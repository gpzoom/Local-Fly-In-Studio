// src/components/studio/SaveTemplateControls.tsx
import { useState } from 'react';
import { buildTemplateFromProject } from '../../timeline/buildTemplateFromProject';
import { saveProjectTemplate } from '../../persistence/projectTemplateRepository';
import type { Project } from '../../models/project';
import type { TemplateBuildError } from '../../timeline/buildTemplateFromProject';

const ERROR_MESSAGES: Record<TemplateBuildError['reason'], string> = {
  'missing-map': 'This project has no Map scene to save into a template.',
  'missing-storefront': 'This project has no Storefront scene to save into a template.',
  'missing-interior-tour': 'This project has no Interior Tour scene to save into a template.',
};

interface SaveTemplateControlsProps {
  project: Project;
}

export function SaveTemplateControls({ project }: SaveTemplateControlsProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setConfirmation(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Enter a name for the template.');
      return;
    }
    const result = buildTemplateFromProject(project, trimmedName);
    if (!result.ok) {
      setError(ERROR_MESSAGES[result.error.reason]);
      return;
    }
    try {
      await saveProjectTemplate(result.template);
    } catch (err) {
      // A failed save must never be silent: without this, the user sees neither the
      // role="alert" error nor the role="status" confirmation.
      setError(err instanceof Error ? err.message : 'Could not save the template.');
      return;
    }
    setConfirmation(`Saved template "${result.template.name}".`);
    setName('');
  }

  return (
    <div className="inspector save-template-controls">
      <h3>Save as Template</h3>
      <label>
        Template name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="save-template-controls-actions">
        <button type="button" onClick={() => void handleSave()}>
          Save as Template
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {confirmation && <p role="status">{confirmation}</p>}
    </div>
  );
}
