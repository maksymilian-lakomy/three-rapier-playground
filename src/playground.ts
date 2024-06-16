import { Pane } from 'tweakpane';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import RAPIER from '@dimforge/rapier3d-compat';
import Stats from 'stats.js';
import { Assets } from './assets.ts';
import { CONSTANTS } from './constants.ts';

export class Playground {
  public readonly onUpdate = new Set<(deltaTimeS: number) => void>();
  public readonly onPhysicsUpdate = new Set<
    (fixedDeltaTimeS: number) => void
  >();
  public readonly onResize = new Set<() => void>();

  public readonly container: HTMLElement;
  public readonly canvas: HTMLCanvasElement;

  public readonly pane: Pane;
  public readonly stats: Stats;

  public readonly freeRoamCamera: THREE.PerspectiveCamera;
  public readonly orbitControls: OrbitControls;

  public readonly scene: THREE.Scene;
  public readonly directionalLight: THREE.DirectionalLight;

  public readonly physicsWorld: RAPIER.World;

  public readonly renderer: THREE.WebGLRenderer;

  public get activeCamera(): THREE.PerspectiveCamera {
    return this._activeCamera;
  }

  public set activeCamera(camera: THREE.PerspectiveCamera) {
    this._activeCamera = camera;
  }

  private animationId: number | null = null;
  private startTimeMs: number | null = null;
  private elapsedTimeMs: number | null = null;
  private elapsedTickCounter: number | null = null;

  private _activeCamera: THREE.PerspectiveCamera;

  constructor(private readonly assets: Assets) {
    this.container = this.getContainer();
    this.pane = this.createPane();
    this.stats = this.createStats();
    this.container.appendChild(this.stats.dom);

    this._activeCamera = this.freeRoamCamera = this.createFreeRoamCamera();

    this.scene = this.createScene();
    this.physicsWorld = this.createPhysicsWorld();

    this.directionalLight = this.createDirectionalLight();

    this.scene.add(this.directionalLight);

    this.renderer = this.createRenderer();
    this.canvas = this.renderer.domElement;
    this.container.appendChild(this.canvas);

    this.orbitControls = this.createOrbitControls();

    this.animationId = requestAnimationFrame(this.updateLoop.bind(this));

    window.addEventListener('resize', this.onWindowResize.bind(this));

    document.addEventListener(
      'visibilitychange',
      this.onDocumentVisibilityChange.bind(this),
    );
  }

  public loadLevel(name: string): void {
    const gltf = this.assets.gltf.get(name);
    if (!gltf) return;

    const level = gltf.scene;

    level.traverse((it) => {
      if (it instanceof THREE.Mesh) {
        it.castShadow = true;
        it.receiveShadow = true;

        const positionAttributes = it.geometry.attributes['position'].array;
        const indexes = it.geometry.index?.array;

        if (!indexes || !positionAttributes) {
          console.warn(
            `Mesh "${it.name}" marked as a collider, but failed to retrieve position attributes or indices.`,
          );
          return;
        }

        const colliderDesc = RAPIER.ColliderDesc.trimesh(
          positionAttributes,
          new Uint32Array(indexes),
        );

        const object3DWorldPosition = it.getWorldPosition(new THREE.Vector3());
        colliderDesc.setTranslation(
          object3DWorldPosition.x,
          object3DWorldPosition.y,
          object3DWorldPosition.z,
        );
        colliderDesc.setRotation(it.quaternion);

        console.log('collider', colliderDesc);

        this.physicsWorld.createCollider(colliderDesc);
      }
    });

    this.scene.add(level);
  }

  private updateLoop(timeMs: number): void {
    this.stats.begin();

    if (this.startTimeMs === null) {
      this.startTimeMs = timeMs;
    }

    if (this.elapsedTickCounter === null) {
      this.elapsedTickCounter = 0;
    }

    const fixedDeltaTimeMs = (1 / CONSTANTS.PHYSICS_UPDATE_PER_SECOND) * 1000;

    const tickCounter = Math.ceil(
      (timeMs - this.startTimeMs) / fixedDeltaTimeMs,
    );

    for (let tick = this.elapsedTickCounter; tick < tickCounter; tick++) {
      this.physicsWorldUpdateLoop(fixedDeltaTimeMs);
    }

    if (this.elapsedTimeMs === null) {
      this.elapsedTimeMs = 0;
    }

    const deltaTimeMs = timeMs - this.elapsedTimeMs;
    this.sceneUpdateLoop(deltaTimeMs);

    this.stats.end();

    this.elapsedTickCounter = tickCounter;
    this.elapsedTimeMs = timeMs;
    this.animationId = requestAnimationFrame(this.updateLoop.bind(this));
  }

  private sceneUpdateLoop(deltaTimeMs: number): void {
    const deltaTimeS = deltaTimeMs / 1000;

    this.orbitControls.update();

    this.onUpdate.forEach((callback) => callback(deltaTimeS));

    this.renderer.render(this.scene, this.activeCamera);
  }

  private physicsWorldUpdateLoop(fixedDeltaTimeMs: number): void {
    const fixedDeltaTimeS = fixedDeltaTimeMs / 1000;

    this.onPhysicsUpdate.forEach((callback) => callback(fixedDeltaTimeS));

    this.physicsWorld.step();
  }

  private getContainer(): HTMLElement {
    const container = document.getElementById('container');

    if (!container)
      throw new Error('Could not get element with id: "container"!');

    return container;
  }

  private createPane(): Pane {
    return new Pane({ title: 'Playground - Debug' });
  }

  private createFreeRoamCamera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      1,
      100,
    );
    camera.position.set(0, 4, 10);
    camera.lookAt(0, 1, 0);

    return camera;
  }

  private createOrbitControls(): OrbitControls {
    const orbitControls = new OrbitControls(
      this.freeRoamCamera,
      this.renderer.domElement,
    );
    orbitControls.minDistance = 10;
    orbitControls.maxDistance = 75;
    orbitControls.enableDamping = true;

    return orbitControls;
  }

  private createScene(): THREE.Scene {
    const scene = new THREE.Scene();

    const hdrMap = this.assets.dataTexture.get('hdr')!;

    hdrMap.mapping = THREE.EquirectangularReflectionMapping;
    hdrMap.minFilter = THREE.LinearFilter;
    hdrMap.magFilter = THREE.LinearFilter;
    hdrMap.needsUpdate = true;

    scene.background = hdrMap;
    scene.backgroundBlurriness = 0.1;
    scene.environment = hdrMap;

    return scene;
  }

  private createPhysicsWorld(): RAPIER.World {
    const physicsWorld = new RAPIER.World({ x: 0, y: CONSTANTS.GRAVITY, z: 0 });
    physicsWorld.timestep = 1 / CONSTANTS.PHYSICS_UPDATE_PER_SECOND;

    return physicsWorld;
  }

  private createDirectionalLight(): THREE.DirectionalLight {
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

    return directionalLight;
  }

  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    return renderer;
  }

  private createStats(): Stats {
    return new Stats();
  }

  private onWindowResize(): void {
    this.onResize.forEach((callback) => callback.bind(this));
  }

  private onDocumentVisibilityChange(): void {
    if (document.hidden && this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
      this.startTimeMs = null;
      this.elapsedTimeMs = null;
      this.elapsedTickCounter = null;
      console.log('Update loop paused');
    } else {
      this.animationId = requestAnimationFrame(this.updateLoop.bind(this));
      console.log('Update loop resumed');
    }
  }
}
