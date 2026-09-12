import { createServer } from "node:http";

const HOST = "127.0.0.1";
const port = Number.parseInt(process.env.MOCK_DEVICE_PORT ?? "8790", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("MOCK_DEVICE_PORT must be an integer between 1 and 65535.");
}

const allowedStates = new Set(["running", "stopped", "warning", "alarm"]);
const newDevice = (offset) => ({
  offset,
  valueMode: "normal",
  alarmLevel: 0,
  fixedTimestamp: null,
  outage: false,
  sequence: 0,
  status: "running",
});
const devices = new Map([["DEVICE-001", newDevice(0)], ["DEVICE-002", newDevice(20)]]);

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
  const requestedId = url.pathname.match(/^\/device\/([^/]+)$/)?.[1]
    ?? url.pathname.match(/^\/control\/(DEVICE-[^/]+)\//)?.[1] ?? "DEVICE-001";
  const device = devices.get(requestedId);
  const controlPath = url.pathname.replace(/^\/control\/DEVICE-[^/]+\//, "/control/");
  let responseStatus = 500;
  try {
    if (!device) { responseStatus = 404; writeJson(response, 404, { code: "unknown_mock_device" }); return; }
    if (request.method === "GET" && controlPath === "/control/counts") {
      responseStatus = 200; writeJson(response, 200, Object.fromEntries([...devices].map(([id, state]) => [id, state.sequence]))); return;
    }
    if (request.method === "POST" && controlPath === "/control/value") {
      const body = await readJsonBody(request);
      if (!["normal", "null", "type-error", "missing"].includes(body.mode)) { responseStatus = 422; writeJson(response, 422, { code: "invalid_value_mode" }); return; }
      device.valueMode = body.mode; responseStatus = 200; writeJson(response, 200, { deviceId: requestedId, mode: device.valueMode }); return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      responseStatus = 200;
      writeJson(response, responseStatus, {
        deviceId: requestedId,
        fixedTimestamp: device.fixedTimestamp,
        outage: device.outage,
        status: "ok",
      });
      return;
    }

    if (request.method === "GET" && url.pathname === `/device/${requestedId}`) {
      if (device.outage) {
        responseStatus = 503;
        writeJson(response, responseStatus, {
          code: "simulated_device_outage",
          message: `${requestedId} is intentionally unavailable.`,
        });
        return;
      }
      device.sequence += 1;
      responseStatus = 200;
      writeJson(response, responseStatus, {
        deviceId: requestedId,
        timestamp: device.fixedTimestamp ?? new Date().toISOString(),
        values: {
          alarmLevel: device.alarmLevel,
          pressure: Number((101.2 + Math.cos(device.sequence / 4) * 1.4).toFixed(1)),
          status: device.status,
          ...(device.valueMode === "missing" ? {} : { temperature: device.valueMode === "null" ? null : device.valueMode === "type-error" ? "invalid-number" : Number((42.5 + device.offset + Math.sin(device.sequence / 3) * 2.2).toFixed(1)) }),
        },
      });
      return;
    }

    if (request.method === "POST" && controlPath === "/control/outage") {
      device.outage = true;
      responseStatus = 200;
      writeJson(response, responseStatus, { deviceId: requestedId, outage: true });
      return;
    }

    if (request.method === "POST" && controlPath === "/control/recover") {
      device.outage = false;
      responseStatus = 200;
      writeJson(response, responseStatus, { deviceId: requestedId, outage: false });
      return;
    }

    if (request.method === "POST" && controlPath === "/control/stale") {
      device.fixedTimestamp = new Date(Date.now() - 30_000).toISOString();
      responseStatus = 200;
      writeJson(response, responseStatus, {
        deviceId: requestedId,
        fixedTimestamp: device.fixedTimestamp,
      });
      return;
    }

    if (request.method === "POST" && controlPath === "/control/fresh") {
      device.fixedTimestamp = null;
      responseStatus = 200;
      writeJson(response, responseStatus, {
        deviceId: requestedId,
        fixedTimestamp: null,
      });
      return;
    }

    if (request.method === "POST" && controlPath === "/control/state") {
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
        deviceId: requestedId,
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
