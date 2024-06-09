import './style.css'

import * as THREE from 'three';
import RAPIER from "@dimforge/rapier3d-compat";
import Stats from 'stats.js';
import {GLTFLoader, OrbitControls, RGBELoader} from "three-stdlib";
import {Pane} from "tweakpane";

let container: HTMLElement;

let freeRoamCamera: THREE.PerspectiveCamera;
let orbitControls: OrbitControls;

let scene: THREE.Scene;
let physicsWorldDebug: THREE.Group;

let physicsWorld: RAPIER.World;
let renderer: THREE.WebGLRenderer;
let stats: Stats;

let pane: Pane;

let animationId: number | null = null;

const GRAVITY_VECTOR = new THREE.Vector3(0, -9.81, 0);
const PHYSICS_UPDATE_PER_SECOND = 60;

init();

async function init(): Promise<void> {
    await RAPIER.init();

    const hdrMap = await new RGBELoader().loadAsync('/industrial_sunset_puresky_2k.hdr');
    hdrMap.mapping = THREE.EquirectangularReflectionMapping;
    hdrMap.minFilter = THREE.LinearFilter;
    hdrMap.magFilter = THREE.LinearFilter;
    hdrMap.needsUpdate = true;

    container = (function () {
        const container = document.getElementById("container");

        if (!container) throw new Error('Could not get element with id: "container"!');

        return container;
    })()


    pane = new Pane({title: 'Debug'});

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
    scene.add(physicsWorldDebug);

    const level = (await new GLTFLoader().loadAsync('/level_1.glb')).scene;
    level.traverse(object3D => {
        if (object3D instanceof THREE.Mesh) {

            const positionAttributes = object3D.geometry.attributes['position'].array;
            const indexes = object3D.geometry.index?.array;

            if (!indexes || !positionAttributes) {
                console.warn(`Mesh "${object3D.name}" marked as a collider, but failed to retrieve position attributes or indices.`);
                return;
            }

            const colliderDesc = RAPIER.ColliderDesc.trimesh(
                positionAttributes,
                new Uint32Array(indexes)
            );

            const object3DWorldPosition = object3D.getWorldPosition(new THREE.Vector3());
            colliderDesc.setTranslation(object3DWorldPosition.x, object3DWorldPosition.y, object3DWorldPosition.z)
            colliderDesc.setRotation(object3D.quaternion);

            physicsWorld.createCollider(colliderDesc);
        }
    })

    scene.add(level);

    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    container.appendChild(renderer.domElement);

    orbitControls = new OrbitControls(freeRoamCamera, renderer.domElement);
    orbitControls.enableDamping = true;

    stats = new Stats();
    container.appendChild(stats.dom);

    window.addEventListener('resize', onWindowResize);
    document.addEventListener('visibilitychange', onDocumentVisibilityChange);

    animationId = requestAnimationFrame(animate);
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
        (timeMs - startTimeMs) / (1 / PHYSICS_UPDATE_PER_SECOND * 1000)
    )

    for (let tick = elapsedTickCounter; tick < tickCounter; tick++) {
        animateRapier();
    }

    const deltaTimeMs = elapsedTimeMs !== null ? timeMs - elapsedTimeMs : 0;
    animateThree(deltaTimeMs);

    stats.end();

    elapsedTickCounter = tickCounter;
    elapsedTimeMs = timeMs;
    animationId = requestAnimationFrame(animate);
}

let debugLineGeometries: THREE.BufferGeometry[] = [];

function animateRapier(): void {
    physicsWorld.step();

    // THIS DEBUG CAN BECOME VERY SLOW ON LARGE MESHES
    physicsWorldDebug.clear();

    let debugLineMaterials = [];

    debugLineGeometries.forEach(it => it.dispose());
    debugLineGeometries = [];

    const {vertices, colors} = physicsWorld.debugRender();

    for (let i = 0; i < colors.length / 8; i += 1) {
        debugLineMaterials.push(getLineMaterial(
            colors[(i * 8)],
            colors[(i * 8) + 1],
            colors[(i * 8) + 2]
        ));
    }

    for (let i = 0; i < vertices.length / 6; i += 1) {
        const points = [
            new THREE.Vector3(vertices[i * 6], vertices[(i * 6) + 1], vertices[(i * 6) + 2]),
            new THREE.Vector3(vertices[(i * 6) + 3], vertices[(i * 6) + 4], vertices[(i * 6) + 5])
        ];

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        debugLineGeometries.push(geometry);

        const line = new THREE.Line(geometry, debugLineMaterials[i]);

        physicsWorldDebug.add(line);
    }
}

const cachedLineMaterials = new Map<string, THREE.LineBasicMaterial>();

function getLineMaterial(r: number, g: number, b: number): THREE.LineBasicMaterial {
    const colorRepresentation = {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };

    const cacheKey = `${colorRepresentation.r}-${colorRepresentation.g}-${colorRepresentation.b}`;

    let material = cachedLineMaterials.get(cacheKey);

    if (!material) {
        material = new THREE.LineBasicMaterial({
            color: new THREE.Color(
                colorRepresentation.r, colorRepresentation.g, colorRepresentation.b
            )
        });

        cachedLineMaterials.set(cacheKey, material);
    }


    return material;
}

function animateThree(_: number): void {
    orbitControls.update();
    renderer.render(scene, freeRoamCamera);
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

    renderer.setSize(window.innerWidth, window.innerHeight);
}


