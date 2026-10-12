import { describe, it, expect } from 'vitest';
import { mergeVrm } from './vrmMerger';
import { ParsedGlb } from './glb';

describe('VRM Merger', () => {
  it('should preserve head model intact and wear body model outfit', () => {
    const mockBody: ParsedGlb = {
      json: {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [
          { name: 'BodyMeshNode', mesh: 0 },
        ],
        meshes: [
          { name: 'BodyOutfitMesh', primitives: [{ attributes: { POSITION: 0 } }] },
        ],
        accessors: [
          { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 36 },
        ],
        extensions: {
          VRM: {
            meta: { title: 'BodyModel' },
            humanoid: {
              humanBones: [{ bone: 'hips', node: 0 }],
            },
          },
        },
      },
      binaryChunk: new Uint8Array(36),
    };

    const mockHead: ParsedGlb = {
      json: {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [
          { name: 'HeadMeshNode', mesh: 0 },
        ],
        meshes: [
          { name: 'FaceMesh', primitives: [{ attributes: { POSITION: 0 } }] },
        ],
        accessors: [
          { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 48 },
        ],
        extensions: {
          VRM: {
            meta: { title: 'HeadModel' },
            humanoid: {
              humanBones: [{ bone: 'head', node: 0 }],
            },
            blendShapeMaster: {
              blendShapeGroups: [
                {
                  name: 'Joy',
                  binds: [{ mesh: 0, index: 0, weight: 100 }],
                },
              ],
            },
          },
        },
      },
      binaryChunk: new Uint8Array(48),
    };

    const merged = mergeVrm(mockBody, mockHead);

    expect(merged.binaryChunk).not.toBeNull();
    // Combined buffer
    expect(merged.binaryChunk!.byteLength).toBe(48 + 36);

    // Head base meshes (Face) + imported Body outfit mesh
    expect(merged.json.meshes).toHaveLength(2);
    expect(merged.json.meshes[0].name).toBe('FaceMesh');
    expect(merged.json.meshes[1].name).toBe('BodyOutfitMesh');

    // Head blendshape Joy is 100% preserved
    const blendGroups = merged.json.extensions.VRM.blendShapeMaster.blendShapeGroups;
    expect(blendGroups).toHaveLength(1);
    expect(blendGroups[0].name).toBe('Joy');
    expect(blendGroups[0].binds[0].mesh).toBe(0);

    // Nodes must NOT duplicate body skeleton bones! (1 head node + 1 body mesh node = 2)
    expect(merged.json.nodes).toHaveLength(2);
  });

  it('should preserve head materials and map imported body materials correctly', () => {
    const mockBody: ParsedGlb = {
      json: {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'BodyMeshNode', mesh: 0 }],
        meshes: [{ name: 'BodyMesh', primitives: [{ material: 0 }] }],
        textures: [{ source: 0 }], // 1 body texture
        materials: [{ name: 'BodyMat' }],
        extensions: {
          VRM: {
            humanoid: { humanBones: [{ bone: 'hips', node: 0 }] },
            materialProperties: [{ name: 'BodyMat', textureProperties: { _MainTex: 0 } }],
          },
        },
      },
      binaryChunk: new Uint8Array(16),
    };

    const mockHead: ParsedGlb = {
      json: {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'FaceMeshNode', mesh: 0 }],
        meshes: [{ name: 'FaceMesh', primitives: [{ material: 0 }] }],
        textures: [{ source: 0 }, { source: 1 }], // 2 head textures (e.g. eye & face)
        materials: [{ name: 'EyeMat' }],
        extensions: {
          VRM: {
            humanoid: { humanBones: [{ bone: 'head', node: 0 }] },
            materialProperties: [
              { name: 'EyeMat', textureProperties: { _MainTex: 0 } },
            ],
          },
        },
      },
      binaryChunk: new Uint8Array(16),
    };

    const merged = mergeVrm(mockBody, mockHead);

    // Head materials & materialProperties are preserved!
    const mats = merged.json.extensions.VRM.materialProperties;
    expect(mats).toHaveLength(2);
    // EyeMat is index 0 with original texture 0
    expect(mats[0].name).toBe('EyeMat');
    expect(mats[0].textureProperties._MainTex).toBe(0);

    // BodyMat is index 1 with remapped texture:
    // mockHead originally had 2 textures (0 and 1), but texture 1 was unused, so pruneGlb pruned it!
    // Therefore, new textures are: [Head Tex 0, Body Tex 0], so BodyMat's _MainTex becomes 1.
    expect(mats[1].name).toBe('BodyMat');
    expect(mats[1].textureProperties._MainTex).toBe(1);
  });

  it('should import clothing bones and dock under head humanoid hips', () => {
    const mockBody: ParsedGlb = {
      json: {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [
          { name: 'BodyHips', children: [1] },
          { name: 'SkirtBone_01' },
          { name: 'OutfitMeshNode', mesh: 0, skin: 0 },
        ],
        meshes: [{ name: 'OutfitMesh', primitives: [{ attributes: { POSITION: 0 } }] }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
        skins: [
          { joints: [0, 1] }, // Bound to Hips (0) and SkirtBone (1)
        ],
        extensions: {
          VRM: {
            humanoid: { humanBones: [{ bone: 'hips', node: 0 }] },
          },
        },
      },
      binaryChunk: new Uint8Array(36),
    };

    const mockHead: ParsedGlb = {
      json: {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0, 1] }],
        nodes: [
          { name: 'HeadRoot', children: [1] },
          { name: 'HeadHips' },
          { name: 'FaceMeshNode', mesh: 0 },
        ],
        meshes: [{ name: 'FaceMesh', primitives: [{ attributes: { POSITION: 0 } }] }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
        extensions: {
          VRM: {
            humanoid: {
              humanBones: [
                { bone: 'hips', node: 1 },
                { bone: 'head', node: 1 },
              ],
            },
          },
        },
      },
      binaryChunk: new Uint8Array(36),
    };

    const merged = mergeVrm(mockBody, mockHead);

    // Head nodes (3) + imported SkirtBone (1) + OutfitMeshNode (1) = 5 nodes
    // Notice BodyHips was NOT duplicated!
    expect(merged.json.nodes).toHaveLength(5);

    // SkirtBone should be docked under HeadHips (node 1)
    const headHipsNode = merged.json.nodes[1];
    expect(headHipsNode.name).toBe('HeadHips');
    expect(headHipsNode.children).toContain(3); // Node 3 is SkirtBone_01

    // Skinned joints should map 0 (BodyHips) -> 1 (HeadHips), and 1 (SkirtBone) -> 3 (imported SkirtBone)
    const importedSkin = merged.json.skins[0];
    expect(importedSkin.joints).toEqual([1, 3]);
  });
});
