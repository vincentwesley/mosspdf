import { buildCorpus } from "../scripts/corpus.mjs";

/** Generates tests/corpus/generated/ when missing (idempotent). */
export default async function setup() {
  await buildCorpus();
}
