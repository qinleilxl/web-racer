import { test } from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP as dt, steeringAngleLimit } from "../src/game/Driving";
import { VEHICLES } from "../src/game/Vehicles";
import { vehicleDefaults } from "../src/game/Tuning";
import { launch, parked, straightCircuit, throttle, tiltDegrees } from "./helpers/driving";

test("a recent collision cannot retain wall steering after contact has ended", () => {
  const p=Object.assign(Object.create(Physics.prototype),{wallContactTime:.18,wallGap:0});
  assert.equal(p.touchingWall,true);
  p.wallGap=.05;
  assert.equal(p.touchingWall,false,"the old collision is still claiming wheel authority");
});

test("holding steering past a real barrier end returns travel to the driver on every car", async () => {
  let cases=0, slowestResponse=0;
  for (const v of Object.values(VEHICLES)) {
    const f=straightCircuit(), barriers=new Group();
    const geometry=new BoxGeometry(.5,1.8,12), material=new MeshBasicMaterial();
    for (const side of [-1,1]) {
      const wall=new Mesh(geometry,material); wall.position.set(side*3.8,.9,-38); barriers.add(wall);
    }
    const p=await Physics.create(f.road,f.track,vehicleDefaults(v.id),{roadside:false,barriers},v.geometry);
    try {
      for (const kmh of [120,160]) for (const side of [-1,1]) {
        p.reset(f.track,100,side*1.6);
        for (let i=0;i<120;i++) p.step(dt,parked,true,false);
        launch(p,kmh,side*.2);
        const input={...throttle,steer:-side};
        const native=p as unknown as {wallGap:number;wallRelease:boolean};
        let hit=false,cleared=false;
        for (let i=0;i<240;i++) {
          p.step(dt,input,true,false); hit ||= p.touchingWall;
          if (hit && p.position.z> -33 && native.wallGap>=.05) {cleared=true;break;}
        }
        const label=`${v.id} ${kmh} km/h side ${side}`;
        assert.ok(hit && cleared,`fixture did not traverse the barrier: ${label}`);
        assert.equal(p.touchingWall,false,`stale contact claimed steering: ${label}`);
        assert.equal(native.wallRelease,false,`stale exit controller claimed steering: ${label}`);
        const start=p.velocity.clone().setY(0).normalize();
        let response: number|undefined;
        for (let i=0;i<60;i++) {
          p.step(dt,input,true,false);
          if (response===undefined && p.telemetry.yawRate*side>5) response=(i+1)*dt;
          if (i===11) {
            const limit=steeringAngleLimit(p.speed,0,p.tuning.steeringGrip,v.geometry.frontAxle-v.geometry.rearAxle);
            assert.ok(p.wheel(0).GetSteerAngle()*side>limit*.85,`front wheels ignored held steering: ${label}`);
          }
          assert.equal(p.drifting,false,`wall exit rearmed drift: ${label}`);
          assert.ok(p.contacts>=3 && tiltDegrees(p.rotation)<18,`wall exit lifted the car: ${label}`);
        }
        // Wheel authority returns first; the chassis retains physical inertia.
        // Use the same 350 ms direction-change budget as ordinary reversals.
        assert.ok(response!==undefined && response<=.35,`held steering was swallowed: ${label}, ${response}s`);
        const travel=p.velocity.clone().setY(0).normalize();
        const turn=Math.atan2(start.clone().cross(travel).y,start.dot(travel))*side;
        assert.ok(turn>.025,`wheels turned but travel kept following the old wall: ${label}, ${turn}`);
        slowestResponse=Math.max(slowestResponse,response);cases++;
      }
    } finally {p.dispose();geometry.dispose();material.dispose();f.road.geometry.dispose();}
  }
  console.log(JSON.stringify({barrierEndCases:cases,slowestResponseSeconds:slowestResponse}));
});
