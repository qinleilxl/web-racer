import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { CoastalAtmosphere } from "./CoastalAtmosphere";
import { menuDistanceScale } from "./CameraViews";
import { prepareHomeVehicle } from "./HomeVehicleVisual";
import { VEHICLES, type VehicleId } from "./Vehicles";
import { ConvertibleRoof } from "./ConvertibleRoof";
import { prepareVehicleGlass } from "./VehicleGlass";
import { disposeObjectResources } from "./GraphicsResources";
import type { Settings, Snapshot } from "./types";

/** A real 3D vehicle stage. It has no track data, Jolt, audio or race simulation. */
export class Showroom {
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(44, 1, 0.1, 4000);
  private renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  private model?: T.Group;
  private roof?: ConvertibleRoof;
  private atmosphere: CoastalAtmosphere;
  private origin = new T.Vector3();
  private heading = new T.Vector3(0,0,1);
  private elapsed = 0;
  private observer: ResizeObserver;
  private animation = 0;
  private disposed = false;
  private active = true;
  private modelSize = 4.4;
  private modelHeight = 1.6;
  private lastTime = 0;
  private lastRoof = "";

  constructor(
    private host: HTMLDivElement,
    quality: Settings["quality"],
    private onRoof: (roof: Snapshot["roof"]) => void,
  ) {
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality !== "low";
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, quality === "high" ? 1.5 : 1.25));
    this.renderer.domElement.dataset.previewReady = "false";
    this.renderer.domElement.dataset.previewInstance = T.MathUtils.generateUUID();
    host.appendChild(this.renderer.domElement);
    this.atmosphere = new CoastalAtmosphere(this.scene);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.animation = requestAnimationFrame(this.frame);
  }

  async load(id: VehicleId) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [asset, coast] = await Promise.all([
      loader.loadAsync(`/assets/showroom/${id}.glb`),
      loader.loadAsync("/assets/showroom/coast.glb"),
    ]);
    if (this.disposed) { disposeObjectResources(asset.scene); disposeObjectResources(coast.scene); return; }
    coast.scene.traverse((node) => {
      if (node.userData.origin) {
        this.origin.fromArray(node.userData.origin);
        this.heading.fromArray(node.userData.heading).setY(0).normalize();
      }
      if (node instanceof T.Mesh) { node.castShadow = true; node.receiveShadow = true; }
    });
    this.scene.add(coast.scene);
    this.atmosphere.update(0,this.origin);
    this.model = asset.scene;
    this.model.traverse((node) => {
      if (node instanceof T.Mesh) { node.castShadow = true; node.receiveShadow = true; }
      if (node instanceof T.Light) node.visible = false;
    });
    prepareVehicleGlass(this.model, VEHICLES[id]);
    prepareHomeVehicle(this.model);
    if (VEHICLES[id].convertible) this.roof = new ConvertibleRoof(this.model, asset.animations);
    const bounds = new T.Box3().setFromObject(this.model), size = bounds.getSize(new T.Vector3()), center = bounds.getCenter(new T.Vector3());
    this.model.position.sub(new T.Vector3(center.x, bounds.min.y, center.z));
    this.modelSize = Math.max(size.x, size.z);
    this.modelHeight = size.y;
    const vehicle = new T.Group();
    vehicle.position.copy(this.origin);
    vehicle.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),this.heading)
      .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.PI/2));
    vehicle.add(this.model);
    this.scene.add(vehicle);
    this.renderer.domElement.dataset.previewVehicle = id;
    this.resize();
    await this.renderer.compileAsync(this.scene,this.camera);
    if (this.disposed) return;
    this.renderer.render(this.scene,this.camera);
    this.renderer.domElement.dataset.previewReady = "true";
    this.publishRoof();
  }
  toggleRoof() { this.roof?.toggle(); this.publishRoof(); }
  restoreRoof(state: Snapshot["roof"]) {
    if (!this.roof || !state) return;
    this.roof.progress = state.progress;
    this.roof.targetOpen = state.targetOpen;
    this.roof.update(0);
    this.publishRoof();
    this.renderer.render(this.scene, this.camera);
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.renderer.domElement.dataset.previewActive = String(active);
    if (active) this.resize();
  }
  private publishRoof() {
    const roof = this.roof ? {progress:this.roof.progress,targetOpen:this.roof.targetOpen,status:this.roof.status} : undefined;
    const signature = roof ? `${roof.status}:${Math.round(roof.progress*100)}` : "none";
    if (signature !== this.lastRoof) { this.lastRoof = signature; this.onRoof(roof); }
  }
  private resize() {
    const width = this.host.clientWidth, height = Math.max(1, this.host.clientHeight), aspect = width/height;
    this.renderer.setSize(width,height);
    this.camera.aspect = aspect;
    const framing = menuDistanceScale(width,height,false) * Math.max(1,this.modelSize/4.42);
    const side = new T.Vector3(this.heading.z,0,-this.heading.x);
    const look = this.origin.clone().add(new T.Vector3(0,this.modelHeight*.55,0));
    this.camera.position.copy(this.origin)
      .addScaledVector(this.heading,Math.cos(.65)*7.6*framing)
      .addScaledVector(side,Math.sin(.65)*9*framing);
    this.camera.position.y += this.modelHeight*.55 + 1.5*Math.sqrt(framing);
    this.camera.lookAt(look);
    this.camera.setViewOffset(width,height,-width*(width>700 ? .16 : 0),height*(aspect<1 ? .04 : 0),width,height);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene,this.camera);
  }
  private frame = (time: number) => {
    if (this.disposed) return;
    this.animation = requestAnimationFrame(this.frame);
    if (!this.active) { this.lastTime = time; return; }
    if (time-this.lastTime < 32) return;
    const dt = Math.min(.1,(time-this.lastTime)/1000); this.lastTime=time;
    this.elapsed += dt;
    this.atmosphere.update(this.elapsed,this.origin);
    this.roof?.update(dt); this.publishRoof();
    this.renderer.render(this.scene,this.camera);
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.animation); this.observer.disconnect();
    this.roof?.dispose(); disposeObjectResources(this.scene);
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
