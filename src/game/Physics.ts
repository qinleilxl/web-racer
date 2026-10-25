import initJolt from "jolt-physics/wasm";
import type Jolt from "jolt-physics";
import { Mesh, Object3D, Quaternion, Vector3 } from "three";
import { Track } from "./Track";
import type { Input } from "./types";
import { DriftControl, VEHICLE, steeringAngleLimit } from "./Driving";
import { createRoadside } from "./Roadside";

export class Physics {
  private constructor(
    readonly J: typeof Jolt,
    readonly world: Jolt.JoltInterface,
    readonly system: Jolt.PhysicsSystem,
  ) {
    this.bi = system.GetBodyInterface();
  }
  private bi: Jolt.BodyInterface;
  body!: Jolt.Body;
  vehicle!: Jolt.VehicleConstraint;
  controller!: Jolt.WheeledVehicleController;
  private listener!: Jolt.VehicleConstraintStepListener;
  private contactListener!: Jolt.ContactListenerJS;
  private wallContactTime = 0;
  private wallNormal = new Vector3();
  private wallRelease = false;
  private wallTouched = false;
  private scrapeTime = 0;
  private wallGap = 0;
  private track!: Track;
  private driftControl = new DriftControl();
  private lastTravel = new Vector3();
  private travelYaw = 0;
  private tester!: Jolt.VehicleCollisionTesterCastSphere;
  private tireCallback!: Jolt.WheeledVehicleControllerCallbacksJS;
  private driftBlend = 0;
  private rearGrip = 1;
  private recoveryWeight = 0;
  private handbrakeStrength = 0;
  private throttle = 0;
  slipAngle = 0;
  drifting = false;
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
  position = new Vector3();
  rotation = new Quaternion();
  velocity = new Vector3();
  speed = 0;
  forwardSpeed = 0;
  contacts = 0;
  static async create(collision: Object3D, track: Track) {
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
    p.track = track;
    p.addMesh(collision);
    // Extend the collision plane above the chassis so it cannot perch on a wall edge.
    const roadside = createRoadside(track, 2);
    p.addMesh(roadside.shoulders);
    p.addMesh(roadside.walls, 0, 2);
    roadside.shoulders.geometry.dispose();
    roadside.walls.geometry.dispose();
    (roadside.shoulders.material as import("three").Material).dispose();
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
      // Wall contact still blocks translation, but cannot kick the light chassis into a spin.
      if (first === 1) settings.mInvInertiaScale1 = 0;
      else settings.mInvInertiaScale2 = 0;
      settings.mCombinedFriction = 0.06;
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
      // A noticeable small rebound, with an upper bound even for head-on boost impacts.
      settings.mCombinedRestitution = Math.min(
        0.16,
        2.4 / Math.max(1, approach),
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
    return this.wallContactTime > 0;
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
      settings.mMassPropertiesOverride.mMass = VEHICLE.mass;
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
    const half = new J.Vec3(0.86, 0.24, 1.62);
    const box = new J.BoxShapeSettings(half);
    const offset = new J.Vec3(0, -0.54, 0);
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
        i % 2 === 0 ? 0.735 : -0.735,
        -0.08,
        i < 2 ? 1.07 : -1.02,
      );
      w.mPosition = mount;
      J.destroy(mount);
      w.mRadius = 0.433;
      w.mWidth = 0.27;
      w.mSuspensionMinLength = 0.16;
      w.mSuspensionMaxLength = 0.44;
      w.mSuspensionSpring.mFrequency = 1.55;
      w.mSuspensionSpring.mDamping = 1;
      w.mMaxSteerAngle = i < 2 ? VEHICLE.maxSteer : 0;
      w.mMaxBrakeTorque = 1700;
      w.mMaxHandBrakeTorque = i < 2 ? 0 : 2200;
      w.mLongitudinalFriction.Clear();
      [
        [0, 0],
        [0.08, 2.8],
        [0.2, 2.5],
        [1, 1.8],
      ].forEach(([x, y]) => w.mLongitudinalFriction.AddPoint(x, y));
      w.mLateralFriction.Clear();
      [
        [0, 1.2],
        [5, 1.3],
        [25, 1.1],
        [90, 0.9],
      ].forEach(([x, y]) => w.mLateralFriction.AddPoint(x, y));
      settings.mWheels.push_back(w);
    }
    const drive = new J.WheeledVehicleControllerSettings();
    drive.mEngine.mMaxTorque = VEHICLE.torque;
    drive.mEngine.mMaxRPM = 7200;
    drive.mTransmission.mClutchStrength = 7;
    drive.mTransmission.mSwitchTime = 0.12;
    drive.mTransmission.mClutchReleaseTime = 0.12;
    drive.mTransmission.mShiftUpRPM = 6100;
    drive.mTransmission.mShiftDownRPM = 2800;
    drive.mTransmission.mGearRatios.clear();
    [4.1, 2.6, 1.7, 1.2, 0.9].forEach((r) =>
      drive.mTransmission.mGearRatios.push_back(r),
    );
    // Rear-wheel drive, matching the detailed vehicle specification.
    drive.mDifferentials.clear();
    const diff = new J.VehicleDifferentialSettings();
    diff.mLeftWheel = 2;
    diff.mRightWheel = 3;
    diff.mLimitedSlipRatio = 3;
    diff.mDifferentialRatio = 3.7;
    drive.mDifferentials.push_back(diff);
    J.destroy(diff);
    settings.mController = drive;
    for (let axle = 0; axle < 2; axle++) {
      const bar = new J.VehicleAntiRollBar();
      bar.mLeftWheel = axle * 2;
      bar.mRightWheel = axle * 2 + 1;
      bar.mStiffness = 6000;
      settings.mAntiRollBars.push_back(bar);
      J.destroy(bar);
    }
    this.vehicle = new J.VehicleConstraint(this.body, settings);
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
    ) => {
      const result = J.wrapPointer(
        resultPointer,
        J.TireMaxImpulseCallbackResult,
      );
      result.mLongitudinalImpulse = longitudinal * suspension;
      result.mLateralImpulse =
        lateral *
        suspension *
        (wheel >= 2 ? this.rearGrip : 1 - this.driftBlend * 0.25) *
        (this.wallRelease ? 0.35 : this.touchingWall ? 0.65 : 1);
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
    p.y += 0.88;
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
    this.wallContactTime = 0;
    this.wallNormal.set(0, 0, 0);
    this.wallRelease = false;
    this.wallTouched = false;
    this.wallGap = this.scrapeTime = 0;
    this.driftControl.reset();
    this.lastTravel.set(0, 0, 0);
    this.travelYaw = 0;
    this.throttle = 0;
    this.driftBlend = 0;
    this.rearGrip = 1;
    this.recoveryWeight = 0;
    this.handbrakeStrength = 0;
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
    this.sync();
    this.capturePrevious();
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
    this.wallRelease =
      this.touchingWall &&
      (input.throttle > 0 ||
        (steeringAway && this.speed > 2 && !input.brake)) &&
      steeringAway;
    this.driftControl.update(dt, input.steer, input.handbrake, this.speed);
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
      input.handbrake && this.speed > 5
        ? Math.min(
            1,
            Math.max(
              Math.abs(input.steer) * 3,
              Math.abs(this.driftControl.angle) / 0.12,
            ),
          )
        : 0;
    if (this.driftControl.recovering && this.driftBlend > 0.04) {
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
    const gripTarget =
      1 - this.driftBlend * (0.62 + this.driftControl.oversteer * 0.24);
    // Restore tyre authority slowly, even when the oversteer assist changes state.
    this.rearGrip += Math.max(
      -dt * 4,
      Math.min(dt * 0.4, gripTarget - this.rearGrip),
    );
    const relativeYaw = Math.abs(
      this.body.GetAngularVelocity().GetY() - this.travelYaw,
    );
    const unsettled =
      Math.abs(this.slipAngle) > 0.025 ||
      relativeYaw > 0.1 ||
      Math.abs(this.driftControl.angleRate) > 0.08 ||
      this.rearGrip < 0.97;
    const recoveryTarget =
      (this.driftControl.recovering || !input.handbrake) &&
      (this.driftBlend > 0.08 || this.recoveryWeight > 0.05) &&
      unsettled
        ? 1
        : 0;
    this.recoveryWeight +=
      (recoveryTarget - this.recoveryWeight) *
      (1 - Math.exp(-dt * (recoveryTarget ? 10 : 3)));
    let target =
      (this.driftControl.steering *
        steeringAngleLimit(this.speed, this.driftBlend)) /
      VEHICLE.maxSteer;
    // While unwinding, align front tyres with their travel instead of catching the
    // whole lateral velocity when the keyboard returns to centre.
    const counterWeight =
      this.forwardSpeed > 3
        ? this.recoveryWeight *
          Math.max(0, Math.min(1, (1.2 - Math.abs(this.slipAngle)) / 0.4))
        : 0;
    const counterTarget =
      -Math.max(-VEHICLE.maxSteer, Math.min(VEHICLE.maxSteer, this.slipAngle)) /
      VEHICLE.maxSteer;
    target += (counterTarget - target) * counterWeight;
    this.steer +=
      (target - this.steer) * (1 - Math.exp(-dt * (assists ? 9 : 12)));
    let forward = input.throttle,
      brake = 0;
    if (input.brake) {
      if (this.forwardSpeed > 0.65) {
        forward = 0;
        brake = 1;
      } else forward = -0.6;
    }
    if (input.throttle && this.forwardSpeed < -0.65) {
      forward = 0;
      brake = 1;
    }
    const normalLimit = boost ? VEHICLE.boostLimit : VEHICLE.cruiseLimit;
    const limit = normalLimit + (18 - normalLimit) * this.wallScrape;
    if (forward > 0) forward *= Math.max(0, Math.min(1, (limit - speed) / 3));
    if (forward < 0)
      forward *= Math.max(0, Math.min(1, (7 + this.forwardSpeed) / 2));
    this.throttle += (forward - this.throttle) * (1 - Math.exp(-dt * 12));
    // Unwind the brake torque independently of tyre slip: keeping Space held
    // must not keep braking the rear wheels throughout the recovery phase.
    const handbrakeTarget = input.handbrake
      ? this.speed < 3
        ? 1
        : this.driftControl.recovering
          ? 0
          : 0.16 * this.driftBlend
      : 0;
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
      const grip =
        (assists ? 1000 : 180) *
        (1 - this.driftBlend * 0.88) *
        (this.wallRelease ? 0.15 : this.touchingWall ? 0.4 : 1);
      const boostForce = boost
        ? 5200 *
          (1 - this.wallScrape) *
          Math.max(0, Math.min(1, (VEHICLE.boostLimit - speed) / 7))
        : 0;
      const force = lateral
        .multiplyScalar(-slip * grip)
        .addScaledVector(direction, boostForce);
      force.y -= speed * speed * 0.7;
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
      const wallRecovery = this.touchingWall ? 0 : 1;
      yawTorque +=
        Math.max(
          -14000,
          Math.min(
            14000,
            slipError * 48000 +
              (this.travelYaw - yaw - this.driftControl.angleRate) * 15000,
          ),
        ) *
        Math.max(this.driftBlend, this.recoveryWeight) *
        (1 - this.driftControl.oversteer * 0.8) *
        wallRecovery;
      yawTorque +=
        Math.sign(angle) *
        Math.max(0, Math.abs(angle) - (0.45 + this.driftBlend * 0.38)) *
        6000 *
        wallRecovery *
        (1 - this.driftControl.oversteer) *
        (this.forwardSpeed > 2 || this.driftControl.active ? 1 : 0);
      this.torque.Set(
        upright.x - angular.GetX() * 1200,
        yawTorque,
        upright.z - angular.GetZ() * 1200,
      );
      this.body.AddTorque(this.torque);
    }
    if (this.touchingWall) {
      const a = this.body.GetAngularVelocity();
      const nearest = this.track.nearest(this.position),
        index = nearest.index;
      const route = this.track.tangent(index).setY(0).normalize();
      const along = this.velocity.dot(route);
      const tangent = route.clone();
      const noseAlong = heading.dot(route);
      // Follow the local wall without turning a reversing car to face its velocity.
      if ((Math.abs(noseAlong) > 0.2 ? noseAlong : along) < 0) tangent.negate();
      if (this.wallRelease) {
        if (inward < -0.98 && steeringAway)
          tangent
            .set(-this.wallNormal.z, 0, this.wallNormal.x)
            .multiplyScalar(-Math.sign(input.steer));
        tangent.addScaledVector(this.wallNormal, 0.35).normalize();
        this.force.Set(
          this.wallNormal.x * (1400 + Math.min(speed, 30) * 60),
          0,
          this.wallNormal.z * (1400 + Math.min(speed, 30) * 60),
        );
        this.body.AddForce(this.force);
      }
      const before = this.track
          .tangent(index - 4)
          .setY(0)
          .normalize(),
        after = this.track
          .tangent(index + 4)
          .setY(0)
          .normalize();
      const arc = Math.max(
        0.5,
        this.track.point(index - 4).distanceTo(this.track.point(index + 4)),
      );
      const curveYaw =
        (Math.atan2(before.clone().cross(after).y, before.dot(after)) / arc) *
        along;
      const error = Math.atan2(
        heading.clone().cross(tangent).y,
        heading.dot(tangent),
      );
      const weight = this.wallRelease
        ? 1
        : Math.max(0, Math.min(1, (Math.abs(along) - 1) / 4));
      const yawTorque = Math.max(
        -4000,
        Math.min(4000, (error * 6500 + (curveYaw - a.GetY()) * 1100) * weight),
      );
      this.torque.Set(-a.GetX() * 2000, yawTorque, -a.GetZ() * 2000);
      this.body.AddTorque(this.torque);
    }
    if (this.wallScrape > 0 && this.speed > 1) {
      const tangentVelocity = this.velocity
        .clone()
        .setY(0)
        .addScaledVector(this.wallNormal, -this.velocity.dot(this.wallNormal));
      const tangentSpeed = tangentVelocity.length();
      const drag =
        Math.min(8, 1.2 + Math.max(0, tangentSpeed - 12) * 1.4) *
        VEHICLE.mass *
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
    this.slipAngle = Math.atan2(this.velocity.dot(lateral), this.forwardSpeed);
    this.drifting =
      this.speed > 5 &&
      this.contacts >= 2 &&
      (this.forwardSpeed > 2 || this.driftControl.active) &&
      Math.abs(this.slipAngle) > 0.1;
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
