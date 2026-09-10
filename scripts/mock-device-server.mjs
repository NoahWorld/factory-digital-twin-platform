import { createServer } from "node:http";

const HOST = "127.0.0.1";
const port = Number.parseInt(process.env.MOCK_DEVICE_PORT ?? "8790", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("MOCK_DEVICE_PORT must be an integer between 1 and 65535.");
}

const allowedStates = new Set(["running", "stopped", "warning", "alarm"]);
const device = {
  alarmLevel: 0,
  fixedTimestamp: null,
  outage: false,
  sequence: 0,
  status: "running",
};

const round = (value, digits = 1) => Number(value.toFixed(digits));

const factorySnapshot = () => {
  device.sequence += 1;
  const phase = device.sequence;
  return {
    timestamp: device.fixedTimestamp ?? new Date().toISOString(),
    demo: {
      label: "智能车间 2D + 3D 联动",
      runtimeMode: "simulation",
    },
    devices: {
      robot01: {
        alarmLevel: 0,
        cycleTime: round(12.6 + Math.sin(phase / 4) * 0.8),
        outputCount: 1280 + phase * 3,
        status: "running",
        temperature: round(46.2 + Math.sin(phase / 5) * 1.7),
        utilization: round(91.4 + Math.cos(phase / 6) * 2.1),
      },
      robot02: {
        alarmLevel: 1,
        cycleTime: round(14.1 + Math.sin(phase / 3) * 0.9),
        outputCount: 1196 + phase * 2,
        status: "warning",
        temperature: round(58.8 + Math.cos(phase / 4) * 2.2),
        utilization: round(78.5 + Math.sin(phase / 7) * 2.6),
      },
      agv01: {
        alarmLevel: 0,
        battery: round(84.6 - (phase % 40) * 0.25),
        speed: round(1.25 + Math.sin(phase / 3) * 0.16, 2),
        status: "running",
        taskProgress: round(42 + (phase % 24) * 2.1),
        temperature: round(37.5 + Math.cos(phase / 5) * 0.7),
      },
      agv02: {
        alarmLevel: 0,
        battery: round(96.2 - (phase % 18) * 0.12),
        speed: 0,
        status: "stopped",
        taskProgress: 100,
        temperature: round(33.4 + Math.sin(phase / 6) * 0.4),
      },
      machine01: {
        alarmLevel: 0,
        outputCount: 2486 + phase * 4,
        power: round(18.7 + Math.sin(phase / 4) * 1.2),
        spindleSpeed: Math.round(1460 + Math.cos(phase / 5) * 38),
        status: "running",
        temperature: round(52.3 + Math.sin(phase / 6) * 1.4),
      },
      cabinet01: {
        alarmLevel: 0,
        current: round(32.8 + Math.cos(phase / 4) * 1.8),
        humidity: round(43.2 + Math.sin(phase / 7) * 1.3),
        status: "running",
        temperature: round(29.7 + Math.sin(phase / 5) * 0.8),
        voltage: round(381.5 + Math.cos(phase / 6) * 2.4),
      },
      camera01: {
        alarmLevel: 0,
        bitrate: round(5.6 + Math.sin(phase / 4) * 0.4),
        fps: round(24.8 + Math.cos(phase / 5) * 0.3),
        latency: Math.round(42 + Math.sin(phase / 3) * 7),
        status: "running",
        temperature: round(41.3 + Math.sin(phase / 6) * 0.5),
      },
      beacon01: {
        alarmLevel: 2,
        duration: 46 + phase * 2,
        eventCode: "SAFETY-GATE-OPEN",
        status: "alarm",
        temperature: round(31.2 + Math.cos(phase / 5) * 0.3),
      },
    },
  };
};

const writeJson = (response, status, body) => {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(payload);
};

const readJsonBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new Error("Request body exceeds 4096 bytes.");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) throw new Error("Request body is required.");
  return JSON.parse(text);
};

const server = createServer(async (request, response) => {
  const startedAt = Date.now();
  const url = new URL(request.url ?? "/", `http://${HOST}:${port}`);
  let responseStatus = 500;
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      responseStatus = 200;
      writeJson(response, responseStatus, {
        deviceId: "DEVICE-001",
        fixedTimestamp: device.fixedTimestamp,
        outage: device.outage,
        status: "ok",
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/device/DEVICE-001") {
      if (device.outage) {
        responseStatus = 503;
        writeJson(response, responseStatus, {
          code: "simulated_device_outage",
          message: "DEVICE-001 is intentionally unavailable.",
        });
        return;
      }
      device.sequence += 1;
      responseStatus = 200;
      writeJson(response, responseStatus, {
        deviceId: "DEVICE-001",
        timestamp: device.fixedTimestamp ?? new Date().toISOString(),
        values: {
          alarmLevel: device.alarmLevel,
          pressure: Number((101.2 + Math.cos(device.sequence / 4) * 1.4).toFixed(1)),
          status: device.status,
          temperature: Number((42.5 + Math.sin(device.sequence / 3) * 2.2).toFixed(1)),
        },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/factory/demo-workshop") {
      responseStatus = 200;
      writeJson(response, responseStatus, factorySnapshot());
      return;
    }

    if (request.method === "POST" && url.pathname === "/control/outage") {
      device.outage = true;
      responseStatus = 200;
      writeJson(response, responseStatus, { deviceId: "DEVICE-001", outage: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/control/recover") {
      device.outage = false;
      responseStatus = 200;
      writeJson(response, responseStatus, { deviceId: "DEVICE-001", outage: false });
      return;
    }

    if (request.method === "POST" && url.pathname === "/control/stale") {
      device.fixedTimestamp = new Date(Date.now() - 30_000).toISOString();
      responseStatus = 200;
      writeJson(response, responseStatus, {
        deviceId: "DEVICE-001",
        fixedTimestamp: device.fixedTimestamp,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/control/fresh") {
      device.fixedTimestamp = null;
      responseStatus = 200;
      writeJson(response, responseStatus, {
        deviceId: "DEVICE-001",
        fixedTimestamp: null,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/control/state") {
      const body = await readJsonBody(request);
      if (typeof body.status !== "string" || !allowedStates.has(body.status)) {
        responseStatus = 422;
        writeJson(response, responseStatus, {
          code: "invalid_device_state",
          message: "status must be running, stopped, warning, or alarm.",
        });
        return;
      }
      device.status = body.status;
      device.alarmLevel = body.status === "alarm" ? 2 : body.status === "warning" ? 1 : 0;
      responseStatus = 200;
      writeJson(response, responseStatus, {
        alarmLevel: device.alarmLevel,
        deviceId: "DEVICE-001",
        status: device.status,
      });
      return;
    }

    responseStatus = 404;
    writeJson(response, responseStatus, {
      code: "route_not_found",
      message: `${request.method ?? "UNKNOWN"} ${url.pathname} is not available.`,
    });
  } catch (error) {
    responseStatus = error instanceof SyntaxError ? 400 : 500;
    writeJson(response, responseStatus, {
      code: error instanceof SyntaxError ? "invalid_json" : "mock_server_error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    console.log(JSON.stringify({
      durationMs: Date.now() - startedAt,
      event: "mock_device_request",
      method: request.method,
      path: url.pathname,
      status: responseStatus,
    }));
  }
});

server.on("error", (error) => {
  console.error(JSON.stringify({
    event: "mock_device_server_error",
    message: error.message,
  }));
  process.exitCode = 1;
});

server.listen(port, HOST, () => {
  console.log(JSON.stringify({
    deviceUrl: `http://${HOST}:${port}/device/DEVICE-001`,
    event: "mock_device_server_started",
    factoryDemoUrl: `http://${HOST}:${port}/factory/demo-workshop`,
    host: HOST,
    port,
  }));
});

const close = (signal) => {
  console.log(JSON.stringify({ event: "mock_device_server_stopping", signal }));
  server.close((error) => {
    if (error) {
      console.error(JSON.stringify({ event: "mock_device_server_close_failed", message: error.message }));
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", () => close("SIGINT"));
process.on("SIGTERM", () => close("SIGTERM"));
