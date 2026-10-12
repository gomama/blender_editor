import { ParsedGlb } from './glb';
import { analyzeVrm } from './vrmAnalyzer';
import { pruneGlb } from './glbPruner';

export interface MergeOptions {
  /** Node indices of body model meshes to keep. If not provided, non-head meshes are kept. */
  bodyMeshNodeIndices?: number[];
  /** Node indices of head model meshes to import. If not provided, head candidate meshes are kept. */
  headMeshNodeIndices?: number[];
  /** Offset for head/body relative position */
  offsetY?: number;
  offsetZ?: number;
  /** Flip head orientation 180 degrees (Y-axis) */
  flipRotationY?: boolean;
}

/**
 * Merges a Body VRM and a Head VRM by preserving the Head VRM's intact skeleton,
 * eyes, facial expressions, materials, and physics, while wearing the Body VRM's outfit and body meshes.
 */
export function mergeVrm(
  bodyGlb: ParsedGlb,
  headGlb: ParsedGlb,
  options: MergeOptions = {}
): ParsedGlb {
  // Head model is our primary BASE to guarantee 100% intact face, eyes, hair, expressions, lookAt, and springbones!
  const outJson = JSON.parse(JSON.stringify(headGlb.json));
  const bodyJson = JSON.parse(JSON.stringify(bodyGlb.json));

  const headAnalysis = analyzeVrm(outJson);
  const bodyAnalysis = analyzeVrm(bodyJson);

  // 1. Determine which meshes to keep from Head (Face, Hair, Head accessories)
  const headMeshNodesToImport = new Set<number>(
    options.headMeshNodeIndices ??
      headAnalysis.meshes
        .filter(m => m.isHeadPartCandidate)
        .map(m => m.nodeIndex)
  );

  // 2. Determine which meshes to keep from Body (Outfit, Body, Shoes)
  const bodyMeshNodesToKeep = new Set<number>(
    options.bodyMeshNodeIndices ??
      bodyAnalysis.meshes
        .filter(m => !m.isHeadPartCandidate)
        .map(m => m.nodeIndex)
  );

  // 3. Remove unselected meshes (old body/outfit) from Head model
  for (const m of headAnalysis.meshes) {
    if (!headMeshNodesToImport.has(m.nodeIndex)) {
      delete outJson.nodes[m.nodeIndex].mesh;
      delete outJson.nodes[m.nodeIndex].skin;
    }
  }

  // 4. Combine binary buffers (Head buffer + Body buffer)
  const headBin = headGlb.binaryChunk || new Uint8Array(0);
  const bodyBin = bodyGlb.binaryChunk || new Uint8Array(0);

  const headBinPadding = (4 - (headBin.byteLength % 4)) % 4;
  const alignedHeadBinLength = headBin.byteLength + headBinPadding;

  const combinedBin = new Uint8Array(alignedHeadBinLength + bodyBin.byteLength);
  combinedBin.set(headBin, 0);
  combinedBin.set(bodyBin, alignedHeadBinLength);

  const baseBufferOffset = alignedHeadBinLength;
  outJson.buffers = [{ byteLength: combinedBin.byteLength }];

  // 5. Track index offsets for importing Body resources into Head base
  outJson.bufferViews = outJson.bufferViews || [];
  outJson.accessors = outJson.accessors || [];
  outJson.images = outJson.images || [];
  outJson.samplers = outJson.samplers || [];
  outJson.textures = outJson.textures || [];
  outJson.materials = outJson.materials || [];
  outJson.meshes = outJson.meshes || [];
  outJson.nodes = outJson.nodes || [];
  outJson.skins = outJson.skins || [];

  const bufferViewOffset = outJson.bufferViews.length;
  const accessorOffset = outJson.accessors.length;
  const imageOffset = outJson.images.length;
  const samplerOffset = outJson.samplers.length;
  const textureOffset = outJson.textures.length;
  const materialOffset = outJson.materials.length;
  const meshOffset = outJson.meshes.length;
  const skinOffset = outJson.skins.length;

  // Append Body bufferViews
  for (const bv of bodyJson.bufferViews || []) {
    const newBv = { ...bv };
    newBv.buffer = 0;
    newBv.byteOffset = (newBv.byteOffset || 0) + baseBufferOffset;
    outJson.bufferViews.push(newBv);
  }

  // Append Body accessors
  for (const acc of bodyJson.accessors || []) {
    const newAcc = { ...acc };
    if (typeof newAcc.bufferView === 'number') {
      newAcc.bufferView += bufferViewOffset;
    }
    outJson.accessors.push(newAcc);
  }

  // Append Body images
  for (const img of bodyJson.images || []) {
    const newImg = { ...img };
    if (typeof newImg.bufferView === 'number') {
      newImg.bufferView += bufferViewOffset;
    }
    outJson.images.push(newImg);
  }

  // Append Body samplers
  for (const smp of bodyJson.samplers || []) {
    outJson.samplers.push({ ...smp });
  }

  // Append Body textures
  for (const tex of bodyJson.textures || []) {
    const newTex = { ...tex };
    if (typeof newTex.sampler === 'number') {
      newTex.sampler += samplerOffset;
    }
    if (typeof newTex.source === 'number') {
      newTex.source += imageOffset;
    }
    outJson.textures.push(newTex);
  }

  // Append Body materials
  for (const mat of bodyJson.materials || []) {
    const newMat = JSON.parse(JSON.stringify(mat));
    if (newMat.pbrMetallicRoughness?.baseColorTexture) {
      newMat.pbrMetallicRoughness.baseColorTexture.index += textureOffset;
    }
    if (newMat.normalTexture) {
      newMat.normalTexture.index += textureOffset;
    }
    if (newMat.emissiveTexture) {
      newMat.emissiveTexture.index += textureOffset;
    }
    if (newMat.occlusionTexture) {
      newMat.occlusionTexture.index += textureOffset;
    }
    if (newMat.extensions?.VRMC_materials_mtoon) {
      const mtoon = newMat.extensions.VRMC_materials_mtoon;
      if (mtoon.shadeMultiplyTexture) mtoon.shadeMultiplyTexture.index += textureOffset;
      if (mtoon.shadingShiftTexture) mtoon.shadingShiftTexture.index += textureOffset;
      if (mtoon.rimMultiplyTexture) mtoon.rimMultiplyTexture.index += textureOffset;
      if (mtoon.outlineWidthMultiplyTexture) mtoon.outlineWidthMultiplyTexture.index += textureOffset;
      if (mtoon.uvAnimationMaskTexture) mtoon.uvAnimationMaskTexture.index += textureOffset;
    }
    outJson.materials.push(newMat);
  }

  // VRM 0.x MToon materialProperties for imported Body materials
  if (outJson.extensions?.VRM && bodyJson.extensions?.VRM) {
    outJson.extensions.VRM.materialProperties = outJson.extensions.VRM.materialProperties || [];
    // Ensure materialProperties is strictly 1:1 aligned before appending
    while (outJson.extensions.VRM.materialProperties.length < materialOffset) {
      outJson.extensions.VRM.materialProperties.push({
        name: outJson.materials[outJson.extensions.VRM.materialProperties.length]?.name || 'Standard',
        shader: 'VRM/MToon',
        renderQueue: 2000,
      });
    }

    const bodyMatProps = bodyJson.extensions.VRM.materialProperties || [];
    const bodyMats = bodyJson.materials || [];
    const count = Math.max(bodyMats.length, bodyMatProps.length);
    for (let bMatIdx = 0; bMatIdx < count; bMatIdx++) {
      const bMat = bodyMats[bMatIdx];
      const rawProp = bodyMatProps[bMatIdx] || (bMat ? bodyMatProps.find((p: any) => p.name === bMat.name) : undefined);
      if (rawProp) {
        const newProp = JSON.parse(JSON.stringify(rawProp));
        if (newProp.textureProperties) {
          for (const texKey of Object.keys(newProp.textureProperties)) {
            if (typeof newProp.textureProperties[texKey] === 'number') {
              newProp.textureProperties[texKey] += textureOffset;
            }
          }
        }
        outJson.extensions.VRM.materialProperties.push(newProp);
      } else if (bMat) {
        outJson.extensions.VRM.materialProperties.push({
          name: bMat.name || `Material_${bMatIdx}`,
          shader: 'VRM/MToon',
          renderQueue: 2000,
        });
      }
    }
  }

  // Append Body meshes
  const bodyMeshIndexMap = new Map<number, number>();
  for (let bMIdx = 0; bMIdx < (bodyJson.meshes || []).length; bMIdx++) {
    const mesh = bodyJson.meshes[bMIdx];
    const newMesh = JSON.parse(JSON.stringify(mesh));
    for (const prim of newMesh.primitives || []) {
      if (typeof prim.indices === 'number') {
        prim.indices += accessorOffset;
      }
      if (prim.attributes) {
        for (const attrKey of Object.keys(prim.attributes)) {
          prim.attributes[attrKey] += accessorOffset;
        }
      }
      if (typeof prim.material === 'number') {
        prim.material += materialOffset;
      }
      if (prim.targets) {
        for (const target of prim.targets) {
          for (const targetKey of Object.keys(target)) {
            target[targetKey] += accessorOffset;
          }
        }
      }
    }
    const newMeshIndex = outJson.meshes.length;
    outJson.meshes.push(newMesh);
    bodyMeshIndexMap.set(bMIdx, newMeshIndex);
  }

  // 6. Build Humanoid Bone Mapping (Body bone -> Head bone)
  const bodyToHeadBoneMap = new Map<number, number>();
  for (const [boneName, bodyNodeIdx] of Object.entries(bodyAnalysis.bones.humanoidBoneMap)) {
    const headNodeIdx = headAnalysis.bones.humanoidBoneMap[boneName];
    if (typeof headNodeIdx === 'number') {
      bodyToHeadBoneMap.set(bodyNodeIdx, headNodeIdx);
    }
  }

  // Fallback map: neck / head
  if (typeof bodyAnalysis.bones.neckNodeIndex === 'number' && typeof headAnalysis.bones.neckNodeIndex === 'number') {
    bodyToHeadBoneMap.set(bodyAnalysis.bones.neckNodeIndex, headAnalysis.bones.neckNodeIndex);
  }
  if (typeof bodyAnalysis.bones.headNodeIndex === 'number' && typeof headAnalysis.bones.headNodeIndex === 'number') {
    bodyToHeadBoneMap.set(bodyAnalysis.bones.headNodeIndex, headAnalysis.bones.headNodeIndex);
  }

  // 6.1 Identify Body clothing / accessory bones (bones that are NOT humanoid skeleton bones)
  const bodyHumanoidNodeSet = new Set<number>(Object.values(bodyAnalysis.bones.humanoidBoneMap));
  if (typeof bodyAnalysis.bones.headNodeIndex === 'number') bodyHumanoidNodeSet.add(bodyAnalysis.bones.headNodeIndex);
  if (typeof bodyAnalysis.bones.neckNodeIndex === 'number') bodyHumanoidNodeSet.add(bodyAnalysis.bones.neckNodeIndex);

  // Find all node indices referenced by Body's skins or secondaryAnimation
  const bodyUsedBoneIndices = new Set<number>();
  for (const skin of bodyJson.skins || []) {
    if (Array.isArray(skin.joints)) {
      skin.joints.forEach((j: number) => bodyUsedBoneIndices.add(j));
    }
  }
  for (const bg of bodyJson.extensions?.VRM?.secondaryAnimation?.boneGroups || []) {
    if (Array.isArray(bg.bones)) {
      bg.bones.forEach((b: number) => bodyUsedBoneIndices.add(b));
    }
  }

  // Build parent map of Body nodes
  const bodyParentMap = new Map<number, number>();
  for (let i = 0; i < (bodyJson.nodes || []).length; i++) {
    const n = bodyJson.nodes[i];
    if (Array.isArray(n.children)) {
      n.children.forEach((c: number) => bodyParentMap.set(c, i));
    }
  }

  // Clothing bones = used by skins/physics, but NOT in standard humanoid skeleton, and NOT a mesh node
  const clothingBoneIndices = new Set<number>();
  for (const bIdx of bodyUsedBoneIndices) {
    if (!bodyHumanoidNodeSet.has(bIdx) && !bodyMeshNodesToKeep.has(bIdx)) {
      clothingBoneIndices.add(bIdx);
    }
  }

  // Also include all children of clothing bones
  let addedMore = true;
  while (addedMore) {
    addedMore = false;
    for (const cbIdx of Array.from(clothingBoneIndices)) {
      const node = bodyJson.nodes[cbIdx];
      if (node && Array.isArray(node.children)) {
        for (const childIdx of node.children) {
          if (!clothingBoneIndices.has(childIdx) && !bodyHumanoidNodeSet.has(childIdx) && !bodyMeshNodesToKeep.has(childIdx)) {
            clothingBoneIndices.add(childIdx);
            addedMore = true;
          }
        }
      }
    }
  }

  // Import Clothing Bones into Head model's nodes
  const bodyClothingToHeadNodeMap = new Map<number, number>();
  for (const cbIdx of clothingBoneIndices) {
    const bNode = bodyJson.nodes[cbIdx];
    if (!bNode) continue;
    const newNode = JSON.parse(JSON.stringify(bNode));
    delete newNode.children; // re-linked below

    const newNodeIndex = outJson.nodes.length;
    outJson.nodes.push(newNode);
    bodyClothingToHeadNodeMap.set(cbIdx, newNodeIndex);
  }

  // Link children for imported Clothing Bones and dock root clothing bones under Head model's matching humanoid bones!
  const defaultHeadHips = headAnalysis.bones.humanoidBoneMap['hips'] ?? 0;
  for (const cbIdx of clothingBoneIndices) {
    const newIdx = bodyClothingToHeadNodeMap.get(cbIdx)!;
    const parentBIdx = bodyParentMap.get(cbIdx);

    if (typeof parentBIdx === 'number') {
      if (clothingBoneIndices.has(parentBIdx)) {
        // Child of another clothing bone
        const parentNewIdx = bodyClothingToHeadNodeMap.get(parentBIdx)!;
        const parentNode = outJson.nodes[parentNewIdx];
        parentNode.children = parentNode.children || [];
        if (!parentNode.children.includes(newIdx)) parentNode.children.push(newIdx);
      } else {
        // Parent is a humanoid bone! Dock directly under Head model's matching humanoid bone!
        const mappedHeadParentNode = bodyToHeadBoneMap.get(parentBIdx) ?? defaultHeadHips;
        const headParentNodeObj = outJson.nodes[mappedHeadParentNode];
        if (headParentNodeObj) {
          headParentNodeObj.children = headParentNodeObj.children || [];
          if (!headParentNodeObj.children.includes(newIdx)) headParentNodeObj.children.push(newIdx);
        }
      }
    } else {
      // Fallback: attach to Head model's Hips
      const headParentNodeObj = outJson.nodes[defaultHeadHips];
      if (headParentNodeObj) {
        headParentNodeObj.children = headParentNodeObj.children || [];
        if (!headParentNodeObj.children.includes(newIdx)) headParentNodeObj.children.push(newIdx);
      }
    }
  }

  // Import ONLY selected Body mesh nodes!
  for (const bNodeIdx of bodyMeshNodesToKeep) {
    const bNode = bodyJson.nodes[bNodeIdx];
    if (!bNode) continue;

    const newNode = JSON.parse(JSON.stringify(bNode));
    if (typeof newNode.mesh === 'number') {
      newNode.mesh = bodyMeshIndexMap.get(newNode.mesh) ?? (newNode.mesh + meshOffset);
    }
    if (typeof newNode.skin === 'number') {
      newNode.skin += skinOffset;
    }
    delete newNode.children;

    const newNodeIndex = outJson.nodes.length;
    outJson.nodes.push(newNode);

    // Attach mesh node to Head model's root scene
    if (outJson.scenes?.[0]?.nodes) {
      outJson.scenes[0].nodes.push(newNodeIndex);
    }
  }

  // Append Body skins, remapping joint indices to matching humanoid bones OR imported clothing bones!
  for (const skin of bodyJson.skins || []) {
    const newSkin = JSON.parse(JSON.stringify(skin));
    if (typeof newSkin.inverseBindMatrices === 'number') {
      newSkin.inverseBindMatrices += accessorOffset;
    }
    if (Array.isArray(newSkin.joints)) {
      newSkin.joints = newSkin.joints.map((jointIdx: number) => {
        // 1. Check if it's an imported clothing bone
        const mappedClothingBone = bodyClothingToHeadNodeMap.get(jointIdx);
        if (typeof mappedClothingBone === 'number') {
          return mappedClothingBone;
        }
        // 2. Check if it's a standard humanoid bone
        const mappedHeadBone = bodyToHeadBoneMap.get(jointIdx);
        if (typeof mappedHeadBone === 'number') {
          return mappedHeadBone;
        }
        return defaultHeadHips;
      });
    }
    outJson.skins.push(newSkin);
  }

  // Merge clothing SpringBones from Body model into Head model safely (prevents IndexOutOfRangeException in Unity)
  if (outJson.extensions?.VRM && bodyJson.extensions?.VRM?.secondaryAnimation) {
    outJson.extensions.VRM.secondaryAnimation = outJson.extensions.VRM.secondaryAnimation || {
      boneGroups: [],
      colliderGroups: [],
    };
    outJson.extensions.VRM.secondaryAnimation.boneGroups =
      outJson.extensions.VRM.secondaryAnimation.boneGroups || [];
    outJson.extensions.VRM.secondaryAnimation.colliderGroups =
      outJson.extensions.VRM.secondaryAnimation.colliderGroups || [];

    const colliderOffset = outJson.extensions.VRM.secondaryAnimation.colliderGroups.length;

    // Append Body colliders with remapped node indices
    for (const cg of bodyJson.extensions.VRM.secondaryAnimation.colliderGroups || []) {
      const newCg = JSON.parse(JSON.stringify(cg));
      if (typeof newCg.node === 'number') {
        newCg.node =
          bodyClothingToHeadNodeMap.get(newCg.node) ??
          bodyToHeadBoneMap.get(newCg.node) ??
          defaultHeadHips;
      }
      outJson.extensions.VRM.secondaryAnimation.colliderGroups.push(newCg);
    }

    // Append Body boneGroups with remapped bones AND remapped colliderGroups
    const bodyBoneGroups = bodyJson.extensions.VRM.secondaryAnimation.boneGroups || [];
    for (const bg of bodyBoneGroups) {
      const newBg = JSON.parse(JSON.stringify(bg));
      if (Array.isArray(newBg.bones)) {
        newBg.bones = newBg.bones
          .map((bIdx: number) => bodyClothingToHeadNodeMap.get(bIdx) ?? bodyToHeadBoneMap.get(bIdx))
          .filter((idx: any): idx is number => typeof idx === 'number');
      }
      if (Array.isArray(newBg.colliderGroups)) {
        newBg.colliderGroups = newBg.colliderGroups.map((cgIdx: number) => cgIdx + colliderOffset);
      }
      // Only include boneGroup if it has valid bones
      if (Array.isArray(newBg.bones) && newBg.bones.length > 0) {
        outJson.extensions.VRM.secondaryAnimation.boneGroups.push(newBg);
      }
    }
  }

  // Sanitize meshAnnotations: Ensure all mesh indices are valid (< outJson.meshes.length)
  if (outJson.extensions?.VRM?.firstPerson?.meshAnnotations) {
    outJson.extensions.VRM.firstPerson.meshAnnotations =
      outJson.extensions.VRM.firstPerson.meshAnnotations.filter(
        (a: any) => typeof a.mesh === 'number' && a.mesh >= 0 && a.mesh < outJson.meshes.length
      );
  }

  // Sanitize blendShapeMaster binds: Ensure all mesh indices are valid
  if (outJson.extensions?.VRM?.blendShapeMaster?.blendShapeGroups) {
    for (const bg of outJson.extensions.VRM.blendShapeMaster.blendShapeGroups) {
      if (Array.isArray(bg.binds)) {
        bg.binds = bg.binds.filter(
          (b: any) => typeof b.mesh === 'number' && b.mesh >= 0 && b.mesh < outJson.meshes.length
        );
      }
    }
  }

  // Sanitize materialProperties: strictly equal length with materials
  if (outJson.extensions?.VRM?.materialProperties) {
    while (outJson.extensions.VRM.materialProperties.length < outJson.materials.length) {
      outJson.extensions.VRM.materialProperties.push({
        name: outJson.materials[outJson.extensions.VRM.materialProperties.length]?.name || 'Standard',
        shader: 'VRM_Standard',
        renderQueue: 2000,
      });
    }
  }

  // 7. Optional offset / flip adjustments
  const headHeadNode = headAnalysis.bones.headNodeIndex;
  if (typeof headHeadNode === 'number' && outJson.nodes[headHeadNode]) {
    const headNodeObj = outJson.nodes[headHeadNode];
    if (options.flipRotationY) {
      const curRot = headNodeObj.rotation || [0, 0, 0, 1];
      headNodeObj.rotation = [
        -curRot[2],
        curRot[3],
        curRot[0],
        -curRot[1],
      ];
      if (headNodeObj.translation) {
        headNodeObj.translation[0] = -headNodeObj.translation[0];
        headNodeObj.translation[2] = -headNodeObj.translation[2];
      }
    }
    if (options.offsetY || options.offsetZ) {
      headNodeObj.translation = headNodeObj.translation || [0, 0, 0];
      if (options.offsetY) headNodeObj.translation[1] += options.offsetY;
      if (options.offsetZ) headNodeObj.translation[2] += options.offsetZ;
    }
  }

    // Apply GLB pruning to eliminate all unreferenced meshes, materials, textures,
    // and repack binary buffers to drastically reduce output file size (similar to Blender export).
    return pruneGlb({
      json: outJson,
      binaryChunk: combinedBin,
    });
  }
