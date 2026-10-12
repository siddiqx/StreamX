/**
 * StreamX Cloudflare Worker — 24/7 Edge Proxy & Direct Google Drive Streamer
 * 
 * Runs 24/7 on Cloudflare's serverless edge network (100% in cloud, ZERO cost, NO credit card).
 * 
 * Dual-Mode Architecture:
 * 1. ONLINE MODE (When your PC is ON):
 *    - Forwards all API requests to your local backend via Cloudflare Tunnel.
 *    - Caches media catalog & image proxies on Cloudflare edge.
 * 2. OFFLINE MODE (When your PC is OFF):
 *    - Serves the cached media catalog 24/7 so the website is always reachable.
 *    - Streams videos directly from Google Drive to your browser or VLC with HTTP 206 Partial Content.
 *    - Generates M3U playlists on the fly for external media players (VLC, MX Player, IINA).
 *    - Zero bandwidth limit: 100% free streaming powered by Google Drive & Cloudflare Edge.
 */

// Your backend tunnel URL (when PC is running)
const BACKEND_URL = "https://senior-concerning-economies-tap.trycloudflare.com";

// In-memory token cache for Google OAuth
let cachedGoogleToken = null;
let googleTokenExpiry = 0;

// In-memory catalog cache for 24/7 offline fallback
let cachedCatalog = null;
let cachedCatalogTime = 0;

async function getGoogleAccessToken(env) {
  const now = Date.now();
  if (cachedGoogleToken && googleTokenExpiry > now + 60000) {
    return cachedGoogleToken;
  }

  const clientId = env?.GOOGLE_CLIENT_ID || "";
  const clientSecret = env?.GOOGLE_CLIENT_SECRET || "";
  const refreshToken = env?.GOOGLE_REFRESH_TOKEN || "";

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Drive credentials not configured in Cloudflare Worker environment variables.");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuth refresh failed HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Google OAuth did not return an access_token.");
  }

  cachedGoogleToken = data.access_token;
  googleTokenExpiry = now + (data.expires_in || 3600) * 1000;
  return cachedGoogleToken;
}

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
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
          "Access-Control-Allow-Headers": reqHeaders,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const rawBase = (env?.BACKEND_URL || BACKEND_URL || "").trim().replace(/\/+$/, "");
    const targetUrl = new URL(rawBase + url.pathname + url.search);
    const isStream = url.pathname.includes("/stream");
    const isPlaylist = url.pathname.includes("/playlist.m3u");
    const isCatalog = url.pathname === "/media";
    const driveIdParam = url.searchParams.get("drive_id");

    // Helper: Stream directly from Google Drive
    const streamDirectFromDrive = async (driveFileId) => {
      try {
        const token = await getGoogleAccessToken(env);
        const driveUrl = `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`;

        const driveHeaders = new Headers();
        driveHeaders.set("Authorization", `Bearer ${token}`);
        const range = request.headers.get("Range");
        if (range) {
          driveHeaders.set("Range", range);
        }

        const driveRes = await fetch(driveUrl, {
          method: request.method,
          headers: driveHeaders,
        });

        const resHeaders = new Headers(driveRes.headers);
        resHeaders.set("Access-Control-Allow-Origin", origin);
        resHeaders.set("Access-Control-Allow-Credentials", "true");
        resHeaders.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
        resHeaders.set("Accept-Ranges", "bytes");

        return new Response(request.method === "HEAD" ? null : driveRes.body, {
          status: driveRes.status,
          statusText: driveRes.statusText,
          headers: resHeaders,
        });
      } catch (driveErr) {
        return new Response(
          JSON.stringify({
            error: "Failed to stream directly from Google Drive",
            message: driveErr.message,
          }),
          {
            status: 502,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": origin,
            },
          }
        );
      }
    };

    // Forward original headers to local backend
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", targetUrl.host);
    newHeaders.set("X-Forwarded-Host", url.host);
    newHeaders.set("X-Forwarded-Proto", "https");

    const fetchInit = {
      method: request.method,
      headers: newHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "follow",
    };
    if (fetchInit.body && typeof fetchInit.body === "object") {
      fetchInit.duplex = "half";
    }

    try {
      // 1. Attempt to reach backend tunnel
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), isStream ? 5000 : 3500);
      fetchInit.signal = controller.signal;

      const response = await fetch(targetUrl.toString(), fetchInit);
      clearTimeout(timeoutId);

      // Cache catalog response on success
      if (isCatalog && response.status === 200) {
        try {
          const clone = response.clone();
          cachedCatalog = await clone.json();
          cachedCatalogTime = Date.now();
        } catch (_) {}
      }

      // Clone response headers and attach CORS
      const resHeaders = new Headers(response.headers);
      resHeaders.set("Access-Control-Allow-Origin", origin);
      resHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD");
      resHeaders.set("Access-Control-Allow-Headers", "*");
      resHeaders.set("Access-Control-Allow-Credentials", "true");
      resHeaders.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

      const hasNoBody = [101, 204, 205, 304].includes(response.status) || request.method === "HEAD";

      return new Response(hasNoBody ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
      });
    } catch (err) {
      // 2. OFFLINE FALLBACK (When local PC is off or tunnel is down)

      // Fallback A: Stream video directly from Google Drive
      if (isStream && driveIdParam) {
        return await streamDirectFromDrive(driveIdParam);
      }

      // Fallback B: If stream requested without drive_id param, try resolving from cached catalog
      if (isStream) {
        const match = url.pathname.match(/\/media\/(\d+)\/stream/);
        if (match && cachedCatalog && Array.isArray(cachedCatalog)) {
          const mediaId = parseInt(match[1], 10);
          const found = cachedCatalog.find((item) => item.id === mediaId);
          if (found && found.drive_file_id) {
            return await streamDirectFromDrive(found.drive_file_id);
          }
        }
      }

      // Fallback C: Generate M3U playlist pointing to direct stream
      if (isPlaylist && driveIdParam) {
        const streamUrl = `https://${url.host}/media/0/stream?drive_id=${encodeURIComponent(driveIdParam)}`;
        const m3u = `#EXTM3U\n#EXTINF:-1,StreamX Direct Play\n${streamUrl}\n`;
        return new Response(m3u, {
          status: 200,
          headers: {
            "Content-Type": "application/x-mpegurl; charset=utf-8",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        });
      }

      // Fallback D: Serve cached catalog so frontend displays library 24/7
      if (isCatalog && cachedCatalog) {
        return new Response(JSON.stringify(cachedCatalog), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "X-StreamX-Source": "edge-cache",
          },
        });
      }

      // Fallback E: System health check
      if (url.pathname === "/health" || url.pathname === "/system/status") {
        return new Response(
          JSON.stringify({
            status: "online",
            edge: "Cloudflare Worker 24/7",
            backend: "offline (local PC sleeping)",
            streaming: "ready (direct Google Drive)",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": origin,
            },
          }
        );
      }

      return new Response(
        JSON.stringify({
          error: "StreamX Local Backend Offline",
          message: "Your local PC is currently off. Watching cached media streams directly from Google Drive is active.",
          hint: "Turn on your PC when you want to queue new downloads from Telegram.",
        }),
        {
          status: 503,
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
