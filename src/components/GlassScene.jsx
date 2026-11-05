import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Real, locally lit glass geometry; no models or textures are fetched. */
export default function GlassScene({ className = '' }) {
  const container = useRef(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const host = container.current;
    if (!host) return undefined;
    // React's development StrictMode probes effects twice. Defer expensive GPU
    // initialization so the probe is cancelled before allocating a context.
    const initialize = () => {
      let renderer;
      let environment;
      let environmentScene;
      let pmrem;
      const canvas = document.createElement('canvas');
      try {
        const context = canvas.getContext('webgl2', {
          alpha: true,
          antialias: true,
          powerPreference: 'low-power',
          failIfMajorPerformanceCaveat: false,
        });
        if (!context) {
          setFallback(true);
          return undefined;
        }
        renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
        renderer.transmissionResolutionScale = 0.5;
        renderer.setClearColor(0x000000, 0);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.35;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        canvas.style.cssText = 'width:100%;height:100%;display:block;pointer-events:none;';
        canvas.setAttribute('aria-hidden', 'true');
        host.appendChild(canvas);
        pmrem = new THREE.PMREMGenerator(renderer);
        environmentScene = new RoomEnvironment();
        environment = pmrem.fromScene(environmentScene, 0.04, 0.1, 100, { size: 128 });
      } catch {
        renderer?.dispose();
        canvas.remove();
        environment?.dispose();
        environmentScene?.dispose();
        pmrem?.dispose();
        setFallback(true);
        return undefined;
      }

      const scene = new THREE.Scene();
      scene.environment = environment.texture;
      const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 40);
      camera.position.set(0, 0, 8);
      const world = new THREE.Group();
      scene.add(world);

      scene.add(new THREE.AmbientLight(0xa5fff1, 2.3));
      const key = new THREE.DirectionalLight(0xe1fff7, 4.5);
      key.position.set(-3, 5, 6);
      scene.add(key);
      const rim = new THREE.PointLight(0x4effd8, 48, 18);
      rim.position.set(4, 2, 3);
      scene.add(rim);
      const blue = new THREE.PointLight(0x89c8ff, 25, 16);
      blue.position.set(-3, -2, 2);
      scene.add(blue);

      const glass = new THREE.MeshPhysicalMaterial({
        color: 0x8af8db,
        metalness: 0.06,
        roughness: 0.075,
        transmission: 0.96,
        thickness: 1.05,
        ior: 1.46,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMapIntensity: 1.8,
        transparent: true,
        opacity: 0.94,
        attenuationColor: new THREE.Color(0x32bd9c),
        attenuationDistance: 2.2,
      });
      const pearl = new THREE.MeshPhysicalMaterial({
        color: 0xc8fff0,
        roughness: 0.12,
        metalness: 0.28,
        transmission: 0.5,
        thickness: 0.35,
        ior: 1.45,
        clearcoat: 1,
        envMapIntensity: 1.8,
        transparent: true,
        opacity: 0.9,
      });
      const thinGlass = new THREE.MeshPhysicalMaterial({
        color: 0x8cddce,
        metalness: 0.18,
        roughness: 0.15,
        transmission: 0.75,
        thickness: 0.4,
        ior: 1.4,
        clearcoat: 1,
        envMapIntensity: 1.8,
        transparent: true,
        opacity: 0.66,
      });

      const shape = new THREE.Shape();
      const arm = 0.27;
      const reach = 0.8;
      [
        [-arm, reach], [arm, reach], [arm, arm], [reach, arm],
        [reach, -arm], [arm, -arm], [arm, -reach], [-arm, -reach],
        [-arm, -arm], [-reach, -arm], [-reach, arm], [-arm, arm],
      ].forEach(([x, y], index) => (index ? shape.lineTo(x, y) : shape.moveTo(x, y)));
      shape.closePath();
      const plusGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.37,
        bevelEnabled: true,
        bevelThickness: 0.105,
        bevelSize: 0.1,
        bevelSegments: 6,
        steps: 1,
        curveSegments: 12,
      });
      plusGeometry.center();
      const plus = new THREE.Mesh(plusGeometry, glass);
      plus.position.set(1.55, 1.48, -0.45);
      plus.rotation.set(0.15, -0.35, -0.19);
      world.add(plus);

      const orbit = new THREE.Group();
      orbit.position.set(-0.05, -0.28, -0.25);
      orbit.rotation.set(0.5, -0.35, -0.48);
      const outerRing = new THREE.Mesh(new THREE.TorusGeometry(2.28, 0.035, 10, 100), thinGlass);
      outerRing.scale.y = 0.64;
      orbit.add(outerRing);
      const innerRing = new THREE.Mesh(new THREE.TorusGeometry(2.02, 0.012, 8, 96), pearl);
      innerRing.scale.y = 0.64;
      innerRing.rotation.z = 0.025;
      innerRing.position.z = 0.06;
      orbit.add(innerRing);
      world.add(orbit);

      const ballGeometry = new THREE.SphereGeometry(1, 28, 20);
      const spherePositions = [
        [-1.9, 1.65, 0.3, 0.23],
        [-2.1, -1.62, 0.25, 0.34],
        [1.97, -0.88, 0.9, 0.18],
        [0.18, 2.22, -1.1, 0.1],
        [2.32, 0.4, -0.3, 0.07],
      ];
      const spheres = spherePositions.map(([x, y, z, scale], index) => {
        const ball = new THREE.Mesh(ballGeometry, index % 2 ? glass : pearl);
        ball.position.set(x, y, z);
        ball.scale.setScalar(scale);
        world.add(ball);
        return { mesh: ball, y, phase: index * 1.7 };
      });

      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      let reducedMotion = media.matches;
      let visible = true;
      let frame = 0;
      let lastFrame = -Infinity;
      let lastWidth = 0;
      let lastHeight = 0;
      const pointer = { x: 0, y: 0 };
      const render = () => renderer.render(scene, camera);
      const resize = () => {
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        if (width === lastWidth && height === lastHeight) return;
        lastWidth = width;
        lastHeight = height;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        // Keep the whole orbit visible in tall mobile compositions.
        world.scale.setScalar(Math.min(1, Math.max(0.65, width / height)));
        render();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();

      const onPointer = (event) => {
        if (reducedMotion || event.pointerType === 'touch') return;
        const bounds = host.getBoundingClientRect();
        pointer.x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
        pointer.y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
      };
      window.addEventListener('pointermove', onPointer, { passive: true });

      const tick = (now) => {
        if (media.matches) {
          frame = 0;
          return;
        }
        frame = requestAnimationFrame(tick);
        if (!visible || document.hidden) return;
        // Gentle floating geometry does not need to saturate a 60/120 Hz GPU.
        if (now - lastFrame < 1000 / 30) return;
        lastFrame = now;
        const seconds = now * 0.001;
        world.rotation.y += (pointer.x * 0.1 - world.rotation.y) * 0.035;
        world.rotation.x += (pointer.y * 0.06 - world.rotation.x) * 0.035;
        plus.position.y = 1.48 + Math.sin(seconds * 0.65) * 0.12;
        plus.rotation.y = -0.35 + Math.sin(seconds * 0.32) * 0.25;
        plus.rotation.z = -0.19 + Math.sin(seconds * 0.4) * 0.07;
        orbit.rotation.z = -0.48 + Math.sin(seconds * 0.2) * 0.08;
        spheres.forEach(({ mesh, y, phase }) => {
          mesh.position.y = y + Math.sin(seconds * 0.6 + phase) * 0.12;
        });
        render();
      };
      const start = () => {
        if (!frame && !reducedMotion && visible && !document.hidden) frame = requestAnimationFrame(tick);
      };
      const stop = () => {
        cancelAnimationFrame(frame);
        frame = 0;
      };
      const onMotionChange = () => {
        reducedMotion = media.matches;
        if (reducedMotion) {
          stop();
          world.rotation.set(0, 0, 0);
          render();
        } else start();
      };
      media.addEventListener('change', onMotionChange);
      const onVisibility = () => {
        if (document.hidden) stop();
        else start();
      };
      document.addEventListener('visibilitychange', onVisibility);
      const intersection = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
        else stop();
      }, { rootMargin: '100px' });
      intersection.observe(host);
      start();

      return () => {
        stop();
        observer.disconnect();
        intersection.disconnect();
        media.removeEventListener('change', onMotionChange);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pointermove', onPointer);
        const geometries = new Set();
        const materials = new Set();
        scene.traverse((object) => {
          if (object.geometry) geometries.add(object.geometry);
          if (object.material) {
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
          }
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        environment.dispose();
        environmentScene.dispose();
        pmrem.dispose();
        renderer.dispose();
        canvas.remove();
      };
    };
    let cleanup;
    const initializationTimer = window.setTimeout(() => { cleanup = initialize(); }, 0);
    return () => {
      window.clearTimeout(initializationTimer);
      cleanup?.();
    };
  }, []);

  return (
    <div
      ref={container}
      className={`glass-scene ${className}`}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {fallback && (
        <div style={{ position: 'absolute', width: '65%', aspectRatio: '1', left: '16%', top: '20%', border: '1px solid rgba(166,255,229,.35)', borderRadius: '50%', transform: 'rotate(-25deg) scaleY(.65)', boxShadow: 'inset 0 0 30px rgba(137,255,224,.1), 0 0 30px rgba(137,255,224,.08)' }} />
      )}
    </div>
  );
}
