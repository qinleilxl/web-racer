import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { VEHICLES, type VehicleId } from "./Vehicles";
import { ConvertibleRoof } from "./ConvertibleRoof";
import { prepareVehicleGlass } from "./VehicleGlass";
import { disposeObjectResources } from "./GraphicsResources";
import type { Settings, Snapshot } from "./types";

/** A real 3D vehicle stage. It has no track data, Jolt, audio or race simulation. */
export class Showroom {
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(43, 1, 0.1, 300);
  private renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  private model?: T.Group;
  private roof?: ConvertibleRoof;
  private environment: T.WebGLRenderTarget;
  private observer: ResizeObserver;
  private animation = 0;
  private disposed = false;
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
    host.appendChild(this.renderer.domElement);
    this.scene.background = new T.Color("#aec9bf");
    this.scene.fog = new T.Fog("#aec9bf", 48, 180);
    this.scene.add(new T.HemisphereLight("#eaf5e4", "#6d8065", 2.1));
    const sun = new T.DirectionalLight("#fff0ce", 2.6);
    sun.position.set(-7, 10, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    const pmrem = new T.PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    room.dispose(); pmrem.dispose();
    const plane = (width: number, depth: number, color: string, y: number, z: number) => {
      const mesh = new T.Mesh(new T.PlaneGeometry(width, depth), new T.MeshStandardMaterial({ color, roughness: .86 }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, y, z); mesh.receiveShadow = true;
      this.scene.add(mesh); return mesh;
    };
    plane(350, 350, "#7faeac", -0.3, -75);
    plane(240, 12, "#939b8d", -0.015, 0);
    for (const z of [-4.8, 4.8]) plane(240, .11, "#f3f0da", 0, z);
    const wall = new T.Mesh(new T.BoxGeometry(240, .65, .28), new T.MeshStandardMaterial({ color: "#e4e7d2", roughness: .95 }));
    wall.position.set(0, .31, -5.5); wall.receiveShadow = true; this.scene.add(wall);
    const cloudMaterial = new T.MeshStandardMaterial({color:"#eef1db",roughness:1});
    const cloudGeometry = new T.SphereGeometry(1, 12, 8);
    for (const [x,y,z,s] of [[-32,17,-60,6],[8,23,-85,9],[42,17,-70,7]]) {
      for (let i = 0; i < 4; i++) {
        const cloud = new T.Mesh(cloudGeometry,cloudMaterial);
        cloud.position.set(x+(i-1.5)*s*.65,y+(i%2)*s*.2,z);
        cloud.scale.set(s, s*.45, s*.55); this.scene.add(cloud);
      }
    }
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.animation = requestAnimationFrame(this.frame);
  }

  async load(id: VehicleId) {
    const asset = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/assets/showroom/${id}.glb`);
    if (this.disposed) { disposeObjectResources(asset.scene); return; }
    this.model = asset.scene;
    this.model.traverse((node) => {
      if (node instanceof T.Mesh) { node.castShadow = true; node.receiveShadow = true; }
      if (node instanceof T.Light) node.visible = false;
    });
    prepareVehicleGlass(this.model, VEHICLES[id]);
    if (VEHICLES[id].convertible) this.roof = new ConvertibleRoof(this.model, asset.animations);
    const bounds = new T.Box3().setFromObject(this.model), size = bounds.getSize(new T.Vector3()), center = bounds.getCenter(new T.Vector3());
    this.model.position.sub(new T.Vector3(center.x, bounds.min.y, center.z));
    this.modelSize = Math.max(size.x, size.z);
    this.modelHeight = size.y;
    this.scene.add(this.model);
    this.renderer.domElement.dataset.previewVehicle = id;
    this.renderer.domElement.dataset.previewReady = "true";
    this.resize();
    this.publishRoof();
  }
  toggleRoof() { this.roof?.toggle(); this.publishRoof(); }
  private publishRoof() {
    const roof = this.roof ? {progress:this.roof.progress,targetOpen:this.roof.targetOpen,status:this.roof.status} : undefined;
    const signature = roof ? `${roof.status}:${Math.round(roof.progress*100)}` : "none";
    if (signature !== this.lastRoof) { this.lastRoof = signature; this.onRoof(roof); }
  }
  private resize() {
    const width = this.host.clientWidth, height = Math.max(1, this.host.clientHeight), aspect = width/height;
    this.renderer.setSize(width,height);
    this.camera.aspect = aspect;
    const distance = Math.max(this.modelSize*1.7,this.modelSize/(Math.max(.25,aspect)*.7));
    const look = new T.Vector3(0,this.modelHeight*.46,0);
    this.camera.position.copy(look).addScaledVector(new T.Vector3(-.8,.32,.85).normalize(),distance);
    this.camera.lookAt(look);
    this.camera.setViewOffset(width,height,-width*(aspect>1 ? .18 : 0),height*(aspect<1 ? .04 : 0),width,height);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene,this.camera);
  }
  private frame = (time: number) => {
    if (this.disposed) return;
    this.animation = requestAnimationFrame(this.frame);
    if (time-this.lastTime < 32) return;
    const dt = Math.min(.1,(time-this.lastTime)/1000); this.lastTime=time;
    this.roof?.update(dt); this.publishRoof();
    this.renderer.render(this.scene,this.camera);
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.animation); this.observer.disconnect();
    this.roof?.dispose(); disposeObjectResources(this.scene); this.environment.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
