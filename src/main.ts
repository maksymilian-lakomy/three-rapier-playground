import './style.css'

import * as THREE from 'three';
import RAPIER from "@dimforge/rapier3d-compat";
import Stats from 'stats.js';
import {OrbitControls, RGBELoader} from "three-stdlib";

let freeRoamCamera: THREE.PerspectiveCamera;
let orbitControls: OrbitControls;

let scene: THREE.Scene;
let physicsWorld: RAPIER.World;
let renderer: THREE.WebGLRenderer;
let stats: Stats;

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

    const container = document.getElementById("container");

    if (!container) throw new Error('Could not get element with id: "container"!');

    freeRoamCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 100);
    freeRoamCamera.position.set(1, 2, -3);
    freeRoamCamera.lookAt(0, 1, 0);

    scene = new THREE.Scene();
    scene.background = hdrMap;
    scene.backgroundBlurriness = 0.1;
    scene.environment = hdrMap;

    physicsWorld = new RAPIER.World(GRAVITY_VECTOR);
    physicsWorld.timestep = 1 / PHYSICS_UPDATE_PER_SECOND;

    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    container.appendChild(renderer.domElement);

    orbitControls = new OrbitControls(freeRoamCamera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.autoRotate = true;

    stats = new Stats();
    container.appendChild(stats.dom);

    window.addEventListener('resize', onWindowResize);
    document.addEventListener('visibilitychange', onDocumentVisibilityChange);

    let geometry = new THREE.TorusKnotGeometry(18, 8, 200, 40, 1, 3);
    let material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 1,
        roughness: 0
    });

    const torusMesh = new THREE.Mesh(geometry, material);
    torusMesh.scale.set(0.025, 0.025, 0.025);
    scene.add(torusMesh);

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

function animateRapier(): void {
    physicsWorld.step();
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


