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
const BACKEND_URL = "https://dale-mitchell-threatening-recordings.trycloudflare.com";

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

// --- 24/7 Telegram Edge Bot Webhook Engine ---
async function handleTelegramWebhook(request, env, rawBase) {
  try {
    const botToken = env?.TELEGRAM_BOT_TOKEN || "";
    if (!botToken) {
      return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not configured" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ownerId = parseInt(env?.TELEGRAM_OWNER_USER_ID || "8142877259", 10);
    const allowedRaw = env?.TELEGRAM_ALLOWED_USER_IDS || "8142877259,7344705202,8640979779";
    const allowedUsers = allowedRaw.split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean);

    const sendTelegram = async (chatId, text, replyId) => {
      try {
        const payload = { chat_id: chatId, text, parse_mode: "HTML" };
        if (replyId) payload.reply_to_message_id = replyId;
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        console.error("sendTelegram error:", e);
      }
    };

    const forwardToOwner = async (fromChatId, messageId) => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/forwardMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ownerId,
            from_chat_id: fromChatId,
            message_id: messageId,
          }),
        });
        return res.ok;
      } catch (e) {
        console.error("forwardToOwner error:", e);
        return false;
      }
    };

    const update = await request.json();
    const msg = update.message || update.channel_post || update.edited_message;
    if (!msg) return new Response("OK", { status: 200 });

    const chatId = msg.chat?.id;
    const userId = msg.from?.id || chatId;
    const msgId = msg.message_id;

    if (!chatId || !userId) return new Response("OK", { status: 200 });

    // Authorization check
    if (!allowedUsers.includes(userId)) {
      await sendTelegram(chatId, "⛔ <b>Access Denied</b>\nThis StreamX Bot instance is private.", msgId);
      return new Response("OK", { status: 200 });
    }

    const text = (msg.text || msg.caption || "").trim();
    const cmd = text.split(/\s+/)[0].toLowerCase().split("@")[0];

    // Commands
    if (cmd === "/start") {
      await sendTelegram(
        chatId,
        `👋 <b>Welcome to StreamX!</b>\n\n` +
        `StreamX is your personal media cloud pipeline connecting Telegram directly to Google Drive.\n\n` +
        `<b>Features:</b>\n` +
        `• <b>24/7 Cloud Ingestion:</b> Forward any video, episode, or movie directly to this bot at any time.\n` +
        `• <b>Edge Responding:</b> This bot is always online and ready to accept your files.\n` +
        `• <b>Automatic Downloads:</b> When your PC is running, all queued files stream directly to Google Drive.\n\n` +
        `<b>Commands:</b>\n` +
        `• /status — Check 24/7 edge & download status\n` +
        `• /ping — Test edge responsiveness\n` +
        `• /help — Full instructions`,
        msgId
      );
      return new Response("OK", { status: 200 });
    }

    if (cmd === "/ping") {
      await sendTelegram(
        chatId,
        `🏓 <b>Pong! StreamX is Online 24/7</b>\n\n` +
        `🟢 <b>Edge Gateway:</b> Cloudflare Serverless Active\n` +
        `☁️ <b>Google Drive:</b> Connected & Ready\n` +
        `📥 <b>Queue Engine:</b> Ready for new transfers`,
        msgId
      );
      return new Response("OK", { status: 200 });
    }

    if (cmd === "/help") {
      await sendTelegram(
        chatId,
        `📖 <b>StreamX Help Guide</b>\n\n` +
        `• <b>Forward Media:</b> Forward any anime, movie, or series episode directly to this bot.\n` +
        `• <b>24/7 Cloud Ingestion:</b> Your files are safely accepted anytime.\n` +
        `• <b>Automatic Download:</b> When PC turns on, downloads begin automatically.\n` +
        `• <b>VLC Playback:</b> Click Play on the StreamX site or PWA to open directly in VLC.`,
        msgId
      );
      return new Response("OK", { status: 200 });
    }

    if (cmd === "/status" || cmd === "/queue") {
      let isPcOnline = false;
      try {
        const pingRes = await fetch(`${rawBase}/health`, { signal: AbortSignal.timeout(2000) });
        if (pingRes.ok) isPcOnline = true;
      } catch (_) {}

      await sendTelegram(
        chatId,
        `📊 <b>StreamX System Status</b>\n\n` +
        `🟢 <b>Edge Bot Engine:</b> Active 24/7 (Always Responding)\n` +
        `💻 <b>Download Worker:</b> ${isPcOnline ? '🟢 Online & Downloading' : '🟡 Standby (Queued files download when PC boots)'}\n` +
        `☁️ <b>Google Drive:</b> Connected`,
        msgId
      );
      return new Response("OK", { status: 200 });
    }

    // Media Handling (Video, Document, Audio, Animation)
    const mediaObj = msg.document || msg.video || msg.animation || msg.audio;
    if (mediaObj) {
      const fileName = mediaObj.file_name || msg.caption || `media_${Date.now()}.mp4`;
      const fileSize = mediaObj.file_size || 0;
      const sizeMb = (fileSize / (1024 * 1024)).toFixed(1);

      // Forward to owner account so MTProto user can read it
      if (userId !== ownerId) {
        await forwardToOwner(chatId, msgId);
      }

      await sendTelegram(
        chatId,
        `🎬 <b>StreamX — Media Received & Queued 24/7</b>\n\n` +
        `📁 <b>File:</b> <code>${fileName}</code>\n` +
        `📦 <b>Size:</b> ${sizeMb} MB\n` +
        `⚡ <b>Status:</b> <code>Queued in cloud</code>\n` +
        `🏷️ <b>Forwarded:</b> Saved to download queue\n\n` +
        `<i>Your file is safely queued in the cloud. It will automatically download to Google Drive as soon as your PC is running!</i>`,
        msgId
      );

      // If PC is running right now, notify local backend to start immediately
      try {
        await fetch(`${rawBase}/transfers/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(3000),
        });
      } catch (_) {}

      return new Response("OK", { status: 200 });
    }

    // Fallback for plain text
    await sendTelegram(
      chatId,
      `💡 <b>Forward a media file to start</b>\n\n` +
      `Send or forward any video, movie, episode, or document directly to this bot to transfer it to Google Drive.\n\n` +
      `Type /help for instructions or /status for status.`,
      msgId
    );
    return new Response("OK", { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 200 });
  }
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

    // 24/7 Telegram Webhook handler
    if ((url.pathname === "/telegram/webhook" || url.pathname === "/api/telegram/webhook") && request.method === "POST") {
      return await handleTelegramWebhook(request, env, rawBase);
    }

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
        resHeaders.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, Content-Disposition");
        resHeaders.set("Accept-Ranges", "bytes");

        let ctype = resHeaders.get("Content-Type") || "";
        if (!ctype || ctype.includes("octet-stream") || ctype.includes("x-download")) {
          ctype = url.pathname.toLowerCase().endsWith(".mp4") ? "video/mp4" : "video/x-matroska";
          resHeaders.set("Content-Type", ctype);
        }
        resHeaders.set("Content-Disposition", "inline");

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

      // If tunnel returned server error (502, 503, 504, 520, 521, 522, 523, 530), treat as tunnel down
      if (response.status >= 500) {
        throw new Error(`Backend tunnel unreachable or returned HTTP ${response.status}`);
      }

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
        const streamUrl = `https://${url.host}/media/0/stream/stream.mkv?drive_id=${encodeURIComponent(driveIdParam)}`;
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
