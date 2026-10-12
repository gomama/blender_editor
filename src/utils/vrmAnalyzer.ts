export interface VrmBoneInfo {
  headNodeIndex?: number;
  neckNodeIndex?: number;
  leftEyeNodeIndex?: number;
  rightEyeNodeIndex?: number;
  humanoidBoneMap: Record<string, number>;
}

export interface VrmMeshInfo {
  meshIndex: number;
  nodeIndex: number;
  name: string;
  isHeadPartCandidate: boolean;
  primitiveCount: number;
}

export interface VrmModelAnalysis {
  isVrm0: boolean;
  isVrm1: boolean;
  title: string;
  author: string;
  bones: VrmBoneInfo;
  meshes: VrmMeshInfo[];
}

const HEAD_KEYWORDS = [
  'face', 'hair', 'head', 'eye', 'brow', 'mouth', 'teeth', 'tongue',
  'ear', 'nose', 'glasses', 'ahoge', 'wig', 'facial', 'cheek', 'lip',
  'beard', 'mustache', 'bangs', 'ponytail', 'twintail',
  // Japanese keywords commonly found in VRoid and Blender models
  '髪', 'かみ', 'カミ', 'ヘア', '顔', 'かお', 'カオ', '頭', '目', '眉', '口', '歯', '舌', '耳',
  'まつ毛', 'まつげ', 'アイ', 'ポニテ', 'ツインテ', 'アホ毛'
];

function isHeadName(name: string): boolean {
  const lower = name.toLowerCase();
  return HEAD_KEYWORDS.some(kw => {
    // Check if the keyword exists and isn't just an unintended substring
    if (kw === 'ear' || kw === 'lip') {
      return new RegExp(`(^|[^a-z])${kw}([^a-z]|$)`, 'i').test(lower);
    }
    return lower.includes(kw);
  });
}

/**
 * Analyzes parsed GLB JSON to detect VRM metadata, humanoid bones, and mesh parts.
 */
export function analyzeVrm(json: any): VrmModelAnalysis {
  const isVrm0 = Boolean(json.extensions?.VRM);
  const isVrm1 = Boolean(json.extensions?.VRMC_vrm);

  let title = 'Unknown VRM';
  let author = 'Unknown Author';
  const bones: VrmBoneInfo = {
    humanoidBoneMap: {},
  };

  if (isVrm0) {
    const vrm0 = json.extensions.VRM;
    title = vrm0.meta?.title || title;
    author = vrm0.meta?.author || author;

    const humanBones: any[] = vrm0.humanoid?.humanBones || [];
    for (const hb of humanBones) {
      if (typeof hb.bone === 'string' && typeof hb.node === 'number') {
        bones.humanoidBoneMap[hb.bone] = hb.node;
      }
      if (hb.bone === 'head') bones.headNodeIndex = hb.node;
      if (hb.bone === 'neck') bones.neckNodeIndex = hb.node;
      if (hb.bone === 'leftEye') bones.leftEyeNodeIndex = hb.node;
      if (hb.bone === 'rightEye') bones.rightEyeNodeIndex = hb.node;
    }
  } else if (isVrm1) {
    const vrm1 = json.extensions.VRMC_vrm;
    title = vrm1.meta?.name || title;
    author = vrm1.meta?.authors?.[0] || author;

    const humanBones = vrm1.humanoid?.humanBones || {};
    for (const [boneKey, boneVal] of Object.entries(humanBones)) {
      const nodeNum = (boneVal as any)?.node;
      if (typeof nodeNum === 'number') {
        bones.humanoidBoneMap[boneKey] = nodeNum;
      }
    }
    if (humanBones.head) bones.headNodeIndex = humanBones.head.node;
    if (humanBones.neck) bones.neckNodeIndex = humanBones.neck.node;
    if (humanBones.leftEye) bones.leftEyeNodeIndex = humanBones.leftEye.node;
    if (humanBones.rightEye) bones.rightEyeNodeIndex = humanBones.rightEye.node;
  }

  // Find all meshes and their nodes
  const meshes: VrmMeshInfo[] = [];
  const nodes: any[] = json.nodes || [];

  for (let nodeIdx = 0; nodeIdx < nodes.length; nodeIdx++) {
    const node = nodes[nodeIdx];
    if (typeof node.mesh === 'number') {
      const meshObj = json.meshes?.[node.mesh];
      const meshName = node.name || meshObj?.name || `Mesh_${node.mesh}`;
      const isHeadPartCandidate = isHeadName(meshName);

      meshes.push({
        meshIndex: node.mesh,
        nodeIndex: nodeIdx,
        name: meshName,
        isHeadPartCandidate,
        primitiveCount: meshObj?.primitives?.length || 0,
      });
    }
  }

  return {
    isVrm0,
    isVrm1,
    title,
    author,
    bones,
    meshes,
  };
}
