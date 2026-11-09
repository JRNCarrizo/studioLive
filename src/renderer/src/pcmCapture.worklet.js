class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.paused = false
    this.port.onmessage = (event) => {
      const action = event.data && event.data.action
      if (action === 'pause') this.paused = true
      if (action === 'resume') this.paused = false
    }
  }

  process(inputs) {
    if (this.paused) return true
    const channels = inputs[0]
    if (!channels || !channels.length || !channels[0] || !channels[0].length) return true
    const copies = []
    for (let i = 0; i < channels.length; i++) {
      const copy = new Float32Array(channels[i].length)
      copy.set(channels[i])
      copies.push(copy)
    }
    this.port.postMessage({ channels: copies }, copies.map((c) => c.buffer))
    return true
  }
}

registerProcessor('studio-pcm-capture', PcmCaptureProcessor)
