/**
 * Converts Float32 audio samples from the browser Web Audio API mic input
 * into raw 16-bit signed integer PCM little-endian buffer data.
 */
export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); // true = little-endian
  }
  return buffer;
}

/**
 * Encodes an ArrayBuffer into a standard Base64 string so that it can be
 * sent safely over a WebSocket connection.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts an incoming base64 raw 16-bit PCM (24kHz) stream from Gemini Live
 * into a standard Float32Array of samples playable by the Web Audio API.
 */
export function base64ToFloat32PCM(base64: string): Float32Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const numSamples = len / 2;
  const float32 = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const int16 = view.getInt16(i * 2, true); // true = little-endian
    float32[i] = int16 / 32768.0;
  }
  return float32;
}
