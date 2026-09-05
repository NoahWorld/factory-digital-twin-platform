import { createServer } from "node:http";

const HOST = "127.0.0.1";
const port = Number.parseInt(process.env.MOCK_DEVICE_PORT ?? "8790", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("MOCK_DEVICE_PORT must be an integer between 1 and 65535.");
}

const allowedStates = new Set(["running", "stopped", "warning", "alarm"]);
const device = {
  alarmLevel: 0,
  outage: false,
  sequence: 0,
  status: "running",
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
        timestamp: new Date().toISOString(),
        values: {
          alarmLevel: device.alarmLevel,
          pressure: Number((101.2 + Math.cos(device.sequence / 4) * 1.4).toFixed(1)),
          status: device.status,
          temperature: Number((42.5 + Math.sin(device.sequence / 3) * 2.2).toFixed(1)),
        },
      });
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
