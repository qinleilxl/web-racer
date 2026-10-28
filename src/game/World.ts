import * as T from "three";
import { Track } from "./Track";
import { createRoadside } from "./Roadside";
import { TyreMarks } from "./TyreMarks";
import { CoastalAtmosphere } from "./CoastalAtmosphere";

export class World {
  readonly sun: T.DirectionalLight;
  private atmosphere: CoastalAtmosphere;
  private flags: T.Mesh[] = [];
  private birds = new T.Group();
  private gates: T.Group[] = [];
  private windMotes: T.Points;
  private dust: T.Points;
  private dustPositions = new Float32Array(150 * 3);
  private dustLife = new Float32Array(150);
  private dustCursor = 0;
  readonly tyreMarks = new TyreMarks();
  constructor(
    readonly scene: T.Scene,
    readonly track: Track,
    terrain: T.Object3D,
    options: { testGround?: boolean } = {},
  ) {
    this.atmosphere = new CoastalAtmosphere(scene, options.testGround);
    this.sun = this.atmosphere.sun;
    terrain.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = !o.name.includes("WATER");
        o.receiveShadow = true;
        if (o.name.includes("WATER")) o.visible = false;
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach((m) => {
          if (m instanceof T.MeshStandardMaterial) {
            m.roughness = Math.max(0.65, m.roughness);
            m.envMapIntensity = 0.4;
          }
        });
      }
    });
    scene.add(terrain);
    if (!options.testGround) scene.add(createRoadside(track).visual);
    if (!options.testGround) {
      this.makeGates();
      this.makeFlags();
    }
    const motePositions: number[] = [];
    for (let i = 0; i < track.points.length; i++) {
      if (options.testGround || !track.wind(i)) continue;
      const p = track.point(i);
      for (let j = 0; j < 2; j++)
        motePositions.push(
          p.x + (Math.random() - 0.5) * 5,
          p.y + 0.5 + Math.random() * 2,
          p.z + (Math.random() - 0.5) * 5,
        );
    }
    const moteGeo = new T.BufferGeometry();
    moteGeo.setAttribute(
      "position",
      new T.Float32BufferAttribute(motePositions, 3),
    );
    this.windMotes = new T.Points(
      moteGeo,
      new T.PointsMaterial({
        color: "#eaffd9",
        size: 0.15,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    scene.add(this.windMotes);
    for (let i = 0; i < 9; i++) {
      const bird = new T.Group();
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints([
          new T.Vector3(-1, 0, 0),
          new T.Vector3(0, -0.3, 0.1),
          new T.Vector3(1, 0, 0),
        ]),
        new T.LineBasicMaterial({ color: "#eff5e8" }),
      );
      bird.add(line);
      bird.position.set(30 + i * 9, 65 + (i % 3) * 3, 90 + i * 4);
      this.birds.add(bird);
    }
    scene.add(this.birds);
    this.dustPositions.fill(-1000);
    const dustGeo = new T.BufferGeometry();
    dustGeo.setAttribute(
      "position",
      new T.BufferAttribute(this.dustPositions, 3),
    );
    const smokeCanvas = document.createElement("canvas");
    smokeCanvas.width = 64;
    smokeCanvas.height = 64;
    const smokeContext = smokeCanvas.getContext("2d")!;
    const smokeGradient = smokeContext.createRadialGradient(
      32,
      32,
      0,
      32,
      32,
      32,
    );
    smokeGradient.addColorStop(0, "rgba(255,255,255,.7)");
    smokeGradient.addColorStop(0.45, "rgba(255,255,255,.3)");
    smokeGradient.addColorStop(1, "rgba(255,255,255,0)");
    smokeContext.fillStyle = smokeGradient;
    smokeContext.fillRect(0, 0, 64, 64);
    const smokeTexture = new T.CanvasTexture(smokeCanvas);
    this.dust = new T.Points(
      dustGeo,
      new T.PointsMaterial({
        size: 0.65,
        map: smokeTexture,
        color: "#e8dfbc",
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    scene.add(this.tyreMarks.mesh);
  }
  private makeGates() {
    const gateHalfWidth = this.track.width / 2 + 0.8;
    this.track.gateIndices.forEach((index, i) => {
      const p = this.track.point(index),
        dir = this.track.tangent(index);
      const group = new T.Group();
      group.position.copy(p);
      group.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir);
      const mat = new T.MeshStandardMaterial({
        color: i === 7 ? "#e9dac0" : "#e9d7a3",
        roughness: 1,
      });
      for (const side of [-1, 1]) {
        const pole = new T.Mesh(
          new T.CylinderGeometry(0.065, 0.075, 4.5, 6),
          mat,
        );
        pole.position.set(side * gateHalfWidth, 2.25, 0);
        group.add(pole);
        const flag = new T.Mesh(
          new T.PlaneGeometry(1.1, 2.2, 3, 6),
          new T.MeshStandardMaterial({
            color: i === 7 ? "#c6664b" : "#e6bd74",
            side: T.DoubleSide,
            roughness: 1,
          }),
        );
        flag.position.set(side * gateHalfWidth, 3.25, 0);
        group.add(flag);
        this.flags.push(flag);
      }
      if (i === 7) {
        const banner = new T.Mesh(
          new T.BoxGeometry(gateHalfWidth * 2 + 0.2, 0.7, 0.09),
          new T.MeshStandardMaterial({ color: "#e8e3c9" }),
        );
        banner.position.y = 4.5;
        group.add(banner);
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 80;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#e9e3c9";
        ctx.fillRect(0, 0, 1024, 80);
        ctx.fillStyle = "#375e58";
        ctx.font = "bold 37px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("C L O U D C A P E   R A L L Y", 512, 54);
        const texture = new T.CanvasTexture(canvas);
        texture.colorSpace = T.SRGBColorSpace;
        const sign = new T.Mesh(
          new T.PlaneGeometry(gateHalfWidth * 2 - 0.2, 0.73),
          new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide }),
        );
        sign.position.set(0, 4.5, -0.06);
        sign.rotation.y = Math.PI;
        group.add(sign);
        const reverse = sign.clone();
        reverse.position.z = 0.06;
        reverse.rotation.y = 0;
        group.add(reverse);
      }
      this.scene.add(group);
      this.gates.push(group);
    });
  }
  private makeFlags() {
    for (let i = 0; i < this.track.points.length; i += 22) {
      if (!this.track.wind(i)) continue;
      const p = this.track.point(i),
        dir = this.track.tangent(i);
      const group = new T.Group();
      group.position
        .copy(p)
        .add(
          new T.Vector3(dir.z, 0, -dir.x).multiplyScalar(
            this.track.width / 2 + 0.7,
          ),
        );
      const pole = new T.Mesh(
        new T.CylinderGeometry(0.04, 0.05, 3.8, 5),
        new T.MeshStandardMaterial({ color: "#ddd6ab" }),
      );
      pole.position.y = 1.9;
      group.add(pole);
      const flag = new T.Mesh(
        new T.PlaneGeometry(1.8, 0.55, 8, 2),
        new T.MeshStandardMaterial({ color: "#b6dcba", side: T.DoubleSide }),
      );
      flag.position.set(0.9, 3.5, 0);
      group.add(flag);
      this.flags.push(flag);
      this.scene.add(group);
    }
  }
  setGate(passed: number) {
    this.gates.forEach((gate, i) => {
      gate.children.forEach((o) => {
        if (
          o instanceof T.Mesh &&
          o.geometry instanceof T.PlaneGeometry &&
          o.geometry.parameters.height === 2.2
        ) {
          (o.material as T.MeshStandardMaterial).color.set(
            i === passed ? "#8fd5cd" : "#e6bd74",
          );
        }
      });
    });
  }
  update(
    dt: number,
    time: number,
    car: T.Vector3,
    speed: number,
    drifting: boolean,
    _wind: boolean,
  ) {
    this.atmosphere.update(time, car);
    this.flags.forEach((f, i) => {
      const a = f.geometry.attributes.position;
      for (let j = 0; j < a.count; j++)
        a.setZ(j, Math.sin(time * 3 + a.getX(j) * 3 + i) * 0.14);
      a.needsUpdate = true;
    });
    this.birds.children.forEach((b, i) => {
      b.position.x = 30 + i * 9 + Math.sin(time * 0.09) * 75;
      b.position.z = 90 + i * 4 + Math.cos(time * 0.09) * 35;
      b.rotation.z = Math.sin(time * 3 + i) * 0.12;
    });
    this.windMotes.position.y = Math.sin(time * 2) * 0.16;
    for (let i = 0; i < this.dustLife.length; i++) {
      if (this.dustLife[i] > 0) {
        this.dustLife[i] -= dt;
        this.dustPositions[i * 3 + 1] += dt * 0.3;
        if (this.dustLife[i] <= 0) this.dustPositions[i * 3 + 1] = -1000;
      }
    }
    if (drifting && speed > 5) {
      for (let n = 0; n < 2; n++) {
        const i = this.dustCursor++ % 150;
        this.dustPositions.set(
          [
            car.x + (Math.random() - 0.5) * 2,
            car.y - 0.6,
            car.z + (Math.random() - 0.5) * 2,
          ],
          i * 3,
        );
        this.dustLife[i] = 1;
      }
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }
  skid(a: T.Vector3, b: T.Vector3, normal: T.Vector3, strength: number) {
    this.tyreMarks.add(a, b, normal, strength);
  }
  quality(quality: string) {
    this.sun.castShadow = quality !== "low";
    this.sun.shadow.mapSize.set(
      quality === "high" ? 2048 : 1024,
      quality === "high" ? 2048 : 1024,
    );
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }
}
