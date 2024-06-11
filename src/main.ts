import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPlayground } from './playground.ts';
import { toVector3 } from './utils.ts';
import { GRAVITY_VECTOR } from './gravity.ts';

await RAPIER.init();

const PLAYGROUND = await initPlayground();

const playerInput = {
  forward: 0,
  backward: 0,
  left: 0,
  right: 0,
  jump: 0,
};

let playerEuler = new THREE.Euler(0, 0, 0);

let playerCamera: THREE.PerspectiveCamera;
let playerGroup: THREE.Group;

let playerCollider: RAPIER.Collider;
let characterController: RAPIER.KinematicCharacterController;

const PLAYER_OFFSET = 0.01;
const PLAYER_EVE_LEVEL = 1.8;

const PLAYER_COLLIDER_HEIGHT = 2;
const PLAYER_COLLIDER_RADIUS = 0.4;

const PLAYER_MOUSE_SENSITIVITY = 150;
const PLAYER_SPEED = 7;
const PLAYER_JUMP_FORCE = 0.3;

const GRAVITY_SCALE = 0.125;

function createPlayer(): void {
  // THREE SETUP
  playerGroup = new THREE.Group();

  playerCamera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.01, 100);
  playerCamera.position.set(0, PLAYER_EVE_LEVEL, 0);

  playerGroup.add(playerCamera);

  PLAYGROUND.activeCamera = playerCamera;
  PLAYGROUND.scene.add(playerGroup);

// RAPIER SETUP
  const colliderDesc = RAPIER.ColliderDesc.cylinder(PLAYER_COLLIDER_HEIGHT / 2, PLAYER_COLLIDER_RADIUS);
  colliderDesc.setTranslation(0, PLAYER_COLLIDER_HEIGHT / 2, 0);

  playerCollider = PLAYGROUND.physicsWorld.createCollider(colliderDesc);

  characterController = PLAYGROUND.physicsWorld.createCharacterController(PLAYER_OFFSET);
  characterController.setMaxSlopeClimbAngle(5 * THREE.MathUtils.DEG2RAD);
  characterController.setApplyImpulsesToDynamicBodies(false);
  characterController.enableAutostep(0.25, 0.2, true);
  characterController.enableSnapToGround(0.25);

// EVENTS SETUP
  PLAYGROUND.canvas.addEventListener('click', () => {
    if (PLAYGROUND.activeCamera !== playerCamera) return;

    PLAYGROUND.canvas.requestPointerLock();
  });

  PLAYGROUND.canvas.addEventListener('pointermove', event => {
    // Mention flipping sides
    playerEuler.x += (event.movementY / PLAYGROUND.canvas.clientHeight) * PLAYER_MOUSE_SENSITIVITY * THREE.MathUtils.DEG2RAD;
    playerEuler.x = THREE.MathUtils.clamp(
      playerEuler.x,
      -80 * THREE.MathUtils.DEG2RAD,
      80 * THREE.MathUtils.DEG2RAD,
    );

    playerEuler.y -= (event.movementX / PLAYGROUND.canvas.clientWidth) * PLAYER_MOUSE_SENSITIVITY * THREE.MathUtils.DEG2RAD;
  });

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
  });

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
  });
}

const GROUNDED_TIMER_DEFAULT_VALUE = 0.5;
// For some reason it's bugged when vertical movement equals 0
const VERTICAL_MOVEMENT = -0.00005;

let groundedTimer = 0;
let verticalMovement = VERTICAL_MOVEMENT;

function updatePlayer(): void {
  const deltaTimeS = 1 / 60;

  // For some reason camera is facing -Z in default, so we need to fix it
  playerCamera.rotation.set(playerEuler.x, 180 * THREE.MathUtils.DEG2RAD, 0);

  const nextQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, playerEuler.y, 0));
  playerCollider.setRotation(nextQuaternion);
  playerGroup.quaternion.copy(nextQuaternion); // SYNC WITH THREE.JS

  const movementVector = new THREE.Vector3(
    playerInput.left - playerInput.right,
    0,
    playerInput.forward - playerInput.backward,
  ).normalize().multiplyScalar(PLAYER_SPEED).applyQuaternion(nextQuaternion).multiplyScalar(deltaTimeS);

  if (characterController.computedGrounded()) {
    groundedTimer = GROUNDED_TIMER_DEFAULT_VALUE;
    verticalMovement = VERTICAL_MOVEMENT;
  }

  if (groundedTimer > 0) {
    groundedTimer = Math.max(groundedTimer - deltaTimeS, 0);

    if (playerInput.jump > 0) {
      verticalMovement = PLAYER_JUMP_FORCE;
      groundedTimer = 0;
    }
  }

  playerInput.jump = 0;
  movementVector.setY(verticalMovement);

  verticalMovement = Math.max(
    verticalMovement + (GRAVITY_VECTOR.y * GRAVITY_SCALE * deltaTimeS),
    GRAVITY_VECTOR.y,
  );

  characterController.computeColliderMovement(playerCollider, movementVector);

  const currentPosition = toVector3(playerCollider.translation());
  const computedMovementVector = toVector3(characterController.computedMovement());

  const nextPosition = currentPosition.clone().add(computedMovementVector);

  playerCollider.setTranslation(nextPosition);
  playerGroup.position.copy(nextPosition).sub(new THREE.Vector3(0, PLAYER_COLLIDER_HEIGHT / 2, 0)); // SYNC WITH THREE.JS
}

createPlayer();
PLAYGROUND.onPhysicsUpdate = updatePlayer;
