import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TouchInput,
  emptyInput,
  automaticThrottle,
  touchControlsEnabled,
} from "../src/game/TouchInput";
import { InputManager } from "../src/game/Input";
import { loadSettings } from "../src/game/types";
import { Physics } from "../src/game/Physics";
import { flatCircuit, parked } from "./helpers/driving";

test("multiple fingers retain independent directions, pedals and boost until their own release", () => {
  const touch = new TouchInput();
  touch.press(1, "left");
  touch.press(2, "throttle");
  touch.press(3, "boost");
  assert.deepEqual(touch.read(), {
    throttle: 1,
    brake: 0,
    steer: -1,
    handbrake: false,
    boost: true,
  });
  touch.release(2);
  assert.equal(touch.read().steer, -1);
  assert.equal(touch.read().boost, true);
  assert.equal(touch.read().throttle, 0);
  touch.press(4, "left");
  touch.release(1);
  assert.equal(
    touch.read().steer,
    -1,
    "one release cancelled the other finger on the same direction",
  );
  touch.press(5, "right");
  assert.equal(touch.read().steer, 0);
  touch.release(4);
  assert.equal(
    touch.read().steer,
    1,
    "opposite key release cancelled the remaining turn",
  );
  touch.press(6, "brake");
  touch.press(7, "handbrake");
  assert.equal(touch.read().brake, 1);
  assert.equal(touch.read().handbrake, true);
  touch.release(7);
  touch.release(7);
  assert.equal(touch.read().handbrake, false);
  assert.equal(touch.read().brake, 1);
  touch.clear();
  assert.deepEqual(touch.read(), emptyInput());
});

test("automatic throttle yields to either brake, resumes on release and leaves manual input unchanged", () => {
  const idle = emptyInput();
  assert.equal(automaticThrottle(idle, true).throttle, 1);
  assert.equal(idle.throttle, 0);
  for (const brake of [{ brake: 1 }, { handbrake: true }])
    assert.equal(automaticThrottle({ ...idle, ...brake }, true).throttle, 0);
  const manual = { ...idle, throttle: 0.4, steer: -1 };
  assert.deepEqual(automaticThrottle(manual, false), manual);
  assert.equal(automaticThrottle(idle, true).throttle, 1);
  assert.equal(touchControlsEnabled("auto", true), true);
  assert.equal(touchControlsEnabled("auto", false), false);
  assert.equal(touchControlsEnabled("keyboard", true), false);
  assert.equal(touchControlsEnabled("touch", false), true);
});

test("input manager clears all captured fingers on blur and limits automatic throttle to touch mode", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const target = new EventTarget(),
    query = { matches: true };
  const win = {
    matchMedia: () => query,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: win,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { maxTouchPoints: 0 },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousNavigator)
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
  const actions: string[] = [],
    input = new InputManager((key) => actions.push(key));
  try {
    input.configureControls("auto", true);
    assert.equal(input.read().throttle, 1);
    input.pressTouch(10, "right");
    input.pressTouch(11, "brake");
    assert.equal(input.read().steer, 1);
    assert.equal(input.read().throttle, 0);
    input.releaseTouch(11);
    assert.equal(input.read().throttle, 1);
    assert.equal(input.read().steer, 1);
    input.keys.add("ArrowLeft");
    assert.equal(
      input.read().steer,
      -1,
      "keyboard should take priority over touch",
    );
    target.dispatchEvent(new Event("blur"));
    assert.equal(input.read().steer, 0);
    assert.deepEqual(input.touch, emptyInput());
    assert.ok(actions.includes("blur"));
    input.configureControls("keyboard", true);
    assert.equal(input.read().throttle, 0);
    input.configureControls("auto", true);
    query.matches = false;
    assert.equal(input.read().throttle, 0);
    input.configureControls("touch", true);
    assert.equal(input.read().throttle, 1);
    input.pressTouch(12, "handbrake");
    assert.equal(input.read().throttle, 0);
    input.clear();
    assert.equal(input.read().handbrake, false);
  } finally {
    input.dispose();
  }
});

test("mobile preferences are backward compatible, persisted and validated without changing saved quality", (t) => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let saved = "{}";
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => saved },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { maxTouchPoints: 2 },
  });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (oldNavigator)
      Object.defineProperty(globalThis, "navigator", oldNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
  assert.equal(loadSettings().controls, "auto");
  assert.equal(loadSettings().autoThrottle, false);
  assert.equal(loadSettings().quality, "medium");
  saved = JSON.stringify({
    ...loadSettings(),
    quality: "high",
    controls: "touch",
    autoThrottle: true,
  });
  assert.equal(loadSettings().quality, "high");
  assert.equal(loadSettings().controls, "touch");
  assert.equal(loadSettings().autoThrottle, true);
  saved = '{"controls":"invalid","autoThrottle":"true"}';
  assert.equal(loadSettings().controls, "auto");
  assert.equal(loadSettings().autoThrottle, false);
});

test("real vehicle accelerates automatically, stops with held handbrake and resumes when released", async () => {
  const f = flatCircuit(),
    p = await Physics.create(f.road, f.track);
  try {
    for (let i = 0; i < 120; i++) p.step(1 / 120, parked, true, false);
    for (let i = 0; i < 420; i++)
      p.step(1 / 120, automaticThrottle(emptyInput(), true), true, false);
    assert.ok(p.speed * 3.6 > 45, "automatic throttle failed to accelerate");
    for (let i = 0; i < 600; i++)
      p.step(
        1 / 120,
        automaticThrottle({ ...emptyInput(), handbrake: true }, true),
        true,
        false,
      );
    assert.ok(
      p.speed < 0.25,
      "automatic throttle kept pushing against the handbrake",
    );
    for (let i = 0; i < 360; i++)
      p.step(1 / 120, automaticThrottle(emptyInput(), true), true, false);
    assert.ok(
      p.speed * 3.6 > 40,
      "automatic throttle did not resume after brake release",
    );
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});
