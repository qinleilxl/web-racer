import initJolt from "jolt-physics/wasm";
import type Jolt from "jolt-physics";
import { Mesh, Object3D, Quaternion, Vector3 } from "three";
import { Track } from "./Track";
import type { Input } from "./types";
import {
  DRIFT,
  DriftControl,
  VEHICLE,
  steeringAngleLimit,
  roadCorneringWeight,
  speedSteeringGain,
} from "./Driving";
import { createRoadside } from "./Roadside";
import {
  DEFAULT_TUNING,
  sanitizeTuning,
  type PhysicsTuning,
  type PhysicsTelemetry,
} from "./Tuning";
import { tireImpulseBudget } from "./TireModel";
import { boundedRestitution, contactYawTarget } from "./CollisionResponse";
import { VEHICLES, type VehicleGeometry } from "./Vehicles";

export type PhysicsEnvironment = {
  roadside?: boolean;
  barriers?: Object3D;
  /** Seamless, level pad at y=0, centred on the origin. */
  flatGround?: { width: number; length: number };
};

export class Physics {
  private constructor(
    readonly J: typeof Jolt,
    readonly world: Jolt.JoltInterface,
    readonly system: Jolt.PhysicsSystem,
  ) {
    this.bi = system.GetBodyInterface();
  }
  tuning: PhysicsTuning = { ...DEFAULT_TUNING };
  geometry: VehicleGeometry = VEHICLES.sparrow.geometry;
  telemetry: PhysicsTelemetry = {
    slipAngle: 0,
    yawRate: 0,
    lateralG: 0,
    longitudinalG: 0,
    rearGrip: 1,
    wallContact: false,
    impactSpeed: 0,
    tcs: 0,
    abs: 0,
    wheels: Array.from({ length: 4 }, () => ({
      grounded: false,
      load: 0,
      slipRatio: 0,
      slipAngle: 0,
      gripUsage: 0,
      suspension: 0,
    })),
  };
  private tireCaps = Array.from({ length: 4 }, () => ({
    longitudinal: 0,
    lateral: 0,
    normalLoad: 0,
    loadScale: 1,
  }));
  private tcsReduction = 0;
  private absReduction = 0;
  private absWheels = new Float64Array(4);
  private bi: Jolt.BodyInterface;
  body!: Jolt.Body;
  vehicle!: Jolt.VehicleConstraint;
  controller!: Jolt.WheeledVehicleController;
  private listener!: Jolt.VehicleConstraintStepListener;
  private contactListener!: Jolt.ContactListenerJS;
  private wallContactTime = 0;
  private wallNormal = new Vector3();
  private wallRelease = false;
  private wallPinned = false;
  private wallTouched = false;
  private scrapeTime = 0;
  private wallGap = 0;
  private driftControl = new DriftControl();
  private lastTravel = new Vector3();
  private travelYaw = 0;
  private tester!: Jolt.VehicleCollisionTesterCastSphere;
  private tireCallback!: Jolt.WheeledVehicleControllerCallbacksJS;
  private constraintCallbacks!: Jolt.VehicleConstraintCallbacksJS;
  private surfaceGrip = [1, 1, 1, 1];
  private wallExitTime = 0;
  private wallInterruptedDrift = false;
  private driftBlend = 0;
  private rearGrip = 1;
  private corneringGrip = 0;
  private recoveryWeight = 0;
  private recoveryControl = false;
  private handbrakeStrength = 0;
  private handbrakeTime = 0;
  private throttle = 0;
  slipAngle = 0;
  drifting = false;
  braking = false;
  reversing = false;
  readonly previousPosition = new Vector3();
  readonly previousRotation = new Quaternion();
  readonly previousSuspension = new Float64Array(4);
  readonly previousRoll = new Float64Array(4);
  readonly previousSteer = new Float64Array(4);
  private bodies: Jolt.BodyID[] = [];
  private wheels: Jolt.Wheel[] = [];
  private force!: Jolt.Vec3;
  private torque!: Jolt.Vec3;
  private steer = 0;
  private brakeReverse = false;
  private brakeWasDown = false;
  private brakeStopTime = 0;
  private clutchStrength = 7;
  private reversalDirection = 0;
  position = new Vector3();
  rotation = new Quaternion();
  velocity = new Vector3();
  speed = 0;
  forwardSpeed = 0;
  contacts = 0;
  static async create(
    collision: Object3D,
    track: Track,
    tuning: PhysicsTuning = DEFAULT_TUNING,
    environment: PhysicsEnvironment = {},
    geometry: VehicleGeometry = VEHICLES.sparrow.geometry,
  ) {
    const wasmURL = new URL(
      "../../node_modules/jolt-physics/dist/jolt-physics.wasm.wasm",
      import.meta.url,
    ).href;
    const J = await initJolt({ locateFile: () => wasmURL });
    const settings = new J.JoltSettings();
    settings.mMaxWorkerThreads = 0;
    settings.mMaxBodies = 2048;
    // Ground=0, chassis=1, parapets=2, tyre query=3. Tyres never cast against walls.
    const pairs = new J.ObjectLayerPairFilterTable(4);
    pairs.EnableCollision(0, 1);
    pairs.EnableCollision(1, 2);
    pairs.EnableCollision(0, 3);
    const broad = new J.BroadPhaseLayerInterfaceTable(4, 2);
    const staticLayer = new J.BroadPhaseLayer(0),
      movingLayer = new J.BroadPhaseLayer(1);
    broad.MapObjectToBroadPhaseLayer(0, staticLayer);
    broad.MapObjectToBroadPhaseLayer(1, movingLayer);
    broad.MapObjectToBroadPhaseLayer(2, staticLayer);
    broad.MapObjectToBroadPhaseLayer(3, movingLayer);
    settings.mObjectLayerPairFilter = pairs;
    settings.mBroadPhaseLayerInterface = broad;
    settings.mObjectVsBroadPhaseLayerFilter =
      new J.ObjectVsBroadPhaseLayerFilterTable(broad, 2, pairs, 4);
    const world = new J.JoltInterface(settings);
    J.destroy(settings);
    J.destroy(staticLayer);
    J.destroy(movingLayer);
    const p = new Physics(J, world, world.GetPhysicsSystem());
    p.tuning = sanitizeTuning(tuning);
    p.geometry = geometry;
    const gravity = new J.Vec3(0, -p.tuning.gravity, 0);
    p.system.SetGravity(gravity);
    J.destroy(gravity);
    if (environment.flatGround) p.addFlatGround(environment.flatGround);
    else p.addMesh(collision, p.tuning.roadGrip);
    // Extend the collision plane above the chassis so it cannot perch on a wall edge.
    if (environment.roadside !== false) {
      const roadside = createRoadside(track, 2);
      p.addMesh(roadside.shoulders, p.tuning.shoulderGrip);
      p.addMesh(roadside.walls, 0, 2);
      roadside.shoulders.geometry.dispose();
      roadside.walls.geometry.dispose();
      (roadside.shoulders.material as import("three").Material).dispose();
    }
    if (environment.barriers) p.addMesh(environment.barriers, 0, 2);
    p.createCar();
    p.configureContacts();
    p.reset(track, 0);
    p.system.OptimizeBroadPhase();
    return p;
  }
  private configureContacts() {
    const J = this.J;
    this.contactListener = new J.ContactListenerJS();
    this.contactListener.OnContactValidate = () =>
      J.ValidateResult_AcceptAllContactsForThisBodyPair;
    const soften = (
      one: number,
      two: number,
      manifoldPointer: number,
      settingsPointer: number,
    ) => {
      const body1 = J.wrapPointer(one, J.Body),
        body2 = J.wrapPointer(two, J.Body);
      const first = body1.GetObjectLayer(),
        second = body2.GetObjectLayer();
      if (!((first === 1 && second === 2) || (first === 2 && second === 1)))
        return;
      const settings = J.wrapPointer(settingsPointer, J.ContactSettings);
      // Let contact position produce a small physical rotation; cap its authority
      // for this short-wheelbase car instead of deleting all angular response.
      settings.mCombinedFriction = this.tuning.wallFriction;
      const normal = J.wrapPointer(
        manifoldPointer,
        J.ContactManifold,
      ).mWorldSpaceNormal;
      // Jolt's normal points from body 1 to body 2; retain the direction away from the wall.
      this.wallNormal
        .set(normal.GetX(), 0, normal.GetZ())
        .multiplyScalar(first === 1 ? -1 : 1)
        .normalize();
      const v = this.body.GetLinearVelocity();
      const approach = Math.max(
        0,
        -(v.GetX() * this.wallNormal.x + v.GetZ() * this.wallNormal.z),
      );
      if (approach > 2 && !this.wallInterruptedDrift) {
        // The impact changed travel independently of the driver's drift. Do not
        // let that new slip keep an old countersteering target alive indefinitely.
        this.wallInterruptedDrift = true;
        this.driftControl.interrupt();
        this.recoveryWeight = 0;
      }
      // Preserve contact-point yaw at ordinary impact energies, taper angular
      // authority at high speeds so a corner strike cannot become a launch ramp.
      const rotationScale =
        (this.tuning.impactRotation / 100) *
        Math.min(
          1,
          28 / Math.max(28, Math.hypot(v.GetX(), v.GetZ())),
          18 / Math.max(18, approach),
        );
      if (first === 1) settings.mInvInertiaScale1 = rotationScale;
      else settings.mInvInertiaScale2 = rotationScale;
      // A noticeable small rebound, with an upper bound even for head-on boost impacts.
      settings.mCombinedRestitution = boundedRestitution(
        this.tuning.restitution,
        this.tuning.maxRebound,
        approach,
      );
      this.telemetry.impactSpeed = Math.max(
        this.telemetry.impactSpeed,
        approach,
      );
      this.wallTouched = true;
      this.wallContactTime = 0.22;
    };
    this.contactListener.OnContactAdded = soften;
    this.contactListener.OnContactPersisted = soften;
    this.contactListener.OnContactRemoved = () => {};
    this.system.SetContactListener(this.contactListener);
  }
  get touchingWall() {
    // A collision notification can remain recent after a clean rebound. Do not
    // let its old surface keep controlling steering for another 220 ms.
    return this.wallContactTime > 0 && this.wallGap < 1 / 30;
  }
  get wallScrape() {
    return Math.max(0, Math.min(1, (this.scrapeTime - 0.12) / 0.8));
  }
  get driftTargetAngle() {
    return this.driftControl.angle;
  }
  get rearGripFactor() {
    return this.rearGrip;
  }
  private addFlatGround({ width, length }: { width: number; length: number }) {
    const J = this.J;
    // A native convex slab has one continuous top face. Casting suspension
    // spheres against kilometre-wide mesh triangles can report false penetration
    // along their shared diagonal, compressing a wheel and kicking the car up.
    // Keep the top exactly at the rendered asphalt's y=0, with no bevel or seams.
    const half = new J.Vec3(width / 2, 1, length / 2);
    const shape = new J.BoxShape(half, 0);
    this.addBody(
      shape,
      new Vector3(0, -1, 0),
      new Quaternion(),
      false,
      this.tuning.roadGrip,
    );
    J.destroy(half);
  }
  private addMesh(root: Object3D, friction = 1.1, layer = 0) {
    const J = this.J;
    const triangles = new J.TriangleList();
    const a = new J.Vec3(),
      b = new J.Vec3(),
      c = new J.Vec3();
    const v = new Vector3();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const geometry = o.geometry;
      const position = geometry.attributes.position;
      const indices = geometry.index;
      for (let i = 0; i < (indices?.count ?? position.count); i += 3) {
        [a, b, c].forEach((j, k) => {
          v.fromBufferAttribute(
            position,
            indices ? indices.getX(i + k) : i + k,
          ).applyMatrix4(o.matrixWorld);
          j.Set(v.x, v.y, v.z);
        });
        const tri = new J.Triangle(a, b, c);
        triangles.push_back(tri);
        J.destroy(tri);
      }
    });
    const mesh = new J.MeshShapeSettings(triangles);
    mesh.Sanitize();
    if (layer === 2) mesh.mActiveEdgeCosThresholdAngle = -1;
    const result = mesh.Create();
    if (result.HasError()) throw new Error("赛道路面碰撞体创建失败");
    this.addBody(
      result.Get(),
      new Vector3(),
      new Quaternion(),
      false,
      friction,
      layer,
    );
    J.destroy(mesh);
    J.destroy(result);
    J.destroy(triangles);
    [a, b, c].forEach((o) => J.destroy(o));
  }
  private addBody(
    shape: Jolt.Shape,
    position: Vector3,
    rotation: Quaternion,
    dynamic: boolean,
    friction = 1.1,
    layer = 0,
  ) {
    const J = this.J;
    const pos = new J.RVec3(position.x, position.y, position.z);
    const q = new J.Quat(rotation.x, rotation.y, rotation.z, rotation.w);
    const settings = new J.BodyCreationSettings(
      shape,
      pos,
      q,
      dynamic ? J.EMotionType_Dynamic : J.EMotionType_Static,
      dynamic ? 1 : layer,
    );
    settings.mFriction = friction;
    settings.mRestitution = 0;
    if (dynamic) {
      settings.mOverrideMassProperties =
        J.EOverrideMassProperties_CalculateInertia;
      settings.mMassPropertiesOverride.mMass = this.tuning.mass;
      settings.mLinearDamping = 0.015;
      settings.mAngularDamping = 0.25;
      // At 120 Hz even boost moves less than the chassis half-width per step.
      // Discrete contacts avoid the CCD pass treating wall seams as impact edges.
      settings.mMotionQuality = J.EMotionQuality_Discrete;
      settings.mAllowSleeping = false;
      // Adjacent wall triangles form one surface, not tiny edges to crash into.
      settings.mEnhancedInternalEdgeRemoval = true;
    }
    const body = this.bi.CreateBody(settings);
    this.bi.AddBody(
      body.GetID(),
      dynamic ? J.EActivation_Activate : J.EActivation_DontActivate,
    );
    this.bodies.push(body.GetID());
    J.destroy(settings);
    J.destroy(pos);
    J.destroy(q);
    return body;
  }
  private createCar() {
    const J = this.J;
    const half = new J.Vec3(...this.geometry.halfExtents);
    const box = new J.BoxShapeSettings(half);
    const offset = new J.Vec3(0, -this.tuning.centerOfMass, 0);
    const shapeSettings = new J.OffsetCenterOfMassShapeSettings(offset, box);
    const result = shapeSettings.Create();
    this.body = this.addBody(
      result.Get(),
      new Vector3(0, 50, 0),
      new Quaternion(),
      true,
    );
    J.destroy(result);
    J.destroy(shapeSettings);
    J.destroy(half);
    J.destroy(offset);
    const settings = new J.VehicleConstraintSettings();
    settings.mMaxPitchRollAngle = Math.PI / 9;
    settings.mNumVelocityStepsOverride = 14;
    settings.mNumPositionStepsOverride = 4;
    for (let i = 0; i < 4; i++) {
      const w = new J.WheelSettingsWV();
      const mount = new J.Vec3(
        (i % 2 === 0 ? 1 : -1) *
          (i < 2
            ? this.geometry.halfTrack
            : (this.geometry.rearHalfTrack ?? this.geometry.halfTrack)),
        this.geometry.mountY,
        i < 2 ? this.geometry.frontAxle : this.geometry.rearAxle,
      );
      w.mPosition = mount;
      J.destroy(mount);
      w.mRadius = this.geometry.radius;
      w.mWidth =
        i < 2
          ? this.geometry.width
          : (this.geometry.rearWidth ?? this.geometry.width);
      w.mSuspensionMinLength = 0.16;
      w.mSuspensionMaxLength = 0.44;
      w.mSuspensionSpring.mFrequency =
        i < 2 ? this.tuning.frontFrequency : this.tuning.rearFrequency;
      w.mSuspensionSpring.mDamping = this.tuning.suspensionDamping;
      w.mMaxSteerAngle = i < 2 ? VEHICLE.maxSteer : 0;
      w.mMaxBrakeTorque =
        this.tuning.brakeTorque *
        2 *
        (i < 2 ? this.tuning.brakeBias / 100 : 1 - this.tuning.brakeBias / 100);
      w.mMaxHandBrakeTorque = i < 2 ? 0 : 2200;
      w.mLongitudinalFriction.Clear();
      [
        [0, 0],
        [0.08, this.tuning.longitudinalGrip],
        [0.2, this.tuning.longitudinalGrip * 0.9],
        [1, this.tuning.longitudinalGrip * 0.65],
      ].forEach(([x, y]) => w.mLongitudinalFriction.AddPoint(x, y));
      w.mLateralFriction.Clear();
      const lateralGrip = i < 2 ? this.tuning.frontGrip : this.tuning.rearGrip;
      [
        [0, 0.92],
        [7, 1],
        [25, 0.85],
        [90, 0.65],
      ].forEach(([x, y]) => w.mLateralFriction.AddPoint(x, y * lateralGrip));
      settings.mWheels.push_back(w);
    }
    const drive = new J.WheeledVehicleControllerSettings();
    drive.mEngine.mMaxTorque = this.tuning.torque;
    drive.mEngine.mMaxRPM = 7200;
    drive.mTransmission.mClutchStrength = 7;
    drive.mTransmission.mSwitchTime = 0.07;
    drive.mTransmission.mClutchReleaseTime = 0.06;
    // Keep successive shifts responsive instead of waiting at the rev limiter.
    drive.mTransmission.mSwitchLatency = 0.12;
    drive.mTransmission.mShiftUpRPM = 6100;
    drive.mTransmission.mShiftDownRPM = 2800;
    drive.mTransmission.mGearRatios.clear();
    [4.1, 2.6, 1.7, 1.2, 0.9].forEach((r) =>
      drive.mTransmission.mGearRatios.push_back(r),
    );
    // Torque split supports rear, front and all-wheel drive setups with the same chassis.
    drive.mDifferentials.clear();
    for (let axle = 0; axle < 2; axle++) {
      const ratio =
        axle === 0
          ? this.tuning.frontDrive / 100
          : 1 - this.tuning.frontDrive / 100;
      if (ratio === 0) continue;
      const diff = new J.VehicleDifferentialSettings();
      diff.mLeftWheel = axle * 2;
      diff.mRightWheel = axle * 2 + 1;
      diff.mLimitedSlipRatio = 3;
      diff.mDifferentialRatio = this.tuning.finalDrive;
      diff.mEngineTorqueRatio = ratio;
      drive.mDifferentials.push_back(diff);
      J.destroy(diff);
    }
    settings.mController = drive;
    for (let axle = 0; axle < 2; axle++) {
      const bar = new J.VehicleAntiRollBar();
      bar.mLeftWheel = axle * 2;
      bar.mRightWheel = axle * 2 + 1;
      bar.mStiffness =
        axle === 0 ? this.tuning.frontAntiRoll : this.tuning.rearAntiRoll;
      settings.mAntiRollBars.push_back(bar);
      J.destroy(bar);
    }
    this.vehicle = new J.VehicleConstraint(this.body, settings);
    // Use a literal surface multiplier, so the debug menu's tyre mu is the
    // coefficient at the contact patch (Jolt defaults to a geometric mean).
    this.constraintCallbacks = new J.VehicleConstraintCallbacksJS();
    this.constraintCallbacks.GetCombinedFriction = (
      wheel,
      _direction,
      tire,
      other,
    ) => {
      const surface = J.wrapPointer(other, J.Body).GetFriction();
      this.surfaceGrip[wheel] = surface;
      return tire * surface;
    };
    this.constraintCallbacks.OnPreStepCallback = () => {};
    this.constraintCallbacks.OnPostCollideCallback = () => {};
    this.constraintCallbacks.OnPostStepCallback = () => {};
    this.constraintCallbacks.SetVehicleConstraint(this.vehicle);
    this.tester = new J.VehicleCollisionTesterCastSphere(3, 0.13);
    this.vehicle.SetVehicleCollisionTester(this.tester);
    this.system.AddConstraint(this.vehicle);
    this.listener = new J.VehicleConstraintStepListener(this.vehicle);
    this.system.AddStepListener(this.listener);
    this.controller = J.castObject(
      this.vehicle.GetController(),
      J.WheeledVehicleController,
    );
    this.tireCallback = new J.WheeledVehicleControllerCallbacksJS();
    this.tireCallback.OnTireMaxImpulseCallback = (
      wheel,
      resultPointer,
      suspension,
      longitudinal,
      lateral,
      longitudinalSlip,
      lateralSlip,
      dt,
    ) => {
      const result = J.wrapPointer(
        resultPointer,
        J.TireMaxImpulseCallbackResult,
      );
      // Moving steering tyres retain their grip; only a nearly stationary,
      // pinned nose gets extra compliance to pivot clear. The old all-wheel
      // 0.35 release scale let the nose rotate without the vehicle following it.
      const wallLateralScale = this.wallPinned
        ? wheel < 2
          ? 0.75
          : 0.35
        : this.touchingWall && wheel >= 2
          ? this.wallRelease
            ? 0.85
            : 0.75
          : 1;
      // Once steering is handed back, preserve the normal front/rear balance
      // while grip recovers; the old front drift boost must not induce another slide.
      const budget = tireImpulseBudget({
        normalImpulse: suspension,
        dt,
        mass: this.tuning.mass,
        gravity: this.tuning.gravity,
        longitudinalFriction: longitudinal,
        lateralFriction: lateral,
        longitudinalSlip,
        lateralSlip,
        gripScale: 1,
        loadSensitivity: this.tuning.loadSensitivity,
        combinedGrip: this.tuning.combinedGrip / 100,
        lateralGripScale:
          (wheel >= 2 || !this.recoveryControl
            ? this.rearGrip
            : 1 + this.driftBlend * 0.5) *
          wallLateralScale *
          (1 + this.corneringGrip * (wheel < 2 ? 0.16 : 0.12)),
        peakLongitudinalFriction:
          this.tuning.longitudinalGrip * this.surfaceGrip[wheel],
        peakLateralFriction:
          (wheel < 2 ? this.tuning.frontGrip : this.tuning.rearGrip) *
          this.surfaceGrip[wheel],
      });
      result.mLongitudinalImpulse = budget.longitudinalImpulse;
      result.mLateralImpulse = budget.lateralImpulse;
      this.tireCaps[wheel] = {
        longitudinal: budget.totalLongitudinalCapacity,
        lateral: budget.totalLateralCapacity,
        normalLoad: budget.normalLoad,
        loadScale: budget.loadScale,
      };
      const data = this.telemetry.wheels[wheel];
      data.load = budget.normalLoad;
      data.slipRatio = longitudinalSlip;
      data.slipAngle = (lateralSlip * 180) / Math.PI;
    };
    this.tireCallback.SetWheeledVehicleController(this.controller);
    for (let i = 0; i < 4; i++) this.wheels.push(this.vehicle.GetWheel(i));
    // Wheel/controller settings are ref-counted and owned by the constraint.
    J.destroy(settings);
    this.force = new J.Vec3();
    this.torque = new J.Vec3();
  }
  reset(track: Track, index: number, lateralOffset = 0) {
    const J = this.J,
      p = track.point(index).clone();
    const tangent = track.tangent(index);
    p.addScaledVector(
      new Vector3(tangent.z, 0, -tangent.x).normalize(),
      lateralOffset,
    );
    p.y += this.geometry.spawnHeight;
    const direction = track.tangent(index);
    const q = new Quaternion().setFromUnitVectors(
      new Vector3(0, 0, 1),
      direction,
    );
    const pos = new J.RVec3(p.x, p.y, p.z),
      rot = new J.Quat(q.x, q.y, q.z, q.w),
      zero = new J.Vec3();
    this.bi.SetPositionAndRotation(
      this.body.GetID(),
      pos,
      rot,
      J.EActivation_Activate,
    );
    this.bi.SetLinearAndAngularVelocity(this.body.GetID(), zero, zero);
    this.body.ResetForce();
    this.body.ResetTorque();
    this.vehicle.ResetWarmStart();
    this.wheels.forEach((w) => {
      w.SetAngularVelocity(0);
      w.SetRotationAngle(0);
    });
    this.controller.GetTransmission().Set(1, 1);
    this.controller.GetEngine().SetCurrentRPM(1000);
    this.controller.SetDriverInput(0, 0, 1, 0);
    this.steer = 0;
    this.brakeReverse = false;
    this.brakeWasDown = false;
    this.brakeStopTime = 0;
    this.clutchStrength = 7;
    this.reversalDirection = 0;
    this.wallContactTime = this.wallExitTime = 0;
    this.wallInterruptedDrift = false;
    this.wallNormal.set(0, 0, 0);
    this.wallRelease = this.wallPinned = false;
    this.wallTouched = false;
    this.wallGap = this.scrapeTime = 0;
    this.driftControl.reset();
    this.lastTravel.set(0, 0, 0);
    this.travelYaw = 0;
    this.throttle = 0;
    this.driftBlend = 0;
    this.rearGrip = 1;
    this.corneringGrip = 0;
    this.recoveryWeight = 0;
    this.recoveryControl = false;
    this.handbrakeStrength = 0;
    this.handbrakeTime = 0;
    this.tcsReduction = this.absReduction = 0;
    this.absWheels.fill(0);
    Object.assign(this.telemetry, {
      slipAngle: 0,
      yawRate: 0,
      lateralG: 0,
      longitudinalG: 0,
      rearGrip: 1,
      wallContact: false,
      impactSpeed: 0,
      tcs: 0,
      abs: 0,
    });
    this.telemetry.wheels.forEach((wheel) => {
      wheel.grounded = false;
      wheel.load = wheel.slipRatio = wheel.slipAngle = wheel.gripUsage = 0;
      wheel.suspension = 0;
    });
    this.drifting = false;
    this.slipAngle = 0;
    [pos, rot, zero].forEach((o) => J.destroy(o));
    this.sync();
    this.capturePrevious();
  }
  private capturePrevious() {
    this.previousPosition.copy(this.position);
    this.previousRotation.copy(this.rotation);
    this.wheels.forEach((w, i) => {
      this.previousSuspension[i] = w.GetSuspensionLength();
      this.previousRoll[i] = w.GetRotationAngle();
      this.previousSteer[i] = w.GetSteerAngle();
    });
  }
  step(dt: number, input: Input, assists: boolean, boost: boolean) {
    if (dt > 1 / 120 + 1e-8) {
      // Substep controls and tyre feedback too, not just native rigid bodies.
      // Otherwise ABS and load telemetry differ between 60 and 120 Hz callers.
      const steps = Math.ceil(dt / (1 / 120));
      for (let i = 0; i < steps; i++)
        this.step(dt / steps, input, assists, boost);
      return;
    }
    this.sync();
    const previousVelocity = this.velocity.clone();
    this.capturePrevious();
    this.telemetry.impactSpeed *= Math.exp(-dt * 2);
    this.wallContactTime = Math.max(0, this.wallContactTime - dt);
    this.wallTouched = false;
    const speed = Math.abs(this.forwardSpeed);
    const heading = new Vector3(0, 0, 1)
      .applyQuaternion(this.rotation)
      .setY(0)
      .normalize();
    const inward = heading.dot(this.wallNormal);
    const steeringAway =
      Math.abs(input.steer) > 0.1 &&
      (-input.steer * heading.clone().cross(this.wallNormal).y > 0.001 ||
        inward < -0.98);
    if (this.touchingWall && steeringAway) this.wallExitTime = 0.35;
    else this.wallExitTime = Math.max(0, this.wallExitTime - dt);
    this.wallRelease =
      (this.touchingWall || this.wallExitTime > 0) &&
      (input.throttle > 0 ||
        (steeringAway && this.speed > 2 && !input.brake)) &&
      steeringAway;
    this.wallPinned = this.wallRelease && this.speed < 3 && inward < -0.55;
    if (
      !this.touchingWall &&
      !this.wallRelease &&
      this.driftBlend < 0.04 &&
      this.rearGrip > 0.97
    )
      this.wallInterruptedDrift = false;
    const driftHandbrake =
      input.handbrake &&
      !this.wallInterruptedDrift &&
      this.contacts >= 2 &&
      this.forwardSpeed >= DRIFT.entrySpeed;
    this.driftControl.update(
      dt,
      input.steer,
      driftHandbrake,
      this.speed,
      this.tuning,
      this.slipAngle,
    );
    const travel = this.velocity.clone().setY(0).normalize();
    if (this.speed > 4 && this.lastTravel.lengthSq() > 0.5) {
      const rate =
        Math.atan2(
          this.lastTravel.clone().cross(travel).y,
          this.lastTravel.dot(travel),
        ) / dt;
      this.travelYaw +=
        (Math.max(-2, Math.min(2, rate)) - this.travelYaw) *
        (1 - Math.exp(-dt * 10));
    } else this.travelYaw = 0;
    this.lastTravel.copy(travel);
    let driftTarget =
      this.driftControl.active && this.speed > 5
        ? Math.min(
            1,
            Math.max(
              Math.abs(input.steer) * 3,
              Math.abs(this.driftControl.angle) / 0.35,
            ),
          )
        : 0;
    if (
      !this.wallInterruptedDrift &&
      this.driftControl.recovering &&
      (this.driftControl.active ||
        this.driftControl.spinning ||
        Math.abs(this.slipAngle) > DRIFT.displayEnter) &&
      this.driftBlend > 0.04
    ) {
      const slipNeed =
        Math.max(0, Math.min(1, (Math.abs(this.slipAngle) - 0.05) / 0.35)) *
        0.88;
      const yawNeed =
        Math.max(
          0,
          Math.min(
            1,
            (Math.abs(this.body.GetAngularVelocity().GetY() - this.travelYaw) -
              0.08) /
              0.8,
          ),
        ) * 0.7;
      driftTarget = Math.max(driftTarget, slipNeed, yawNeed);
    }
    const blendChange =
      (driftTarget - this.driftBlend) *
      (1 - Math.exp(-dt * (driftTarget > this.driftBlend ? 8 : 2.4)));
    this.driftBlend += Math.max(-dt * 0.65, blendChange);
    let gripTarget =
      1 -
      this.driftBlend *
        (this.tuning.driftGripLoss / 100 + this.driftControl.oversteer * 0.24);
    if (this.driftControl.spinning) gripTarget = Math.min(gripTarget, 0.3);
    // Restore tyre authority slowly, even when the oversteer assist changes state.
    this.rearGrip += Math.max(
      -dt * 4,
      Math.min(dt * this.tuning.gripRecovery, gripTarget - this.rearGrip),
    );
    const relativeYaw = Math.abs(
      this.body.GetAngularVelocity().GetY() - this.travelYaw,
    );
    const aligned =
      Math.abs(this.slipAngle) < (3 * Math.PI) / 180 && relativeYaw < 0.12;
    // A held countersteer is the next grip turn once the actual slide exits.
    // Waiting for near-zero yaw would mistake that new turn for old recovery.
    // Tyre grip continues recovering independently at its existing bounded rate.
    const heldDriftExit =
      !this.driftControl.active &&
      !this.driftControl.spinning &&
      Math.abs(this.slipAngle) < DRIFT.displayExit &&
      Math.abs(input.steer) > 0.1;
    const driverTakingControl =
      Math.abs(input.steer) > 0.1 && (aligned || heldDriftExit);
    const wasRecovering = this.recoveryControl;
    const recoverySettled =
      aligned &&
      this.rearGrip > 0.97 &&
      Math.abs(this.driftControl.angle) < 0.005 &&
      Math.abs(this.body.GetAngularVelocity().GetY()) < 0.12;
    if (this.driftControl.active) this.recoveryControl = true;
    else if (
      this.wallInterruptedDrift ||
      (!this.driftControl.spinning && (driverTakingControl || recoverySettled))
    )
      this.recoveryControl = false;
    const driftSteeringHandoff =
      wasRecovering && !this.recoveryControl && heldDriftExit;
    const unsettled =
      Math.abs(this.slipAngle) > DRIFT.displayExit ||
      relativeYaw > 0.3 ||
      Math.abs(this.driftControl.angle) > 0.035 ||
      Math.abs(this.driftControl.angleRate) > 0.08 ||
      this.rearGrip < 0.97;
    const recoveryTarget =
      this.recoveryControl &&
      !this.wallInterruptedDrift &&
      (this.driftControl.recovering || !this.driftControl.active) &&
      (this.driftBlend > 0.08 || this.recoveryWeight > 0.05) &&
      unsettled
        ? 1
        : 0;
    this.recoveryWeight +=
      (recoveryTarget - this.recoveryWeight) *
      (1 -
        Math.exp(-dt * (recoveryTarget ? 10 : this.recoveryControl ? 3 : 24)));
    // Grip can still be recovering after the car is aligned. Once that happens,
    // retire the old countersteer / yaw authority until another deliberate drift.
    // New steering must not re-arm the old assistance just by producing yaw.
    const recoveryAuthority = this.recoveryControl ? this.recoveryWeight : 0;
    // Preserve the handbrake's path-curvature advantage when grip turns gain
    // middle-speed authority; retire the reserve during recovery or a spin.
    const controlledDrift =
      this.driftControl.active &&
      !this.driftControl.spinning &&
      this.driftControl.oversteer < 0.2;
    const corneringTarget =
      assists &&
      (!this.recoveryControl || controlledDrift) &&
      (!this.touchingWall || this.wallRelease)
        ? roadCorneringWeight(this.speed) *
          (controlledDrift ? 1.35 : Math.min(1, Math.abs(input.steer) * 2))
        : 0;
    this.corneringGrip +=
      (corneringTarget - this.corneringGrip) * (1 - Math.exp(-dt * 8));
    let target =
      (this.driftControl.steering *
        steeringAngleLimit(
          this.speed,
          this.wallInterruptedDrift || !this.driftControl.active
            ? 0
            : this.driftBlend,
          this.tuning.steeringGrip,
          this.geometry.frontAxle - this.geometry.rearAxle,
          !this.driftControl.active && !this.recoveryControl,
        )) /
      VEHICLE.maxSteer;
    const driverSteerTarget = target;
    // While unwinding, align front tyres with their travel instead of catching the
    // whole lateral velocity when the keyboard returns to centre.
    const assistWeight = assists ? this.tuning.stability / 85 : 0;
    const counterWeight =
      this.forwardSpeed > 3 && !this.driftControl.spinning
        ? Math.min(1, assistWeight) *
          recoveryAuthority *
          Math.max(0, Math.min(1, (1.2 - Math.abs(this.slipAngle)) / 0.4))
        : 0;
    const counterTarget =
      -Math.max(-VEHICLE.maxSteer, Math.min(VEHICLE.maxSteer, this.slipAngle)) /
      VEHICLE.maxSteer;
    target += (counterTarget - target) * counterWeight;
    // During an explicit reversal the front contact patches must first clear
    // the existing lateral slip. A tiny high-speed road angle alone cannot do
    // that, even though the visible wheels have already crossed the centre.
    const canReverse =
      this.forwardSpeed > 6 &&
      !this.driftControl.active &&
      !this.recoveryControl &&
      !this.touchingWall &&
      !this.wallRelease;
    // Keep reversal authority through zero yaw. Residual impact slip can still
    // oppose the new turn there; release only when both chassis and travel turn.
    if (
      !canReverse ||
      Math.sign(input.steer) !== this.reversalDirection ||
      (input.steer * this.body.GetAngularVelocity().GetY() < -0.12 &&
        input.steer * this.travelYaw < -0.06 &&
        relativeYaw < 0.2)
    )
      this.reversalDirection = 0;
    if (
      canReverse &&
      (input.steer * this.body.GetAngularVelocity().GetY() > 0.005 ||
        driftSteeringHandoff)
    )
      this.reversalDirection = Math.sign(input.steer);
    const reversingTurn = this.reversalDirection !== 0;
    const clearingImpactSlip =
      this.wallContactTime > 0 &&
      !this.touchingWall &&
      !this.driftControl.active &&
      !this.recoveryControl;
    if (
      (this.wallRelease || clearingImpactSlip || reversingTurn) &&
      this.forwardSpeed > 3 &&
      input.steer * this.slipAngle < -0.015
    )
      // After an impact/reversal, clear the old contact-patch slip before adding
      // the new road curvature. This follows travel, never the former wall normal.
      target +=
        (Math.max(-0.3, Math.min(0.3, -this.slipAngle * 0.95)) /
          VEHICLE.maxSteer) *
        Math.min(1, Math.abs(input.steer) * 2);
    target = Math.max(-1, Math.min(1, target));
    this.steer +=
      (target - this.steer) *
      (1 - Math.exp(-dt * Math.max(12, this.tuning.steeringRate * 4)));
    let forward = input.throttle,
      brake = 0;
    this.handbrakeTime = input.handbrake ? this.handbrakeTime + dt : 0;
    // A brief pull initiates a slide; holding the key applies the same four-wheel
    // brakes and ABS as Z. Space stops and holds, without selecting reverse.
    const heldHandbrake =
      input.handbrake && (this.handbrakeTime >= 0.12 || this.speed < 3);
    const freshBrake = input.brake > 0 && !this.brakeWasDown;
    this.brakeWasDown = input.brake > 0;
    if (!input.brake) {
      this.brakeReverse = false;
      this.brakeStopTime = 0;
    }
    if (input.brake) {
      // A sideways slide can have almost zero forward speed while still moving
      // quickly. Select reverse only after the whole car is nearly stationary.
      if (!this.brakeReverse && !input.throttle && !input.handbrake) {
        this.brakeStopTime = this.speed < 0.15 ? this.brakeStopTime + dt : 0;
        // A fresh press at rest selects reverse immediately. Braking from motion
        // reaches a real stop first, with a short hold before continued reverse.
        if ((freshBrake && this.speed < 0.15) || this.brakeStopTime >= 0.25)
          this.brakeReverse = true;
      }
      if (this.brakeReverse && !input.throttle && !input.handbrake)
        forward = -0.6;
      else {
        forward = 0;
        brake = 1;
      }
    }
    if (input.throttle && this.forwardSpeed < -0.65) {
      forward = 0;
      brake = 1;
    }
    if (heldHandbrake) {
      forward = 0;
      brake = 1;
    }
    const coastWeight =
      !input.throttle && !input.brake && !input.handbrake && !boost
        ? Math.max(0, 1 - Math.max(this.driftBlend, this.recoveryWeight))
        : 0;
    // Driver braking, excluding passive rolling / engine resistance.
    this.braking = brake > 0 || input.handbrake;
    this.reversing = forward < 0 || this.forwardSpeed < -0.2;
    const lowSpeedResistance = Math.max(0, Math.min(1, (12 - speed) / 9));
    // Bleed the engine's remaining rotational energy near idle, without adding
    // the same large overrun drag to a high-speed coast or a drift exit.
    this.controller.GetEngine().mAngularDamping =
      0.2 + coastWeight * lowSpeedResistance * 1.8;
    if (coastWeight > 0) {
      // Rolling / drivetrain resistance acts through the native tyre brakes,
      // including at walking speed. Fade it out during an inertial drift exit.
      brake = Math.min(
        1,
        (this.tuning.mass *
          (0.35 + lowSpeedResistance * 0.55) *
          this.geometry.radius *
          coastWeight) /
          (4 * this.tuning.brakeTorque),
      );
    }
    const normalLimit = this.tuning.topSpeed / 3.6 + (boost ? 8 : 0);
    const limit =
      normalLimit +
      (this.tuning.wallSpeed / 3.6 - normalLimit) * this.wallScrape;
    if (forward > 0) forward *= Math.max(0, Math.min(1, (limit - speed) / 3));
    if (forward < 0)
      forward *= Math.max(0, Math.min(1, (7 + this.forwardSpeed) / 2));
    // Slip-based electronic aids modulate drivetrain/brakes, never the body velocity.
    const drivenSlip = Math.max(
      0,
      ...this.telemetry.wheels.map((w, i) =>
        (i < 2 ? this.tuning.frontDrive > 0 : this.tuning.frontDrive < 100) &&
        w.grounded
          ? w.slipRatio
          : 0,
      ),
    );
    // Catch launch wheelspin from walking speed, before the engine stores a
    // large RPM overshoot that then needs a prolonged traction-control cut.
    const tcsTarget =
      assists &&
      this.speed > 0.75 &&
      !this.driftControl.active &&
      !this.touchingWall
        ? (Math.min(0.8, Math.max(0, drivenSlip - 0.18) * 1.5) *
            this.tuning.tractionControl) /
          100
        : 0;
    this.tcsReduction +=
      (tcsTarget - this.tcsReduction) * (1 - Math.exp(-dt * 12));
    this.absReduction = 0;
    this.wheels.forEach((wheel, i) => {
      const state = this.telemetry.wheels[i];
      const strength = this.tuning.abs / 100;
      if (
        assists &&
        strength > 0 &&
        this.speed > 3 &&
        brake > 0 &&
        state.grounded
      ) {
        // Bounded slip feedback: release only while locking is present and
        // reapply quickly when rolling returns. An accumulated release value
        // previously left heavy cars coasting with almost no brake pressure.
        const slip = Math.max(0, -state.slipRatio);
        const lowSpeed = Math.max(0, Math.min(1, (this.speed - 2) / 6));
        // Higher dry-road grip supports firmer pressure. Keep the full release
        // reserve on low-mu surfaces, without coasting on the new launch tyres.
        const maximumRelease = Math.max(
          0.45,
          0.65 -
            Math.max(
              0,
              this.tuning.longitudinalGrip * this.surfaceGrip[i] - 1.45,
            ) *
              0.3,
        );
        const release =
          Math.min(maximumRelease, Math.max(0, (slip - 0.12) / 0.85)) *
          strength *
          lowSpeed;
        this.absWheels[i] +=
          (release - this.absWheels[i]) *
          (1 - Math.exp(-dt * (release > this.absWheels[i] ? 30 : 55)));
      } else this.absWheels[i] = 0;
      const wheelSettings = this.J.castObject(
        wheel.GetSettings(),
        this.J.WheelSettingsWV,
      );
      const bias =
        i < 2 ? this.tuning.brakeBias / 100 : 1 - this.tuning.brakeBias / 100;
      wheelSettings.mMaxBrakeTorque =
        this.tuning.brakeTorque * 2 * bias * (1 - this.absWheels[i]);
      this.absReduction += this.absWheels[i] / 4;
    });
    forward *= 1 - this.tcsReduction;
    this.throttle +=
      (forward - this.throttle) * (1 - Math.exp(-dt * (brake > 0 ? 40 : 12)));
    // Open the clutch under service braking so idle RPM cannot drive against
    // the brakes in first gear. Reconnect progressively on pedal release.
    if (this.braking && brake > 0) this.clutchStrength = 0.01;
    else
      this.clutchStrength +=
        (7 - this.clutchStrength) * (1 - Math.exp(-dt * 12));
    this.controller.GetTransmission().mClutchStrength = this.clutchStrength;
    // Rear-only torque is reserved for the initial pull. Once held, do not add
    // another locked rear axle on top of the full, ABS-controlled service brake.
    const handbrakeTarget =
      input.handbrake && !heldHandbrake && !this.driftControl.recovering
        ? (this.tuning.handbrake / 100) * this.driftBlend
        : 0;
    if (heldHandbrake) this.handbrakeStrength = 0;
    else
      this.handbrakeStrength +=
        (handbrakeTarget - this.handbrakeStrength) * (1 - Math.exp(-dt * 12));
    this.controller.SetDriverInput(
      this.throttle,
      this.steer,
      brake,
      this.handbrakeStrength,
    );
    if (this.contacts >= 2) {
      const direction = new Vector3(0, 0, 1).applyQuaternion(this.rotation);
      const lateral = new Vector3(1, 0, 0).applyQuaternion(this.rotation);
      const slip = this.velocity.dot(lateral);
      const boostForce =
        boost && !input.brake && !input.handbrake
          ? this.tuning.boostForce *
            (1 - this.wallScrape) *
            Math.max(
              0,
              Math.min(1, (this.tuning.topSpeed / 3.6 + 8 - speed) / 7),
            )
          : 0;
      // Tyres are the sole source of lateral ground force. Aerodynamics acts on
      // the body along travel; suspension transfers its load back into the tyre budget.
      const force = this.velocity
        .clone()
        .multiplyScalar(-0.5 * 1.225 * this.tuning.aeroDrag * this.speed)
        .addScaledVector(direction, boostForce);
      force.y -= speed * speed * this.tuning.downforce;
      this.force.Set(force.x, force.y, force.z);
      this.body.AddForce(this.force);
      const angular = this.body.GetAngularVelocity();
      const yaw = angular.GetY();
      const up = new Vector3(0, 1, 0).applyQuaternion(this.rotation);
      const roadUp = new Vector3();
      this.wheels.forEach((w) => {
        if (w.HasContact()) {
          const n = w.GetContactNormal();
          roadUp.add(new Vector3(n.GetX(), n.GetY(), n.GetZ()));
        }
      });
      roadUp.normalize();
      const upright = up.cross(roadUp).multiplyScalar(6000);
      const angle = Math.atan2(slip, this.forwardSpeed);
      const slipError = Math.atan2(
        Math.sin(angle - this.driftControl.angle),
        Math.cos(angle - this.driftControl.angle),
      );
      let yawTorque =
        -yaw * (assists ? 600 : 120) * (1 - this.driftBlend * 0.8);
      if ((reversingTurn || clearingImpactSlip) && assists) {
        const yawBudget =
          (this.tuning.steeringGrip * (1.05 + this.corneringGrip * 0.25)) /
          Math.max(8, this.forwardSpeed);
        const desiredYaw = Math.max(
          -yawBudget,
          Math.min(
            yawBudget,
            (-Math.tan(driverSteerTarget * VEHICLE.maxSteer) *
              this.forwardSpeed) /
              (this.geometry.frontAxle - this.geometry.rearAxle),
          ),
        );
        // Brake the old rotation and catch overshoot around the driver's new
        // curvature. This is bounded torque, never a heading/velocity rewrite.
        yawTorque +=
          Math.max(
            -this.tuning.mass * 8,
            Math.min(
              this.tuning.mass * 8,
              (desiredYaw - yaw) * this.tuning.mass * 9,
            ),
          ) * Math.min(1, assistWeight);
      }
      const wallRecovery =
        this.touchingWall ||
        this.wallRelease ||
        this.wallInterruptedDrift ||
        this.driftControl.spinning
          ? 0
          : 1;
      yawTorque +=
        Math.max(
          -14000,
          Math.min(
            14000,
            slipError * 48000 +
              (this.travelYaw - yaw - this.driftControl.angleRate) * 15000,
          ),
        ) *
        Math.max(
          this.driftControl.active ? this.driftBlend : 0,
          recoveryAuthority,
        ) *
        assistWeight *
        Math.max(0, Math.min(1, (this.speed - 3) / 5)) *
        Math.min(1, this.contacts / 4) *
        (1 - this.driftControl.oversteer * 0.8) *
        wallRecovery;
      yawTorque +=
        Math.sign(angle) *
        Math.max(0, Math.abs(angle) - (0.45 + this.driftBlend * 0.38)) *
        6000 *
        assistWeight *
        wallRecovery *
        (1 - this.driftControl.oversteer) *
        (this.forwardSpeed > 2 || this.driftControl.active ? 1 : 0);
      // Catch unintended rear slip early in ordinary driving. Apply a bounded
      // yaw torque, leaving tyre forces, driver steering and deliberate drifts intact.
      if (
        this.forwardSpeed > 3 &&
        !this.touchingWall &&
        !this.wallRelease &&
        !this.driftControl.spinning
      ) {
        const slipExcess =
          Math.sign(angle) * Math.max(0, Math.abs(angle) - 0.06);
        const activation = Math.min(1, Math.abs(slipExcess) / 0.1);
        const normalGrip = 1 - Math.max(this.driftBlend, this.recoveryWeight);
        const stabilityGain = speedSteeringGain(this.speed);
        // With centred input, damp leftover yaw even below the slide threshold.
        // Rear-drive power must not sustain a turn after a brief steering tap.
        if (
          Math.abs(input.steer) < 0.05 &&
          !this.driftControl.active &&
          !this.recoveryControl
        )
          yawTorque -=
            Math.max(-4500, Math.min(4500, yaw * this.tuning.mass * 8)) *
            normalGrip *
            assistWeight *
            Math.min(1, this.contacts / 4);
        yawTorque +=
          Math.max(
            -7000 * stabilityGain,
            Math.min(
              7000 * stabilityGain,
              (slipExcess * 26000 +
                (this.travelYaw - yaw) * 7000 * activation) *
                stabilityGain,
            ),
          ) *
          normalGrip *
          (reversingTurn ? 0.2 : 1) *
          assistWeight *
          Math.min(1, this.contacts / 4);
      }
      this.torque.Set(
        upright.x - angular.GetX() * 1200,
        yawTorque,
        upright.z - angular.GetZ() * 1200,
      );
      this.body.AddTorque(this.torque);
    }
    if (this.touchingWall || this.wallRelease) {
      const a = this.body.GetAngularVelocity();
      const response = contactYawTarget({
        normal: this.wallNormal,
        heading,
        velocity: this.velocity,
        yawRate: a.GetY(),
        release: this.wallRelease,
        steer: input.steer,
        driverYawRate:
          (-Math.tan(driverSteerTarget * VEHICLE.maxSteer) *
            this.forwardSpeed) /
          (this.geometry.frontAxle - this.geometry.rearAxle),
        yawDamping: 1600,
        maxTorque:
          this.wallRelease && speed < 10 && inward < -0.55 ? 6000 : 4000,
      });
      const separationSpeed = this.velocity.dot(this.wallNormal);
      if (
        this.wallRelease &&
        this.wallGap < 0.05 &&
        inward < -0.1 &&
        separationSpeed < 0.35
      ) {
        // Help a pinned nose clear the contact. An existing rebound or a clean
        // separation must not receive another half-second of sideways thrust.
        const releaseForce =
          this.tuning.mass * Math.min(0.85, (0.35 - separationSpeed) * 3);
        this.force.Set(
          this.wallNormal.x * releaseForce,
          0,
          this.wallNormal.z * releaseForce,
        );
        this.body.AddForce(this.force);
      }
      this.torque.Set(-a.GetX() * 2000, response.torque, -a.GetZ() * 2000);
      this.body.AddTorque(this.torque);
    }
    if (this.wallScrape > 0 && this.speed > 1) {
      const tangentVelocity = this.velocity
        .clone()
        .setY(0)
        .addScaledVector(this.wallNormal, -this.velocity.dot(this.wallNormal));
      const tangentSpeed = tangentVelocity.length();
      const drag =
        Math.min(
          this.tuning.wallDrag,
          1.2 + Math.max(0, tangentSpeed - 12) * 1.4,
        ) *
        this.tuning.mass *
        this.wallScrape;
      tangentVelocity.normalize().multiplyScalar(-drag);
      this.force.Set(tangentVelocity.x, 0, tangentVelocity.z);
      this.body.AddForce(this.force);
    }
    this.world.Step(dt, dt > 1 / 90 ? 2 : 1);
    if (this.wallTouched) {
      this.wallGap = 0;
      this.scrapeTime = Math.min(1.2, this.scrapeTime + dt);
    } else {
      this.wallGap += dt;
      if (this.wallGap > 0.18)
        this.scrapeTime = Math.max(0, this.scrapeTime - dt * 3);
    }
    this.sync();
    const acceleration = this.velocity
      .clone()
      .sub(previousVelocity)
      .multiplyScalar(1 / dt);
    const side = new Vector3(1, 0, 0).applyQuaternion(this.rotation);
    const nose = new Vector3(0, 0, 1).applyQuaternion(this.rotation);
    const data = this.telemetry;
    data.slipAngle = (this.slipAngle * 180) / Math.PI;
    data.yawRate = (this.body.GetAngularVelocity().GetY() * 180) / Math.PI;
    data.lateralG +=
      (acceleration.dot(side) / this.tuning.gravity - data.lateralG) *
      (1 - Math.exp(-dt * 8));
    data.longitudinalG +=
      (acceleration.dot(nose) / this.tuning.gravity - data.longitudinalG) *
      (1 - Math.exp(-dt * 8));
    data.rearGrip = this.rearGrip;
    data.wallContact = this.touchingWall;
    data.tcs = this.tcsReduction;
    data.abs = this.absReduction;
    this.wheels.forEach((w, i) => {
      const info = data.wheels[i],
        cap = this.tireCaps[i];
      info.grounded = w.HasContact();
      info.suspension = w.GetSuspensionLength();
      // Actual constraint impulses, rather than the requested tyre cap.
      info.gripUsage = info.grounded
        ? Math.min(
            2,
            Math.hypot(
              w.GetLongitudinalLambda() / Math.max(0.001, cap.longitudinal),
              w.GetLateralLambda() / Math.max(0.001, cap.lateral),
            ),
          )
        : 0;
      if (!info.grounded) {
        info.load = info.slipRatio = info.slipAngle = 0;
      } else {
        // Jolt's public slip ratio is absolute. Reconstruct signed rolling slip
        // at each contact for brake locking (<0) versus wheelspin (>0).
        const contact = w.GetContactPosition(),
          center = this.body.GetCenterOfMassPosition(),
          ground = w.GetContactPointVelocity(),
          forward = w.GetContactLongitudinal(),
          angular = this.body.GetAngularVelocity();
        const rx = contact.GetX() - center.GetX(),
          ry = contact.GetY() - center.GetY(),
          rz = contact.GetZ() - center.GetZ();
        const vx =
          this.velocity.x +
          angular.GetY() * rz -
          angular.GetZ() * ry -
          ground.GetX();
        const vy =
          this.velocity.y +
          angular.GetZ() * rx -
          angular.GetX() * rz -
          ground.GetY();
        const vz =
          this.velocity.z +
          angular.GetX() * ry -
          angular.GetY() * rx -
          ground.GetZ();
        const contactSpeed =
          vx * forward.GetX() + vy * forward.GetY() + vz * forward.GetZ();
        info.slipRatio =
          (w.GetAngularVelocity() *
            this.geometry.radius *
            Math.sign(contactSpeed || this.forwardSpeed || 1) -
            Math.abs(contactSpeed)) /
          Math.max(3, Math.abs(contactSpeed));
        info.load = Math.max(0, w.GetSuspensionLambda() / dt);
      }
    });
  }
  sync() {
    const p = this.body.GetPosition(),
      q = this.body.GetRotation(),
      v = this.body.GetLinearVelocity();
    this.position.set(p.GetX(), p.GetY(), p.GetZ());
    this.rotation.set(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
    this.velocity.set(v.GetX(), v.GetY(), v.GetZ());
    this.speed = this.velocity.length();
    this.forwardSpeed = this.velocity.dot(
      new Vector3(0, 0, 1).applyQuaternion(this.rotation),
    );
    this.contacts = this.wheels.filter((w) => w.HasContact()).length;
    const lateral = new Vector3(1, 0, 0).applyQuaternion(this.rotation);
    // Heading relative to a near-zero velocity is undefined. Tiny settling
    // motion must not report a 180-degree slide and keep recovery tyre settings.
    this.slipAngle =
      Math.hypot(this.velocity.x, this.velocity.z) < 0.2
        ? 0
        : Math.atan2(this.velocity.dot(lateral), this.forwardSpeed);
    this.drifting =
      this.speed >= DRIFT.exitSpeed &&
      this.contacts >= 2 &&
      (this.forwardSpeed > 2 || this.driftControl.active) &&
      this.driftControl.active &&
      Math.abs(this.slipAngle) >
        (this.drifting ? DRIFT.displayExit : DRIFT.displayEnter);
  }
  wheel(index: number) {
    return this.wheels[index];
  }
  get steering() {
    return this.steer;
  }
  dispose() {
    const J = this.J;
    this.system.RemoveStepListener(this.listener);
    this.system.RemoveConstraint(this.vehicle);
    J.destroy(this.listener);
    J.destroy(this.tireCallback);
    J.destroy(this.constraintCallbacks);
    for (const id of this.bodies) {
      this.bi.RemoveBody(id);
      this.bi.DestroyBody(id);
    }
    J.destroy(this.force);
    J.destroy(this.torque);
    J.destroy(this.world);
    J.destroy(this.contactListener);
  }
}
