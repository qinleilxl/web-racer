import { t } from "../i18n";
import { vehicleModelRoot } from "./Vehicles";
import {
  Box3,
  BoxGeometry,
  CircleGeometry,
  Group,
  Light,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  RectAreaLight,
  Vector3,
} from "three";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LampGlow, type GlowEmitter } from "./LampGlow";
import type { VehicleDefinition } from "./Vehicles";
import { ExhaustFlames } from "./ExhaustFlames";

export type DrivingFeedback = {
  speed: number;
  rpm: number;
  braking: boolean;
  reversing: boolean;
  steer: number;
  headlights: boolean;
  active: boolean;
  throttle?: number;
  boosting?: boolean;
  handbrake?: boolean;
  velocity?: Vector3;
  yawRate?: number;
  viewportHeight?: number;
};
type Lamp = {
  mesh: Mesh;
  material: MeshStandardMaterial;
  role: "head" | "tail" | "reverse" | "signal";
  side: number;
  running?: boolean;
};
let areaLightsReady = false;

const segments = [
  "abcdef",
  "bc",
  "abdeg",
  "abcdg",
  "bcfg",
  "acdfg",
  "acdefg",
  "abc",
  "abcdefg",
  "abcdfg",
];

/** Three-dimensional instruments: they stay on the dashboard / moving wheel. */
class SpeedDisplay {
  readonly root = new Group();
  private digits: Mesh[][] = [];
  constructor(width: number, height: number) {
    this.root.name = "LIVE_SPEED_KMH";
    const ink = new MeshBasicMaterial({ color: "#b9f7d3", toneMapped: false });
    const w = width / 3.8,
      h = height * 0.88,
      t = w * 0.16;
    for (let d = 0; d < 3; d++) {
      const glyph: Mesh[] = [];
      const bars = [
        [0, h / 2, w - t, t],
        [w / 2, h / 4, t, h / 2 - t],
        [w / 2, -h / 4, t, h / 2 - t],
        [0, -h / 2, w - t, t],
        [-w / 2, -h / 4, t, h / 2 - t],
        [-w / 2, h / 4, t, h / 2 - t],
        [0, 0, w - t, t],
      ];
      for (const [x, y, sx, sy] of bars) {
        const mesh = new Mesh(new BoxGeometry(sx, sy, 0.0008), ink);
        mesh.position.set((d - 1) * w * 1.25 + x, y, 0);
        this.root.add(mesh);
        glyph.push(mesh);
      }
      this.digits.push(glyph);
    }
    this.update(0);
  }
  freeze() {
    const visible = this.root.children.filter(
      (o): o is Mesh => o instanceof Mesh && o.visible,
    );
    const parts = visible.map((mesh) => {
      mesh.updateMatrix();
      return mesh.geometry.clone().applyMatrix4(mesh.matrix);
    });
    const geometry = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    const material = visible[0].material;
    this.root.children.forEach((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.root.clear();
    if (geometry) this.root.add(new Mesh(geometry, material));
  }

  update(speed: number) {
    const text = Math.min(999, Math.round(Math.max(0, speed)))
      .toString()
      .padStart(3, " ");
    this.digits.forEach((digit, i) =>
      digit.forEach((mesh, j) => {
        mesh.visible =
          text[i] !== " " && segments[Number(text[i])].includes("abcdefg"[j]);
      }),
    );
  }
}

export class VehicleFeedback {
  readonly exhaust: ExhaustFlames;
  readonly lamps: Lamp[] = [];
  readonly instrumentKind: "none" | "digital" | "analog";
  speedKmh = 0;
  brakeOn = false;
  reverseOn = false;
  headlightsOn = true;
  private elapsed = 0;
  private display?: SpeedDisplay;
  private needle?: Group;
  private needleRestAngle = 0;
  private tachometer?: { pivot: Group; restAngle: number };
  private rpmLeds: MeshStandardMaterial[] = [];
  private headlights: Light[] = [];
  private surrounds: MeshStandardMaterial[] = [];
  readonly glows: LampGlow[] = [];
  readonly brakeLights: {
    name: string;
    nodes: Mesh[];
    light: PointLight | RectAreaLight;
  }[] = [];
  constructor(
    readonly model: Object3D,
    readonly vehicle: VehicleDefinition,
  ) {
    const id = vehicle.id;
    this.instrumentKind =
      vehicle.instrumentKind ??
      (id === "suv" ? "analog" : id === "sparrow" ? "none" : "digital");
    const meshes: Mesh[] = [];
    model.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
      if (o instanceof Light) {
        o.visible = false;
        if (/HEADLIGHT|Headlight|Headlamp/i.test(o.name)) {
          o.intensity = 55;
          this.headlights.push(o);
        }
      }
    });
    const root = vehicleModelRoot(model);
    const brakeBindings = new Map<
      Mesh,
      { running: boolean; linear: boolean }
    >();
    root.updateWorldMatrix(true, true);
    for (const fixture of vehicle.brakeLamps) {
      // Keep the surround dim and independent from the stronger inner LED strip.
      for (const name of fixture.surrounds ?? []) {
        const trim = model.getObjectByName(name);
        if (
          !(trim instanceof Mesh) ||
          !(trim.material instanceof MeshStandardMaterial)
        )
          throw new Error(t("车辆尾灯缺少外框：{0}/{1}", { 0: vehicle.id, 1: name }));
        trim.userData.runtime_feedback = true;
        const material = trim.material.clone();
        material.emissive.setHex(0xff1608);
        material.emissiveIntensity = 0.15;
        material.toneMapped = false;
        trim.material = material;
        this.surrounds.push(material);
      }
      const bounds = new Box3();
      const nodes = fixture.nodes.map((name) => {
        const mesh = model.getObjectByName(name);
        if (
          !(mesh instanceof Mesh) ||
          !(mesh.material instanceof MeshStandardMaterial)
        )
          throw new Error(t("车辆刹车灯缺少灯罩：{0}/{1}", { 0: vehicle.id, 1: name }));
        if (fixture.minimumLensHeight) {
          mesh.geometry.computeBoundingBox();
          const box = mesh.geometry.boundingBox!;
          const height = box.max.y - box.min.y;
          if (height > 0 && height < fixture.minimumLensHeight) {
            // Preserve the strip centre and length; avoid a subpixel LED at
            // the normal chase-camera distance without lighting its outline.
            const centre = box.getCenter(new Vector3());
            mesh.geometry = mesh.geometry
              .clone()
              .translate(-centre.x, -centre.y, -centre.z)
              .scale(1, fixture.minimumLensHeight / height, 1)
              .translate(centre.x, centre.y, centre.z);
            mesh.geometry.computeBoundingBox();
            mesh.geometry.computeBoundingSphere();
          }
        }
        brakeBindings.set(mesh, {
          running: fixture.running !== false,
          linear: fixture.shape === "strip",
        });
        bounds.expandByObject(mesh);
        return mesh;
      });
      // Place reflection at the actual rear-facing lens, in its root's space.
      // The attached lights then follow chassis pitch and vehicle rotation.
      bounds.applyMatrix4(root.matrixWorld.clone().invert());
      let light: PointLight | RectAreaLight;
      if (fixture.shape === "strip") {
        if (!areaLightsReady) {
          RectAreaLightUniformsLib.init();
          areaLightsReady = true;
        }
        const size = bounds.getSize(new Vector3());
        light = new RectAreaLight(0xff2010, 0, size.z, size.y);
        // RectAreaLight emits along local -Z; the car's rear is local +X.
        light.rotation.y = -Math.PI / 2;
      } else light = new PointLight(0xff2010, 0, 0.8, 2);
      light.name = `BRAKE_REFLECTION_${fixture.name}`;
      light.position.copy(bounds.getCenter(new Vector3()));
      light.position.x = bounds.max.x + 0.035;
      root.add(light);
      this.brakeLights.push({ name: fixture.name, nodes, light });
    }
    for (const mesh of meshes) {
      if (!(mesh.material instanceof MeshStandardMaterial)) continue;
      const name = mesh.name,
        mat = mesh.material.name;
      let role: Lamp["role"] | undefined;
      if (
        /Headlamp_convex_lens|Headlamp_luminous_bulb|Headlamp_lens_|Headlamp_tungsten_bulb|Lamp_lens_prism|Recessed_headlamp_lens|HIFI_auxiliary_lamp_optic|HIFI_continuous_swept_LED_light_guide|HIFI_projector_LED_source/.test(
          name,
        )
      )
        role = "head";
      if (brakeBindings.has(mesh)) role = "tail";
      if (id === "targa") {
        if (/^Rear_lens_flute_[1-7]_/.test(name)) role = "tail";
        if (
          /^Front_indicator_lens|^Rear_lamp_lens_[08]$|^Rear_lens_flute_[08]_/.test(
            name,
          )
        )
          role = "signal";
      }
      if (
        id === "sparrow" &&
        /^(Rear_lamp00[13]|Rear_lamp_inset_domed_fluted_lens00[13])$/.test(name)
      )
        role = "signal";
      if (id === "suv" && /^Tail_lens_molded_flute/.test(name)) {
        if (mat === "Amber signal lens") role = "signal";
        if (mat === "Aged ivory roof") role = "reverse";
      }
      if (id === "suv" && /^Rear_lens_segment00[25]$/.test(name))
        role = "reverse";
      if (
        /Amber_front_indicator|Front_amber_indicator|Amber_side_marker/.test(
          name,
        ) ||
        (id === "suv" &&
          /^Rear_lens_segment/.test(name) &&
          mat === "Amber signal lens")
      )
        role = "signal";
      if (role) {
        mesh.userData.runtime_feedback = true;
        const material = (mesh.material as MeshStandardMaterial).clone();
        mesh.material = material;
        if (brakeBindings.get(mesh)?.linear) {
          // Uniform self-emission along the full strip, without a central
          // specular highlight from the daylight or the environment map.
          material.color.setHex(0x080000);
          material.roughness = 1;
          material.metalness = 0;
          material.envMapIntensity = 0;
        }
        const colour =
          role === "head"
            ? 0xffeccb
            : role === "tail"
              ? 0xff1608
              : role === "reverse"
                ? 0xf5f4da
                : 0xff8305;
        material.emissive.setHex(colour);
        // ACES turns high-luminance red LEDs pale orange; keep their signal hue.
        if (role === "tail") material.toneMapped = false;
        this.lamps.push({
          mesh,
          material,
          role,
          running: brakeBindings.get(mesh)?.running,
          side: Math.sign(
            new Box3().setFromObject(mesh).getCenter(new Vector3()).z,
          ),
        });
      }
      if (/HIFI_tachometer_LED_bar_/.test(name)) {
        mesh.userData.runtime_feedback = true;
        const material = (mesh.material as MeshStandardMaterial).clone();
        mesh.material = material;
        const index = Number(name.match(/bar_(\d+)/)?.[1] ?? 0);
        this.rpmLeds[index] = material;
      }
      if (/HIFI_numeric_speed_segment|Display_telemetry_bar/.test(name))
        mesh.visible = false;
    }
    if (id === "scarlet" || id === "formula") {
      this.display = new SpeedDisplay(
        id === "scarlet" ? 0.125 : 0.071,
        id === "scarlet" ? 0.028 : 0.027,
      );
      const screen = this.display.root;
      if (id === "scarlet") {
        screen.position.set(-0.7908, 0.9107, 0.34);
        screen.quaternion.setFromRotationMatrix(
          new Matrix4().makeBasis(
            new Vector3(0, 0, -1),
            new Vector3(-0.4, 0.916515, 0),
            new Vector3(0.916515, 0.4, 0),
          ),
        );
        root.add(screen);
      } else {
        const pivot = model.getObjectByName("STEERING_WHEEL_PIVOT")!;
        // The supplied steering controls face the nose. Turn its face towards
        // the driver while keeping the real steering column / axis unchanged.
        const face = new Group();
        face.name = "DRIVER_STEERING_FACE";
        for (const child of [...pivot.children]) face.add(child);
        face.rotation.y = Math.PI;
        pivot.add(face);
        screen.position.set(0.02, 0.023, 0);
        screen.rotation.y = Math.PI / 2;
        model.getObjectByName("STEERING_WHEEL_PIVOT")!.add(screen);
      }
    }
    if (id === "suv") {
      // The supplied cylinders use local Y, while the dial markings lie in YZ.
      // Correct their faces and lift the cluster above the steering hub so the
      // working needle can be read from the driver's seat.
      for (const mesh of meshes) {
        if (
          !/^(Speedometer|Fuel|Temperature)_(instrument_can|polished_bezel|needle_cap|red_needle|dial_tick|\d+$)/.test(
            mesh.name,
          )
        )
          continue;
        mesh.position.y += 0.18;
        if (/instrument_can|polished_bezel|needle_cap/.test(mesh.name))
          mesh.rotation.z = -Math.PI / 2;
        if (/^Speedometer_(dial_tick|\d+$)/.test(mesh.name))
          mesh.visible = false;
      }
      const face = new Mesh(
        new CircleGeometry(0.063, 48),
        new MeshBasicMaterial({ color: 0x101916 }),
      );
      face.name = "LIVE_SPEED_DIAL";
      face.position.set(-0.269, 1.35, 0.43);
      face.rotation.y = Math.PI / 2;
      root.add(face);
      const dialInk = new MeshBasicMaterial({
        color: 0xdadbc6,
        toneMapped: false,
      });
      for (let i = 0; i <= 24; i++) {
        const angle = ((130 - (260 * i) / 24) * Math.PI) / 180;
        const tick = new Mesh(
          new BoxGeometry(0.001, i % 4 === 0 ? 0.008 : 0.004, 0.0015),
          dialInk,
        );
        tick.position.set(
          -0.267,
          1.35 + Math.cos(angle) * 0.055,
          0.43 + Math.sin(angle) * 0.055,
        );
        tick.rotation.x = angle;
        root.add(tick);
        if (i % 4 === 0) {
          const label = new SpeedDisplay(0.022, 0.008);
          label.update(i * 5);
          label.freeze();
          label.root.position.set(
            -0.266,
            1.35 + Math.cos(angle) * 0.039,
            0.43 + Math.sin(angle) * 0.039,
          );
          label.root.rotation.y = Math.PI / 2;
          label.root.name = `SPEED_DIAL_${i * 5}`;
          root.add(label.root);
        }
      }
    }
    if (id === "suv") {
      const old = model.getObjectByName("Speedometer_red_needle") as Mesh;
      const cap = model.getObjectByName("Speedometer_needle_cap")!;
      cap.userData.runtime_feedback = true;
      old.visible = false;
      this.needle = new Group();
      this.needle.name = "LIVE_SPEED_NEEDLE";
      this.needle.position.copy(cap.position);
      this.needle.position.x += 0.005;
      const pointer = new Mesh(
        new BoxGeometry(0.002, 0.047, 0.002),
        old.material,
      );
      pointer.position.y = 0.0235;
      this.needle.add(pointer);
      root.add(this.needle);
    }
    if (vehicle.rig === "e-final" || id === "targa") {
      // The imported needles are baked in root coordinates. Reparent around
      // their real pins, preserving geometry and the original dashboard face.
      const bindNeedle = (index: number, name: string) => {
        const mesh = model.getObjectByName(
          id === "targa"
            ? `Gauge_${index}_orange_needle`
            : `Instrument_${index}_needle`,
        ) as Mesh;
        const pin = model.getObjectByName(
          id === "targa"
            ? `Gauge_${index}_needle_pin`
            : `Instrument_${index}_needle_pin`,
        )!;
        mesh.userData.runtime_feedback = pin.userData.runtime_feedback = true;
        const centre = root.worldToLocal(pin.getWorldPosition(new Vector3()));
        const tip = root
          .worldToLocal(new Box3().setFromObject(mesh).getCenter(new Vector3()))
          .sub(centre);
        const pivot = new Group();
        pivot.name = name;
        pivot.position.copy(centre);
        root.add(pivot);
        root.updateWorldMatrix(true, true);
        pivot.attach(mesh);
        return { pivot, restAngle: Math.atan2(tip.z, tip.y) };
      };
      const speed = bindNeedle(id === "targa" ? 3 : 0, "LIVE_SPEED_NEEDLE");
      this.needle = speed.pivot;
      this.needleRestAngle = speed.restAngle;
      this.tachometer = bindNeedle(id === "targa" ? 2 : 1, "LIVE_RPM_NEEDLE");
    }
    // The road cars without a supplied reverse optic gain small white inserts.
    if (id === "sparrow" || id === "scarlet" || id === "targa") {
      for (const side of [-1, 1]) {
        const mat = new MeshStandardMaterial({
          color: 0xddd8c3,
          emissive: 0xfff4db,
        });
        const lens = new Mesh(new BoxGeometry(0.012, 0.025, 0.06), mat);
        lens.name = `LIVE_REVERSE_${side}`;
        lens.position.set(
          id === "sparrow" ? 1.85 : 2.11,
          id === "sparrow" ? 0.58 : id === "targa" ? 0.43 : 0.76,
          side * (id === "sparrow" ? 0.7 : id === "targa" ? 0.4 : 0.3),
        );
        root.add(lens);
        this.lamps.push({ mesh: lens, material: mat, role: "reverse", side });
      }
    }
    const glowEmitters: GlowEmitter[] = this.brakeLights.map((fixture) => ({
      name: fixture.name,
      nodes: fixture.nodes,
      face: "rear",
      color: 0xff1608,
      intensity: () =>
        Math.max(
          ...fixture.nodes.map(
            (mesh) => (mesh.material as MeshStandardMaterial).emissiveIntensity,
          ),
        ),
    }));
    const groups = new Map<
      string,
      { lamps: Lamp[]; face: GlowEmitter["face"] }
    >();
    for (const lamp of this.lamps) {
      if (lamp.role === "tail") continue;
      const centre = new Box3()
        .setFromObject(lamp.mesh)
        .getCenter(new Vector3());
      root.worldToLocal(centre);
      const face: GlowEmitter["face"] = /side_marker/i.test(lamp.mesh.name)
        ? lamp.side > 0
          ? "left"
          : "right"
        : centre.x < 0
          ? "front"
          : "rear";
      const key = `${lamp.role}_${face}_${lamp.side}`;
      const group = groups.get(key) ?? { lamps: [], face };
      group.lamps.push(lamp);
      groups.set(key, group);
    }
    for (const [name, group] of groups) {
      glowEmitters.push({
        name,
        nodes: group.lamps.map((l) => l.mesh),
        face: group.face,
        color: group.lamps[0].material.emissive.getHex(),
        intensity: () =>
          Math.max(...group.lamps.map((l) => l.material.emissiveIntensity)),
      });
    }
    this.glows.push(
      ...glowEmitters.map((emitter) => new LampGlow(root, emitter)),
    );
    this.exhaust = new ExhaustFlames(model, vehicle);
    this.update(
      {
        speed: 0,
        rpm: 1000,
        braking: false,
        reversing: false,
        steer: 0,
        headlights: true,
        active: false,
      },
      0,
    );
  }
  update(state: DrivingFeedback, dt: number) {
    this.exhaust.update(state, dt);
    this.elapsed += dt;
    this.speedKmh = Math.round(Math.max(0, state.speed) * 3.6);
    this.brakeOn = state.active && state.braking;
    this.reverseOn = state.active && state.reversing;
    this.headlightsOn = state.headlights && this.vehicle.id !== "formula";
    this.display?.update(this.speedKmh);
    if (this.needle)
      this.needle.rotation.x =
        ((130 -
          (260 *
            Math.min(
              this.vehicle.rig || this.vehicle.id === "targa" ? 200 : 120,
              this.speedKmh,
            )) /
            (this.vehicle.rig || this.vehicle.id === "targa" ? 200 : 120)) *
          Math.PI) /
          180 -
        this.needleRestAngle;
    if (this.tachometer)
      this.tachometer.pivot.rotation.x =
        ((130 - 260 * Math.min(1, Math.max(0, state.rpm / 8000))) * Math.PI) /
          180 -
        this.tachometer.restAngle;
    const blink = this.elapsed % 0.7 < 0.35;
    for (const lamp of this.lamps) {
      const intensity =
        lamp.role === "head"
          ? this.headlightsOn
            ? 3.2
            : 0.015
          : lamp.role === "tail"
            ? this.brakeOn
              ? 5.5
              : lamp.running === false
                ? 0
                : this.headlightsOn || this.vehicle.id === "formula"
                  ? 0.45
                  : 0.02
            : lamp.role === "reverse"
              ? this.reverseOn
                ? 4
                : 0.01
              : state.active && state.steer * lamp.side < -0.1 && blink
                ? 4
                : 0.01;
      lamp.material.emissiveIntensity = intensity;
    }
    this.headlights.forEach((light) => (light.visible = this.headlightsOn));
    this.surrounds.forEach((material) => {
      material.emissiveIntensity =
        this.headlightsOn || this.brakeOn ? 0.15 : 0.015;
    });
    this.brakeLights.forEach(({ light }) => {
      light.intensity = this.brakeOn
        ? light instanceof RectAreaLight
          ? 3
          : 0.035
        : 0;
    });
    this.glows.forEach((glow) => glow.update());
    this.rpmLeds.forEach((mat, i) => {
      mat.emissiveIntensity = state.rpm / 7000 > (i + 1) / 13 ? 2.5 : 0.05;
    });
  }
}
