import { useCallback, useState } from 'react';
import { StorefrontStep } from './StorefrontStep';
import { InteriorTourStep } from './InteriorTourStep';
import { NoDestinationFallback } from './NoDestinationFallback';
import { createDraft, NoDestinationError } from '../../quickCreate/createDraft';
import { useProjectStore } from '../../store/projectStore';
import type { Destination, Project } from '../../models/project';

type WizardStep = 'storefront' | 'interior' | 'no-destination' | 'creating';

interface QuickCreateWizardProps {
  onDraftReady: (project: Project) => void;
}

export function QuickCreateWizard({ onDraftReady }: QuickCreateWizardProps) {
  const [step, setStep] = useState<WizardStep>('storefront');
  const [storefrontPhoto, setStorefrontPhoto] = useState<File | null>(null);
  const [pendingInteriorMedia, setPendingInteriorMedia] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const createProject = useProjectStore((state) => state.createProject);

  const runCreateDraft = useCallback(
    async (interiorMedia: File[], destinationOverride?: Destination) => {
      if (!storefrontPhoto) return;
      setPendingInteriorMedia(interiorMedia);
      setStep('creating');
      setError(null);
      try {
        const project = await createDraft({ storefrontPhoto, interiorMedia, destinationOverride });
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
    [storefrontPhoto, createProject, onDraftReady],
  );

  if (step === 'storefront') {
    return (
      <StorefrontStep
        onNext={(file) => {
          setStorefrontPhoto(file);
          setStep('interior');
        }}
      />
    );
  }

  if (step === 'no-destination') {
    return (
      <NoDestinationFallback
        onResolved={(destination) => {
          void runCreateDraft(pendingInteriorMedia, destination);
        }}
      />
    );
  }

  return (
    <div>
      <InteriorTourStep
        onCreateDraft={(files) => void runCreateDraft(files)}
        onBack={() => setStep('storefront')}
        submitting={step === 'creating'}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
