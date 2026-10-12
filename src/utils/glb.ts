export interface ParsedGlb {
  json: any;
  binaryChunk: Uint8Array | null;
}

const GLB_HEADER_MAGIC = 0x46546c67; // "glTF"
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"

/**
 * Parses a binary GLB buffer into its JSON chunk and binary chunk.
 */
export function parseGlb(buffer: ArrayBuffer | Uint8Array): ParsedGlb {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.byteLength < 12) {
    throw new Error('Invalid GLB: file too small');
  }

  const magic = dataView.getUint32(0, true);
  if (magic !== GLB_HEADER_MAGIC) {
    throw new Error('Invalid GLB: wrong magic number');
  }

  const version = dataView.getUint32(4, true);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version: ${version}`);
  }

  let offset = 12;
  let json: any = null;
  let binaryChunk: Uint8Array | null = null;

  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = dataView.getUint32(offset, true);
    const chunkType = dataView.getUint32(offset + 4, true);
    offset += 8;

    const chunkData = bytes.subarray(offset, offset + chunkLength);
    offset += chunkLength;

    if (chunkType === CHUNK_TYPE_JSON) {
      const decoder = new TextDecoder('utf-8');
      const jsonText = decoder.decode(chunkData);
      json = JSON.parse(jsonText);
    } else if (chunkType === CHUNK_TYPE_BIN) {
      binaryChunk = chunkData;
    }
  }

  if (!json) {
    throw new Error('Invalid GLB: JSON chunk not found');
  }

  return { json, binaryChunk };
}

/**
 * Packages a glTF JSON object and binary chunk into a valid GLB binary array.
 */
export function packGlb(json: any, binaryChunk: Uint8Array | null): Uint8Array {
  const encoder = new TextEncoder();
  const jsonString = JSON.stringify(json);
  const jsonBytes = encoder.encode(jsonString);

  // JSON chunk must be padded with 0x20 (space) to 4-byte alignment
  const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4;
  const jsonChunkLength = jsonBytes.byteLength + jsonPadding;

  // Binary chunk must be padded with 0x00 to 4-byte alignment
  let binPadding = 0;
  let binChunkLength = 0;
  if (binaryChunk && binaryChunk.byteLength > 0) {
    binPadding = (4 - (binaryChunk.byteLength % 4)) % 4;
    binChunkLength = binaryChunk.byteLength + binPadding;
  }

  const totalLength =
    12 + // GLB Header
    8 + jsonChunkLength + // JSON Chunk header + data
    (binChunkLength > 0 ? 8 + binChunkLength : 0); // BIN Chunk header + data

  const result = new Uint8Array(totalLength);
  const dataView = new DataView(result.buffer);

  // GLB Header
  dataView.setUint32(0, GLB_HEADER_MAGIC, true);
  dataView.setUint32(4, 2, true); // Version 2
  dataView.setUint32(8, totalLength, true);

  // JSON Chunk header
  let offset = 12;
  dataView.setUint32(offset, jsonChunkLength, true);
  dataView.setUint32(offset + 4, CHUNK_TYPE_JSON, true);
  offset += 8;

  // JSON Chunk data + space padding
  result.set(jsonBytes, offset);
  offset += jsonBytes.byteLength;
  for (let i = 0; i < jsonPadding; i++) {
    result[offset++] = 0x20; // space
  }

  // BIN Chunk header + data
  if (binChunkLength > 0 && binaryChunk) {
    dataView.setUint32(offset, binChunkLength, true);
    dataView.setUint32(offset + 4, CHUNK_TYPE_BIN, true);
    offset += 8;

    result.set(binaryChunk, offset);
    offset += binaryChunk.byteLength;
    for (let i = 0; i < binPadding; i++) {
      result[offset++] = 0x00; // zero padding
    }
  }

  return result;
}
