import { ParsedGlb } from './glb';

/**
 * Prunes all unused resources (meshes, materials, textures, images, accessors, bufferViews)
 * and repacks the binary chunk to minimize file size.
 */
export function pruneGlb(parsed: ParsedGlb): ParsedGlb {
  const json = JSON.parse(JSON.stringify(parsed.json));
  const oldBin = parsed.binaryChunk || new Uint8Array(0);

  // 1. Collect reachable nodes from scenes, skins, humanoid, firstPerson, secondaryAnimation
  const usedNodeIndices = new Set<number>();

  const traverseNode = (idx: number) => {
    if (usedNodeIndices.has(idx)) return;
    usedNodeIndices.add(idx);
    const node = json.nodes?.[idx];
    if (node && Array.isArray(node.children)) {
      node.children.forEach(traverseNode);
    }
  };

  // Start from scenes
  for (const scene of json.scenes || []) {
    if (Array.isArray(scene.nodes)) {
      scene.nodes.forEach(traverseNode);
    }
  }

  // Include humanoid bones
  const vrm0HumanBones = json.extensions?.VRM?.humanoid?.humanBones || [];
  for (const hb of vrm0HumanBones) {
    if (typeof hb.node === 'number') traverseNode(hb.node);
  }
  const vrm1HumanBones = json.extensions?.VRMC_vrm?.humanoid?.humanBones || {};
  for (const boneVal of Object.values(vrm1HumanBones)) {
    const nodeNum = (boneVal as any)?.node;
    if (typeof nodeNum === 'number') traverseNode(nodeNum);
  }

  // Include FirstPerson bone
  if (typeof json.extensions?.VRM?.firstPerson?.firstPersonBone === 'number') {
    traverseNode(json.extensions.VRM.firstPerson.firstPersonBone);
  }

  // Include secondaryAnimation colliders & bones
  for (const cg of json.extensions?.VRM?.secondaryAnimation?.colliderGroups || []) {
    if (typeof cg.node === 'number') traverseNode(cg.node);
  }
  for (const bg of json.extensions?.VRM?.secondaryAnimation?.boneGroups || []) {
    if (Array.isArray(bg.bones)) {
      bg.bones.forEach((b: number) => {
        if (typeof b === 'number') traverseNode(b);
      });
    }
  }

  // Include skins joints
  for (const skin of json.skins || []) {
    if (Array.isArray(skin.joints)) {
      skin.joints.forEach((j: number) => {
        if (typeof j === 'number') traverseNode(j);
      });
    }
  }

  // 2. Identify used Meshes & Skins from reachable nodes
  const usedMeshIndices = new Set<number>();
  const usedSkinIndices = new Set<number>();

  for (const nodeIdx of usedNodeIndices) {
    const node = json.nodes?.[nodeIdx];
    if (!node) continue;
    if (typeof node.mesh === 'number') usedMeshIndices.add(node.mesh);
    if (typeof node.skin === 'number') usedSkinIndices.add(node.skin);
  }

  // 3. Identify used Materials and Accessors from used Meshes
  const usedMaterialIndices = new Set<number>();
  const usedAccessorIndices = new Set<number>();

  for (const mIdx of usedMeshIndices) {
    const mesh = json.meshes?.[mIdx];
    if (!mesh) continue;
    for (const prim of mesh.primitives || []) {
      if (typeof prim.material === 'number') usedMaterialIndices.add(prim.material);
      if (typeof prim.indices === 'number') usedAccessorIndices.add(prim.indices);
      if (prim.attributes) {
        for (const accIdx of Object.values(prim.attributes)) {
          if (typeof accIdx === 'number') usedAccessorIndices.add(accIdx);
        }
      }
      if (Array.isArray(prim.targets)) {
        for (const target of prim.targets) {
          for (const accIdx of Object.values(target)) {
            if (typeof accIdx === 'number') usedAccessorIndices.add(accIdx);
          }
        }
      }
    }
  }

  // Add inverseBindMatrices from used Skins
  for (const sIdx of usedSkinIndices) {
    const skin = json.skins?.[sIdx];
    if (skin && typeof skin.inverseBindMatrices === 'number') {
      usedAccessorIndices.add(skin.inverseBindMatrices);
    }
  }

  // 4. Identify used Textures from used Materials
  const usedTextureIndices = new Set<number>();
  const markTex = (idx: any) => {
    if (typeof idx === 'number') usedTextureIndices.add(idx);
    else if (typeof idx?.index === 'number') usedTextureIndices.add(idx.index);
  };

  for (const matIdx of usedMaterialIndices) {
    const mat = json.materials?.[matIdx];
    if (!mat) continue;
    markTex(mat.pbrMetallicRoughness?.baseColorTexture);
    markTex(mat.pbrMetallicRoughness?.metallicRoughnessTexture);
    markTex(mat.normalTexture);
    markTex(mat.emissiveTexture);
    markTex(mat.occlusionTexture);

    // MToon 1.0
    const mtoon1 = mat.extensions?.VRMC_materials_mtoon;
    if (mtoon1) {
      markTex(mtoon1.shadeMultiplyTexture);
      markTex(mtoon1.shadingShiftTexture);
      markTex(mtoon1.rimMultiplyTexture);
      markTex(mtoon1.outlineWidthMultiplyTexture);
      markTex(mtoon1.uvAnimationMaskTexture);
    }

    // VRM 0.x materialProperties
    const matProp = json.extensions?.VRM?.materialProperties?.[matIdx];
    if (matProp?.textureProperties) {
      for (const tIdx of Object.values(matProp.textureProperties)) {
        markTex(tIdx);
      }
    }
  }

  // Include meta texture
  markTex(json.extensions?.VRM?.meta?.texture);
  markTex(json.extensions?.VRMC_vrm?.meta?.thumbnailImage);

  // 5. Identify used Images and Samplers from used Textures
  const usedImageIndices = new Set<number>();
  const usedSamplerIndices = new Set<number>();

  for (const tIdx of usedTextureIndices) {
    const tex = json.textures?.[tIdx];
    if (!tex) continue;
    if (typeof tex.source === 'number') usedImageIndices.add(tex.source);
    if (typeof tex.sampler === 'number') usedSamplerIndices.add(tex.sampler);
  }

  // 6. Identify used BufferViews from used Accessors and used Images
  const usedBufferViewIndices = new Set<number>();

  for (const accIdx of usedAccessorIndices) {
    const acc = json.accessors?.[accIdx];
    if (acc && typeof acc.bufferView === 'number') {
      usedBufferViewIndices.add(acc.bufferView);
    }
  }

  for (const imgIdx of usedImageIndices) {
    const img = json.images?.[imgIdx];
    if (img && typeof img.bufferView === 'number') {
      usedBufferViewIndices.add(img.bufferView);
    }
  }

  // -------------------------------------------------------------
  // REPACK BINARY CHUNK: Keep only used bufferViews!
  // -------------------------------------------------------------
  const newBufferViews: any[] = [];
  const oldToNewBufferViewMap = new Map<number, number>();

  // Calculate new buffer and offsets
  const newBufferChunks: Uint8Array[] = [];
  let currentOffset = 0;

  // Sort old bufferView indices so they maintain orderly packing
  const sortedBvIndices = Array.from(usedBufferViewIndices).sort((a, b) => a - b);

  for (const oldBvIdx of sortedBvIndices) {
    const oldBv = json.bufferViews[oldBvIdx];
    if (!oldBv) continue;

    const bvOffset = oldBv.byteOffset || 0;
    const bvLength = oldBv.byteLength;
    const chunkData = oldBin.subarray(bvOffset, bvOffset + bvLength);

    // 4-byte padding alignment for new bufferView offset
    const padding = (4 - (currentOffset % 4)) % 4;
    currentOffset += padding;

    const newBv = {
      ...oldBv,
      buffer: 0,
      byteOffset: currentOffset,
      byteLength: bvLength,
    };

    oldToNewBufferViewMap.set(oldBvIdx, newBufferViews.length);
    newBufferViews.push(newBv);

    if (padding > 0) {
      newBufferChunks.push(new Uint8Array(padding)); // zero padding
    }
    newBufferChunks.push(chunkData);
    currentOffset += bvLength;
  }

  // Assemble new compact binary chunk
  const repackedBin = new Uint8Array(currentOffset);
  let writeOffset = 0;
  for (const chunk of newBufferChunks) {
    repackedBin.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  // Update buffers[0]
  json.buffers = [{ byteLength: repackedBin.byteLength }];
  json.bufferViews = newBufferViews;

  // -------------------------------------------------------------
  // REMAP ALL REFERENCES
  // -------------------------------------------------------------

  // Remap Accessors
  const newAccessors: any[] = [];
  const oldToNewAccessorMap = new Map<number, number>();
  for (let i = 0; i < (json.accessors || []).length; i++) {
    if (usedAccessorIndices.has(i)) {
      const acc = json.accessors[i];
      if (typeof acc.bufferView === 'number') {
        acc.bufferView = oldToNewBufferViewMap.get(acc.bufferView)!;
      }
      oldToNewAccessorMap.set(i, newAccessors.length);
      newAccessors.push(acc);
    }
  }
  json.accessors = newAccessors;

  // Remap Images
  const newImages: any[] = [];
  const oldToNewImageMap = new Map<number, number>();
  for (let i = 0; i < (json.images || []).length; i++) {
    if (usedImageIndices.has(i)) {
      const img = json.images[i];
      if (typeof img.bufferView === 'number') {
        img.bufferView = oldToNewBufferViewMap.get(img.bufferView)!;
      }
      oldToNewImageMap.set(i, newImages.length);
      newImages.push(img);
    }
  }
  json.images = newImages;

  // Remap Samplers
  const newSamplers: any[] = [];
  const oldToNewSamplerMap = new Map<number, number>();
  for (let i = 0; i < (json.samplers || []).length; i++) {
    if (usedSamplerIndices.has(i)) {
      oldToNewSamplerMap.set(i, newSamplers.length);
      newSamplers.push(json.samplers[i]);
    }
  }
  json.samplers = newSamplers;

  // Remap Textures
  const newTextures: any[] = [];
  const oldToNewTextureMap = new Map<number, number>();
  for (let i = 0; i < (json.textures || []).length; i++) {
    if (usedTextureIndices.has(i)) {
      const tex = json.textures[i];
      if (typeof tex.source === 'number') {
        tex.source = oldToNewImageMap.get(tex.source)!;
      }
      if (typeof tex.sampler === 'number') {
        tex.sampler = oldToNewSamplerMap.get(tex.sampler)!;
      }
      oldToNewTextureMap.set(i, newTextures.length);
      newTextures.push(tex);
    }
  }
  json.textures = newTextures;

  // Remap Materials & VRM 0.x materialProperties
  const remapTexRef = (ref: any) => {
    if (typeof ref === 'number') return oldToNewTextureMap.get(ref);
    if (typeof ref?.index === 'number') ref.index = oldToNewTextureMap.get(ref.index)!;
    return ref;
  };

  const newMaterials: any[] = [];
  const newMaterialProperties: any[] = [];
  const oldToNewMaterialMap = new Map<number, number>();

  for (let i = 0; i < (json.materials || []).length; i++) {
    if (usedMaterialIndices.has(i)) {
      const mat = json.materials[i];
      if (mat.pbrMetallicRoughness?.baseColorTexture) remapTexRef(mat.pbrMetallicRoughness.baseColorTexture);
      if (mat.pbrMetallicRoughness?.metallicRoughnessTexture) remapTexRef(mat.pbrMetallicRoughness.metallicRoughnessTexture);
      if (mat.normalTexture) remapTexRef(mat.normalTexture);
      if (mat.emissiveTexture) remapTexRef(mat.emissiveTexture);
      if (mat.occlusionTexture) remapTexRef(mat.occlusionTexture);

      const mtoon1 = mat.extensions?.VRMC_materials_mtoon;
      if (mtoon1) {
        if (mtoon1.shadeMultiplyTexture) remapTexRef(mtoon1.shadeMultiplyTexture);
        if (mtoon1.shadingShiftTexture) remapTexRef(mtoon1.shadingShiftTexture);
        if (mtoon1.rimMultiplyTexture) remapTexRef(mtoon1.rimMultiplyTexture);
        if (mtoon1.outlineWidthMultiplyTexture) remapTexRef(mtoon1.outlineWidthMultiplyTexture);
        if (mtoon1.uvAnimationMaskTexture) remapTexRef(mtoon1.uvAnimationMaskTexture);
      }

      oldToNewMaterialMap.set(i, newMaterials.length);
      newMaterials.push(mat);

      // Corresponding VRM 0.x materialProperty
      const matProp = json.extensions?.VRM?.materialProperties?.[i];
      if (matProp) {
        const newProp = JSON.parse(JSON.stringify(matProp));
        if (newProp.textureProperties) {
          for (const k of Object.keys(newProp.textureProperties)) {
            const oldT = newProp.textureProperties[k];
            if (typeof oldT === 'number') {
              newProp.textureProperties[k] = oldToNewTextureMap.get(oldT);
            }
          }
        }
        newMaterialProperties.push(newProp);
      }
    }
  }
  json.materials = newMaterials;
  if (json.extensions?.VRM) {
    json.extensions.VRM.materialProperties = newMaterialProperties;
  }

  // Remap Meshes
  const newMeshes: any[] = [];
  const oldToNewMeshMap = new Map<number, number>();
  for (let i = 0; i < (json.meshes || []).length; i++) {
    if (usedMeshIndices.has(i)) {
      const mesh = json.meshes[i];
      for (const prim of mesh.primitives || []) {
        if (typeof prim.material === 'number') {
          prim.material = oldToNewMaterialMap.get(prim.material)!;
        }
        if (typeof prim.indices === 'number') {
          prim.indices = oldToNewAccessorMap.get(prim.indices)!;
        }
        if (prim.attributes) {
          for (const k of Object.keys(prim.attributes)) {
            prim.attributes[k] = oldToNewAccessorMap.get(prim.attributes[k])!;
          }
        }
        if (Array.isArray(prim.targets)) {
          for (const target of prim.targets) {
            for (const k of Object.keys(target)) {
              target[k] = oldToNewAccessorMap.get(target[k])!;
            }
          }
        }
      }
      oldToNewMeshMap.set(i, newMeshes.length);
      newMeshes.push(mesh);
    }
  }
  json.meshes = newMeshes;

  // Remap Skins
  const newSkins: any[] = [];
  const oldToNewSkinMap = new Map<number, number>();
  for (let i = 0; i < (json.skins || []).length; i++) {
    if (usedSkinIndices.has(i)) {
      const skin = json.skins[i];
      if (typeof skin.inverseBindMatrices === 'number') {
        skin.inverseBindMatrices = oldToNewAccessorMap.get(skin.inverseBindMatrices)!;
      }
      oldToNewSkinMap.set(i, newSkins.length);
      newSkins.push(skin);
    }
  }
  json.skins = newSkins;

  // Remap VRM 0.x BlendShape binds
  if (json.extensions?.VRM?.blendShapeMaster?.blendShapeGroups) {
    for (const bg of json.extensions.VRM.blendShapeMaster.blendShapeGroups) {
      if (Array.isArray(bg.binds)) {
        bg.binds = bg.binds
          .filter((b: any) => typeof b.mesh === 'number' && oldToNewMeshMap.has(b.mesh))
          .map((b: any) => ({
            ...b,
            mesh: oldToNewMeshMap.get(b.mesh)!,
          }));
      }
    }
  }

  // Remap VRM 0.x FirstPerson meshAnnotations
  if (json.extensions?.VRM?.firstPerson?.meshAnnotations) {
    json.extensions.VRM.firstPerson.meshAnnotations = json.extensions.VRM.firstPerson.meshAnnotations
      .filter((a: any) => typeof a.mesh === 'number' && oldToNewMeshMap.has(a.mesh))
      .map((a: any) => ({
        ...a,
        mesh: oldToNewMeshMap.get(a.mesh)!,
      }));
  }

  // Update nodes with remapped mesh & skin
  for (const node of json.nodes || []) {
    if (typeof node.mesh === 'number') {
      node.mesh = oldToNewMeshMap.get(node.mesh);
    }
    if (typeof node.skin === 'number') {
      node.skin = oldToNewSkinMap.get(node.skin);
    }
  }

  return {
    json,
    binaryChunk: repackedBin,
  };
}
