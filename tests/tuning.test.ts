import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TUNING,
  TUNING_PRESETS,
  TUNING_SCHEMA,
  loadTuning,
  parseTuning,
  sanitizeTuning,
  saveTuning,
  serializeTuning,
  tuningIsStandard,
  tuningPreset,
  vehicleDefaults,
  type TuningKey,
} from "../src/game/Tuning";

test("an exported vehicle and track setup survives JSON roundtrip without losing precision", () => {
  const setup = {
    ...tuningPreset("drift"),
    mass: 1130,
    frontDrive: 35,
    frontFrequency: 1.85,
    roadGrip: 0.65,
    maxRebound: 1.7,
  };
  const json = serializeTuning(setup);
  assert.equal(JSON.parse(json).version, 1);
  const imported = parseTuning(json);
  assert.deepEqual(imported, setup);
  assert.notEqual(imported, setup);
  assert.equal(tuningIsStandard(imported), false);
});

test("imports reject incompatible versions, incomplete records and invalid numeric values", () => {
  for (const data of [
    null,
    [],
    {},
    { version: "1", tuning: DEFAULT_TUNING },
    { version: 2, tuning: DEFAULT_TUNING },
    { version: 1, tuning: [] },
    { version: 1, tuning: {} },
    { version: 1, tuning: { ...DEFAULT_TUNING, mass: "950" } },
    { version: 1, tuning: { ...DEFAULT_TUNING, mass: null } },
    { version: 1, tuning: { ...DEFAULT_TUNING, mass: false } },
  ]) {
    assert.throws(() => parseTuning(JSON.stringify(data)));
  }
  const missingField = { ...DEFAULT_TUNING } as Partial<typeof DEFAULT_TUNING>;
  delete missingField.gripRecovery;
  assert.throws(() =>
    parseTuning(JSON.stringify({ version: 1, tuning: missingField })),
  );
  assert.throws(() => parseTuning("{broken json"));
  // JSON permits this numeric spelling, but the JS result is non-finite.
  const overflow = serializeTuning(DEFAULT_TUNING).replace(
    /"mass":\s*950/,
    '"mass":1e309',
  );
  assert.throws(() => parseTuning(overflow));
});

test("out-of-range imported settings are bounded while invalid local drafts fall back safely", () => {
  const unsafe = {
    ...DEFAULT_TUNING,
    mass: -100,
    torque: 100000,
    roadGrip: -1,
    frontDrive: 150,
    gravity: 0,
    unexpected: 123,
  };
  const imported = parseTuning(JSON.stringify({ version: 1, tuning: unsafe }));
  assert.equal(imported.mass, TUNING_SCHEMA.mass.min);
  assert.equal(imported.torque, TUNING_SCHEMA.torque.max);
  assert.equal(imported.roadGrip, TUNING_SCHEMA.roadGrip.min);
  assert.equal(imported.frontDrive, TUNING_SCHEMA.frontDrive.max);
  assert.equal(imported.gravity, TUNING_SCHEMA.gravity.min);
  assert.equal("unexpected" in imported, false);
  assert.equal(
    unsafe.mass,
    -100,
    "sanitizing must not mutate the editor draft",
  );

  const safe = sanitizeTuning({
    mass: NaN,
    torque: Infinity,
    gravity: -Infinity,
    abs: "0",
    tractionControl: false,
    roadGrip: 0.7,
  });
  for (const key of [
    "mass",
    "torque",
    "gravity",
    "abs",
    "tractionControl",
  ] as TuningKey[])
    assert.equal(safe[key], DEFAULT_TUNING[key]);
  assert.equal(safe.roadGrip, 0.7);
  for (const invalid of [null, undefined, "setup", 4, []])
    assert.deepEqual(sanitizeTuning(invalid), DEFAULT_TUNING);
});

test("every preset is complete and independent; resetting a draft cannot change the standard setup", () => {
  const baseline = { ...DEFAULT_TUNING };
  const keys = Object.keys(TUNING_SCHEMA) as TuningKey[];
  for (const key of Object.keys(TUNING_PRESETS)) {
    const first = tuningPreset(key);
    const second = tuningPreset(key);
    assert.deepEqual(Object.keys(first).sort(), [...keys].sort());
    for (const field of keys) {
      assert.ok(Number.isFinite(first[field]));
      assert.ok(first[field] >= TUNING_SCHEMA[field].min);
      assert.ok(first[field] <= TUNING_SCHEMA[field].max);
    }
    first.mass = 1800;
    first.roadGrip = 0.4;
    assert.deepEqual(tuningPreset(key), second);
    assert.deepEqual(DEFAULT_TUNING, baseline);
  }
  assert.equal(tuningIsStandard(tuningPreset("balanced")), true);
  assert.deepEqual(tuningPreset("unknown-preset"), baseline);
  assert.equal(
    tuningIsStandard({ ...baseline, roadGrip: baseline.roadGrip - 0.05 }),
    false,
  );
});

test("browser storage restores valid setups and safely ignores corrupt or unavailable storage", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  let stored: string | null = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => {
        assert.equal(key, "cloudcape.tuning.v1");
        return stored;
      },
      setItem: (key: string, value: string) => {
        assert.equal(key, "cloudcape.tuning.v1");
        stored = value;
      },
    },
  });
  assert.deepEqual(loadTuning(), DEFAULT_TUNING);
  const previousStable = {
    ...DEFAULT_TUNING,
    torque: 440,
    longitudinalGrip: 1.45,
    restitution: 0.16,
    maxRebound: 2.4,
    driftGripLoss: 55,
  };
  stored = JSON.stringify({
    version: 1,
    setupRevision: 2,
    tuning: previousStable,
  });
  assert.deepEqual(
    loadTuning(),
    DEFAULT_TUNING,
    "previous balanced drift setup was not upgraded",
  );
  stored = JSON.stringify({
    version: 1,
    setupRevision: 2,
    tuning: { ...previousStable, mass: 1100 },
  });
  assert.deepEqual(
    loadTuning(),
    { ...previousStable, mass: 1100 },
    "upgrading drift defaults changed a custom setup",
  );
  saveTuning(previousStable);
  assert.deepEqual(
    loadTuning(),
    previousStable,
    "explicit previous grip settings were overwritten",
  );
  const previousDefault = {
    ...DEFAULT_TUNING,
    torque: 440,
    longitudinalGrip: 1.45,
    restitution: 0.16,
    maxRebound: 2.4,
    frontGrip: 1.15,
    rearGrip: 1.15,
    steeringGrip: 13,
    driftBuild: 0.6,
    driftGripLoss: 62,
  };
  stored = JSON.stringify({ version: 1, tuning: previousDefault });
  assert.deepEqual(
    loadTuning(),
    DEFAULT_TUNING,
    "old standard setup was not upgraded",
  );
  const oldCustom = { ...previousDefault, mass: 1100 };
  stored = JSON.stringify({ version: 1, tuning: oldCustom });
  assert.deepEqual(loadTuning(), oldCustom, "migration changed a custom setup");
  saveTuning(previousDefault);
  assert.deepEqual(
    loadTuning(),
    previousDefault,
    "explicitly restoring old values must survive reload",
  );
  const wet = tuningPreset("wet");
  saveTuning(wet);
  assert.deepEqual(loadTuning(), wet);
  stored = '{"version":1,"tuning":{"mass":950}}';
  assert.deepEqual(loadTuning(), DEFAULT_TUNING);
  stored = "invalid";
  const fallback = loadTuning();
  fallback.mass = 1800;
  assert.deepEqual(loadTuning(), DEFAULT_TUNING);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage disabled");
    },
  });
  assert.deepEqual(loadTuning(), DEFAULT_TUNING);
});

test("all exact revision-3 factory setups upgrade power, while custom and explicitly reimported setups remain literal", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  });
  const previousPower = {
    sparrow: [440, 1.45],
    scarlet: [600, 1.55],
    formula: [500, 1.6],
    targa: [470, 1.5],
    suv: [560, 1.55],
  } as const;
  for (const id of Object.keys(
    previousPower,
  ) as (keyof typeof previousPower)[]) {
    const old = {
      ...vehicleDefaults(id),
      torque: previousPower[id][0],
      longitudinalGrip: previousPower[id][1],
      restitution: 0.16,
      maxRebound: 2.4,
    };
    const key =
      id === "sparrow" ? "cloudcape.tuning.v1" : `cloudcape.tuning.${id}.v1`;
    data.set(
      key,
      JSON.stringify({ version: 1, setupRevision: 3, tuning: old }),
    );
    assert.deepEqual(
      loadTuning(id),
      vehicleDefaults(id),
      `${id}: old factory setup remained slow`,
    );
    const custom = { ...old, finalDrive: old.finalDrive + 0.1 };
    data.set(
      key,
      JSON.stringify({ version: 1, setupRevision: 3, tuning: custom }),
    );
    assert.deepEqual(
      loadTuning(id),
      custom,
      `${id}: custom setup was overwritten`,
    );
    saveTuning(old, id);
    assert.deepEqual(
      loadTuning(id),
      old,
      `${id}: explicit import of old values was overwritten`,
    );
  }
});

test("factory revision-4 rebound settings soften automatically without overwriting custom or reimported collision tuning", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  let value = "";
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => value,
      setItem: (_key: string, data: string) => {
        value = data;
      },
    },
  });
  for (const id of ["sparrow", "scarlet", "formula", "targa", "suv"] as const) {
    const factory = {
      ...vehicleDefaults(id),
      restitution: 0.16,
      maxRebound: 2.4,
    };
    value = JSON.stringify({ version: 1, setupRevision: 4, tuning: factory });
    assert.deepEqual(loadTuning(id), vehicleDefaults(id));
    const custom = { ...factory, wallFriction: 0.12 };
    value = JSON.stringify({ version: 1, setupRevision: 4, tuning: custom });
    assert.deepEqual(loadTuning(id), custom);
    saveTuning(factory, id);
    assert.deepEqual(loadTuning(id), factory);
  }
});
