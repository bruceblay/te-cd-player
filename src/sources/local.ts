import { detectBpm, encodeWav, loadTapWorklet } from '../engine/audio'
import type { Capabilities, DiscInfo, Source, SourceCallbacks } from '../engine/types'
import { audioContext, clamp } from '../engine/util'

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aiff?|flac|ogg|oga|opus|webm)$/i

/** Local files behave like an MP3 data disc: folders become INDEX numbers. */
export class LocalSource implements Source {
  readonly kind = 'local' as const
  readonly caps: Capabilities = {
    varispeed: true,
    volume: true,
    meter: true,
    record: true,
    beatDetect: true,
    persistCues: false,
  }
  private files: File[]
  private el = new Audio()
  private ctx = audioContext()
  private gain = this.ctx.createGain()
  private aL = this.ctx.createAnalyser()
  private aR = this.ctx.createAnalyser()
  private tap: AudioWorkletNode | null = null
  private recChunks: [Float32Array, Float32Array][] = []
  private url = ''
  private current = -1
  private buf = new Float32Array(1024)

  constructor(
    files: File[],
    private cb: SourceCallbacks,
    /** the deck's output bus: speakers by default, or a mixer channel */
    out: AudioNode,
    /** compilations keep the order the user arranged */
    keepOrder = false,
  ) {
    this.files = files.filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name))
    if (!keepOrder)
      this.files.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }))
    this.el.preload = 'auto'
    this.el.preservesPitch = false // true varispeed: pitch follows speed
    const src = this.ctx.createMediaElementSource(this.el)
    const split = this.ctx.createChannelSplitter(2)
    // Upmix mono to the same L/R pair sent to the speakers, meter and recorder.
    this.gain.channelCount = 2
    this.gain.channelCountMode = 'explicit'
    src.connect(this.gain)
    this.gain.connect(out)
    this.gain.connect(split)
    this.aL.fftSize = this.aR.fftSize = 1024
    split.connect(this.aL, 0)
    split.connect(this.aR, 1)
    this.el.addEventListener('ended', () => cb.onEnded())
    this.el.addEventListener('play', () => cb.onPlayState(true))
    this.el.addEventListener('pause', () => !this.el.ended && cb.onPlayState(false))
    this.el.addEventListener('loadedmetadata', () => cb.onTrackMeta(this.current, { duration: this.el.duration }))
  }

  async load(): Promise<DiscInfo> {
    if (!this.files.length) throw new Error('no audio')
    const folders = new Map<string, number>()
    const folderOf = (f: File) => {
      const p = f.webkitRelativePath.split('/').slice(0, -1).join('/')
      if (!folders.has(p)) folders.set(p, folders.size + 1)
      return folders.get(p)!
    }
    const root = this.files[0].webkitRelativePath.split('/')[0]
    await this.cue(0, 0, false)
    return {
      id: `local:${this.files.map((f) => f.name + f.size).join('|').slice(0, 200)}`,
      kind: 'local',
      title: root || (this.files.length === 1 ? this.files[0].name : `${this.files.length} files`),
      tracks: this.files.map((f) => ({ title: f.name.replace(/\.[^.]+$/, ''), duration: 0, folder: folderOf(f) })),
    }
  }

  async cue(track: number, at: number, autoplay: boolean) {
    const f = this.files[track]
    if (!f) return
    if (track !== this.current) {
      this.current = track
      if (this.url) URL.revokeObjectURL(this.url)
      this.url = URL.createObjectURL(f)
      const rate = this.el.playbackRate
      this.el.src = this.url
      await new Promise<void>((r) => {
        this.el.addEventListener('loadedmetadata', () => r(), { once: true })
        this.el.addEventListener('error', () => r(), { once: true })
      })
      this.el.playbackRate = rate
      this.el.preservesPitch = false
    }
    this.el.currentTime = at
    if (autoplay) this.play()
    else this.el.pause()
  }

  play() {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    void this.el.play().catch(() => this.cb.onPlayState(false))
  }
  pause() {
    this.el.pause()
  }
  seek(s: number) {
    if (Number.isFinite(this.el.duration)) this.el.currentTime = clamp(s, 0, this.el.duration)
  }
  position() {
    return this.el.currentTime || 0
  }
  duration() {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0
  }
  setVolume(v: number) {
    this.gain.gain.setTargetAtTime(clamp(v, 0, 1) ** 2, this.ctx.currentTime, 0.02)
  }
  setRate(r: number) {
    this.el.playbackRate = r
    return r
  }
  levels(): [number, number] {
    const peak = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(this.buf)
      let m = 0
      for (let i = 0; i < this.buf.length; i++) m = Math.max(m, Math.abs(this.buf[i]))
      return m
    }
    return [peak(this.aL), peak(this.aR)]
  }

  async startRecording() {
    await loadTapWorklet(this.ctx)
    if (!this.tap) {
      this.tap = new AudioWorkletNode(this.ctx, 'bc1-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2 })
      this.tap.port.onmessage = (e) => this.recChunks.push(e.data)
      this.gain.connect(this.tap)
    }
    this.recChunks = []
    this.tap.port.postMessage(true)
  }
  async stopRecording() {
    if (!this.tap) return null
    this.tap.port.postMessage(false)
    await new Promise((r) => setTimeout(r, 50))
    if (!this.recChunks.length) return null
    const blob = encodeWav(this.recChunks, this.ctx.sampleRate)
    this.recChunks = []
    return blob
  }

  detectBpm(track: number) {
    const f = this.files[track]
    return f ? detectBpm(f) : Promise.resolve(null)
  }

  destroy() {
    this.el.pause()
    this.el.removeAttribute('src')
    this.el.load()
    if (this.url) URL.revokeObjectURL(this.url)
    this.gain.disconnect()
    this.tap?.disconnect()
  }
}
