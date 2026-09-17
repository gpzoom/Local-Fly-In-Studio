import { create } from 'zustand';
import type { Project } from '../models/project';
import {
  saveProject as persistProject,
  loadProject as fetchProject,
} from '../persistence/projectRepository';
import { setLastOpenProjectId } from './lastOpenProject';

interface ProjectStoreState {
  currentProject: Project | null;
  createProject: (project: Project) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  saveProject: () => Promise<void>;
  updateProject: (updater: (project: Project) => Project) => void;
}

export const useProjectStore = create<ProjectStoreState>()((set, get) => ({
  currentProject: null,

  async createProject(project: Project) {
    await persistProject(project);
    set({ currentProject: project });
    setLastOpenProjectId(project.id);
  },

  async loadProject(id: string) {
    const project = await fetchProject(id);
    set({ currentProject: project });
    if (project) {
      setLastOpenProjectId(project.id);
    }
  },

  async saveProject() {
    const { currentProject } = get();
    if (!currentProject) return;
    await persistProject(currentProject);
  },

  updateProject(updater: (project: Project) => Project) {
    const { currentProject } = get();
    if (!currentProject) return;
    set({ currentProject: updater(currentProject) });
  },
}));
