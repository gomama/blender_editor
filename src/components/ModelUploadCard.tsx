import React, { useRef } from 'react';
import { Upload, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { VrmModelAnalysis } from '../utils/vrmAnalyzer';
import { VrmViewer } from './VrmViewer';

interface ModelUploadCardProps {
  title: string;
  badgeText: string;
  badgeColor: string;
  description: string;
  analysis: VrmModelAnalysis | null;
  fileBytes: Uint8Array | null;
  fileName: string | null;
  selectedMeshNodes: Set<number>;
  onToggleMesh: (nodeIndex: number) => void;
  onFileSelect: (file: File) => void;
  isHeadSlot?: boolean;
}

export const ModelUploadCard: React.FC<ModelUploadCardProps> = ({
  title,
  badgeText,
  badgeColor,
  description,
  analysis,
  fileBytes,
  fileName,
  selectedMeshNodes,
  onToggleMesh,
  onFileSelect,
  isHeadSlot,
}) => {
  const [showMeshes, setShowMeshes] = React.useState(true);
  const [showPreview, setShowPreview] = React.useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-row">
          <h3>{title}</h3>
          <span className="badge" style={{ backgroundColor: badgeColor }}>
            {badgeText}
          </span>
        </div>
        <p className="card-desc">{description}</p>
      </div>

      <div
        className={`dropzone ${fileBytes ? 'loaded' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".vrm,.glb"
          style={{ display: 'none' }}
          onChange={e => {
            if (e.target.files && e.target.files[0]) {
              onFileSelect(e.target.files[0]);
            }
          }}
        />

        {fileBytes && analysis ? (
          <div className="loaded-info">
            <CheckCircle2 className="icon-success" size={28} />
            <div>
              <div className="file-name">{fileName}</div>
              <div className="model-meta">
                <span>{analysis.title}</span>
                {analysis.author && <span> / {analysis.author}</span>}
                <span className="vrm-version-tag">
                  {analysis.isVrm1 ? 'VRM 1.0' : analysis.isVrm0 ? 'VRM 0.x' : 'glTF'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-info">
            <Upload className="icon-upload" size={32} />
            <div>VRMファイルをドラッグ＆ドロップ</div>
            <div className="sub-text">またはクリックしてファイルを選択</div>
          </div>
        )}
      </div>

      {fileBytes && analysis && (
        <div className="card-details">
          <div className="detail-toggles">
            <button
              type="button"
              className="btn-toggle"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? '3Dプレビューを閉じる' : '3Dプレビューを表示'}
            </button>
            <button
              type="button"
              className="btn-toggle"
              onClick={() => setShowMeshes(!showMeshes)}
            >
              パーツ選択 ({selectedMeshNodes.size}/{analysis.meshes.length})
              {showMeshes ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>

          {showPreview && (
            <div className="mini-viewer">
              <VrmViewer glbData={fileBytes} height="220px" />
            </div>
          )}

          {showMeshes && (
            <div className="mesh-list">
              <div className="mesh-list-desc">
                {isHeadSlot
                  ? 'チェックを付けたメッシュが移植されます（顔・髪パーツ推奨）'
                  : 'チェックを付けたメッシュが残ります（体・服パーツ推奨）'}
              </div>
              {analysis.meshes.map(mesh => (
                <label key={mesh.nodeIndex} className="mesh-item">
                  <input
                    type="checkbox"
                    checked={selectedMeshNodes.has(mesh.nodeIndex)}
                    onChange={() => onToggleMesh(mesh.nodeIndex)}
                  />
                  <span className="mesh-name">{mesh.name}</span>
                  {mesh.isHeadPartCandidate && (
                    <span className="tag-head">頭部候補</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
