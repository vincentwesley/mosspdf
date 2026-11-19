export { assemble, merge, split } from "./assemble";
export { compress, type CompressLevel, type CompressResult } from "./compress";
export { imagesToPdf, type ImageInput, type ImagesToPdfOptions } from "./images";
export { readMetadata, writeMetadata, type Metadata, type MetadataEdit } from "./metadata";
export { inspect } from "./open";
export { parseRanges } from "./ranges";
export { addPageNumbers, watermark, type NumberPosition, type PageNumberOptions, type WatermarkOptions } from "./stamp";
export { PdfError } from "./types";
export type * from "./types";
// M3: passwords, safety, repair
export { protect, unprotect } from "./protect";
export { cleanCopy, safetyScan } from "./safety";
export { repair } from "./repair";
export type * from "./types-m3";
