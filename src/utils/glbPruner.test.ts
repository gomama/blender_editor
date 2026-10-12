import { describe, it, expect } from 'vitest';
import { pruneGlb } from './glbPruner';
import { ParsedGlb } from './glb';

describe('GLB Pruner', () => {
  it('should remove unused meshes, materials, textures, and repack binary buffer to compact size', () => {
    // Construct a mock with 2 meshes, 2 materials, 2 bufferViews, where only 1 is used
    const mock: ParsedGlb = {
      json: {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'UsedNode', mesh: 0 }],
        meshes: [
          { name: 'UsedMesh', primitives: [{ material: 0, attributes: { POSITION: 0 } }] },
          { name: 'UnusedMesh', primitives: [{ material: 1, attributes: { POSITION: 1 } }] },
        ],
        materials: [{ name: 'UsedMat' }, { name: 'UnusedMat' }],
        accessors: [
          { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
          { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 36 },
          { buffer: 0, byteOffset: 36, byteLength: 36 },
        ],
        buffers: [{ byteLength: 72 }],
      },
      binaryChunk: new Uint8Array(72), // 72 bytes total
    };

    const pruned = pruneGlb(mock);

    // Only 1 mesh, 1 material, 1 accessor, 1 bufferView should remain!
    expect(pruned.json.meshes).toHaveLength(1);
    expect(pruned.json.meshes[0].name).toBe('UsedMesh');
    expect(pruned.json.materials).toHaveLength(1);
    expect(pruned.json.materials[0].name).toBe('UsedMat');
    expect(pruned.json.accessors).toHaveLength(1);
    expect(pruned.json.bufferViews).toHaveLength(1);

    // Binary buffer size should be pruned from 72 down to 36 bytes!
    expect(pruned.binaryChunk!.byteLength).toBe(36);
    expect(pruned.json.buffers[0].byteLength).toBe(36);
  });
});
