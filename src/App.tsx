import { useState, useCallback, useRef } from 'react';
import { parseGlb, packGlb, ParsedGlb } from './utils/glb';
import { analyzeVrm, VrmModelAnalysis } from './utils/vrmAnalyzer';
import { mergeVrm } from './utils/vrmMerger';
import { ModelUploadCard } from './components/ModelUploadCard';
import { VrmViewer } from './components/VrmViewer';
import { Sparkles, Download, RefreshCw, SlidersHorizontal, Eye } from 'lucide-react';

interface LoadedModel {
  file: File;
  bytes: Uint8Array;
  parsed: ParsedGlb;
  analysis: VrmModelAnalysis;
  selectedMeshNodes: Set<number>;
}

export function App() {
  const resultRef = useRef<HTMLElement>(null);
  const [bodyModel, setBodyModel] = useState<LoadedModel | null>(null);
  const [headModel, setHeadModel] = useState<LoadedModel | null>(null);

  // Offset settings
  const [offsetY, setOffsetY] = useState<number>(0);
  const [offsetZ, setOffsetZ] = useState<number>(0);
  const [flipRotationY, setFlipRotationY] = useState<boolean>(false);

  // Result state
  const [mergedGlbBytes, setMergedGlbBytes] = useState<Uint8Array | null>(null);
  const [mergedFileName, setMergedFileName] = useState<string>('swapped_avatar.vrm');
  const [isMerging, setIsMerging] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Expression preview
  const [selectedExpression, setSelectedExpression] = useState<string>('neutral');

  // Body file load
  const handleBodyFile = useCallback(async (file: File) => {
    try {
      setErrorMsg(null);
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const parsed = parseGlb(bytes);
      const analysis = analyzeVrm(parsed.json);

      // Default: Keep non-head meshes
      const defaultSelected = new Set<number>();
      for (const m of analysis.meshes) {
        if (!m.isHeadPartCandidate) {
          defaultSelected.add(m.nodeIndex);
        }
      }
      // If all meshes were marked as head candidates or none were marked, keep all
      if (defaultSelected.size === 0 && analysis.meshes.length > 0) {
        analysis.meshes.forEach(m => defaultSelected.add(m.nodeIndex));
      }

      setBodyModel({
        file,
        bytes,
        parsed,
        analysis,
        selectedMeshNodes: defaultSelected,
      });
    } catch (err: any) {
      setErrorMsg(`ベースモデルの読み込みに失敗しました: ${err.message}`);
    }
  }, []);

  // Head file load
  const handleHeadFile = useCallback(async (file: File) => {
    try {
      setErrorMsg(null);
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const parsed = parseGlb(bytes);
      const analysis = analyzeVrm(parsed.json);

      // Default: Import head meshes
      const defaultSelected = new Set<number>();
      for (const m of analysis.meshes) {
        if (m.isHeadPartCandidate) {
          defaultSelected.add(m.nodeIndex);
        }
      }
      // If none detected as head candidate, select all
      if (defaultSelected.size === 0 && analysis.meshes.length > 0) {
        analysis.meshes.forEach(m => defaultSelected.add(m.nodeIndex));
      }

      setHeadModel({
        file,
        bytes,
        parsed,
        analysis,
        selectedMeshNodes: defaultSelected,
      });
    } catch (err: any) {
      setErrorMsg(`頭部モデルの読み込みに失敗しました: ${err.message}`);
    }
  }, []);

  // Toggle mesh selection
  const handleToggleBodyMesh = useCallback((nodeIdx: number) => {
    setBodyModel(prev => {
      if (!prev) return null;
      const next = new Set(prev.selectedMeshNodes);
      if (next.has(nodeIdx)) next.delete(nodeIdx);
      else next.add(nodeIdx);
      return { ...prev, selectedMeshNodes: next };
    });
  }, []);

  const handleToggleHeadMesh = useCallback((nodeIdx: number) => {
    setHeadModel(prev => {
      if (!prev) return null;
      const next = new Set(prev.selectedMeshNodes);
      if (next.has(nodeIdx)) next.delete(nodeIdx);
      else next.add(nodeIdx);
      return { ...prev, selectedMeshNodes: next };
    });
  }, []);

  // Execute swap / merge
  const handleMerge = () => {
    if (!bodyModel || !headModel) return;

    try {
      setIsMerging(true);
      setErrorMsg(null);

      const mergedGlb = mergeVrm(bodyModel.parsed, headModel.parsed, {
        bodyMeshNodeIndices: Array.from(bodyModel.selectedMeshNodes),
        headMeshNodeIndices: Array.from(headModel.selectedMeshNodes),
        offsetY,
        offsetZ,
        flipRotationY,
      });

      const packed = packGlb(mergedGlb.json, mergedGlb.binaryChunk);
      setMergedGlbBytes(packed);

      const baseName = bodyModel.file.name.replace(/\.[^/.]+$/, '');
      const headName = headModel.file.name.replace(/\.[^/.]+$/, '');
      setMergedFileName(`${baseName}_head_swapped_${headName}.vrm`);

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err: any) {
      setErrorMsg(`合成処理中にエラーが発生しました: ${err.message}`);
    } finally {
      setIsMerging(false);
    }
  };

  // Download result
  const handleDownload = () => {
    if (!mergedGlbBytes) return;

    const blob = new Blob([mergedGlbBytes.buffer.slice(mergedGlbBytes.byteOffset, mergedGlbBytes.byteOffset + mergedGlbBytes.byteLength) as ArrayBuffer], {
      type: 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = mergedFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-title">
          <Sparkles className="header-icon" size={28} />
          <div>
            <h1>VRM Head Swapper</h1>
            <p className="subtitle">
              VRMアバターの「編集済み頭部」と「体」を手軽に入れ替えるWebツール
            </p>
          </div>
        </div>
      </header>

      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      <main className="main-content">
        {/* Step 1: Upload models */}
        <section className="slots-grid">
          <ModelUploadCard
            title="① ベースモデル（体）"
            badgeText="体・衣装を提供"
            badgeColor="#2563eb"
            description="頭部を差し替えたい元の体・衣装を持つVRMを指定します。"
            analysis={bodyModel?.analysis ?? null}
            fileBytes={bodyModel?.bytes ?? null}
            fileName={bodyModel?.file.name ?? null}
            selectedMeshNodes={bodyModel?.selectedMeshNodes ?? new Set()}
            onToggleMesh={handleToggleBodyMesh}
            onFileSelect={handleBodyFile}
            isHeadSlot={false}
          />

          <ModelUploadCard
            title="② 頭部モデル（頭）"
            badgeText="顔・髪・表情を提供"
            badgeColor="#9333ea"
            description="移植したい編集済みの顔・髪・表情を持つVRMを指定します。"
            analysis={headModel?.analysis ?? null}
            fileBytes={headModel?.bytes ?? null}
            fileName={headModel?.file.name ?? null}
            selectedMeshNodes={headModel?.selectedMeshNodes ?? new Set()}
            onToggleMesh={handleToggleHeadMesh}
            onFileSelect={handleHeadFile}
            isHeadSlot={true}
          />
        </section>

        {/* Step 2: Controls & Merge Action */}
        <section className="actions-section">
          <div className="adjust-panel">
            <div className="adjust-title">
              <SlidersHorizontal size={18} />
              <span>位置の微調整（必要な場合のみ）</span>
            </div>
            <div className="adjust-controls">
              <label>
                頭の高さ (Yオフセット): {offsetY.toFixed(3)}m
                <input
                  type="range"
                  min="-0.2"
                  max="0.2"
                  step="0.005"
                  value={offsetY}
                  onChange={e => setOffsetY(parseFloat(e.target.value))}
                />
              </label>
              <label>
                前後の位置 (Zオフセット): {offsetZ.toFixed(3)}m
                <input
                  type="range"
                  min="-0.2"
                  max="0.2"
                  step="0.005"
                  value={offsetZ}
                  onChange={e => setOffsetZ(parseFloat(e.target.value))}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={flipRotationY}
                  onChange={e => setFlipRotationY(e.target.checked)}
                />
                <span>頭の向きを前後反転（180°回転）</span>
              </label>

              {(offsetY !== 0 || offsetZ !== 0 || !flipRotationY) && (
                <button
                  type="button"
                  className="btn-reset"
                  onClick={() => {
                    setOffsetY(0);
                    setOffsetZ(0);
                    setFlipRotationY(true);
                  }}
                >
                  リセット
                </button>
              )}
            </div>
          </div>

          <div className="merge-btn-wrapper">
            <button
              type="button"
              className="btn-primary"
              disabled={!bodyModel || !headModel || isMerging}
              onClick={handleMerge}
            >
              {isMerging ? (
                <>
                  <RefreshCw className="spin" size={20} />
                  合成中...
                </>
              ) : (
                <>
                  <Sparkles size={20} />
                  頭部を入れ替えて合成する
                </>
              )}
            </button>
          </div>
        </section>

        {/* Step 3: Result Preview & Download */}
        {mergedGlbBytes && (
          <section className="result-section" ref={resultRef}>
            <div className="result-header">
              <div className="result-title-row">
                <h2>合成結果プレビュー</h2>
                <div className="expression-controls">
                  <Eye size={16} />
                  <span>表情テスト:</span>
                  <select
                    value={selectedExpression}
                    onChange={e => setSelectedExpression(e.target.value)}
                  >
                    <option value="neutral">ニュートラル (通常)</option>
                    <option value="happy">Happy (笑顔)</option>
                    <option value="blink">Blink (まばたき)</option>
                    <option value="aa">A (あ)</option>
                    <option value="ih">I (い)</option>
                    <option value="ou">U (う)</option>
                    <option value="ee">E (え)</option>
                    <option value="oh">O (お)</option>
                    <option value="angry">Angry (怒り)</option>
                    <option value="surprised">Surprised (驚き)</option>
                  </select>
                </div>
              </div>
              <p className="result-hint">
                ドラッグで回転、マウスホイールでズームが可能です。
              </p>
            </div>

            <div className="viewer-container">
              <VrmViewer
                glbData={mergedGlbBytes}
                height="500px"
                expressionTest={selectedExpression}
              />
            </div>

            <div className="download-wrapper">
              <button
                type="button"
                className="btn-download"
                onClick={handleDownload}
              >
                <Download size={20} />
                合成済みVRMファイルをダウンロード ({mergedFileName})
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
export default App;
