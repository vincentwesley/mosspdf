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
export { addTextLayer, type OcrPage } from "./ocr";
// M4: fill forms, sign
export { fillForm, readForm, type FieldType, type FieldValue, type FormField, type FormInfo, type FormValues, type FormWidget } from "./forms";
export { stampPage, type StampInput, type StampItem } from "./sign";
export { compareReport } from "./report";
// M6: redaction
export { redact, type RedactInput, type RedactPage } from "./redact";
