import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export function toVector3({ x, y, z }: RAPIER.Vector3): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}
