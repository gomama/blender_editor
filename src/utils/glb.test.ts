import { describe, it, expect } from 'vitest';
import { parseGlb, packGlb } from './glb';

describe('GLB parser and packer', () => {
  it('should pack and parse GLB successfully', () => {
    const mockJson = {
      asset: { version: '2.0', generator: 'Test' },
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'RootNode' }],
    };
    const mockBin = new Uint8Array([1, 2, 3, 4, 5]);

    const packed = packGlb(mockJson, mockBin);
    expect(packed).toBeInstanceOf(Uint8Array);

    const parsed = parseGlb(packed);
    expect(parsed.json).toEqual(mockJson);
    expect(parsed.binaryChunk).not.toBeNull();
    // Compare slice up to length 5
    expect(parsed.binaryChunk?.subarray(0, 5)).toEqual(mockBin);
  });

  it('should handle GLB without binary chunk', () => {
    const mockJson = {
      asset: { version: '2.0' },
      scenes: [],
    };

    const packed = packGlb(mockJson, null);
    const parsed = parseGlb(packed);
    expect(parsed.json).toEqual(mockJson);
  });
});
