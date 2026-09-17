export interface ExportAudioGraph {
  destinationStream: MediaStream;
  close(): void;
}

export function createExportAudioGraph(
  videoElements: readonly { element: HTMLVideoElement; audioEnabled: boolean }[],
  AudioContextCtor?: typeof AudioContext,
): ExportAudioGraph | null {
  const Ctor = AudioContextCtor ?? (typeof AudioContext !== 'undefined' ? AudioContext : undefined);
  if (!Ctor) return null;

  let audioContext: AudioContext;
  try {
    audioContext = new Ctor();
  } catch {
    return null;
  }

  // The "null on failure, never throw" contract has to cover the WHOLE graph build, not just
  // the AudioContext constructor: createMediaStreamDestination(), createMediaElementSource()
  // and connect() can all throw in real browsers (e.g. InvalidStateError when an element is
  // already attached to another graph). If any of them escaped, the caller's export would fail
  // outright instead of falling back to video-only, and the already-constructed AudioContext
  // would leak (never closed). Audio is never mandatory for an export to succeed, so the
  // guarantee lives here rather than depending on every caller wrapping this correctly.
  const sourceNodes: MediaElementAudioSourceNode[] = [];
  try {
    const destinationNode = audioContext.createMediaStreamDestination();

    for (const { element, audioEnabled } of videoElements) {
      if (!audioEnabled) continue;
      const sourceNode = audioContext.createMediaElementSource(element);
      sourceNode.connect(destinationNode);
      sourceNodes.push(sourceNode);
    }

    return {
      destinationStream: destinationNode.stream,
      close(): void {
        for (const sourceNode of sourceNodes) {
          sourceNode.disconnect();
        }
        void audioContext.close();
      },
    };
  } catch {
    for (const sourceNode of sourceNodes) {
      try {
        sourceNode.disconnect();
      } catch {
        // A node that never fully connected can throw on disconnect; keep tearing down the rest.
      }
    }
    void audioContext.close();
    return null;
  }
}
