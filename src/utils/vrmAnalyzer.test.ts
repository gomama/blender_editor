import { describe, it, expect } from 'vitest';
import { analyzeVrm } from './vrmAnalyzer';

describe('VRM Analyzer', () => {
  it('should analyze VRM 0.x structure correctly', () => {
    const mockJson = {
      extensions: {
        VRM: {
          meta: { title: 'Test Model', author: 'Test Author' },
          humanoid: {
            humanBones: [
              { bone: 'neck', node: 1 },
              { bone: 'head', node: 2 },
            ],
          },
        },
      },
      nodes: [
        { name: 'Root' },
        { name: 'Neck_Bone' },
        { name: 'Head_Bone' },
        { name: 'BodyMeshNode', mesh: 0 },
        { name: 'FaceMeshNode', mesh: 1 },
        { name: 'HairMeshNode', mesh: 2 },
      ],
      meshes: [
        { name: 'Body', primitives: [{}] },
        { name: 'Face', primitives: [{}] },
        { name: 'Hair', primitives: [{}] },
      ],
    };

    const analysis = analyzeVrm(mockJson);
    expect(analysis.isVrm0).toBe(true);
    expect(analysis.isVrm1).toBe(false);
    expect(analysis.title).toBe('Test Model');
    expect(analysis.author).toBe('Test Author');
    expect(analysis.bones.headNodeIndex).toBe(2);
    expect(analysis.bones.neckNodeIndex).toBe(1);

    expect(analysis.meshes).toHaveLength(3);
    expect(analysis.meshes[0].isHeadPartCandidate).toBe(false);
    expect(analysis.meshes[1].isHeadPartCandidate).toBe(true);
    expect(analysis.meshes[2].isHeadPartCandidate).toBe(true);
  });

  it('should analyze VRM 1.0 structure correctly', () => {
    const mockJson = {
      extensions: {
        VRMC_vrm: {
          meta: { name: 'VRM1 Model', authors: ['VRM1 Creator'] },
          humanoid: {
            humanBones: {
              neck: { node: 1 },
              head: { node: 2 },
            },
          },
        },
      },
      nodes: [
        { name: 'Root' },
        { name: 'Neck' },
        { name: 'Head' },
        { name: 'Face_01', mesh: 0 },
      ],
      meshes: [{ name: 'Face_01', primitives: [{}] }],
    };

    const analysis = analyzeVrm(mockJson);
    expect(analysis.isVrm0).toBe(false);
    expect(analysis.isVrm1).toBe(true);
    expect(analysis.title).toBe('VRM1 Model');
    expect(analysis.author).toBe('VRM1 Creator');
    expect(analysis.bones.headNodeIndex).toBe(2);
    expect(analysis.meshes[0].isHeadPartCandidate).toBe(true);
  });
});
