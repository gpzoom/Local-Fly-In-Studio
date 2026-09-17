import { useState } from 'react';
import { QuickCreateWizard } from './components/quick-create/QuickCreateWizard';
import { PreviewStage } from './components/preview/PreviewStage';
import type { Project } from './models/project';

export function App() {
  const [draftProject, setDraftProject] = useState<Project | null>(null);

  return (
    <div id="app-shell">
      <h1>Local Fly-In Studio</h1>
      {draftProject ? (
        <PreviewStage project={draftProject} />
      ) : (
        <QuickCreateWizard onDraftReady={setDraftProject} />
      )}
    </div>
  );
}
