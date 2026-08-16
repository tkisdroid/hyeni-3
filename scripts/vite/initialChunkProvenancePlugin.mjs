import {
  INITIAL_CHUNK_PROVENANCE_FILE,
  serializeInitialChunkProvenance,
} from "../lib/initialChunkProvenance.mjs";

export function initialChunkProvenancePlugin({ rootDir }) {
  return {
    name: "hyeni-initial-chunk-provenance",
    apply: "build",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const chunks = Object.values(bundle)
          .filter((output) => output.type === "chunk" && output.name === "i18n-runtime")
          .map((chunk) => ({
            file: chunk.fileName,
            code: chunk.code,
            moduleIds: Object.keys(chunk.modules),
          }));
        this.emitFile({
          type: "asset",
          fileName: INITIAL_CHUNK_PROVENANCE_FILE,
          source: serializeInitialChunkProvenance(chunks, { rootDir }),
        });
      },
    },
  };
}
