import { useMemo } from 'react';
import './TimelineStrip.css';
import { compileProjectTimeline } from '../../timeline/compiler';
import { useUiStore } from '../../store/uiStore';
import { WaypointBlocks } from './WaypointBlocks';
import type { Project } from '../../models/project';
import type { MapScene, StorefrontScene, InteriorTourScene } from '../../models/scenes';

interface TimelineStripProps {
  project: Project;
  onSeek: (timeMs: number) => void;
}

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

export function TimelineStrip({ project, onSeek }: TimelineStripProps) {
  const timeline = useMemo(() => compileProjectTimeline(project), [project]);
  const expandedSection = useUiStore((state) => state.expandedSection);
  const toggleExpanded = useUiStore((state) => state.toggleExpanded);
  const select = useUiStore((state) => state.select);

  const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map');
  const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront');
  const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');

  const mapSection = timeline.sections.find((s) => s.type === 'map');
  const storefrontSection = timeline.sections.find((s) => s.type === 'storefront');
  const interiorSection = timeline.sections.find((s) => s.type === 'interior-tour');

  return (
    <div className="timeline-strip">
      <div className="timeline-sections">
        {mapScene && mapSection && (
          <button
            type="button"
            aria-expanded={expandedSection === 'map'}
            onClick={() => toggleExpanded('map')}
          >
            Map Fly-In ({seconds(mapSection.endMs - mapSection.startMs)}s)
          </button>
        )}
        {storefrontScene && (
          <button
            type="button"
            onClick={() => select({ type: 'storefront', sceneId: storefrontScene.id })}
          >
            Storefront ({storefrontSection ? seconds(storefrontSection.endMs - storefrontSection.startMs) : 0}s)
          </button>
        )}
        {interiorScene && interiorSection && (
          <button
            type="button"
            aria-expanded={expandedSection === 'interior-tour'}
            onClick={() => toggleExpanded('interior-tour')}
          >
            Interior Tour ({seconds(interiorSection.endMs - interiorSection.startMs)}s)
          </button>
        )}
      </div>
      {expandedSection === 'map' && mapScene && (
        <WaypointBlocks mapScene={mapScene} timeline={timeline} onSeek={onSeek} />
      )}
    </div>
  );
}
