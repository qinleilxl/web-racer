import * as T from "three";
import { Track } from "./Track";

export const TEST_GROUND_SIZE = 1200;
export const TEST_SPAWN = new T.Vector3(0, 0, -300);

/** Rendered asphalt uses a separate native slab; markings never affect tyres. */
export function createTestGround() {
  const terrain = new T.Group();
  terrain.name = "Cloudcape proving ground";
  const asphalt = new T.MeshStandardMaterial({
    color: "#505e58",
    roughness: 1,
  });
  const collision = new T.Mesh(
    new T.PlaneGeometry(TEST_GROUND_SIZE, TEST_GROUND_SIZE),
    asphalt,
  );
  collision.rotation.x = -Math.PI / 2;
  collision.name = "Continuous level asphalt";
  collision.receiveShadow = true;
  terrain.add(collision);
  // Two draw calls for the whole pad; neither grid participates in collision.
  // Ten-metre cells and stronger fifty-metre lines make speed / distance legible.
  for (const [spacing, opacity] of [
    [10, 0.2],
    [50, 0.38],
  ]) {
    const grid = new T.GridHelper(
      TEST_GROUND_SIZE,
      TEST_GROUND_SIZE / spacing,
      "#ccd5c0",
      "#ccd5c0",
    );
    grid.name = `Ground grid ${spacing}m`;
    grid.position.y = spacing === 10 ? 0.006 : 0.008;
    grid.material.transparent = true;
    grid.material.opacity = opacity;
    grid.material.depthWrite = false;
    terrain.add(grid);
  }
  const paint = new T.MeshStandardMaterial({
    color: "#e7e6d1",
    roughness: 1,
    depthWrite: false,
  });
  const amber = new T.MeshStandardMaterial({
    color: "#d3b574",
    roughness: 1,
    depthWrite: false,
  });
  const line = (
    x: number,
    z: number,
    width: number,
    length: number,
    material = paint,
  ) => {
    const mesh = new T.Mesh(new T.PlaneGeometry(width, length), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, z);
    terrain.add(mesh);
  };
  // A 700m acceleration / braking lane, with generous clear space on both sides.
  for (const side of [-1, 1]) line(side * 9, 0, 0.16, 700);
  for (let z = -330; z <= 350; z += 20) line(0, z, 0.16, 7);
  line(0, -300, 18, 0.4, amber);
  for (let z = -250; z <= 300; z += 50) {
    line(-11, z, 3, 0.16);
    line(11, z, 3, 0.16);
  }
  for (const x of [-140, 140]) {
    for (const radius of [25, 50, 75]) {
      const ring = new T.Mesh(
        new T.RingGeometry(radius - 0.1, radius + 0.1, 160),
        radius === 50 ? amber : paint,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.014, 0);
      terrain.add(ring);
    }
    line(x, 0, 10, 0.16);
    line(x, 0, 0.16, 10);
  }
  // Perimeter walls and one remote impact strip share their rendered geometry
  // with the collision world, away from the central manoeuvring area.
  const barriers = new T.Group();
  barriers.name = "Proving ground safety barriers";
  const stone = new T.MeshStandardMaterial({ color: "#d7d6be", roughness: 1 });
  const wall = (x: number, z: number, width: number, length: number) => {
    const mesh = new T.Mesh(new T.BoxGeometry(width, 1.8, length), stone);
    mesh.position.set(x, 0.9, z);
    mesh.receiveShadow = mesh.castShadow = true;
    barriers.add(mesh);
  };
  for (const side of [-1, 1]) {
    wall(side * 600, 0, 1.2, 1201.2);
    wall(0, side * 600, 1201.2, 1.2);
  }
  wall(320, 220, 1.2, 160);
  terrain.add(barriers);
  for (let z = 145; z < 300; z += 12) line(307, z, 8, 0.3, amber);
  // Quiet landscaping outside the physical pad anchors the horizon.
  const grass = new T.Mesh(
    new T.PlaneGeometry(4200, 4200),
    new T.MeshStandardMaterial({ color: "#a6b18e", roughness: 1 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.06;
  terrain.add(grass);
  const hillGeometry = new T.IcosahedronGeometry(1, 1);
  const hillMaterial = new T.MeshStandardMaterial({
    color: "#98ad8d",
    roughness: 1,
  });
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    const hill = new T.Mesh(hillGeometry, hillMaterial);
    hill.position.set(Math.cos(angle) * 1000, -30, Math.sin(angle) * 1000);
    hill.scale.set(160 + (i % 3) * 45, 75 + (i % 4) * 20, 130);
    terrain.add(hill);
  }
  // A small service hangar sits beyond the west wall, leaving all asphalt open.
  const hangar = new T.Mesh(
    new T.BoxGeometry(90, 16, 35),
    new T.MeshStandardMaterial({ color: "#dbd8c2", roughness: 1 }),
  );
  hangar.position.set(-690, 8, -280);
  terrain.add(hangar);
  const roof = new T.Mesh(
    new T.BoxGeometry(94, 2, 39),
    new T.MeshStandardMaterial({ color: "#9c6651", roughness: 1 }),
  );
  roof.position.set(-690, 17, -280);
  terrain.add(roof);
  // Reference route is used only for spawn orientation and reset height.
  const points = Array.from({ length: 960 }, (_, i) => {
    const side = Math.floor(i / 240),
      t = (i % 240) / 240;
    const x =
      side === 0 ? 0 : side === 1 ? 400 * t : side === 2 ? 400 : 400 * (1 - t);
    const z =
      side === 0
        ? -500 + 1000 * t
        : side === 1
          ? 500
          : side === 2
            ? 500 - 1000 * t
            : -500;
    return [x, -z, 0];
  });
  const track = new Track({
    centerline_blender: points,
    width_m: TEST_GROUND_SIZE,
    length_m: 2800,
    start_sample: 48,
  });
  return {
    terrain,
    collision,
    barriers,
    track,
    environment: {
      roadside: false,
      barriers,
      flatGround: { width: TEST_GROUND_SIZE, length: TEST_GROUND_SIZE },
    },
  };
}
