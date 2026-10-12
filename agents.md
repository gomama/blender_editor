# VRM Head Swapper & Optimizer - Agent / Developer Guide (agents.md)

このドキュメントは、本リポジトリ（`blender_editor` / VRM Head Swapper）の設計思想、アーキテクチャ、実装詳細、および開発・検証ルールをまとめたエージェント／開発者向けガイドです。

---

## 1. プロジェクト概要

Webブラウザ上で2つのVRMモデル（VRM 0.x / 1.0）を読み込み、**「編集済みの頭部（顔・目・表情・髪）」と「別モデルの衣装・体」を破綻なく合体・最適化してエクスポート**できるWebアプリケーションです。

Blender等の重厚なDCCツールを使わずに、ブラウザ上で直感的に頭部と体をスワップし、UniVRM（Unity）やVRMビューアでエラーなく動作するクリーンなVRMを出力します。

---

## 2. コア・アーキテクチャと設計思想

### 2.1 Head-Preserving（頭部完全温存）アーキテクチャ
VRMモデルにおいて、頭部（特に目線制御、MToonシェーダーテクスチャ、BlendShape/モーフ、表情設定、揺れ髪ボーン）は非常に繊細です。
従来の「体モデルに頭を切り貼りする」方式では、表情のバインド壊れやマテリアルプロパティ消失が発生しやすくなります。

本アプリでは**「Headモデルをベース（土台）とし、Headの体メッシュを脱がせてBodyの衣装を着せる」逆転の発想**を採用しています。
- **Headモデル側**: メタデータ、Humanoid骨格、表情（BlendShapeMaster）、視点（FirstPerson）、目のテクスチャ、髪の揺れ骨などを100%保持。
- **Bodyモデル側**: 衣装・体メッシュ、および衣装専用のボーン（スカートの揺れ骨など）のみを抽出し、Head側に統合。

### 2.2 ボーン二重化防止と服ボーンのドッキング
- **Humanoidボーンの共有**: Hips, Spine, 手足などの基本HumanoidボーンはBody側から複製せず、Head側の対応ボーンにスキニング（`skin.joints`）を再接続します。これによりボーンの二重化を防ぎます。
- **服専用ボーン（揺れ骨）の抽出**: スカートやリボン等の服専用ボーンはBodyからコピーし、Head側の最も近い親ボーン（例: Hips）の子ノードとしてドッキングします。
- **SpringBone / コライダーの統合**: Body側の揺れ骨（`secondaryAnimation`）とコライダーをHead側にマージし、Unity（UniVRM）で発生しやすい `IndexOutOfRangeException` を完全に防ぐインデックスオフセット変換を行います。

### 2.3 最適化＆ガベージコレクション (`glbPruner.ts`)
切り貼り合成を行うと、元のHeadの体バイナリや元のBodyの頭部バイナリがGLBバッファ（BINチャンク）に残存し、ファイルサイズが2倍近くに肥大化します。
本システムでは、エクスポート直前に**依存グラフ解析によるガベージコレクション**を実行します：
1. シーン、スキン、Humanoid、VRMマテリアル、SpringBoneから実際に参照されているノード・メッシュ・マテリアル・テクスチャ・アクセサー・バッファビューを抽出。
2. 未使用のリソースを完全に削除。
3. バイナリバッファ（BINチャンク）を最小サイズに詰めて再パッキング（メモリ配置アラインメント対応）。
これにより、Blenderを通さずとも**最小ファイルサイズ（約半分）** で出力されます。

---

## 3. 主要ファイル構成

```
src/
├── components/
│   ├── ModelUploadCard.tsx   # VRMファイル読み込み・解析状態表示カード
│   └── VrmViewer.tsx         # Three.js + @pixiv/three-vrm による3Dプレビュー画面
├── utils/
│   ├── glb.ts                # GLBバイナリ解析（JSON / BIN分離）およびパック処理
│   ├── glbPruner.ts          # 未使用リソース除去・バイナリ再パッキング（サイズ半減化）
│   ├── vrmAnalyzer.ts        # VRM 0.x/1.0 メタデータ解析・ボーン検出・パーツ判定
│   └── vrmMerger.ts          # Head-Preserving合成エンジン（メッシュ・ボーン・物理マージ）
├── App.tsx                   # メインGUIコンポーネント
└── index.css                 # スタイリング（Tailwind互換CSS）
```

---

## 4. 開発・検証ルール

コードの変更を行った際は、以下のコマンドを順次実行してすべてのチェックがパスすることを確認してください：

1. **Linter チェック**
   ```bash
   npm run lint
   ```
2. **ユニットテスト（単体テスト）**
   ```bash
   npm test
   ```
   - `src/utils/glb.test.ts`: GLBパースおよびアラインメント検証
   - `src/utils/glbPruner.test.ts`: 未使用リソースのパージ・バッファ圧縮検証
   - `src/utils/vrmAnalyzer.test.ts`: パーツ判定およびボーン検出検証
   - `src/utils/vrmMerger.test.ts`: Head温存合成、服ボーンマージ、テクスチャ維持検証
3. **TypeScript 型チェック & 本番ビルド**
   ```bash
   npm run build
   ```

---

## 5. 既知の対応ポイント・注意点

- **VRM 0.x / 1.0 の互換性**:
  - `extensions.VRM` (0.x) と `extensions.VRMC_vrm` (1.0) の両方に対応しています。
  - テクスチャ参照（MToon 0.x の `materialProperties.textureProperties` と MToon 1.0 の `extensions.VRMC_materials_mtoon`）はプルーナーで漏れなく追跡する必要があります。
- **Unity (UniVRM) 互換性**:
  - `secondaryAnimation.colliderGroups` のインデックス参照不整合、および無効な `meshAnnotations` / `blendShapeMaster` バインドインデックスは Unity 側でロードエラーとなるため、`vrmMerger.ts` 内で常にサニタイズ処理を実施しています。

---

## 6. ホスティング & デプロイ環境（Cloudflare Workers）

本アプリケーションは、**Cloudflare Workers（Workers Static Assets）** を使用して世界中へ高速・無料配信されています。

### 6.1 デプロイ構成
- **構成**: Workers Static Assets（SPA配信モード）
- **設定ファイル**: [`wrangler.toml`](file:///home/gomama/project/blender_editor/wrangler.toml)
  ```toml
  name = "blender-editor"
  compatibility_date = "2026-04-01"

  [assets]
  directory = "./dist"
  html_handling = "auto-trailing-slash"
  not_found_handling = "single-page-application"
  ```
- **注意点**: 静的アセット専用Workerでは `binding = "ASSETS"` を指定するとエラーになるため設定不要。

### 6.2 デプロイコマンド
コードを修正した後は、以下のコマンドでビルドからCloudflareへのデプロイまでが一括実行されます：
```bash
npm run deploy
```

### 6.3 独自ドメイン連携
Cloudflare Workers の「Custom Domains」機能により、独自ドメイン（`majigomama.com` 配下のサブドメインなど）が無料SSL（HTTPS）対応でバインドされています。
