/**
 * USB-C MIDI, as on the BC-1: channel 1, CC 23 play, 24 stop, 25 next, 26 prev
 * (64-127 = on). The sync output is mirrored as MIDI clock + start/stop.
 */
export type MidiCommand = 'play' | 'stop' | 'next' | 'prev'

const CC_MAP: Record<number, MidiCommand> = { 23: 'play', 24: 'stop', 25: 'next', 26: 'prev' }

export class Midi {
  private access: MIDIAccess | null = null
  connected = false
  inputs = 0
  outputs = 0

  constructor(private onCommand: (c: MidiCommand) => void) {}

  get supported() {
    return 'requestMIDIAccess' in navigator
  }

  async connect() {
    if (!this.supported) return false
    try {
      this.access = await navigator.requestMIDIAccess()
    } catch {
      return false
    }
    const bind = () => {
      this.inputs = 0
      this.outputs = this.access!.outputs.size
      this.access!.inputs.forEach((input) => {
        this.inputs++
        input.onmidimessage = (e) => this.handle(e.data)
      })
    }
    bind()
    this.access.onstatechange = bind
    this.connected = true
    return true
  }

  disconnect() {
    this.access?.inputs.forEach((i) => (i.onmidimessage = null))
    if (this.access) this.access.onstatechange = null
    this.access = null
    this.connected = false
  }

  private handle(d: Uint8Array | null) {
    if (!d || d.length < 3) return
    if (d[0] !== 0xb0) return // control change, channel 1
    const cmd = CC_MAP[d[1]]
    if (cmd && d[2] >= 64) this.onCommand(cmd)
  }

  private send(bytes: number[], at?: number) {
    this.access?.outputs.forEach((o) => o.send(bytes, at))
  }
  clock(at?: number) {
    this.send([0xf8], at)
  }
  start() {
    this.send([0xfa])
  }
  stop() {
    this.send([0xfc])
  }
}
