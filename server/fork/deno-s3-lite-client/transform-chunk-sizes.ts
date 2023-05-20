import { Buffer } from "./deps.ts";

/**
 * This stream transform will buffer the data it receives until it has enough to form
 * a chunk of the specified size, then pass on the data in chunks of the specified size.
 */
export class TransformChunkSizes extends TransformStream<Uint8Array, Uint8Array> {
  constructor(outChunkSize: number) {
    // This large buffer holds all the incoming data we receive until we reach at least outChunkSize, which we then pass on.
    const buffer = new Buffer();
    buffer.grow(outChunkSize);

    // This is a chunk-sized buffer that gets re-used each time we pass a new chunk out of this transform stream.
    const outChunk = new Uint8Array(outChunkSize);

    super({
      start() {}, // required
      async transform(chunk, controller) {
        buffer.write(chunk);

        while (buffer.length >= outChunkSize) {
          const readFromBuffer = await buffer.read(outChunk);
          if (readFromBuffer !== outChunkSize) {
            throw new Error(
              `Unexpectedly read ${readFromBuffer} bytes from transform buffer when trying to read ${outChunkSize} bytes.`,
            );
          }
          // Now "outChunk" holds the next chunk of data - pass it on to the output:
          controller.enqueue(outChunk);
        }
      },
      flush(controller) {
        if (buffer.length) {
          // The buffer still contains some data, send it now even though it's smaller than the desired chunk size.
          controller.enqueue(buffer.bytes());
        }
      },
    });
  }
}
