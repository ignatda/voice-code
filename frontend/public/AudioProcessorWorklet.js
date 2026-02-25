// AudioWorklet processor - sends all audio chunks to backend
class NoiseCancellingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const inputChannel = input[0];
    if (!inputChannel) {
      return true;
    }

    // Convert to PCM16 and send all audio
    const pcm16 = new Int16Array(inputChannel.length);
    for (let i = 0; i < inputChannel.length; i++) {
      let sample = inputChannel[i];
      if (sample > 0.95) sample = 0.95;
      if (sample < -0.95) sample = -0.95;
      pcm16[i] = Math.floor(sample * 32767);
    }
    
    this.port.postMessage({
      type: 'audio',
      data: pcm16.buffer
    });

    return true;
  }
}

registerProcessor('noise-cancelling-processor', NoiseCancellingProcessor);
