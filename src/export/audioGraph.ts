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

  const destinationNode = audioContext.createMediaStreamDestination();
  const sourceNodes: MediaElementAudioSourceNode[] = [];

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
}
