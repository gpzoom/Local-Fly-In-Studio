// src/components/studio/ProjectList.tsx
import { useEffect, useState } from 'react';
import { listProjects } from '../../persistence/projectRepository';
import { useProjectStore } from '../../store/projectStore';
import type { Project } from '../../models/project';

interface ProjectListProps {
  onOpen: () => void;
  onCreateNew: () => void;
}

export function ProjectList({ onOpen, onCreateNew }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const loadProject = useProjectStore((state) => state.loadProject);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all = await listProjects();
      if (cancelled) return;
      setProjects(all);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleOpen(id: string) {
    await loadProject(id);
    onOpen();
  }

  return (
    <div className="project-list">
      <button type="button" onClick={onCreateNew}>
        Create New
      </button>
      {loading ? (
        <p>Loading…</p>
      ) : projects.length === 0 ? (
        <p>No saved projects yet.</p>
      ) : (
        <ul>
          {projects.map((project) => (
            <li key={project.id}>
              <button type="button" onClick={() => void handleOpen(project.id)}>
                {project.projectName} — updated {new Date(project.updatedAt).toLocaleString()}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
