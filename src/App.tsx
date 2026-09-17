// src/App.tsx
import { useState } from 'react';
import './App.css';
import { QuickCreateWizard } from './components/quick-create/QuickCreateWizard';
import { PreviewStage } from './components/preview/PreviewStage';
import { ProjectList } from './components/studio/ProjectList';
import { StudioView } from './components/studio/StudioView';
import { useProjectStore } from './store/projectStore';
import type { Project } from './models/project';

type View = 'project-list' | 'quick-create' | 'preview' | 'studio';

export function App() {
  const [view, setView] = useState<View>('project-list');
  const [draftProject, setDraftProject] = useState<Project | null>(null);
  const currentProject = useProjectStore((state) => state.currentProject);

  function handleDraftReady(project: Project) {
    setDraftProject(project);
    setView('preview');
  }

  function handleCreateNew() {
    setDraftProject(null);
    setView('quick-create');
  }

  function handleOpenFromList() {
    setView('studio');
  }

  function handleBackFromStudio() {
    setView('project-list');
  }

  return (
    <div id="app-shell">
      <h1>Local Fly-In Studio</h1>
      {view === 'project-list' && <ProjectList onOpen={handleOpenFromList} onCreateNew={handleCreateNew} />}
      {view === 'quick-create' && <QuickCreateWizard onDraftReady={handleDraftReady} />}
      {view === 'preview' && draftProject && (
        <div className="preview-actions-wrapper">
          <PreviewStage project={draftProject} />
          <div className="preview-actions">
            <button type="button" onClick={() => setView('studio')}>
              Fine-tune in Studio
            </button>
            <button type="button" onClick={handleCreateNew}>
              New Project
            </button>
          </div>
        </div>
      )}
      {view === 'studio' && currentProject && <StudioView onBack={handleBackFromStudio} />}
    </div>
  );
}
