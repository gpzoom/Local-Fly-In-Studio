import { describe, it, expect, vi } from 'vitest';
import { createExportAudioGraph } from '../export/audioGraph';

class FakeMediaElementAudioSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeMediaStreamAudioDestinationNode {
  stream = { __fakeStream: true } as unknown as MediaStream;
}

function createFakeAudioContextCtor(options: { throwOnConstruct?: boolean } = {}) {
  const createdSourceNodes: FakeMediaElementAudioSourceNode[] = [];
  const closeFn = vi.fn().mockResolvedValue(undefined);
  const destinationNode = new FakeMediaStreamAudioDestinationNode();

  class FakeAudioContext {
    close = closeFn;
    constructor() {
      if (options.throwOnConstruct) throw new Error('AudioContext not allowed');
    }
    createMediaStreamDestination() {
      return destinationNode;
    }
    createMediaElementSource(_element: HTMLVideoElement) {
      const node = new FakeMediaElementAudioSourceNode();
      createdSourceNodes.push(node);
      return node;
    }
  }

  return {
    FakeAudioContext: FakeAudioContext as unknown as typeof AudioContext,
    createdSourceNodes,
    closeFn,
    destinationNode,
  };
}

describe('createExportAudioGraph', () => {
  it('creates and connects a source node only for audioEnabled entries', () => {
    const { FakeAudioContext, createdSourceNodes, destinationNode } = createFakeAudioContextCtor();
    const graph = createExportAudioGraph(
      [
        { element: {} as HTMLVideoElement, audioEnabled: true },
        { element: {} as HTMLVideoElement, audioEnabled: false },
      ],
      FakeAudioContext,
    );

    expect(graph).not.toBeNull();
    expect(graph?.destinationStream).toBe(destinationNode.stream);
    expect(createdSourceNodes).toHaveLength(1);
    expect(createdSourceNodes[0].connect).toHaveBeenCalledWith(destinationNode);
  });

  it('close() disconnects every created source node and closes the context', () => {
    const { FakeAudioContext, createdSourceNodes, closeFn } = createFakeAudioContextCtor();
    const graph = createExportAudioGraph(
      [
        { element: {} as HTMLVideoElement, audioEnabled: true },
        { element: {} as HTMLVideoElement, audioEnabled: true },
      ],
      FakeAudioContext,
    );

    graph?.close();

    expect(createdSourceNodes).toHaveLength(2);
    for (const node of createdSourceNodes) {
      expect(node.disconnect).toHaveBeenCalledTimes(1);
    }
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('returns null rather than throwing when AudioContextCtor construction fails', () => {
    const { FakeAudioContext } = createFakeAudioContextCtor({ throwOnConstruct: true });
    const graph = createExportAudioGraph([], FakeAudioContext);
    expect(graph).toBeNull();
  });

  it('creates no source nodes when every entry has audioEnabled: false', () => {
    const { FakeAudioContext, createdSourceNodes } = createFakeAudioContextCtor();
    const graph = createExportAudioGraph([{ element: {} as HTMLVideoElement, audioEnabled: false }], FakeAudioContext);
    expect(graph).not.toBeNull();
    expect(createdSourceNodes).toHaveLength(0);
  });
});
