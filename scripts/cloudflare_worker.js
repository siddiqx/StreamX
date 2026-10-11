/**
 * StreamX Cloudflare Worker Edge Proxy
 * 
 * Runs 24/7 on Cloudflare's serverless edge network (100% in cloud, ZERO localhost dependency).
 * Features:
 * - Full CORS handling for Vercel & PWA frontend
 * - High-speed edge caching for posters, synopses, and media catalog
 * - Seamless streaming with HTTP 206 Partial Content (Range requests)
 * - Zero credit card required on Cloudflare Workers Free Tier (100k requests/day, unlimited bandwidth)
 */

// Replace with your 24/7 Cloud Backend URL (e.g. Hugging Face Space or Koyeb URL)
const BACKEND_URL = "https://your-username-streamx.hf.space";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetBase = env?.BACKEND_URL || BACKEND_URL;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Construct upstream URL
    const targetUrl = new URL(url.pathname + url.search, targetBase);

    // Forward original headers
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", targetUrl.host);
    newHeaders.set("X-Forwarded-Host", url.host);
    newHeaders.set("X-Forwarded-Proto", "https");

    try {
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: newHeaders,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "follow",
      });

      // Clone response to add CORS headers
      const resHeaders = new Headers(response.headers);
      resHeaders.set("Access-Control-Allow-Origin": "*");
      resHeaders.set("Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS");
      resHeaders.set("Access-Control-Allow-Headers": "*");
      resHeaders.set("Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges");

      // Enable caching for media catalog and image proxy
      if (request.method === "GET" && (url.pathname.includes("/media") || url.pathname.includes("/image-proxy"))) {
        resHeaders.set("Cache-Control", "public, max-age=60, s-maxage=300");
      }

      return new Response(response.body, {
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
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },
};
