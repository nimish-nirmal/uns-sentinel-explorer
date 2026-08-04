/**
 * Demo Data / Simulator Mode — emits realistic simulated telemetry on a
 * background interval when disconnected, enabling full offline UI testing.
 */
import type { TopicSubscription } from '../types';

export interface SimulatedMessage {
  topic: string;
  payload: string;
  retain: boolean;
  qos: 0 | 1 | 2;
}

interface SimState {
  timer: ReturnType<typeof setInterval> | null;
  tick: number;
  sensorTemps: Record<string, number>;
  sensorPressures: Record<string, number>;
  motorSpeeds: Record<string, number>;
}

const DEMO_SENSORS = ['sensor-01', 'sensor-02', 'sensor-03', 'sensor-04'];
const DEMO_MOTORS = ['motor-A1', 'motor-B2', 'motor-C3'];

export interface SimulatorControl {
  /** Stop the simulator entirely (clears the interval) */
  stop: () => void;
  /** Pause message generation (keeps state, can be resumed) */
  pause: () => void;
  /** Resume message generation after a pause */
  resume: () => void;
  /** Whether the simulator is currently paused */
  isPaused: () => boolean;
}

/** Start a simulator that generates messages every `intervalMs` */
export function startSimulator(
  subscriptions: TopicSubscription[],
  onMessage: (msg: SimulatedMessage) => void,
  intervalMs = 1500
): SimulatorControl {
  const state: SimState = {
    timer: null,
    tick: 0,
    sensorTemps: {},
    sensorPressures: {},
    motorSpeeds: {},
  };

  let paused = false;

  const generate = () => {
    if (paused) return;
    const messages = buildMessages(state);
    for (const msg of messages) onMessage(msg);
  };

  // Seed a couple of messages immediately for instant feedback
  generate();
  state.timer = setInterval(generate, intervalMs);

  return {
    stop: () => {
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
    isPaused: () => paused,
  };
}

function buildMessages(state: SimState): SimulatedMessage[] {
  state.tick++;
  const msgs: SimulatedMessage[] = [];
  const now = new Date().toISOString();

  // ISA-95 structured telemetry — follows the standard hierarchy from the
  // `unified-namespace-schemas` repo:
  //   {TOPIC_PREFIX}/{enterprise}/{site}/{area}/{line}/{cell}/{asset}/{messageType}
  // where messageType ∈ { asset, state, edge, alert }.
  // The TOPIC_PREFIX is optional — it can be a company/namespace name.
  const TOPIC_PREFIX = 'UnifiedNamespace';
  const ENTERPRISE = 'Plant';
  const SITE = 'Plant-01';
  const AREA = 'Utilities';
  const LINE = 'CoolingSystem';
  const CELL = 'PumpStation-A';
  const ASSET = 'PUMP-101';
  const base = `${TOPIC_PREFIX}/${ENTERPRISE}/${SITE}/${AREA}/${LINE}/${CELL}/${ASSET}`;

  // Asset birth certificate (retained)
  msgs.push({
    topic: `${base}/asset`,
    payload: JSON.stringify({
      ts: now,
      assetId: ASSET,
      name: 'Primary Cooling Water Pump 1',
      type: 'CentrifugalPump',
      manufacturer: 'Grundfos',
      model: 'CR45-4',
      location: 'Building A - Bay 2',
    }),
    retain: true,
    qos: 0,
  });

  // Operational state (non-retained)
  msgs.push({
    topic: `${base}/state`,
    payload: JSON.stringify({
      ts: now,
      assetId: ASSET,
      state: state.tick % 20 === 0 ? 'STARTING' : 'RUNNING',
      previousState: 'RUNNING',
      trigger: 'auto',
    }),
    retain: false,
    qos: 0,
  });

  // Edge telemetry — per-sensor readings under .../edge/{sensorName}
  for (const sensor of DEMO_SENSORS) {
    const idx = DEMO_SENSORS.indexOf(sensor);
    const baseTemp = 65 + idx * 4;
    const temp = smoothValue(state.sensorTemps, sensor, baseTemp, 2.5);
    state.sensorTemps[sensor] = temp;

    msgs.push({
      topic: `${base}/edge/temperature`,
      payload: JSON.stringify({
        ts: now,
        sensorId: sensor,
        value: round(temp, 2),
        unit: 'C',
        quality: randomQuality(),
        alarm: temp > 85,
      }),
      retain: true,
      qos: 0,
    });

    const basePressure = 101.3 + idx * 0.4;
    const pressure = smoothValue(state.sensorPressures, sensor, basePressure, 0.9);
    state.sensorPressures[sensor] = pressure;

    msgs.push({
      topic: `${base}/edge/pressure`,
      payload: JSON.stringify({
        ts: now,
        sensorId: sensor,
        value: round(pressure, 3),
        unit: 'kPa',
        quality: randomQuality(),
      }),
      retain: true,
      qos: 0,
    });
  }

  // Alert notification (non-retained, only when a sensor is hot)
  const hottest = Math.max(...Object.values(state.sensorTemps).filter((v) => v !== undefined));
  if (hottest > 85) {
    msgs.push({
      topic: `${base}/alert`,
      payload: JSON.stringify({
        ts: now,
        assetId: ASSET,
        severity: 'WARNING',
        code: 'OVERHEAT_001',
        message: `Temperature exceeded threshold: ${round(hottest, 1)}°C`,
      }),
      retain: false,
      qos: 0,
    });
  }

  // Legacy flat topics
  for (const sensor of DEMO_SENSORS) {
    const idx = DEMO_SENSORS.indexOf(sensor);
    const temp = smoothValue(state.sensorTemps, `legacy-${sensor}`, 70 + idx * 2, 1.5);
    state.sensorTemps[`legacy-${sensor}`] = temp;
    msgs.push({
      topic: `legacy/sensors/${sensor}/temp`,
      payload: JSON.stringify({
        ts: now,
        reading: round(temp, 2),
        unit: 'C',
        status: temp > 80 ? 'HIGH' : 'OK',
      }),
      retain: false,
      qos: 0,
    });
  }

  // Motor speeds (RPM) on legacy topics
  for (const motor of DEMO_MOTORS) {
    const idx = DEMO_MOTORS.indexOf(motor);
    const speed = smoothValue(state.motorSpeeds, motor, 1200 + idx * 150, 80);
    state.motorSpeeds[motor] = speed;
    msgs.push({
      topic: `legacy/motors/${motor}/rpm`,
      payload: JSON.stringify({
        ts: now,
        rpm: Math.round(speed),
        vibration: round(0.5 + Math.random() * 1.8, 2),
        status: 'running',
      }),
      retain: false,
      qos: 0,
    });
  }

  // $SYS broker stats
  msgs.push({
    topic: '$SYS/broker/uptime',
    payload: JSON.stringify({
      seconds: state.tick * 1.5,
      clients: 2 + Math.floor(Math.random() * 4),
      messages_received: state.tick * 100,
      messages_sent: state.tick * 97,
    }),
    retain: true,
    qos: 0,
  });

  return msgs;
}

function smoothValue(store: Record<string, number>, key: string, base: number, jitter: number): number {
  const prev = store[key];
  if (prev === undefined) return base + (Math.random() - 0.5) * jitter;
  return prev + (Math.random() - 0.5) * jitter * 2;
}

function round(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function randomQuality(): 'GOOD' | 'FAIR' | 'BAD' {
  const r = Math.random();
  if (r > 0.92) return 'BAD';
  if (r > 0.7) return 'FAIR';
  return 'GOOD';
}