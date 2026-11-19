declare const __APP_VERSION__: string;
declare module "virtual:pdfjs-data" {
  const url: string;
  export default url;
}
declare module "pdfjs-dist/build/pdf.mjs" {
  export * from "pdfjs-dist/types/src/pdf";
}
declare module "*?worker&url" {
  const url: string;
  export default url;
}
