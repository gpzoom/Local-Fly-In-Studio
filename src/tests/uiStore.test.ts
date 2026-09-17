import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../store/uiStore';

beforeEach(() => {
  useUiStore.setState({ selection: null, expandedSection: null });
});

describe('uiStore', () => {
  it('select sets the selection', () => {
    useUiStore.getState().select({ type: 'storefront', sceneId: 'storefront-1' });
    expect(useUiStore.getState().selection).toEqual({ type: 'storefront', sceneId: 'storefront-1' });
  });

  it('select can clear the selection', () => {
    useUiStore.getState().select({ type: 'storefront', sceneId: 'storefront-1' });
    useUiStore.getState().select(null);
    expect(useUiStore.getState().selection).toBeNull();
  });

  it('toggleExpanded expands a collapsed section', () => {
    useUiStore.getState().toggleExpanded('map');
    expect(useUiStore.getState().expandedSection).toBe('map');
  });

  it('toggleExpanded collapses the section if it is already expanded (not a no-op)', () => {
    useUiStore.getState().toggleExpanded('map');
    useUiStore.getState().toggleExpanded('map');
    expect(useUiStore.getState().expandedSection).toBeNull();
  });

  it('toggleExpanded switches to a different section, collapsing the previous one', () => {
    useUiStore.getState().toggleExpanded('map');
    useUiStore.getState().toggleExpanded('interior-tour');
    expect(useUiStore.getState().expandedSection).toBe('interior-tour');
  });
});
