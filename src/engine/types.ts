export type SourceKind = 'youtube' | 'soundcloud' | 'spotify' | 'local'

export interface TrackInfo {
  title: string
  /** seconds; 0 when not yet known */
  duration: number
  /** MP3/data-disc folder number (1-based). Shown on the INDEX field. */
  folder?: number
  /** cover for this track, when it differs from the disc's */
  artwork?: string
}

export interface DiscInfo {
  /** stable id used to remember cue markers across sessions */
  id: string
  kind: SourceKind
  title: string
  artwork?: string
  tracks: TrackInfo[]
}

export interface Capabilities {
  varispeed: boolean
  volume: boolean
  /** real signal levels for the VU meter */
  meter: boolean
  /** ripping to WAV */
  record: boolean
  /** automatic BPM detection */
  beatDetect: boolean
  /** cue markers persist between sessions (audio CDs yes, MP3 discs no) */
  persistCues: boolean
}

export interface SourceCallbacks {
  onEnded(): void
  /** the source started or paused on its own (embed UI, buffering, autoplay policy) */
  onPlayState(playing: boolean): void
  onTrackMeta(index: number, meta: Partial<TrackInfo>): void
  onDiscMeta(meta: Partial<DiscInfo>): void
  onError(message: string): void
}

export interface Source {
  readonly kind: SourceKind
  readonly caps: Capabilities
  /** loads the disc; resolves once the track list is known */
  load(): Promise<DiscInfo>
  /** select a track and position; plays if autoplay */
  cue(track: number, at: number, autoplay: boolean): Promise<void>
  play(): void
  pause(): void
  seek(seconds: number): void
  position(): number
  duration(): number
  /** 0..1 */
  setVolume(v: number): void
  /** 0.5..1.5; returns the rate actually applied */
  setRate(r: number): number
  /** peak levels 0..1 (only when caps.meter) */
  levels?(): [number, number]
  startRecording?(): void
  stopRecording?(): Promise<Blob | null>
  detectBpm?(track: number): Promise<{ bpm: number; confidence: number } | null>
  destroy(): void
}
