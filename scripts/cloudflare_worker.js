/**
 * StreamX Cloudflare Worker Edge Proxy
 * 
 * Runs 24/7 on Cloudflare's serverless edge network (100% in cloud, ZERO localhost dependency).
 * Features:
 * - Full CORS handling with credential support for Vercel & PWA frontend
 * - High-speed edge caching for posters, synopses, and media catalog
 * - Seamless video streaming with HTTP 206 Partial Content (Range requests)
 * - Safe null-body handling for 204/304 HTTP responses
 * - Zero credit card required on Cloudflare Workers Free Tier (100k requests/day, unlimited bandwidth)
 */

// Replace with your 24/7 Cloud Backend URL (e.g. your cloudflared tunnel, Hugging Face Space, or Koyeb URL)
const BACKEND_URL = "https://senior-concerning-economies-tap.trycloudflare.com";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";

    // Handle CORS preflight (OPTIONS)
    if (request.method === "OPTIONS") {
      const reqHeaders = request.headers.get("Access-Control-Request-Headers") || "*";
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": reqHeaders,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Determine target backend base URL
    const rawBase = (env?.BACKEND_URL || BACKEND_URL || "").trim();
    const cleanBase = rawBase.replace(/\/+$/, "");

    // Friendly diagnostic if backend URL is not yet configured
    if (!cleanBase || cleanBase.includes("your-username")) {
      return new Response(
        JSON.stringify({
          status: "StreamX Cloudflare Worker Online",
          message: "Please configure BACKEND_URL in Cloudflare Worker environment variables or script.",
          tip: "Set BACKEND_URL to your 24/7 backend URL (e.g. your tunnel or cloud host).",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    }

    // Construct upstream URL
    const targetUrl = new URL(cleanBase + url.pathname + url.search);

    // Forward original headers
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", targetUrl.host);
    newHeaders.set("X-Forwarded-Host", url.host);
    newHeaders.set("X-Forwarded-Proto", "https");

    // Prepare fetch options
    const isStream = url.pathname.includes("/stream");
    const fetchInit = {
      method: request.method,
      headers: newHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "follow",
    };

    // Support streaming body for Node/modern workerd
    if (fetchInit.body && typeof fetchInit.body === "object") {
      fetchInit.duplex = "half";
    }

    try {
      const response = await fetch(targetUrl.toString(), fetchInit);

      // Clone response headers and attach CORS headers
      const resHeaders = new Headers(response.headers);
      resHeaders.set("Access-Control-Allow-Origin", origin);
      resHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
      resHeaders.set("Access-Control-Allow-Headers", "*");
      resHeaders.set("Access-Control-Allow-Credentials", "true");
      resHeaders.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

      // Caching Strategy:
      // - Cache media catalog & image proxy for fast loading
      // - NEVER cache video stream chunks (breaks Range/seeking)
      if (!isStream && request.method === "GET" && (url.pathname === "/media" || url.pathname.includes("/image-proxy"))) {
        resHeaders.set("Cache-Control", "public, max-age=60, s-maxage=300");
      } else if (isStream) {
        resHeaders.set("Cache-Control", "no-cache, no-store");
      }

      // HTTP spec: Responses with 101, 204, 205, 304 MUST NOT have a body
      const hasNoBody = [101, 204, 205, 304].includes(response.status);

      return new Response(hasNoBody ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "Cloudflare Worker failed to reach cloud backend",
          message: err.message,
          target: targetUrl.toString(),
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    }
  },
};
