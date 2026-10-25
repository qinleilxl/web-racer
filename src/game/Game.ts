import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Physics } from "./Physics";
import { Track, type RouteData } from "./Track";
import { Race } from "./Race";
import { InputManager } from "./Input";
import { GameAudio } from "./Audio";
import { World } from "./World";
import { PHYSICS_STEP } from "./Driving";
import { CarRig } from "./CarRig";
import { SpeedEffects } from "./SpeedEffects";
import { loadBest, type Settings, type Snapshot } from "./types";

export class Game {
  state: Snapshot = {
    phase: "loading",
    loaded: 0,
    error: "",
    speed: 0,
    gear: 1,
    rpm: 1000,
    time: 0,
    best: loadBest(),
    previousBest: null,
    checkpoint: 0,
    totalCheckpoints: 8,
    progress: 0,
    energy: 35,
    boosting: false,
    inWind: false,
    wallScrape: 0,
    driftAngle: 0,
    countdown: 3,
    notice: "",
    offRoad: false,
    wrongWay: false,
    fps: 60,
    x: 0,
    z: 0,
    heading: 0,
  };
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(50, 1, 0.1, 2200);
  renderer: T.WebGLRenderer;
  physics?: Physics;
  track?: Track;
  race?: Race;
  world?: World;
  input: InputManager;
  audio = new GameAudio();
  settings: Settings;
  showcase = false;
  private car = new T.Group();
  private model?: T.Group;
  private rig?: CarRig;
  private clock = 0;
  private accumulator = 0;
  private interpolation = 1;
  private last = 0;
  private lastUI = 0;
  private animation = 0;
  private disposed = false;
  private noticeUntil = 0;
  private lastImpact = -1;
  private lastCount = 3;
  private resumePhase: "racing" | "countdown" = "racing";
  private countdownTime = 3;
  private cameraReady = false;
  private lastSkids = Array.from({ length: 4 }, () => new T.Vector3());
  private skidActive = [false, false, false, false];
  private speedEffects = new SpeedEffects();
  private motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private cameraLook = new T.Vector3();
  private travelDirection = new T.Vector3(0, 0, 1);
  private resizeObserver: ResizeObserver;
  constructor(
    private host: HTMLDivElement,
    settings: Settings,
    private publish: (state: Snapshot) => void,
    private settingsChanged: (settings: Settings) => void,
  ) {
    this.settings = settings;
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.scene.add(this.speedEffects.mesh);
    host.appendChild(this.renderer.domElement);
    this.input = new InputManager((key) => {
      if (key === "Escape") this.togglePause();
      if (key === "KeyR") this.reset();
      if (key === "KeyC")
        this.setSettings({
          ...this.settings,
          camera: this.settings.camera === "far" ? "near" : "far",
        });
      if (
        key === "blur" &&
        (this.state.phase === "racing" || this.state.phase === "countdown")
      )
        this.pause();
      if (key === "Enter" && this.state.phase === "menu") void this.start();
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    document.addEventListener("visibilitychange", this.visibility);
    void this.load();
  }
  private visibility = () => {
    if (
      document.hidden &&
      (this.state.phase === "racing" || this.state.phase === "countdown")
    )
      this.pause();
  };
  private resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.renderer.setPixelRatio(
      Math.min(
        devicePixelRatio,
        this.settings.quality === "high"
          ? 1.75
          : this.settings.quality === "medium"
            ? 1.25
            : 1,
      ),
    );
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  private emit() {
    this.renderer.domElement.dataset.fps = this.state.fps.toFixed(0);
    this.renderer.domElement.dataset.skidCount = String(
      this.world?.tyreMarks.count ?? 0,
    );
    this.renderer.domElement.dataset.speedEffects =
      this.speedEffects.intensity.toFixed(2);
    this.renderer.domElement.dataset.frontSteer = (
      ((this.rig?.angles[0] ?? 0) * 180) /
      Math.PI
    ).toFixed(1);
    this.renderer.domElement.dataset.bodyPitch = (
      ((this.rig?.pitch ?? 0) * 180) /
      Math.PI
    ).toFixed(2);
    this.renderer.domElement.dataset.frontSuspension = (
      this.rig?.lengths[0] ?? 0
    ).toFixed(4);
    this.renderer.domElement.dataset.rearSuspension = (
      this.rig?.lengths[2] ?? 0
    ).toFixed(4);
    this.renderer.domElement.dataset.wallScrape =
      this.state.wallScrape.toFixed(2);
    this.renderer.domElement.dataset.driftAngle =
      this.state.driftAngle.toFixed(1);
    this.renderer.domElement.dataset.driftTarget = (
      ((this.physics?.driftTargetAngle ?? 0) * 180) /
      Math.PI
    ).toFixed(1);
    this.publish({ ...this.state });
  }
  private async load() {
    try {
      const manager = new T.LoadingManager();
      manager.onProgress = (_, loaded, total) => {
        this.state.loaded = Math.min(85, (loaded / total) * 85);
        this.emit();
      };
      const loader = new GLTFLoader(manager);
      const [land, car, collision, route] = await Promise.all([
        loader.loadAsync("/assets/Coastal_Circuit.glb"),
        loader.loadAsync("/assets/Sparrow_One_Animated.glb"),
        loader.loadAsync("/assets/Road_Collision.glb"),
        fetch("/assets/track_route.json").then((r) => {
          if (!r.ok) throw new Error("路线数据未能载入");
          return r.json() as Promise<RouteData>;
        }),
      ]);
      if (this.disposed) return;
      this.track = new Track(route);
      this.race = new Race(this.track);
      this.world = new World(this.scene, this.track, land.scene);
      this.model = car.scene;
      this.model.rotation.y = Math.PI / 2;
      this.model.position.y = -0.84;
      this.model.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            if (m instanceof T.MeshStandardMaterial) {
              m.metalness = Math.min(m.metalness, 0.35);
              m.roughness = Math.max(m.roughness, 0.38);
            }
          });
        }
        if (o instanceof T.Light) o.visible = false;
      });
      this.rig = new CarRig(this.model);
      this.car.add(this.model);
      this.scene.add(this.car);
      this.state.loaded = 90;
      this.emit();
      this.physics = await Physics.create(collision.scene, this.track);
      if (this.disposed) {
        this.physics.dispose();
        return;
      }
      this.physics.reset(this.track, 760);
      for (let i = 0; i < 90; i++)
        this.physics.step(
          1 / 60,
          { throttle: 0, brake: 0, steer: 0, handbrake: true, boost: false },
          true,
          false,
        );
      this.setSettings(this.settings);
      this.syncCar();
      this.world.setGate(0);
      this.state.loaded = 100;
      this.state.phase = "menu";
      this.updateCamera(1);
      this.emit();
      this.animation = requestAnimationFrame(this.frame);
    } catch (error) {
      console.error(error);
      this.state.phase = "error";
      this.state.error = error instanceof Error ? error.message : String(error);
      this.emit();
    }
  }
  setSettings(settings: Settings) {
    const qualityChanged = this.settings.quality !== settings.quality;
    this.settings = settings;
    this.settingsChanged(settings);
    try {
      localStorage.setItem("cloudcape.settings", JSON.stringify(settings));
    } catch {
      /* Browser storage may be disabled. */
    }
    this.resize();
    if (qualityChanged || !this.cameraReady)
      this.world?.quality(settings.quality);
  }
  async start() {
    if (!this.physics || !this.track || !this.race) return;
    try {
      await this.audio.start();
    } catch {
      /* Audio failure does not prevent racing. */
    }
    this.input.clear();
    this.skidActive.fill(false);
    this.showcase = false;
    this.race.reset();
    this.physics.reset(this.track, 0);
    this.state = {
      ...this.state,
      phase: "countdown",
      countdown: 3,
      speed: 0,
      gear: 1,
      rpm: 1000,
      boosting: false,
      inWind: false,
      wallScrape: 0,
      driftAngle: 0,
      energy: 35,
      checkpoint: 0,
      time: 0,
      progress: 0,
      notice: "",
      previousBest: this.state.best,
      offRoad: false,
      wrongWay: false,
    };
    this.countdownTime = 3;
    this.lastCount = 3;
    this.world?.setGate(0);
    this.audio.beep(440);
    this.cameraReady = false;
    this.accumulator = 0;
    this.syncCar();
    this.emit();
  }
  menu() {
    if (!this.physics || !this.track) return;
    this.input.clear();
    this.physics.reset(this.track, 760);
    for (let i = 0; i < 60; i++)
      this.physics.step(
        1 / 60,
        { throttle: 0, brake: 0, steer: 0, handbrake: true, boost: false },
        true,
        false,
      );
    this.state.phase = "menu";
    this.state.notice = "";
    this.cameraReady = false;
    this.showcase = false;
    this.syncCar();
    this.emit();
  }
  pause() {
    if (this.state.phase !== "racing" && this.state.phase !== "countdown")
      return;
    this.resumePhase = this.state.phase;
    this.state.phase = "paused";
    this.input.clear();
    this.emit();
  }
  togglePause() {
    if (this.state.phase === "paused") {
      this.state.phase = this.resumePhase;
      (document.activeElement as HTMLElement)?.blur();
      this.input.clear();
      this.emit();
    } else this.pause();
  }
  reset() {
    if (
      this.state.phase !== "racing" ||
      !this.physics ||
      !this.track ||
      !this.race
    )
      return;
    this.skidActive.fill(false);
    this.physics.reset(this.track, this.race.safeIndex);
    this.race.relocated(this.physics.position);
    this.race.addResetPenalty();
    this.state.time = this.race.elapsed;
    this.state.speed = 0;
    this.state.gear = 1;
    this.state.rpm = 1000;
    this.state.progress = this.race.passed / 8;
    this.state.boosting = false;
    this.state.wallScrape = this.state.driftAngle = 0;
    this.state.offRoad = false;
    this.state.wrongWay = false;
    this.cameraReady = false;
    this.notice("回到安全路段 · +3 秒");
    this.emit();
  }
  private notice(message: string) {
    this.state.notice = message;
    this.noticeUntil = this.clock + 2.4;
  }
  private syncCar(alpha = 1, dt = 1 / 60) {
    if (!this.physics || !this.model) return;
    const p = this.physics;
    this.car.position.lerpVectors(p.previousPosition, p.position, alpha);
    this.car.quaternion.copy(p.previousRotation).slerp(p.rotation, alpha);
    this.rig?.update(p, alpha, dt);
  }

  private fixed(dt: number) {
    const p = this.physics!,
      track = this.track!,
      race = this.race!;
    const active = this.state.phase === "racing";
    let input = this.input.read();
    if (!active)
      input = {
        throttle: 0,
        brake: 0,
        steer: 0,
        handbrake: true,
        boost: false,
      };
    else if (!input.throttle && !input.brake && p.speed < 0.5)
      input.handbrake = true;
    const nearest = track.nearest(p.position);
    const inWind = track.wind(nearest.index) && nearest.distance < 3.7;
    this.state.inWind = active && inWind;
    this.state.boosting =
      active &&
      input.boost &&
      this.state.energy > 0 &&
      p.forwardSpeed > 2 &&
      p.wallScrape < 0.2;
    if (active) {
      if (inWind && p.speed > 4)
        this.state.energy = Math.min(100, this.state.energy + dt * 24);
      if (this.state.boosting)
        this.state.energy = Math.max(0, this.state.energy - dt * 23);
    }
    const beforeSpeed = p.speed;
    p.step(dt, input, this.settings.assists, this.state.boosting);
    this.state.wallScrape = active ? p.wallScrape : 0;
    this.state.driftAngle =
      active && input.handbrake ? (Math.abs(p.slipAngle) * 180) / Math.PI : 0;
    if (
      active &&
      beforeSpeed - p.speed > 2 &&
      this.clock - this.lastImpact > 0.25
    ) {
      this.audio.impact(beforeSpeed - p.speed);
      this.lastImpact = this.clock;
    }
    const deceleration = (beforeSpeed - p.speed) / dt;
    const hardBrake =
      active && input.brake > 0 && p.forwardSpeed > 2 && deceleration > 3;
    for (let n = 0; n < 4; n++) {
      const wheel = p.wheel(n);
      const sliding =
        active &&
        p.speed > 3 &&
        wheel.HasContact() &&
        (hardBrake || (n >= 2 && (p.drifting || input.handbrake)));
      if (!sliding) {
        this.skidActive[n] = false;
        continue;
      }
      const contact = wheel.GetContactPosition(),
        normal = wheel.GetContactNormal();
      const point = new T.Vector3(
        contact.GetX(),
        contact.GetY(),
        contact.GetZ(),
      );
      const distance = this.lastSkids[n].distanceTo(point);
      if (this.skidActive[n] && distance >= 0.06 && distance < 2) {
        const strength = Math.max(
          hardBrake ? 0.7 : 0,
          Math.min(0.88, 0.5 + Math.abs(p.slipAngle) * 0.7),
        );
        this.world!.skid(
          this.lastSkids[n],
          point,
          new T.Vector3(normal.GetX(), normal.GetY(), normal.GetZ()),
          strength,
        );
      }
      if (!this.skidActive[n] || distance >= 0.06)
        this.lastSkids[n].copy(point);
      this.skidActive[n] = true;
    }
    this.state.speed = p.speed * 3.6;
    this.state.gear = p.controller.GetTransmission().GetCurrentGear();
    this.state.rpm = p.controller.GetEngine().GetCurrentRPM();
    this.state.x = p.position.x;
    this.state.z = p.position.z;
    const heading = new T.Vector3(0, 0, 1).applyQuaternion(p.rotation);
    this.state.heading = Math.atan2(heading.x, heading.z);
    if (active) {
      const crossed = race.update(dt, p.position);
      this.state.time = race.elapsed;
      this.state.checkpoint = race.passed;
      if (crossed) {
        this.world!.setGate(race.passed);
        this.audio.beep(880, 0.13);
        this.notice(race.finished ? "冲线！" : `检查点 ${race.passed} / 8`);
      }
      const completed = race.passed / 8;
      const segment =
        race.passed === 0 && nearest.index > track.points.length * 0.8
          ? 0
          : nearest.index / track.points.length;
      this.state.progress = Math.max(
        completed,
        Math.min((race.passed + 1) / 8, segment),
      );
      this.state.offRoad = nearest.distance > track.width * 0.68;
      this.state.wrongWay =
        p.speed > 2 &&
        p.velocity.clone().normalize().dot(track.tangent(nearest.index)) <
          -0.25;
      if (
        p.position.y < track.point(nearest.index).y - 7 ||
        p.position.y > 100 ||
        !Number.isFinite(p.position.x)
      ) {
        this.reset();
      }
      if (race.finished) {
        this.state.phase = "finished";
        this.state.progress = 1;
        this.state.previousBest = this.state.best;
        if (this.state.best === null || race.elapsed < this.state.best) {
          this.state.best = race.elapsed;
          try {
            localStorage.setItem("cloudcape.best", String(race.elapsed));
          } catch {
            this.notice("浏览器未允许保存成绩");
          }
        }
        this.input.clear();
        this.audio.beep(1100, 0.4);
        this.emit();
      }
    }
  }
  private updateCamera(dt: number) {
    if (!this.physics) return;
    const p = this.physics;
    const menu = this.state.phase === "menu";
    const position = this.car.position;
    const heading = new T.Vector3(0, 0, 1).applyQuaternion(this.car.quaternion);
    heading.y = 0;
    heading.normalize();
    let desired: T.Vector3, look: T.Vector3;
    if (menu) {
      const angle = this.showcase ? this.clock * 0.18 : 0.65;
      const side = new T.Vector3(heading.z, 0, -heading.x);
      desired = position
        .clone()
        .addScaledVector(heading, Math.cos(angle) * 7.6)
        .addScaledVector(side, Math.sin(angle) * 9);
      desired.y += 1.7;
      look = position.clone().add(new T.Vector3(0, 0.2, 0));
      // Place the vehicle to the right of the menu composition using the camera's view offset.
      this.camera.setViewOffset(
        this.host.clientWidth,
        this.host.clientHeight,
        -this.host.clientWidth * (this.host.clientWidth > 700 ? 0.16 : 0),
        0,
        this.host.clientWidth,
        this.host.clientHeight,
      );
    } else {
      this.camera.clearViewOffset();
      const follow = heading.clone();
      if (p.speed > 4) {
        const v = p.velocity.clone();
        v.y = 0;
        v.normalize();
        follow.lerp(v, p.drifting ? 0.55 : 0.2).normalize();
      }
      this.travelDirection.lerp(follow, 1 - Math.exp(-dt * 4));
      if (!this.cameraReady) this.travelDirection.copy(follow);
      const distance =
        (this.settings.camera === "far" ? 7.8 : 5.8) +
        Math.min(p.speed / 18, 1.5) +
        (this.state.boosting && !this.motionPreference.matches ? 0.8 : 0);
      desired = position
        .clone()
        .addScaledVector(this.travelDirection, -distance);
      desired.y += this.settings.camera === "far" ? 3.4 : 2.8;
      // Keep the complete car in view at low speed so tyres and suspension can be read.
      look = position
        .clone()
        .addScaledVector(heading, 2.2 + Math.min(p.speed * 0.06, 1.5));
      look.y += 0.7;
      const side = new T.Vector3(heading.z, 0, -heading.x);
      look.addScaledVector(side, -p.steering * 1.2);
      // Ground clearance for camera on uphill sections.
      if (this.track) {
        const nearest = this.track.nearest(desired);
        if (nearest.distance < 10)
          desired.y = Math.max(
            desired.y,
            this.track.point(nearest.index).y + 1.5,
          );
      }
    }
    const damping = this.cameraReady ? 1 - Math.exp(-dt * 5) : 1;
    this.camera.position.lerp(desired, damping);
    this.cameraLook.lerp(look, damping);
    this.camera.lookAt(this.cameraLook);
    const fov = menu
      ? 44
      : 50 +
        (this.motionPreference.matches
          ? 0
          : Math.min(p.speed * 0.18, 7) + (this.state.boosting ? 6 : 0));
    this.camera.fov = T.MathUtils.damp(this.camera.fov, fov, 3, dt);
    this.camera.updateProjectionMatrix();
    this.cameraReady = true;
  }
  private frame = (timestamp: number) => {
    if (this.disposed) return;
    const rawDt = (timestamp - (this.last || timestamp)) / 1000;
    const dt = Math.min(rawDt, 0.08);
    this.last = timestamp;
    this.clock += dt;
    this.state.fps = T.MathUtils.damp(
      this.state.fps,
      1 / Math.max(rawDt, 0.001),
      2,
      dt,
    );
    const phase = this.state.phase;
    if (phase === "countdown") {
      this.countdownTime -= dt;
      const count = Math.ceil(this.countdownTime);
      this.state.countdown = Math.max(0, count);
      if (count !== this.lastCount && count > 0) {
        this.audio.beep(440);
        this.lastCount = count;
      }
      if (this.countdownTime <= 0) {
        this.state.phase = "racing";
        this.audio.beep(880, 0.3);
        this.notice("出发，追着风！");
      }
    }
    if (["racing", "countdown", "finished"].includes(phase)) {
      this.accumulator += dt;
      while (this.accumulator >= PHYSICS_STEP) {
        this.fixed(PHYSICS_STEP);
        this.accumulator -= PHYSICS_STEP;
      }
      this.interpolation = this.accumulator / PHYSICS_STEP;
    } else if (phase === "menu") this.interpolation = 1;
    this.syncCar(this.interpolation, dt);
    this.updateCamera(dt);
    const p = this.physics!;
    const drifting = this.state.phase === "racing" && p.drifting;
    this.world!.update(
      dt,
      this.clock,
      this.car.position,
      p.speed,
      drifting,
      this.state.inWind,
    );
    this.speedEffects.update(
      dt,
      p.speed,
      this.state.boosting,
      this.state.phase === "racing",
      this.camera.aspect,
      this.motionPreference.matches,
    );
    this.audio.update(
      this.state.rpm,
      p.speed,
      drifting,
      this.settings.volume,
      ["racing", "countdown"].includes(this.state.phase),
    );
    if (this.state.notice && this.clock > this.noticeUntil)
      this.state.notice = "";
    this.renderer.render(this.scene, this.camera);
    if (timestamp - this.lastUI > 80) {
      this.emit();
      this.lastUI = timestamp;
    }
    this.animation = requestAnimationFrame(this.frame);
  };
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    this.input.dispose();
    this.audio.dispose();
    this.physics?.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Points || o instanceof T.Line) {
        geometries.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          materials.add(m);
          Object.values(m).forEach((v) => {
            if (v instanceof T.Texture) textures.add(v);
          });
        });
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    this.world?.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
