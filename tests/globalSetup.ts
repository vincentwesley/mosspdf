import { buildCorpus } from "../scripts/corpus.mjs";

export default async function setup() {
  await buildCorpus();
}
