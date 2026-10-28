import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Game } from "../src/game/Game";
import { VEHICLES, type VehicleId } from "../src/game/Vehicles";
import { vehicleDefaults } from "../src/game/Tuning";
import { disposeObjectResources } from "../src/game/GraphicsResources";
import { flatCircuit } from "./helpers/driving";

function candidate(id: VehicleId) {
  const model = new Group(),
    geometry = new BoxGeometry(),
    texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture });
  model.add(new Mesh(geometry, material));
  const disposed = { geometry: 0, material: 0, texture: 0, physics: 0 };
  geometry.addEventListener("dispose", () => disposed.geometry++);
  material.addEventListener("dispose", () => disposed.material++);
  texture.addEventListener("dispose", () => disposed.texture++);
  return {
    model,
    physics: {
      position: new Vector3(0, 1, 0),
      dispose() {
        disposed.physics++;
      },
    },
    tuning: vehicleDefaults(id),
    rig: {},
    feedback: {},
    cockpitGlass: [],
    disposed,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function globals(t: import("node:test").TestContext) {
  const names = ["location", "history", "localStorage"] as const;
  const previous = names.map((name) =>
    Object.getOwnPropertyDescriptor(globalThis, name),
  );
  const stored = new Map([["cloudcape.best.coast12.v1.suv", "42.5"]]),
    urls: string[] = [];
  const location = {
    href: "https://example.test/game?car=scarlet&map=test&extra=1#play",
    assign() {
      throw new Error("vehicle switch navigated the document");
    },
  };
  const values = [
    location,
    {
      state: { kept: true },
      replaceState(_state: unknown, _title: string, url: string) {
        urls.push(url);
        location.href = url;
      },
    },
    {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  ];
  names.forEach((name, i) =>
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: values[i],
    }),
  );
  t.after(() =>
    names.forEach((name, i) => {
      if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!);
      else Reflect.deleteProperty(globalThis, name);
    }),
  );
  return { stored, urls };
}
function fixture() {
  const old = candidate("scarlet"),
    car = new Group();
  car.add(old.model);
  const updates: unknown[] = [],
    sounds: VehicleId[] = [];
  const map = {},
    renderer = {
      warmups: 0,
      compile() {
        this.warmups++;
      },
    },
    settings = {
      camera: "near",
      volume: 0.42,
      quality: "medium",
      controls: "touch",
      autoThrottle: true,
    };
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    vehicle: VEHICLES.scarlet,
    mapId: "test",
    model: old.model,
    physics: old.physics,
    car,
    track: map,
    collision: new Group(),
    environment: {},
    renderer,
    settings,
    race: { reset() {}, relocated() {} },
    world: { setGate() {} },
    state: {
      vehicleId: "scarlet",
      phase: "racing",
      tuningBusy: false,
      time: 15,
      best: 31,
      progress: 0.5,
    },
    startGeneration: 0,
    vehicleSwitchGeneration: 0,
    disposed: false,
    sessionTuned: false,
    audio: {
      setVehicle(id: VehicleId) {
        sounds.push(id);
      },
    },
    input: { clear() {} },
    skidActive: [false, false, false, false],
    syncCar() {},
    updateCamera() {},
    emit() {
      updates.push({ ...game.state });
    },
    notice(text: string) {
      game.state.notice = text;
    },
  });
  return {
    game: game as Game & Record<string, any>,
    old,
    updates,
    sounds,
    map,
    renderer,
    settings,
  };
}

test("vehicle swaps commit in the same world/canvas, reset the new session and update only URL history", async (t) => {
  const { stored, urls } = globals(t),
    f = fixture(),
    next = candidate("suv");
  f.game.prepareVehicle = async () => next;
  await f.game.selectVehicle("suv");
  assert.equal(f.game.vehicle.id, "suv");
  assert.equal(f.game.physics, next.physics);
  assert.equal(f.game.track, f.map);
  assert.equal(f.game.renderer, f.renderer);
  assert.equal(f.game.settings, f.settings);
  assert.equal(f.game.state.phase, "paused");
  assert.equal(f.game.state.time, 0);
  assert.equal(f.game.state.best, 42.5);
  assert.equal(f.game.state.tuningBusy, false);
  assert.equal(f.game.state.vehicleLoading, null);
  assert.deepEqual(f.sounds, ["suv"]);
  assert.deepEqual(f.old.disposed, {
    geometry: 1,
    material: 1,
    texture: 1,
    physics: 1,
  });
  assert.deepEqual(next.disposed, {
    geometry: 0,
    material: 0,
    texture: 0,
    physics: 0,
  });
  assert.equal(f.game.car.children.length, 1);
  assert.equal(
    f.renderer.warmups,
    1,
    "replacement shaders were not prepared before driving",
  );
  assert.equal(stored.get("cloudcape.vehicle"), "suv");
  assert.equal(urls.length, 1);
  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get("car"), "suv");
  assert.equal(url.searchParams.get("map"), "test");
  assert.equal(url.searchParams.get("extra"), "1");
  assert.equal(url.hash, "#play");
});

test("failed replacements retain the old working car, physics, sound and selected URL", async (t) => {
  const { urls } = globals(t),
    f = fixture();
  t.mock.method(console, "error", () => {});
  f.game.prepareVehicle = async () => {
    throw new Error("asset unavailable");
  };
  await f.game.selectVehicle("formula");
  assert.equal(f.game.vehicle.id, "scarlet");
  assert.equal(f.game.physics, f.old.physics);
  assert.ok(f.game.state.vehicleSwitchError?.includes("仍使用赤风号"));
  assert.equal(f.game.state.phase, "paused");
  assert.equal(f.game.state.tuningBusy, false);
  assert.deepEqual(f.sounds, []);
  assert.deepEqual(urls, []);
  assert.deepEqual(f.old.disposed, {
    geometry: 0,
    material: 0,
    texture: 0,
    physics: 0,
  });
});

test("rapid picks adopt only the latest car and dispose stale models and physics", async (t) => {
  globals(t);
  const f = fixture(),
    first = deferred<ReturnType<typeof candidate>>(),
    last = deferred<ReturnType<typeof candidate>>();
  const stale = candidate("formula"),
    next = candidate("suv");
  let staleProgress: ((p: number) => void) | undefined;
  f.game.prepareVehicle = (
    id: VehicleId,
    _current: () => boolean,
    progress: (p: number) => void,
  ) => {
    if (id === "formula") staleProgress = progress;
    return id === "formula" ? first.promise : last.promise;
  };
  const a = f.game.selectVehicle("formula"),
    b = f.game.selectVehicle("suv");
  staleProgress!(80);
  assert.equal(f.game.state.vehicleLoading, "suv");
  assert.equal(f.game.state.vehicleLoadProgress, 0);
  last.resolve(next);
  await b;
  first.resolve(stale);
  await a;
  assert.equal(f.game.vehicle.id, "suv");
  assert.equal(f.game.physics, next.physics);
  assert.deepEqual(f.sounds, ["suv"]);
  assert.deepEqual(stale.disposed, {
    geometry: 1,
    material: 1,
    texture: 1,
    physics: 1,
  });
  assert.equal(f.game.state.vehicleLoading, null);
  assert.equal(f.game.state.tuningBusy, false);
});

test("picking the current car cancels pending work, and unmounted games cannot adopt late results", async (t) => {
  globals(t);
  const f = fixture(),
    pending = deferred<ReturnType<typeof candidate>>(),
    stale = candidate("formula");
  f.game.prepareVehicle = () => pending.promise;
  const a = f.game.selectVehicle("formula");
  await f.game.selectVehicle("scarlet");
  assert.equal(f.game.state.tuningBusy, false);
  assert.equal(f.game.state.vehicleLoading, null);
  pending.resolve(stale);
  await a;
  assert.equal(f.game.vehicle.id, "scarlet");
  assert.equal(stale.disposed.physics, 1);
  const late = deferred<ReturnType<typeof candidate>>(),
    next = candidate("suv");
  f.game.prepareVehicle = () => late.promise;
  const b = f.game.selectVehicle("suv");
  f.game.disposed = true;
  const count = f.updates.length;
  late.resolve(next);
  await b;
  assert.equal(f.game.vehicle.id, "scarlet");
  assert.equal(next.disposed.physics, 1);
  assert.equal(f.updates.length, count);
});

test("all replacement runtimes prepare real rigs and planted tyres without rebuilding track graphics", async (t) => {
  const f = flatCircuit();
  t.mock.method(
    GLTFLoader.prototype,
    "loadAsync",
    async function (this: GLTFLoader, path: string) {
      this.register(() => ({
        name: "GeometryFixture",
        loadTexture: () => Promise.resolve(null),
      }));
      const bytes = await readFile("public" + path);
      return this.parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        "",
      );
    },
  );
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    collision: f.road,
    track: f.track,
    environment: { roadside: false },
    mapId: "test",
    state: { phase: "paused" },
  });
  try {
    for (const id of Object.keys(VEHICLES) as VehicleId[]) {
      const prepared = await game.prepareVehicle(
        id,
        () => true,
        () => {},
      );
      try {
        assert.equal(prepared.physics.contacts, 4);
        assert.deepEqual(prepared.physics.geometry, VEHICLES[id].geometry);
        assert.equal(prepared.rig.steer.length, 4);
        assert.equal(prepared.feedback.vehicle.id, id);
        assert.equal(
          prepared.feedback.exhaust.jets.length,
          VEHICLES[id].exhausts.length,
        );
        prepared.model.traverse((o: import("three").Object3D) => {
          if (/wiper/i.test(o.name)) assert.equal(o.visible, false);
        });
        assert.equal(game.track, f.track);
      } finally {
        prepared.roof?.dispose();
        prepared.physics.dispose();
        disposeObjectResources(prepared.model);
      }
    }
  } finally {
    f.road.geometry.dispose();
  }
});

test("leaving the convertible releases the old roof mixer, while a failed swap keeps it usable", async (t) => {
  globals(t);
  const f = fixture();
  let disposed = 0;
  const roof = {
    dispose() {
      disposed++;
    },
  };
  Object.assign(f.game, { vehicle: VEHICLES.targa, roof });
  f.game.state.vehicleId = "targa";
  f.game.prepareVehicle = async () => {
    throw new Error("test replacement failure");
  };
  t.mock.method(console, "error", () => {});
  await f.game.selectVehicle("scarlet");
  assert.equal(disposed, 0);
  assert.equal(f.game.roof, roof);
  f.game.prepareVehicle = async () => candidate("scarlet");
  await f.game.selectVehicle("scarlet");
  assert.equal(disposed, 1);
  assert.equal(f.game.roof, undefined);
  assert.equal(f.game.vehicle.id, "scarlet");
});
