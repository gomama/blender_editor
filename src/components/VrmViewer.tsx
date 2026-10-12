import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm';

interface VrmViewerProps {
  glbData: Uint8Array | null;
  height?: string;
  expressionTest?: string;
}

export const VrmViewer: React.FC<VrmViewerProps> = ({
  glbData,
  height = '420px',
  expressionTest,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const vrmRef = useRef<VRM | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e2029);

    // Grid helper
    const gridHelper = new THREE.GridHelper(10, 20, 0x444455, 0x2a2b36);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    // Lighting
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(1.0, 2.0, 1.5).normalize();
    scene.add(directionalLight);

    const backLight = new THREE.DirectionalLight(0x8899bb, 0.6);
    backLight.position.set(-1.0, 1.5, -1.0).normalize();
    scene.add(backLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    // Camera
    const camera = new THREE.PerspectiveCamera(
      35,
      container.clientWidth / container.clientHeight,
      0.1,
      20.0
    );
    camera.position.set(0.0, 1.3, 1.8);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    // Simple orbit controls logic
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    const cameraTarget = new THREE.Vector3(0, 1.2, 0);
    let cameraRadius = 1.6;
    let cameraTheta = 0; // horizontal angle
    let cameraPhi = 0.2; // vertical angle

    const updateCamera = () => {
      camera.position.x =
        cameraTarget.x +
        cameraRadius * Math.sin(cameraTheta) * Math.cos(cameraPhi);
      camera.position.y =
        cameraTarget.y + cameraRadius * Math.sin(cameraPhi);
      camera.position.z =
        cameraTarget.z +
        cameraRadius * Math.cos(cameraTheta) * Math.cos(cameraPhi);
      camera.lookAt(cameraTarget);
    };
    updateCamera();

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      cameraTheta -= deltaX * 0.01;
      cameraPhi = Math.max(-0.6, Math.min(1.2, cameraPhi + deltaY * 0.01));

      previousMousePosition = { x: e.clientX, y: e.clientY };
      updateCamera();
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraRadius = Math.max(0.5, Math.min(4.0, cameraRadius + e.deltaY * 0.002));
      updateCamera();
    };

    const dom = renderer.domElement;
    dom.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    // Handle Resize
    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // Load VRM if buffer is provided
    let isCancelled = false;
    if (glbData && glbData.byteLength > 0) {
      setIsLoading(true);
      setErrorMessage(null);
      const loader = new GLTFLoader();
      loader.register(parser => new VRMLoaderPlugin(parser));

      // Create a blob URL from Uint8Array to avoid SharedArrayBuffer issues
      const blob = new Blob([glbData.buffer.slice(glbData.byteOffset, glbData.byteOffset + glbData.byteLength) as ArrayBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      loader.load(
        url,
        gltf => {
          if (isCancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          setIsLoading(false);
          const vrm = gltf.userData.vrm as VRM;
          if (vrm) {
            vrmRef.current = vrm;
            scene.add(vrm.scene);
            vrm.scene.rotation.y = Math.PI;
          } else {
            scene.add(gltf.scene);
            gltf.scene.rotation.y = Math.PI;
          }

          // Calculate bounding box to ensure model is visible
          const rootObj = vrm?.scene || gltf.scene;
          const bbox = new THREE.Box3().setFromObject(rootObj);
          if (!bbox.isEmpty()) {
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            const size = new THREE.Vector3();
            bbox.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);

            // Focus on upper half (head/chest area)
            cameraTarget.set(center.x, center.y + size.y * 0.2, center.z);
            cameraRadius = Math.max(0.8, maxDim * 0.85);
            updateCamera();
          }
          URL.revokeObjectURL(url);
        },
        undefined,
        error => {
          setIsLoading(false);
          const msg = error instanceof Error ? error.message : String(error);
          setErrorMessage(`3Dプレビューの描画に失敗しました: ${msg}`);
          console.warn('VRM load warning:', error);
          URL.revokeObjectURL(url);
        }
      );
    }

    // Render loop
    const clock = new THREE.Clock();
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      if (vrmRef.current) {
        vrmRef.current.update(delta);
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      isCancelled = true;
      cancelAnimationFrame(animId);
      dom.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [glbData]);

  // Handle expression testing
  useEffect(() => {
    const vrm = vrmRef.current;
    if (!vrm || !vrm.expressionManager) return;

    // Reset common expressions
    const exprs = ['happy', 'blink', 'aa', 'ih', 'ou', 'ee', 'oh', 'surprised', 'angry', 'relaxed'];
    for (const exp of exprs) {
      vrm.expressionManager.setValue(exp, 0);
    }

    if (expressionTest && expressionTest !== 'neutral') {
      vrm.expressionManager.setValue(expressionTest, 1.0);
    }
  }, [expressionTest]);

  return (
    <div
      style={{
        width: '100%',
        height,
        position: 'relative',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <div
        ref={mountRef}
        style={{
          width: '100%',
          height: '100%',
          cursor: 'grab',
        }}
      />
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(15, 17, 23, 0.7)',
            color: '#93c5fd',
            fontSize: '14px',
            pointerEvents: 'none',
          }}
        >
          3Dプレビューを生成中...
        </div>
      )}
      {errorMessage && (
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            right: '12px',
            backgroundColor: 'rgba(239, 68, 68, 0.9)',
            color: '#ffffff',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
          }}
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
};
