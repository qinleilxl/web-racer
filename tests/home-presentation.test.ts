import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/game/Game";

test("background race readiness does not draw over the home presentation", () => {
  let rendered = 0;
  const game = Object.assign(Object.create(Game.prototype), {
    state: {loaded:0, phase:"loading"},
    renderer: {render() { rendered++; }},
    updateCamera() {},
  });
  game.setPresentationVisible(false);
  Object.assign(game.state, {loaded:100, phase:"menu"});
  game.setPresentationVisible(false);
  assert.equal(rendered, 0, "silent readiness rendered the race scene over the home stage");
  game.setPresentationVisible(true);
  assert.equal(rendered, 1, "explicit navigation did not prepare its first visible frame");
  game.setPresentationVisible(false);
  assert.equal(rendered, 1);
});

test("starting from home restores the visible roof and renders the race camera before publishing the new screen", async () => {
  const events: string[] = [];
  const roof = {progress:0, targetOpen:false, update() {events.push("roof");}};
  const game = Object.assign(Object.create(Game.prototype), {
    mapId:"coast", disposed:false, startGeneration:0,
    state:{phase:"menu", loaded:100, tuningBusy:false, best:null},
    audio:{async start() {}, beep() {}}, input:{clear() {}},
    skidActive:[false,false,false,false], physics:{reset() {}},
    track:{}, race:{reset() {}}, world:{setGate() {}}, roof,
    initialRoof:() => ({progress:.42, targetOpen:true}),
    renderer:{render() {events.push("render");}},
    updateCamera() {events.push("camera");}, syncCar() {},
    emit() {events.push("publish");},
  });
  game.setPresentationVisible(false);
  await game.start();
  assert.equal(game.state.phase,"countdown");
  assert.equal(roof.progress,.42);
  assert.equal(roof.targetOpen,true);
  assert.deepEqual(events,["roof","camera","render","publish"]);

  events.length = 0;
  roof.progress = .8;
  game.initialRoof = () => undefined;
  await game.start();
  assert.equal(roof.progress,.8, "restarting a race restored a stale home roof pose");
  assert.deepEqual(events,["camera","render","publish"]);
});
