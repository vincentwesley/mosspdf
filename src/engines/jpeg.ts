// MozJPEG WASM (@jsquash/jpeg). Isomorphic: the caller passes both wasm binaries as bytes, so nothing is fetched (works in the sealed worker and in Node).
import decode, { init as initDecode } from "@jsquash/jpeg/decode.js";
import encode, { init as initEncode } from "@jsquash/jpeg/encode.js";

export type Bytes = Uint8Array;
export interface Raster {
  data: Uint8Array; // RGBA
  width: number;
  height: number;
}
export interface Jpeg {
  decode(jpeg: Bytes): Promise<Raster>;
  /** rgba in, JPEG out. gray=true writes a 1-component JPEG. */
  encode(rgba: Uint8Array, width: number, height: number, quality: number, gray: boolean): Promise<Bytes>;
}

export async function createJpeg(wasm: { dec: Bytes; enc: Bytes }): Promise<Jpeg> {
  await initDecode(await WebAssembly.compile(wasm.dec as BufferSource));
  await initEncode(await WebAssembly.compile(wasm.enc as BufferSource));
  return {
    decode: async (b) => {
      const r = await decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
      return { data: new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength), width: r.width, height: r.height };
    },
    encode: async (rgba, width, height, quality, gray) =>
      new Uint8Array(await encode({ data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height, colorSpace: "srgb" } as ImageData, { quality, color_space: gray ? 1 : 3 })),
  };
}
