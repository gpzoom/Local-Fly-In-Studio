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
  const [error, setError] = useState<string | null>(null);
  const loadProject = useProjectStore((state) => state.loadProject);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await listProjects();
        if (cancelled) return;
        setProjects(all);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load projects.');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleOpen(id: string) {
    try {
      await loadProject(id);
      onOpen();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open project.');
    }
  }

  return (
    <div className="project-list">
      <button type="button" onClick={onCreateNew}>
        Create New
      </button>
      {error && <p role="alert">{error}</p>}
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
