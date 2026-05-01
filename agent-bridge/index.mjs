import http from "node:http";
import { query } from "@anthropic-ai/claude-agent-sdk";

/**
 * Convert Anthropic Messages API messages to a prompt string.
 * System messages are extracted separately.
 */
function messagesToPrompt(messages) {
  let systemPrompt = "";
  const turns = [];

  for (const msg of messages) {
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n");
    }

    switch (msg.role) {
      case "system":
        systemPrompt += (systemPrompt ? "\n\n" : "") + text;
        break;
      case "user":
        turns.push("Human: " + text);
        break;
      case "assistant":
        turns.push("Assistant: " + text);
        break;
    }
  }

  // Single user message: pass directly without conversation framing
  let prompt;
  if (turns.length === 1 && turns[0].startsWith("Human: ")) {
    prompt = turns[0].slice(7);
  } else {
    prompt = turns.join("\n\n");
  }

  return { systemPrompt, prompt };
}

/**
 * Extract system prompt from the request's top-level system field.
 */
function extractSystemPrompt(system) {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .filter((b) => b.text)
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

/**
 * Handle POST /v1/messages
 */
async function handleMessages(req, res) {
  let body = "";
  for await (const chunk of req) body += chunk;

  let request;
  try {
    request = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "Invalid JSON" } }));
    return;
  }

  const { systemPrompt: msgSystemPrompt, prompt } = messagesToPrompt(request.messages || []);
  const topLevelSystem = extractSystemPrompt(request.system);
  const systemPrompt = [topLevelSystem, msgSystemPrompt].filter(Boolean).join("\n\n");

  const options = {
    maxTurns: 1,
    permissionMode: "bypassPermissions",
    includePartialMessages: true,
  };

  if (request.model) {
    options.model = request.model;
  }

  if (systemPrompt) {
    // The Agent SDK accepts system prompt via the prompt itself
    // Prepend it as context
  }

  const fullPrompt = systemPrompt
    ? `System instructions: ${systemPrompt}\n\n${prompt}`
    : prompt;

  if (request.stream) {
    await handleStreaming(res, fullPrompt, options);
  } else {
    await handleNonStreaming(res, fullPrompt, options);
  }
}

/**
 * Stream response as Anthropic SSE events.
 */
async function handleStreaming(res, prompt, options) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  try {
    const conversation = query({ prompt, options });

    for await (const message of conversation) {
      if (message.type === "stream_event" && message.event) {
        // message.event IS a raw Anthropic SSE event -- forward directly
        const eventType = message.event.type;
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(message.event)}\n\n`);
      }
    }
  } catch (err) {
    console.error("[agent-bridge] Streaming error:", err.message);
    // Try to send error as SSE if headers not yet flushed
    const errorEvent = {
      type: "error",
      error: { type: "server_error", message: err.message },
    };
    res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
  }

  // Ensure message_stop is sent
  res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
  res.end();
}

/**
 * Collect full response and return as Anthropic Messages API JSON.
 */
async function handleNonStreaming(res, prompt, options) {
  try {
    const conversation = query({ prompt, options });

    let assistantMessage = null;
    let resultText = "";

    for await (const message of conversation) {
      if (message.type === "assistant" && message.message) {
        assistantMessage = message.message;
      } else if (message.type === "result") {
        resultText = message.result || "";
      }
    }

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });

    if (assistantMessage) {
      res.end(JSON.stringify(assistantMessage));
    } else {
      // Fallback: construct minimal response
      res.end(
        JSON.stringify({
          id: "msg_bridge",
          type: "message",
          role: "assistant",
          model: options.model || "unknown",
          content: [{ type: "text", text: resultText }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
        })
      );
    }
  } catch (err) {
    console.error("[agent-bridge] Non-streaming error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { type: "server_error", message: err.message },
      })
    );
  }
}

/**
 * Handle GET /v1/models -- return available models.
 */
async function handleModels(req, res) {
  try {
    // Try to get models from the SDK
    const conversation = query({ prompt: "", options: { maxTurns: 0 } });
    const models = await conversation.supportedModels();
    conversation.close();

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        data: models.map((m) => ({
          id: m.id || m.name || m,
          object: "model",
        })),
      })
    );
  } catch {
    // Fallback to well-known models
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        data: [
          { id: "claude-sonnet-4-20250514", object: "model" },
          { id: "claude-opus-4-20250514", object: "model" },
          { id: "claude-haiku-4-20250506", object: "model" },
        ],
      })
    );
  }
}

// HTTP server
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key, Anthropic-Version",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/messages") {
    await handleMessages(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    await handleModels(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end('{"error":"not found"}');
});

const port = parseInt(process.env.PORT || "0", 10);

server.listen(port, "127.0.0.1", () => {
  const actualPort = server.address().port;
  // Signal readiness to the Go process manager
  process.stdout.write(`READY:${actualPort}\n`);
  console.error(`[agent-bridge] Listening on 127.0.0.1:${actualPort}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.error("[agent-bridge] Received SIGTERM, shutting down...");
  server.close(() => process.exit(0));
  // Force exit after 5 seconds
  setTimeout(() => process.exit(1), 5000);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
});
