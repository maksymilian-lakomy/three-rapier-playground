import { Playground } from './playground.ts';
import * as THREE from 'three';

export class RapierDebug {
  private readonly group = new THREE.Group();
  private lineSegments: THREE.LineSegments | null = null;

  constructor(private readonly playground: Playground) {
    playground.onPhysicsUpdate.add(this.onPhysicsUpdate);

    this.group.visible = false;
    playground.scene.add(this.group);
  }

  public start(): void {
    this.group.visible = true;
  }

  public stop(): void {
    this.group.visible = false;
  }

  private readonly onPhysicsUpdate = (): void => {
    if (!this.lineSegments) {
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
      });

      const geometry = new THREE.BufferGeometry();

      this.lineSegments = new THREE.LineSegments(geometry, material);
      this.group.add(this.lineSegments);
    }

    const { vertices, colors } = this.playground.physicsWorld.debugRender();

    this.lineSegments.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(vertices, 3),
    );
    this.lineSegments.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(colors, 4),
    );
  };
}
