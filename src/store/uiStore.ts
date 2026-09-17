import { create } from 'zustand';

export type StudioSelection =
  | { type: 'waypoint'; sceneId: string; waypointId: string }
  | { type: 'storefront'; sceneId: string }
  | { type: 'interior-item'; sceneId: string; itemId: string }
  | null;

export type ExpandedSection = 'map' | 'interior-tour' | null;

interface UiStoreState {
  selection: StudioSelection;
  expandedSection: ExpandedSection;
  select: (selection: StudioSelection) => void;
  toggleExpanded: (section: 'map' | 'interior-tour') => void;
}

export const useUiStore = create<UiStoreState>()((set, get) => ({
  selection: null,
  expandedSection: null,
  select: (selection) => set({ selection }),
  toggleExpanded: (section) => set({ expandedSection: get().expandedSection === section ? null : section }),
}));
