import './style.css'

import * as THREE from 'three';
import RAPIER from "@dimforge/rapier3d-compat";
import Stats from 'stats.js';
import {GLTFLoader, OrbitControls, RGBELoader} from "three-stdlib";
import {Pane} from "tweakpane";

let container: HTMLElement;

let freeRoamCamera: THREE.PerspectiveCamera;
let activeCamera: THREE.PerspectiveCamera;
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
    mouseSensitivity: 200
}

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

    const rapierDebugVisibleBinding = pane.addBinding(params, 'rapierDebugVisible')
    rapierDebugVisibleBinding.on('change', () => physicsWorldDebug.visible = params.rapierDebugVisible);

    const directionalLightHelperVisibleBinding = pane.addBinding(params, 'directionalLightHelperVisible')
    directionalLightHelperVisibleBinding.on('change', () => directionalLightHelper.visible = params.directionalLightHelperVisible);

    pane.addBinding(params, 'mouseSensitivity', {
        min: 100,
        max: 500
    });

    freeRoamCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 100);
    freeRoamCamera.position.set(0, 4, 10);
    freeRoamCamera.lookAt(0, 1, 0);

    activeCamera = freeRoamCamera;

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
                new Uint32Array(indexes)
            );

            const object3DWorldPosition = object3D.getWorldPosition(new THREE.Vector3());
            colliderDesc.setTranslation(object3DWorldPosition.x, object3DWorldPosition.y, object3DWorldPosition.z)
            colliderDesc.setRotation(object3D.quaternion);

            physicsWorld.createCollider(colliderDesc);
        }
    })

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

    renderer = new THREE.WebGLRenderer({antialias: true});
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

    player();

    animationId = requestAnimationFrame(animate);
}

let playerInput = {
    forward: 0,
    backward: 0,
    left: 0,
    right: 0,
    jump: 0
}

let playerEuler = new THREE.Euler(0, 0, 0);

let playerCamera: THREE.PerspectiveCamera;
let playerGroup: THREE.Group;

let playerCollider: RAPIER.Collider
let characterController: RAPIER.KinematicCharacterController

const PLAYER_OFFSET = 0.01;

// const PLAYER_CAMERA_SENSITIVITY = 150;
const PLAYER_EVE_LEVEL = 1.8;

const PLAYER_SPEED = 1;
const PLAYER_COLLIDER_HEIGHT = 2;
const PLAYER_COLLIDER_RADIUS = 0.4;

function player(): void {
    // THREE SETUP
    playerGroup = new THREE.Group();

    playerCamera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.01, 100);
    playerCamera.position.set(0, PLAYER_EVE_LEVEL, 0);

    playerGroup.add(playerCamera);
    activeCamera = playerCamera
    scene.add(playerGroup);

    // RAPIER SETUP
    const colliderDesc = RAPIER.ColliderDesc.cylinder(PLAYER_COLLIDER_HEIGHT / 2, PLAYER_COLLIDER_RADIUS);
    colliderDesc.setTranslation(0, PLAYER_COLLIDER_HEIGHT / 2, 0);

    playerCollider = physicsWorld.createCollider(colliderDesc);

    characterController = physicsWorld.createCharacterController(PLAYER_OFFSET);
    characterController.setUp({x: 0, y: 1, z: 0})
    characterController.enableAutostep(1.1, 0.5, true);
    characterController.enableSnapToGround(0.4);
    characterController.setMinSlopeSlideAngle(30 * THREE.MathUtils.DEG2RAD);
    characterController.setMaxSlopeClimbAngle(30 * THREE.MathUtils.DEG2RAD);

    // EVENTS SETUP
    container.addEventListener('click', () => {
        if (activeCamera !== playerCamera) return;

        container.requestPointerLock();
    });

    container.addEventListener('pointermove', event => {
        // Mention flipping sides
        playerEuler.x += (event.movementY / container.clientHeight) * params.mouseSensitivity * THREE.MathUtils.DEG2RAD;
        playerEuler.x = THREE.MathUtils.clamp(
            playerEuler.x,
            -80 * THREE.MathUtils.DEG2RAD,
            80 * THREE.MathUtils.DEG2RAD
        )

        playerEuler.y -= (event.movementX / container.clientWidth) * params.mouseSensitivity * THREE.MathUtils.DEG2RAD;
    })

    window.addEventListener('keydown', event => {
        if (event.repeat) return;

        switch (event.code) {
            case 'KeyW':
                playerInput.forward = 1;
                break;
            case 'KeyS':
                playerInput.backward = 1;
                break;
            case 'KeyA':
                playerInput.left = 1;
                break;
            case 'KeyD':
                playerInput.right = 1;
                break;
            case 'Space':
                playerInput.jump = 1;
                break;
        }
    })

    window.addEventListener('keyup', event => {
        if (event.repeat) return;

        switch (event.code) {
            case 'KeyW':
                playerInput.forward = 0;
                break;
            case 'KeyS':
                playerInput.backward = 0;
                break;
            case 'KeyA':
                playerInput.left = 0;
                break;
            case 'KeyD':
                playerInput.right = 0;
                break;
        }
    })
}

const GROUNDED_TIMER_DEFAULT_VALUE = 1;
// For some reason it's bugged when vertical movement equals 0
const VERTICAL_MOVEMENT = -0.001;

let groundedTimer = 0;
let verticalMovement = VERTICAL_MOVEMENT;

function updatePlayer(deltaTimeMs: number): void {
    // For some reason camera is facing -Z in default, so we need to fix it
    playerCamera.rotation.set(playerEuler.x, 180 * THREE.MathUtils.DEG2RAD, 0);

    const nextQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, playerEuler.y, 0));
    playerCollider.setRotation(nextQuaternion);
    playerGroup.quaternion.copy(nextQuaternion); // SYNC WITH THREE.JS

    const movementVector = new THREE.Vector3(
        playerInput.left - playerInput.right,
        0,
        playerInput.forward - playerInput.backward
    ).normalize().multiplyScalar(PLAYER_SPEED).applyQuaternion(nextQuaternion).divideScalar( deltaTimeMs);

    // This should happen when character is grounded and not sliding?
    if (characterController.computedGrounded()) {
        groundedTimer = GROUNDED_TIMER_DEFAULT_VALUE;
        verticalMovement = VERTICAL_MOVEMENT;
    }

    if (groundedTimer > 0) {
        groundedTimer = Math.max(groundedTimer - (deltaTimeMs / 1000), 0);

        if (playerInput.jump > 0) {
            verticalMovement = 0.25;
            groundedTimer = 0;
            playerInput.jump = 0;
        }
    }

    movementVector.setY(verticalMovement);
    verticalMovement = Math.max(
        (verticalMovement + GRAVITY_VECTOR.y * (deltaTimeMs / 1000) * 0.1),
        GRAVITY_VECTOR.y * (deltaTimeMs / 1000) * 2
    )

    characterController.computeColliderMovement(playerCollider, movementVector);
    const currentPosition = toVector3(playerCollider.translation());
    const computedMovementVector = toVector3(characterController.computedMovement());

    const nextPosition = currentPosition.clone().add(computedMovementVector);

    playerCollider.setTranslation(nextPosition);
    playerGroup.position.copy(nextPosition); // SYNC WITH THREE.JS
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
        updateRapier();
    }

    const deltaTimeMs = elapsedTimeMs !== null ? timeMs - elapsedTimeMs : 0;
    updateThree(deltaTimeMs);

    stats.end();

    elapsedTickCounter = tickCounter;
    elapsedTimeMs = timeMs;
    animationId = requestAnimationFrame(animate);
}

let debugLineGeometries: THREE.BufferGeometry[] = [];

function updateRapier(): void {
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

function updateThree(deltaTimeMs: number): void {
    orbitControls.update();

    // PLAYER RELATED STUFF
    updatePlayer(deltaTimeMs);

    renderer.render(scene, activeCamera);
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

    playerCamera.aspect = window.innerWidth / window.innerHeight;
    playerCamera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
}

function toVector3({x, y, z}: RAPIER.Vector3): THREE.Vector3 {
    return new THREE.Vector3(
        x,
        y,
        z
    )
}