import { test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/game/Physics";
import { DRIFT, DriftControl, steeringAngleLimit } from "../src/game/Driving";
import { VEHICLES } from "../src/game/Vehicles";
import { vehicleDefaults } from "../src/game/Tuning";
import { flatCircuit, parked, throttle, tiltDegrees } from "./helpers/driving";

test("countersteering keeps unwinding the observed slide after its internal target reaches zero", () => {
  for(const side of [-1,1]) {
    const control=new DriftControl(), dt=1/120;
    for(let i=0;i<120;i++) control.update(dt,side,i<12,30,undefined,side*.35);
    for(let i=0;i<240;i++) {
      control.update(dt,-side,false,30,undefined,side*.35);
      assert.equal(control.active,true);
      assert.equal(control.recovering,true,"countersteer changed into an opposite drift before the real slide ended");
      assert.ok(control.angle*side>=-1e-6,"the internal target built a phantom opposite slide");
    }
    assert.ok(Math.abs(control.angle)<.005);
    control.update(dt,-side,false,30,undefined,side*.08);
    assert.equal(control.active,false);
    assert.ok(control.steering*-side>.99,"drift exit reset an already-held direction key");
    for(let i=0;i<120;i++) control.update(dt,-side,false,30,undefined,0);
    assert.equal(control.active,false,"holding the key rearmed the old drift");
  }
});

test("continuously held countersteering becomes a normal turn at drift exit, without requiring a key release", async () => {
  let cases=0, minimumAt250ms=Infinity, minimumAt500ms=Infinity;
  for (const v of Object.values(VEHICLES)) {
    const f=flatCircuit(), tuning=vehicleDefaults(v.id);
    const p=await Physics.create(f.road,f.track,tuning,{roadside:false},v.geometry);
    try {
      for (const hz of [60,120]) for (const kmh of [80,120,Math.min(160,tuning.topSpeed-10)]) for (const side of [-1,1]) {
        const dt=1/hz, label=`${v.id} ${kmh} km/h, ${hz} Hz, drift ${side}`;
        p.reset(f.track,0);
        for(let i=0;i<hz;i++) p.step(dt,parked,true,false);
        for(let i=0;i<hz*25 && p.speed*3.6<kmh;i++) p.step(dt,throttle,true,false);
        let entered=false;
        for(let i=0;i<hz;i++) {
          p.step(dt,{...throttle,steer:side,handbrake:i<Math.round(hz*.1)},true,false);
          if(p.drifting && Math.abs(p.slipAngle)>20*Math.PI/180){entered=true;break;}
        }
        assert.ok(entered,`fixture did not enter an actual slide: ${label}`);
        const counter={...throttle,steer:-side};
        let exited=false;
        for(let i=0;i<hz*4;i++) {
          p.step(dt,counter,true,false);
          if(!p.drifting && Math.abs(p.slipAngle)<DRIFT.displayExit){exited=true;break;}
        }
        assert.ok(exited,`countersteering did not finish the slide: ${label}`);
        assert.ok(p.speed>30/3.6,`fixture stopped instead of handing over: ${label}`);
        let lastGrip=p.rearGripFactor, travelAt250=p.velocity.clone().setY(0).normalize();
        for(let i=0;i<hz;i++) {
          p.step(dt,counter,true,false);
          const ratio=p.wheel(0).GetSteerAngle()*side/
            steeringAngleLimit(p.speed,0,tuning.steeringGrip,v.geometry.frontAxle-v.geometry.rearAxle);
          if(i===Math.round(hz*.25)-1) {
            assert.ok(ratio>.8,`held input was swallowed 250 ms after drift exit: ${label}, ${ratio}`);
            minimumAt250ms=Math.min(minimumAt250ms,ratio);
            travelAt250=p.velocity.clone().setY(0).normalize();
          }
          if(i>=Math.round(hz*.5)-1) {
            assert.ok(ratio>.85,`normal steering remained restricted: ${label}, ${ratio}`);
            minimumAt500ms=Math.min(minimumAt500ms,ratio);
          }
          if(i>=Math.round(hz*.25)-1)
            assert.ok(Math.abs(p.slipAngle)<DRIFT.displayEnter,`handoff flung the car into a hidden opposite slide: ${label}`);
          if(i===Math.round(hz*.75)-1) {
            const travel=p.velocity.clone().setY(0).normalize();
            const turn=Math.atan2(travelAt250.clone().cross(travel).y,travelAt250.dot(travel))*side;
            assert.ok(turn>.025,`the wheels turned but travel did not follow the held countersteer: ${label}, ${turn}`);
          }
          assert.equal(p.drifting,false,`old drift was rearmed: ${label}`);
          assert.ok((p.rearGripFactor-lastGrip)/dt<=tuning.gripRecovery+1e-5,`tyre grip snapped back: ${label}`);
          lastGrip=p.rearGripFactor;
          assert.ok(p.contacts>=3 && tiltDegrees(p.rotation)<18,`handoff lifted the car: ${label}`);
        }
        cases++;
      }
    } finally {p.dispose();f.road.geometry.dispose();}
  }
  console.log(JSON.stringify({continuousDriftCounterCases:cases,minimumAt250ms,minimumAt500ms}));
});
