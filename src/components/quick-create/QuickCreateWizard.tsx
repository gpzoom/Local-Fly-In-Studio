import { useCallback, useState } from 'react';
import './QuickCreateWizard.css';
import { StorefrontStep } from './StorefrontStep';
import { InteriorTourStep } from './InteriorTourStep';
import { NoDestinationFallback } from './NoDestinationFallback';
import { createDraft, NoDestinationError } from '../../quickCreate/createDraft';
import { useProjectStore } from '../../store/projectStore';
import { getBuiltinProjectTemplate } from '../../models/projectTemplate';
import { getProjectTemplate } from '../../persistence/projectTemplateRepository';
import type { Destination, Project } from '../../models/project';

type WizardStep = 'storefront' | 'interior' | 'no-destination' | 'creating';

interface QuickCreateWizardProps {
  onDraftReady: (project: Project) => void;
}

export function QuickCreateWizard({ onDraftReady }: QuickCreateWizardProps) {
  const [step, setStep] = useState<WizardStep>('storefront');
  const [storefrontPhoto, setStorefrontPhoto] = useState<File | null>(null);
  // null means "use the built-in template" — set from StorefrontStep's Style picker.
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  // Source of truth for the interior selection. Living here (rather than inside
  // InteriorTourStep) means the user's files survive any step transition that
  // unmounts the step — including a no-destination retry that fails for a second,
  // unrelated reason and lands back on 'interior'.
  const [interiorMedia, setInteriorMedia] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const createProject = useProjectStore((state) => state.createProject);

  const runCreateDraft = useCallback(
    async (destinationOverride?: Destination) => {
      if (!storefrontPhoto) return;
      setStep('creating');
      setError(null);
      try {
        const template = selectedTemplateId
          ? (await getProjectTemplate(selectedTemplateId)) ?? getBuiltinProjectTemplate()
          : getBuiltinProjectTemplate();
        const project = await createDraft({ storefrontPhoto, interiorMedia, destinationOverride, template });
        await createProject(project);
        onDraftReady(project);
      } catch (err) {
        if (err instanceof NoDestinationError) {
          setStep('no-destination');
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not create the draft.');
        setStep('interior');
      }
    },
    [storefrontPhoto, interiorMedia, selectedTemplateId, createProject, onDraftReady],
  );

  if (step === 'storefront') {
    return (
      <StorefrontStep
        onNext={(file, templateId) => {
          setStorefrontPhoto(file);
          setSelectedTemplateId(templateId);
          setStep('interior');
        }}
      />
    );
  }

  if (step === 'no-destination') {
    return (
      <NoDestinationFallback
        onResolved={(destination) => {
          void runCreateDraft(destination);
        }}
      />
    );
  }

  return (
    <div>
      <InteriorTourStep
        files={interiorMedia}
        onFilesChange={setInteriorMedia}
        onCreateDraft={() => void runCreateDraft()}
        onBack={() => setStep('storefront')}
        submitting={step === 'creating'}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
