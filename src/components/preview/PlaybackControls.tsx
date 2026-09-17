import { Play, Pause } from 'lucide-react';

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentTimeMs: number;
  totalDurationMs: number;
  onTogglePlay: () => void;
  onSeek: (timeMs: number) => void;
}

export function PlaybackControls({
  isPlaying,
  currentTimeMs,
  totalDurationMs,
  onTogglePlay,
  onSeek,
}: PlaybackControlsProps) {
  return (
    <div className="playback-controls">
      <button type="button" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <input
        type="range"
        min={0}
        max={totalDurationMs}
        value={currentTimeMs}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
    </div>
  );
}
