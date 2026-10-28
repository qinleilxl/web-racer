import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { modelAssetUrl } from "./ModelAsset";
import { Physics, type PhysicsEnvironment } from "./Physics";
import { createTestGround, TEST_GROUND_SIZE } from "./TestGround";
import { createCoastalCircuit } from "./CoastalCircuit";
import { mapFromSearch, mapURL } from "./MapMode";
import {
  nextCameraMode,
  chaseDistance,
  menuDistanceScale,
} from "./CameraViews";
import { frameTime } from "./FrameTime";
import { ConvertibleRoof } from "./ConvertibleRoof";
import { prepareVehicleGlass } from "./VehicleGlass";
import {
  VEHICLES,
  vehicleFromSearch,
  vehicleURL,
  type VehicleId,
  type VehicleDefinition,
} from "./Vehicles";
import {
  loadTuning,
  sanitizeTuning,
  saveTuning,
  tuningIsStandard,
  type PhysicsTuning,
} from "./Tuning";
import { Track, type RouteData } from "./Track";
import { Race } from "./Race";
import { InputManager } from "./Input";
import { GameAudio } from "./Audio";
import { World } from "./World";
import { PHYSICS_STEP } from "./Driving";
import { CarRig } from "./CarRig";
import { VehicleFeedback } from "./VehicleFeedback";
import { batchVehicleBody } from "./VehicleBatch";
import { SpeedEffects } from "./SpeedEffects";
import { disposeObjectResources } from "./GraphicsResources";

type PreparedVehicle = {
  model: T.Group;
  rig: CarRig;
  feedback: VehicleFeedback;
  cockpitGlass: T.Object3D[];
  physics: Physics;
  tuning: PhysicsTuning;
  roof?: ConvertibleRoof;
};
import {
  bestStorageKey,
  loadBest,
  type Settings,
  type Snapshot,
} from "./types";

export class Game {
  readonly mapId = mapFromSearch(location.search);
  vehicle = VEHICLES[vehicleFromSearch(location.search)];
  tuning = loadTuning(this.vehicle.id);
  private collision?: T.Object3D;
  private environment: PhysicsEnvironment = {};
  private feedback?: VehicleFeedback;
  private roof?: ConvertibleRoof;
  headlights = true;
  private cockpitGlass: T.Object3D[] = [];
  private sessionTuned = false;
  state: Snapshot = {
    mapId: this.mapId,
    vehicleId: this.vehicle.id,
    debugOpen: false,
    tuning: this.tuning,
    telemetry: null,
    customSetup: !tuningIsStandard(this.tuning, this.vehicle.id),
    tuningBusy: false,
    phase: "loading",
    loaded: 0,
    error: "",
    speed: 0,
    gear: 1,
    rpm: 1000,
    time: 0,
    best: loadBest(this.vehicle.id),
    previousBest: null,
    checkpoint: 0,
    totalCheckpoints: 8,
    progress: 0,
    energy: 35,
    boosting: false,
    inWind: false,
    wallScrape: 0,
    driftAngle: 0,
    countdown: this.mapId === "test" ? 0 : 3,
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
  audio = new GameAudio(this.vehicle.id);
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
  private startGeneration = 0;
  private vehicleSwitchGeneration = 0;
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
  private cameraAnchor = new T.Vector3();
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
      if (key === "F2") {
        if (this.mapId === "test") this.setDebugOpen(!this.state.debugOpen);
        else if (this.state.phase === "menu") this.enterTestGround();
      }
      if (
        this.mapId === "test" &&
        ["KeyA", "KeyZ", "Space", "ShiftLeft", "ShiftRight"].includes(key)
      )
        void this.audio.start().catch(() => {});
      if (key === "Escape") {
        if (this.state.debugOpen) this.setDebugOpen(false);
        else this.togglePause();
      }
      if (key === "KeyR") this.reset();
      if (key === "KeyC") this.cycleCamera();
      if (key === "KeyH") this.toggleHeadlights();
      if (key === "KeyO") this.toggleRoof();
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
    this.state.roof = this.roof
      ? {
          progress: this.roof.progress,
          targetOpen: this.roof.targetOpen,
          status: this.roof.status,
        }
      : undefined;
    this.renderer.domElement.dataset.roof = this.roof?.status ?? "unavailable";
    this.renderer.domElement.dataset.roofProgress = (
      this.roof?.progress ?? 0
    ).toFixed(3);
    this.renderer.domElement.dataset.instrumentSpeed = String(
      this.feedback?.speedKmh ?? 0,
    );
    this.renderer.domElement.dataset.instrumentKind =
      this.feedback?.instrumentKind ?? "none";
    this.renderer.domElement.dataset.brakeLight = String(
      this.feedback?.brakeOn ?? false,
    );
    this.renderer.domElement.dataset.reverseLight = String(
      this.feedback?.reverseOn ?? false,
    );
    this.renderer.domElement.dataset.headlights = String(
      this.feedback?.headlightsOn ?? false,
    );
    this.renderer.domElement.dataset.map = this.mapId;
    this.renderer.domElement.dataset.vehicle = this.vehicle.id;
    this.renderer.domElement.dataset.camera = this.settings.camera;
    this.renderer.domElement.dataset.controls = this.input.touchEnabled
      ? "touch"
      : "keyboard";
    this.renderer.domElement.dataset.autoThrottle = String(
      this.settings.autoThrottle && this.input.touchEnabled,
    );
    this.renderer.domElement.dataset.throttleInput = this.input
      .read()
      .throttle.toFixed(2);
    this.renderer.domElement.dataset.steeringInput = this.input
      .read()
      .steer.toFixed(2);
    this.state.tuning = this.tuning;
    this.state.customSetup =
      (this.mapId !== "test" && this.sessionTuned) ||
      !tuningIsStandard(this.tuning, this.vehicle.id);
    const telemetry = this.physics?.telemetry;
    this.state.telemetry = telemetry
      ? { ...telemetry, wheels: telemetry.wheels.map((w) => ({ ...w })) }
      : null;
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
      const training = this.mapId === "test";
      const [car, map] = await Promise.all([
        loader.loadAsync(modelAssetUrl(this.vehicle.asset)),
        training
          ? Promise.resolve(createTestGround())
          : Promise.all([
              loader.loadAsync("/assets/Coastal_Circuit.glb"),
              loader.loadAsync("/assets/Road_Collision.glb"),
              fetch("/assets/track_route.json").then((r) => {
                if (!r.ok) throw new Error("路线数据未能载入");
                return r.json() as Promise<RouteData>;
              }),
            ]).then(([land, collision, route]) =>
              createCoastalCircuit(land.scene, collision.scene, route),
            ),
      ]);
      if (this.disposed) return;
      this.track = map.track;
      this.environment = map.environment;
      this.race = new Race(this.track);
      this.world = new World(this.scene, this.track, map.terrain, {
        testGround: training,
      });
      this.world.quality(this.settings.quality);
      this.model = car.scene;
      const visual = this.prepareVehicleVisual(
        car.scene,
        car.animations,
        this.vehicle,
      );
      this.feedback = visual.feedback;
      this.roof = visual.roof;
      this.rig = visual.rig;
      this.cockpitGlass = visual.cockpitGlass;
      this.car.add(this.model);
      this.scene.add(this.car);
      this.state.loaded = 90;
      this.emit();
      this.collision = map.collision;
      this.physics = await Physics.create(
        this.collision,
        this.track,
        this.tuning,
        this.environment,
        this.vehicle.geometry,
      );
      if (this.disposed) {
        this.physics.dispose();
        return;
      }
      this.physics.reset(this.track, training ? 0 : 760);
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
      this.state.loaded = 97;
      this.emit();
      // Include hidden exhaust and speed effects before the player can accelerate.
      await this.renderer.compileAsync(this.scene, this.camera);
      if (this.disposed) return;
      this.state.loaded = 100;
      this.state.phase = training ? "racing" : "menu";
      this.state.energy = training ? 100 : 35;
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
  setDebugOpen(open: boolean) {
    this.state.debugOpen = this.mapId === "test" && open;
    this.input.clear();
    this.emit();
  }
  async applyTuning(value: PhysicsTuning) {
    if (this.mapId !== "test") throw new Error("请在试车场中应用调校");
    if (this.state.tuningBusy) throw new Error("参数正在应用，请稍候");
    if (!this.track || !this.collision || !this.physics)
      throw new Error("车辆还未准备完成");
    this.startGeneration++;
    const next = sanitizeTuning(value);
    const inSession = ["racing", "countdown", "paused", "finished"].includes(
      this.state.phase,
    );
    this.pause();
    this.input.clear();
    this.state.tuningBusy = true;
    this.emit();
    let replacement: Physics | undefined;
    try {
      replacement = await Physics.create(
        this.collision,
        this.track,
        next,
        this.environment,
        this.vehicle.geometry,
      );
      if (this.disposed) {
        replacement.dispose();
        replacement = undefined;
        return;
      }
      replacement.reset(
        this.track,
        this.mapId === "test" ? 0 : inSession ? this.race!.safeIndex : 760,
      );
      for (let i = 0; i < 120; i++)
        replacement.step(
          PHYSICS_STEP,
          { throttle: 0, brake: 0, steer: 0, handbrake: true, boost: false },
          true,
          false,
        );
      const previous = this.physics;
      this.physics = replacement;
      replacement = undefined;
      this.tuning = next;
      this.sessionTuned ||= inSession;
      this.race?.relocated(this.physics.position);
      this.skidActive.fill(false);
      this.accumulator = 0;
      this.interpolation = 1;
      this.cameraReady = false;
      this.state.speed = 0;
      this.state.gear = 1;
      this.state.rpm = 1000;
      this.state.boosting = false;
      this.state.wallScrape = this.state.driftAngle = 0;
      this.state.offRoad = this.state.wrongWay = false;
      if (inSession) {
        this.state.phase = "paused";
        this.resumePhase = "racing";
        this.state.progress = this.race!.passed / 8;
        if (this.race?.finished) {
          this.race.reset();
          this.resumePhase = "racing";
          this.state.time = this.state.checkpoint = this.state.progress = 0;
          this.world?.setGate(0);
        }
      }
      this.syncCar();
      previous.dispose();
      try {
        saveTuning(next, this.vehicle.id);
        this.notice("调校已应用 · 车辆已重置");
      } catch {
        this.notice("调校已应用，本次浏览器无法保存");
      }
    } finally {
      replacement?.dispose();
      this.state.tuningBusy = false;
      if (!this.disposed) this.emit();
    }
  }
  setSettings(settings: Settings) {
    const qualityChanged = this.settings.quality !== settings.quality;
    if (settings.camera !== this.settings.camera) this.cameraReady = false;
    this.settings = settings;
    this.input.configureControls(settings.controls, settings.autoThrottle);
    this.settingsChanged(settings);
    try {
      localStorage.setItem("cloudcape.settings", JSON.stringify(settings));
    } catch {
      /* Browser storage may be disabled. */
    }
    this.resize();
    if (qualityChanged) this.world?.quality(settings.quality);
  }
  cycleCamera() {
    this.setSettings({
      ...this.settings,
      camera: nextCameraMode(this.settings.camera),
    });
  }
  private prepareVehicleVisual(
    model: T.Group,
    clips: T.AnimationClip[],
    vehicle: VehicleDefinition,
  ) {
    const cockpitGlass: T.Object3D[] = [];
    model.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = o.receiveShadow = true;
        for (const material of Array.isArray(o.material)
          ? o.material
          : [o.material]) {
          if (
            (vehicle.glassMaterials ?? [vehicle.glassMaterial]).includes(
              material.name,
            )
          )
            cockpitGlass.push(o);
          if (
            material instanceof T.MeshStandardMaterial &&
            vehicle.id === "sparrow" &&
            !vehicle.rig
          ) {
            material.metalness = Math.min(material.metalness, 0.35);
            material.roughness = Math.max(material.roughness, 0.38);
          }
        }
      }
      if (o instanceof T.Light) o.visible = false;
    });
    prepareVehicleGlass(model, vehicle);
    const roof = vehicle.convertible
      ? new ConvertibleRoof(model, clips)
      : undefined;
    const feedback = new VehicleFeedback(model, vehicle),
      rig = new CarRig(model, vehicle);
    batchVehicleBody(model, clips);
    return { feedback, rig, cockpitGlass, roof };
  }

  private async prepareVehicle(
    id: VehicleId,
    current: () => boolean,
    progress: (value: number) => void,
  ): Promise<PreparedVehicle | undefined> {
    let model: T.Group | undefined, physics: Physics | undefined;
    try {
      const vehicle = VEHICLES[id],
        tuning = loadTuning(id);
      const asset = await new GLTFLoader().loadAsync(modelAssetUrl(vehicle.asset), (event) => {
        if (event.lengthComputable)
          progress(Math.min(75, (event.loaded / event.total) * 75));
      });
      model = asset.scene;
      if (!current()) return;
      const visual = this.prepareVehicleVisual(
        model,
        asset.animations,
        vehicle,
      );
      progress(80);
      physics = await Physics.create(
        this.collision!,
        this.track!,
        tuning,
        this.environment,
        vehicle.geometry,
      );
      if (!current()) return;
      physics.reset(
        this.track!,
        this.mapId === "test" || this.state.phase !== "menu" ? 0 : 760,
      );
      for (let i = 0; i < 120; i++)
        physics.step(
          PHYSICS_STEP,
          { throttle: 0, brake: 0, steer: 0, handbrake: true, boost: false },
          true,
          false,
        );
      progress(100);
      const prepared = { model, physics, tuning, ...visual };
      model = undefined;
      physics = undefined;
      return prepared;
    } finally {
      physics?.dispose();
      if (model) disposeObjectResources(model);
    }
  }

  async selectVehicle(id: VehicleId) {
    if (
      this.disposed ||
      !this.physics ||
      !this.track ||
      !this.collision ||
      !this.race ||
      !Object.hasOwn(VEHICLES, id) ||
      (this.state.tuningBusy && !this.state.vehicleLoading)
    )
      return;
    if (id === this.vehicle.id && !this.state.vehicleLoading) return;
    const generation = ++this.vehicleSwitchGeneration;
    this.startGeneration++;
    this.pause();
    this.input.clear();
    this.state.debugOpen = false;
    this.state.vehicleSwitchError = "";
    if (id === this.vehicle.id) {
      this.state.vehicleLoading = null;
      this.state.vehicleLoadProgress = 0;
      this.state.tuningBusy = false;
      this.emit();
      return;
    }
    this.state.vehicleLoading = id;
    this.state.vehicleLoadProgress = 0;
    this.state.tuningBusy = true;
    this.emit();
    let prepared: PreparedVehicle | undefined;
    const current = () =>
      !this.disposed && generation === this.vehicleSwitchGeneration;
    try {
      prepared = await this.prepareVehicle(id, current, (progress) => {
        if (!current()) return;
        this.state.vehicleLoadProgress = progress;
        this.emit();
      });
      if (!prepared || !current()) return;
      // The old car remains intact until every replacement resource is ready.
      this.audio.setVehicle(id);
      const oldModel = this.model,
        oldPhysics = this.physics,
        oldRoof = this.roof;
      if (oldModel) this.car.remove(oldModel);
      this.model = prepared.model;
      this.physics = prepared.physics;
      this.rig = prepared.rig;
      this.feedback = prepared.feedback;
      this.roof = prepared.roof;
      this.cockpitGlass = prepared.cockpitGlass;
      this.tuning = prepared.tuning;
      this.vehicle = VEHICLES[id];
      prepared = undefined;
      this.car.add(this.model);
      this.race!.reset();
      this.race!.relocated(this.physics.position);
      const best = loadBest(id);
      this.state = {
        ...this.state,
        vehicleId: id,
        phase: this.state.phase === "menu" ? "menu" : "paused",
        best,
        previousBest: best,
        speed: 0,
        rpm: 1000,
        gear: 1,
        time: 0,
        checkpoint: 0,
        progress: 0,
        countdown: this.mapId === "test" ? 0 : 3,
        boosting: false,
        inWind: false,
        energy: this.mapId === "test" ? 100 : 35,
        wallScrape: 0,
        driftAngle: 0,
        offRoad: false,
        wrongWay: false,
        telemetry: null,
      };
      this.resumePhase = "racing";
      this.sessionTuned = false;
      this.accumulator = 0;
      this.interpolation = 1;
      this.cameraReady = false;
      this.skidActive.fill(false);
      this.world?.setGate(0);
      this.syncCar();
      this.updateCamera(1);
      oldPhysics.dispose();
      oldRoof?.dispose();
      if (oldModel) disposeObjectResources(oldModel);
      this.renderer?.compile(this.scene, this.camera);
      try {
        localStorage.setItem("cloudcape.vehicle", id);
      } catch {
        /* URL remains usable. */
      }
      try {
        history.replaceState(history.state, "", vehicleURL(location.href, id));
      } catch {
        /* Embedded browsers may restrict history. */
      }
      this.notice(`已换乘${this.vehicle.name}`);
    } catch (error) {
      if (current()) {
        console.error("车辆切换失败", error);
        this.state.vehicleSwitchError = `未能切换车辆，仍使用${this.vehicle.name}，请重试。`;
      }
    } finally {
      prepared?.physics.dispose();
      prepared?.roof?.dispose();
      if (prepared) disposeObjectResources(prepared.model);
      if (current()) {
        this.state.tuningBusy = false;
        this.state.vehicleLoading = null;
        this.state.vehicleLoadProgress = 0;
        this.emit();
      }
    }
  }
  enterTestGround() {
    if (this.state.phase === "menu" && !this.state.tuningBusy)
      location.assign(mapURL(location.href, "test"));
  }
  async start() {
    if (
      this.disposed ||
      this.state.tuningBusy ||
      !this.physics ||
      !this.track ||
      !this.race
    )
      return;
    const generation = ++this.startGeneration;
    try {
      await this.audio.start();
    } catch {
      /* Audio failure does not prevent racing. */
    }
    // Audio resume may finish after another start, menu navigation or a rebuild.
    if (
      this.disposed ||
      this.state.tuningBusy ||
      generation !== this.startGeneration
    )
      return;
    this.sessionTuned = false;
    this.state.debugOpen = false;
    this.input.clear();
    this.skidActive.fill(false);
    this.showcase = false;
    this.race.reset();
    const countdown = this.mapId === "test" ? 0 : 3;
    this.physics.reset(this.track, 0);
    this.state = {
      ...this.state,
      phase: countdown ? "countdown" : "racing",
      countdown,
      speed: 0,
      gear: 1,
      rpm: 1000,
      boosting: false,
      inWind: false,
      wallScrape: 0,
      driftAngle: 0,
      energy: this.mapId === "test" ? 100 : 35,
      checkpoint: 0,
      time: 0,
      progress: 0,
      notice: "",
      previousBest: this.state.best,
      offRoad: false,
      wrongWay: false,
    };
    this.countdownTime = countdown;
    this.lastCount = countdown;
    this.world?.setGate(0);
    if (countdown) this.audio.beep(440);
    this.cameraReady = false;
    this.accumulator = 0;
    this.syncCar();
    this.emit();
  }
  menu() {
    this.startGeneration++;
    if (this.state.tuningBusy || !this.physics || !this.track) return;
    if (this.mapId === "test") {
      location.assign(mapURL(location.href, "coast"));
      return;
    }
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
    if (this.state.tuningBusy) return;
    if (this.state.phase === "paused") {
      this.state.phase = this.resumePhase;
      (document.activeElement as HTMLElement)?.blur();
      this.input.clear();
      this.emit();
    } else this.pause();
  }
  reset() {
    if (
      this.state.tuningBusy ||
      this.state.phase !== "racing" ||
      !this.physics ||
      !this.track ||
      !this.race
    )
      return;
    this.skidActive.fill(false);
    this.feedback?.exhaust.trail.clear();
    this.physics.reset(
      this.track,
      this.mapId === "test" ? 0 : this.race.safeIndex,
    );
    this.race.relocated(this.physics.position);
    if (this.mapId !== "test") this.race.addResetPenalty();
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
    this.notice(
      this.mapId === "test" ? "回到试车场起点" : "回到安全路段 · +3 秒",
    );
    this.emit();
  }
  private notice(message: string) {
    this.state.notice = message;
    this.noticeUntil = this.clock + 2.4;
  }
  toggleHeadlights() {
    this.headlights = !this.headlights;
    this.notice(
      this.vehicle.id === "formula"
        ? "Formula 后雨灯随制动反馈"
        : `前灯${this.headlights ? "已开启" : "已关闭"}`,
    );
    this.emit();
  }
  toggleRoof() {
    if (!this.roof) return;
    this.roof.toggle();
    this.emit();
  }
  private syncCar(alpha = 1, dt = 1 / 60) {
    if (!this.physics || !this.model) return;
    const p = this.physics;
    this.car.position.lerpVectors(p.previousPosition, p.position, alpha);
    this.car.quaternion.copy(p.previousRotation).slerp(p.rotation, alpha);
    this.rig?.update(p, alpha, dt);
    this.feedback?.update(
      {
        speed: p.speed,
        rpm: p.controller.GetEngine().GetCurrentRPM(),
        braking: p.braking,
        reversing: p.reversing,
        steer: this.input.read().steer,
        headlights: this.headlights,
        active: this.state.phase === "racing",
        throttle: this.input.read().throttle,
        handbrake: this.input.read().handbrake,
        boosting: this.state.boosting,
        velocity: p.velocity,
        yawRate: p.body.GetAngularVelocity().GetY(),
        viewportHeight: this.renderer.domElement.height,
      },
      dt,
    );
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
    const training = this.mapId === "test";
    const inWind =
      !training &&
      track.wind(nearest.index) &&
      nearest.distance < track.width / 2 - 0.3;
    this.state.inWind = active && inWind;
    this.state.boosting =
      active &&
      input.boost &&
      !input.brake &&
      !input.handbrake &&
      this.state.energy > 0 &&
      p.forwardSpeed > 2 &&
      p.wallScrape < 0.2;
    if (active) {
      if (training)
        this.state.energy = Math.min(100, this.state.energy + dt * 12);
      if (inWind && p.speed > 4)
        this.state.energy = Math.min(
          100,
          this.state.energy + dt * this.tuning.windRecharge,
        );
      if (this.state.boosting)
        this.state.energy = Math.max(0, this.state.energy - dt * 23);
    }
    const beforeSpeed = p.speed;
    p.step(dt, input, this.settings.assists, this.state.boosting);
    this.state.wallScrape = active ? p.wallScrape : 0;
    this.state.driftAngle =
      active && p.drifting ? (Math.abs(p.slipAngle) * 180) / Math.PI : 0;
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
      active &&
      (input.brake > 0 || input.handbrake) &&
      p.forwardSpeed > 2 &&
      deceleration > 3;
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
    if (active && training) {
      this.state.time += dt;
      this.state.offRoad = this.state.wrongWay = false;
      if (
        Math.abs(p.position.x) > TEST_GROUND_SIZE / 2 + 4 ||
        Math.abs(p.position.z) > TEST_GROUND_SIZE / 2 + 4 ||
        p.position.y < -7 ||
        !Number.isFinite(p.position.x)
      )
        this.reset();
      return;
    }
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
        if (
          !this.sessionTuned &&
          tuningIsStandard(this.tuning, this.vehicle.id) &&
          (this.state.best === null || race.elapsed < this.state.best)
        ) {
          this.state.best = race.elapsed;
          try {
            localStorage.setItem(
              bestStorageKey(this.vehicle.id),
              String(race.elapsed),
            );
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
    const cockpit = !menu && this.settings.camera === "cockpit";
    this.cockpitGlass.forEach((glass) => {
      glass.visible = !cockpit;
    });
    this.camera.near = cockpit ? 0.025 : 0.1;
    this.camera.up.copy(
      cockpit
        ? new T.Vector3(0, 1, 0).applyQuaternion(this.car.quaternion)
        : new T.Vector3(0, 1, 0),
    );
    const position = this.car.position;
    const heading = new T.Vector3(0, 0, 1).applyQuaternion(this.car.quaternion);
    heading.y = 0;
    heading.normalize();
    let desired: T.Vector3, look: T.Vector3;
    if (menu) {
      const angle =
        this.showcase && !this.motionPreference.matches
          ? this.clock * 0.1
          : 0.65;
      const framing = menuDistanceScale(
        this.host.clientWidth,
        this.host.clientHeight,
        this.showcase,
      );
      const side = new T.Vector3(heading.z, 0, -heading.x);
      desired = position
        .clone()
        .addScaledVector(heading, Math.cos(angle) * 7.6 * framing)
        .addScaledVector(side, Math.sin(angle) * 9 * framing);
      desired.y += 1.7 * Math.sqrt(framing);
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
    } else if (cockpit && this.model) {
      this.camera.clearViewOffset();
      desired = this.model.localToWorld(
        new T.Vector3(...this.vehicle.cockpitEye),
      );
      look = this.model.localToWorld(
        new T.Vector3(...this.vehicle.cockpitLook),
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
      this.travelDirection.lerp(follow, 1 - Math.exp(-dt * 4)).normalize();
      if (!this.cameraReady) this.travelDirection.copy(follow);
      const distance = chaseDistance(
        this.settings.camera,
        this.motionPreference.matches ? 0 : p.speed,
        this.camera.aspect,
      );
      desired = position
        .clone()
        .addScaledVector(this.travelDirection, -distance);
      desired.y += this.settings.camera === "far" ? 3 : 2.2;
      // Keep the complete car in view at low speed so tyres and suspension can be read.
      look = position
        .clone()
        .addScaledVector(heading, this.settings.camera === "far" ? 1.4 : 0.8);
      look.y += 0.35;
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
    const chase = !menu && !cockpit;
    const damping =
      this.cameraReady && !cockpit ? 1 - Math.exp(-dt * (chase ? 8 : 5)) : 1;
    if (chase && this.cameraReady) {
      // Keep a little translational lag for chase-camera weight. Feed forward
      // more of the travel at speed so the lag cannot grow into a distant zoom.
      const travel = position.clone().sub(this.cameraAnchor);
      const lag = this.settings.camera === "far" ? 0.55 : 0.45;
      const speed = travel.length() / Math.max(dt, 1e-6);
      const carry = this.motionPreference.matches
        ? 1
        : 1 - lag / (lag + speed / 8);
      this.camera.position.addScaledVector(travel, carry);
      this.cameraLook.add(travel);
    }
    this.camera.position.lerp(desired, damping);
    if (chase) {
      // Allow the orbit to breathe through turns without cutting into the car
      // or pulling away on acceleration. This is a limit, not a rigid mount.
      const offset = this.camera.position.clone().sub(position);
      const radius = Math.hypot(offset.x, offset.z);
      const distance = chaseDistance(
        this.settings.camera,
        this.motionPreference.matches ? 0 : p.speed,
        this.camera.aspect,
      );
      const limited = T.MathUtils.clamp(
        radius,
        distance - 0.35,
        distance + (this.settings.camera === "far" ? 0.55 : 0.45),
      );
      if (radius > 1e-6) {
        this.camera.position.x = position.x + (offset.x / radius) * limited;
        this.camera.position.z = position.z + (offset.z / radius) * limited;
      }
    }
    this.cameraLook.lerp(look, damping);
    this.camera.lookAt(this.cameraLook);
    const fov = menu ? 44 : cockpit ? 54 : 50;
    this.camera.fov = this.cameraReady
      ? T.MathUtils.damp(this.camera.fov, fov, 3, dt)
      : fov;
    this.camera.updateProjectionMatrix();
    this.cameraAnchor.copy(position);
    this.cameraReady = true;
  }
  private frame = (timestamp: number) => {
    if (this.disposed) return;
    const rawDt = (timestamp - (this.last || timestamp)) / 1000;
    const timing = frameTime(rawDt);
    const dt = timing.visual;
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
      this.countdownTime -= timing.simulation;
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
      this.accumulator += timing.simulation;
      while (this.accumulator >= PHYSICS_STEP) {
        this.fixed(PHYSICS_STEP);
        this.accumulator -= PHYSICS_STEP;
      }
      this.interpolation = this.accumulator / PHYSICS_STEP;
    } else if (phase === "menu") this.interpolation = 1;
    this.syncCar(this.interpolation, dt);
    this.roof?.update(timing.simulation);
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
    this.audio.update({
      rpm: this.state.rpm,
      speed: p.speed,
      throttle: this.state.phase === "racing" ? this.input.read().throttle : 0,
      braking: p.braking || this.input.read().handbrake,
      drifting,
      slipAngle: p.slipAngle,
      boosting: this.state.boosting,
      gear: this.state.gear,
      volume: this.settings.volume,
      active: ["racing", "countdown"].includes(this.state.phase),
      cockpit: this.settings.camera === "cockpit",
    });
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
    this.startGeneration++;
    this.vehicleSwitchGeneration++;
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    this.input.dispose();
    this.audio.dispose();
    this.roof?.dispose();
    this.physics?.dispose();
    disposeObjectResources(this.scene);
    this.world?.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
