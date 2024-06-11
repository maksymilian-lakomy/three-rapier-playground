import './style.css';

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import Stats from 'stats.js';
import { GLTFLoader, OrbitControls, RGBELoader } from 'three-stdlib';
import { Pane } from 'tweakpane';
import { GRAVITY_VECTOR } from './gravity.ts';

let container: HTMLElement;

let freeRoamCamera: THREE.PerspectiveCamera;
let orbitControls: OrbitControls;

let scene: THREE.Scene;
let physicsWorldDebug: THREE.Group;

let physicsWorld: RAPIER.World;
let renderer: THREE.WebGLRenderer;
let stats: Stats;

let directionalLightHelper: THREE.DirectionalLightHelper;

let pane: Pane;

const params = {
  directionalLightHelperVisible: false,
  rapierDebugVisible: false,
};

let animationId: number | null = null;

export const PHYSICS_UPDATE_PER_SECOND = 60;

type Playground = {
  pane: Pane;

  container: HTMLElement;
  canvas: HTMLCanvasElement;

  activeCamera: THREE.PerspectiveCamera;

  scene: THREE.Scene;
  physicsWorld: RAPIER.World;

  onUpdate: ((deltaTimeS: number) => void) | null;
  onPhysicsUpdate: ((deltaTimeS: number) => void) | null;
  onResize: (() => void) | null;
}

let playground: Playground;

export async function initPlayground(): Promise<Playground> {
  const hdrMap = await new RGBELoader().loadAsync('/industrial_sunset_puresky_2k.hdr');
  hdrMap.mapping = THREE.EquirectangularReflectionMapping;
  hdrMap.minFilter = THREE.LinearFilter;
  hdrMap.magFilter = THREE.LinearFilter;
  hdrMap.needsUpdate = true;

  container = (function() {
    const container = document.getElementById('container');

    if (!container) throw new Error('Could not get element with id: "container"!');

    return container;
  })();


  pane = new Pane({ title: 'Debug' });

  const rapierDebugVisibleBinding = pane.addBinding(params, 'rapierDebugVisible');
  rapierDebugVisibleBinding.on('change', () => physicsWorldDebug.visible = params.rapierDebugVisible);

  const directionalLightHelperVisibleBinding = pane.addBinding(params, 'directionalLightHelperVisible');
  directionalLightHelperVisibleBinding.on('change', () => directionalLightHelper.visible = params.directionalLightHelperVisible);

  freeRoamCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 100);
  freeRoamCamera.position.set(0, 4, 10);
  freeRoamCamera.lookAt(0, 1, 0);

  scene = new THREE.Scene();
  scene.background = hdrMap;
  scene.backgroundBlurriness = 0.1;
  scene.environment = hdrMap;

  physicsWorld = new RAPIER.World(GRAVITY_VECTOR);
  physicsWorld.timestep = 1 / PHYSICS_UPDATE_PER_SECOND;

  physicsWorldDebug = new THREE.Group();
  physicsWorldDebug.visible = params.rapierDebugVisible;
  scene.add(physicsWorldDebug);

  const level = (await new GLTFLoader().loadAsync('/level_1.glb')).scene;
  level.traverse(object3D => {
    if (object3D instanceof THREE.Mesh) {
      object3D.castShadow = true;
      object3D.receiveShadow = true;

      const positionAttributes = object3D.geometry.attributes['position'].array;
      const indexes = object3D.geometry.index?.array;

      if (!indexes || !positionAttributes) {
        console.warn(`Mesh "${object3D.name}" marked as a collider, but failed to retrieve position attributes or indices.`);
        return;
      }

      const colliderDesc = RAPIER.ColliderDesc.trimesh(
        positionAttributes,
        new Uint32Array(indexes),
      );

      const object3DWorldPosition = object3D.getWorldPosition(new THREE.Vector3());
      colliderDesc.setTranslation(object3DWorldPosition.x, object3DWorldPosition.y, object3DWorldPosition.z);
      colliderDesc.setRotation(object3D.quaternion);

      physicsWorld.createCollider(colliderDesc);
    }
  });

  scene.add(level);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(10, 10, 10);
  directionalLight.castShadow = true;
  directionalLight.shadow.camera.top = 128;
  directionalLight.shadow.camera.bottom = -128;
  directionalLight.shadow.camera.left = -128;
  directionalLight.shadow.camera.right = 128;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 1000;

  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;

  scene.add(directionalLight);

  directionalLightHelper = new THREE.DirectionalLightHelper(directionalLight);
  directionalLightHelper.visible = params.directionalLightHelperVisible;
  scene.add(directionalLightHelper);

  const axesHelper = new THREE.AxesHelper(2);
  scene.add(axesHelper);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  container.appendChild(renderer.domElement);

  orbitControls = new OrbitControls(freeRoamCamera, renderer.domElement);
  orbitControls.minDistance = 10;
  orbitControls.maxDistance = 75;
  orbitControls.enableDamping = true;

  stats = new Stats();
  container.appendChild(stats.dom);

  window.addEventListener('resize', onWindowResize);
  document.addEventListener('visibilitychange', onDocumentVisibilityChange);

  animationId = requestAnimationFrame(animate);

  playground = {
    pane,
    container,
    canvas: renderer.domElement,
    activeCamera: freeRoamCamera,
    scene,
    physicsWorld,
    onUpdate: null,
    onPhysicsUpdate: null,
    onResize: null,
  };

  return playground;
}

let startTimeMs: number | null = null;
let elapsedTimeMs: number | null = null;
let elapsedTickCounter: number = 0;

function animate(timeMs: number): void {
  stats.begin();

  if (startTimeMs === null) {
    startTimeMs = timeMs;
  }

  const tickCounter = Math.ceil(
    (timeMs - startTimeMs) / (1 / PHYSICS_UPDATE_PER_SECOND * 1000),
  );

  for (let tick = elapsedTickCounter; tick < tickCounter; tick++) {
    updateRapier();
  }

  const deltaTimeMs = elapsedTimeMs !== null ? timeMs - elapsedTimeMs : 0;
  updateThree(deltaTimeMs);

  stats.end();

  elapsedTickCounter = tickCounter;
  elapsedTimeMs = timeMs;
  animationId = requestAnimationFrame(animate);
}

let debugLineSegments: THREE.LineSegments;

function updateRapier(): void {
  physicsWorld.step();

  if (playground.onPhysicsUpdate) {
    playground.onPhysicsUpdate(1 / PHYSICS_UPDATE_PER_SECOND);
  }

  if (!debugLineSegments) {
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
    });

    const geometry = new THREE.BufferGeometry();

    debugLineSegments = new THREE.LineSegments(geometry, material);
    physicsWorldDebug.add(debugLineSegments);
  }

  const { vertices, colors } = physicsWorld.debugRender();

  debugLineSegments.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  debugLineSegments.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
}

function updateThree(deltaTimeMs: number): void {
  orbitControls.update();

  if (playground.onUpdate) {
    playground.onUpdate(deltaTimeMs / 1000);
  }

  renderer.render(scene, playground.activeCamera);
}

function clearAnimationAndTimings(): void {
  animationId = null;
  startTimeMs = null;
  elapsedTimeMs = null;
  elapsedTickCounter = 0;
}

function onDocumentVisibilityChange(): void {
  if (document.hidden && animationId !== null) {
    cancelAnimationFrame(animationId);
    clearAnimationAndTimings();
    console.log('Animation paused');
  } else {
    animationId = requestAnimationFrame(animate);
    console.log('Animation resumed');
  }
}

function onWindowResize(): void {
  freeRoamCamera.aspect = window.innerWidth / window.innerHeight;
  freeRoamCamera.updateProjectionMatrix();

  if (playground.onResize) {
    playground.onResize();
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
}