import { test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP as dt, roadCorneringWeight, steeringAngleLimit } from "../src/game/Driving";
import { VEHICLES } from "../src/game/Vehicles";
import { vehicleDefaults } from "../src/game/Tuning";
import { flatCircuit, parked, throttle, tiltDegrees } from "./helpers/driving";

test("cornering grip and steering budget have no 80–115 km/h assistance valley", () => {
  for (const v of Object.values(VEHICLES)) {
    const tuning = vehicleDefaults(v.id), wheelbase = v.geometry.frontAxle-v.geometry.rearAxle;
    let previousGrip = 0, previousBudget = 0;
    for (let kmh=65;kmh<=220;kmh++) {
      const speed = kmh/3.6, grip = roadCorneringWeight(speed);
      // Compare lateral authority rather than absolute angle: a faster car
      // still needs a larger radius, but must not lose its available budget.
      const budget = Math.tan(steeringAngleLimit(speed,0,tuning.steeringGrip,wheelbase))*speed*speed/wheelbase;
      assert.ok(grip >= previousGrip,`${v.id}: tyre assistance dropped at ${kmh} km/h`);
      assert.ok(budget >= previousBudget,`${v.id}: steering authority dropped at ${kmh} km/h`);
      previousGrip=grip; previousBudget=budget;
    }
  }
});

test("all cars naturally accelerate through 70–160 km/h and retain continuous path curvature in either direction", async () => {
  const records = [];
  for (const v of Object.values(VEHICLES)) {
    const f=flatCircuit(), tuning=vehicleDefaults(v.id);
    const p=await Physics.create(f.road,f.track,tuning,{roadside:false},v.geometry);
    try {
      for (const side of [-1,1]) {
        let previousAuthority=0;
        const speeds=[70,80,90,100,120,Math.min(160,tuning.topSpeed-10)];
        for (const kmh of speeds) {
          p.reset(f.track,0);
          for (let i=0;i<120;i++) p.step(dt,parked,true,false);
          for (let i=0;i<3000 && p.speed<kmh/3.6;i++) p.step(dt,throttle,true,false);
          assert.ok(p.speed*3.6>=kmh-.5,`${v.id}: did not reach ${kmh} km/h naturally`);
          let distance=0,turn=0,speed=0,samples=0,peakSlip=0;
          let last=p.velocity.clone().setY(0).normalize();
          for (let i=0;i<480;i++) {
            p.step(dt,{...throttle,steer:side,throttle:Math.max(0,Math.min(.8,(kmh/3.6-p.forwardSpeed)*.7+.08))},true,false);
            const travel=p.velocity.clone().setY(0).normalize();
            if (i>=120) {
              turn+=Math.abs(Math.atan2(last.clone().cross(travel).y,last.dot(travel)));
              distance+=p.speed*dt; speed+=p.speed; samples++;
            }
            last=travel;
            peakSlip=Math.max(peakSlip,Math.abs(p.telemetry.slipAngle));
            assert.equal(p.drifting,false);
            assert.equal(p.rearGripFactor,1,"normal cornering armed drift grip");
            assert.ok(p.contacts>=3 && tiltDegrees(p.rotation)<15,"steering lifted the car");
          }
          const radius=distance/turn, meanSpeed=speed/samples;
          const authority=meanSpeed*meanSpeed/radius;
          assert.ok(authority>=previousAuthority*.97,`${v.id} ${kmh} km/h: path authority fell ${previousAuthority.toFixed(2)} -> ${authority.toFixed(2)}`);
          assert.ok(peakSlip<8,`${v.id} ${kmh}: ordinary cornering became a slide (${peakSlip})`);
          assert.ok(meanSpeed*3.6>kmh-8,"cornering relies on hidden speed loss");
          previousAuthority=authority;
          records.push({id:v.id,kmh,side,radius,authority,peakSlip});
        }
      }
    } finally {p.dispose();f.road.geometry.dispose();}
  }
  console.log(JSON.stringify({continuousPoweredCornering:records}));
});
