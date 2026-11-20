// Just the parts of tesseract.js-core (Emscripten, WebIDL bindings) that src/engines/ocr.ts uses.
declare module "tesseract.js-core/tesseract-core-simd-lstm.js" {
  interface ResultIterator {
    Empty(level: number): boolean;
    GetUTF8Text(level: number): string | null;
    Confidence(level: number): number;
    getBoundingBox(level: number): { x0: number; y0: number; x1: number; y1: number };
    IsAtFinalElement(level: number, element: number): boolean;
    Next(level: number): boolean;
  }
  interface TessBaseAPI {
    Init(datapath: null, language: string, oem: number): number;
    SetImageFile(exif?: number, psm?: number): number;
    Recognize(monitor: null): number;
    GetIterator(): ResultIterator | null;
    Clear(): void;
    End(): void;
  }
  interface Core {
    FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void };
    TessBaseAPI: new () => TessBaseAPI;
  }
  const TesseractCore: (o: { wasmBinary: Uint8Array; print(): void; printErr(): void }) => Promise<Core>;
  export default TesseractCore;
}
