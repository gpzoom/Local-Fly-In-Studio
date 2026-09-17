// src/components/timeline/InteriorItemBlocks.tsx
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUiStore } from '../../store/uiStore';
import type { Project } from '../../models/project';
import type { InteriorTourScene, InteriorTourItem } from '../../models/scenes';
import type { CompiledTimeline } from '../../models/timeline';

interface InteriorItemBlocksProps {
  interiorScene: InteriorTourScene;
  timeline: CompiledTimeline;
  updateProject: (updater: (project: Project) => Project) => void;
  onSeek: (timeMs: number) => void;
}

function itemEffectiveDurationMs(item: InteriorTourItem): number {
  if (item.type === 'photo') return item.durationMs;
  return (item.trimEndMs - item.trimStartMs) / item.playbackRate;
}

function findItemSegmentStartMs(timeline: CompiledTimeline, itemId: string): number | undefined {
  return timeline.segments.find((segment) => segment.itemId === itemId)?.startMs;
}

interface SortableItemBlockProps {
  item: InteriorTourItem;
  widthPercent: number;
  isSelected: boolean;
  onClick: () => void;
}

function SortableItemBlock({ item, widthPercent, isSelected, onClick }: SortableItemBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={isSelected ? 'timeline-block timeline-block--selected' : 'timeline-block'}
      style={{ width: `${widthPercent}%`, transform: CSS.Transform.toString(transform), transition }}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {item.type === 'photo' ? 'Photo' : 'Video'}
    </button>
  );
}

export function InteriorItemBlocks({ interiorScene, timeline, updateProject, onSeek }: InteriorItemBlocksProps) {
  const select = useUiStore((state) => state.select);
  const selection = useUiStore((state) => state.selection);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const totalMs = interiorScene.items.reduce((sum, item) => sum + itemEffectiveDurationMs(item), 0);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = interiorScene.items.findIndex((item) => item.id === active.id);
    const newIndex = interiorScene.items.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(interiorScene.items, oldIndex, newIndex);
    updateProject((project) => ({
      ...project,
      scenes: project.scenes.map((scene) =>
        scene.id === interiorScene.id ? { ...scene, items: reordered } : scene,
      ),
    }));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={interiorScene.items.map((item) => item.id)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="interior-item-blocks">
          {interiorScene.items.map((item) => {
            const widthPercent = totalMs > 0 ? (itemEffectiveDurationMs(item) / totalMs) * 100 : 0;
            const isSelected =
              selection?.type === 'interior-item' &&
              selection.sceneId === interiorScene.id &&
              selection.itemId === item.id;

            return (
              <SortableItemBlock
                key={item.id}
                item={item}
                widthPercent={widthPercent}
                isSelected={isSelected}
                onClick={() => {
                  select({ type: 'interior-item', sceneId: interiorScene.id, itemId: item.id });
                  const startMs = findItemSegmentStartMs(timeline, item.id);
                  if (startMs !== undefined) onSeek(startMs);
                }}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
