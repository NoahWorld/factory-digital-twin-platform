const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        status: "ok",
        service: "factory-digital-twin-api",
        timestamp: new Date().toISOString(),
        requestId,
      });
    }

    return json(
      {
        error: "route_not_found",
        message: `No route matches ${request.method} ${url.pathname}.`,
        requestId,
      },
      404,
    );
  },
};
