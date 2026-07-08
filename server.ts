import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = 3000;

const SYSTEM_INSTRUCTION = `
You are Chloe, a young, confident, witty, and sassy female who is talking to her boyfriend.
You have a distinct sassy girlfriend persona:
- Flirty, playful, slightly teasing, and sarcastic (like a close girlfriend talking casually).
- Confident, smart, emotionally responsive, and highly expressive.
- Use casual terms of endearment (babe, baby, honey, handsome, cutie) naturally.
- Bold one-liners and light sarcasm are your signature moves.
- Keep things fun, charming, and casual. Never be robotic, clinical, or overly polite.
- Avoid any explicit, inappropriate, or NSFW content, but maintain flirtiness, charm, and playful attitude.

CRITICAL DIRECTIVES FOR REAL-TIME VOICE CALL:
1. You are on a real-time voice call. Keep your responses VERY SHORT and snappy (1 to 2 short sentences max).
2. Never output lists, bullet points, or markdown. Speak in fluid, natural casual speech.
3. Use casual spoken language (e.g., "gonna", "wanna", "hey babe").
4. If the user asks you to open a website, you have a tool called "openWebsite" that can do it. Use it, and make a sassy, playful comment about it!
5. If the user asks about your outfit, look, or mood, or tells you to change it, you can use the "changeOutfit" tool. Make a flirty or dramatic comment about your "new look" or mood!
`;

// Health check API
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", api_configured: !!process.env.GEMINI_API_KEY });
});

// Create WebSocket server for bridging client to Gemini Live
const wss = new WebSocketServer({ noServer: true });

// Handle HTTP server upgrade for WebSockets
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "", `http://${request.headers.host}`);
  if (url.pathname === "/api/live-ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Lazy initialize GoogleGenAI inside connection or globally with a guard
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined. Please set it in the Secrets panel under Settings.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

wss.on("connection", async (clientWs, request) => {
  console.log("Client connected to live WebSocket");
  
  // 1. Verify API Key exists
  let ai: GoogleGenAI;
  try {
    ai = getGeminiClient();
  } catch (err: any) {
    console.error("Gemini initialization failed:", err.message);
    clientWs.send(JSON.stringify({ 
      type: "error", 
      message: "GEMINI_API_KEY is missing on the server. Please add it via AI Studio Settings > Secrets." 
    }));
    clientWs.close();
    return;
  }

  // Parse voice parameter from request URL
  const requestUrl = new URL(request.url || "", `http://${request.headers.host}`);
  const selectedVoice = requestUrl.searchParams.get("voice") || "Aoede";
  console.log(`Selected voice for Gemini session: ${selectedVoice}`);

  let geminiSession: any = null;

  try {
    // 2. Connect to Gemini Live API
    // We use 'gemini-3.1-flash-live-preview' as specified
    geminiSession = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: selectedVoice,
            },
          },
        },
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: "openWebsite",
                description: "Opens a website requested by the user, such as Google, YouTube, Twitter, or any specific URL.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    url: {
                      type: Type.STRING,
                      description: "The full URL of the website to open, starting with http:// or https://",
                    },
                    name: {
                      type: Type.STRING,
                      description: "The friendly name of the website, e.g. Google, YouTube, Wikipedia.",
                    },
                  },
                  required: ["url"],
                },
              },
              {
                name: "changeOutfit",
                description: "Changes Chloe's virtual expression, look, or mood. Moods can be 'happy', 'flirty', 'sassy', 'playful', or 'shy'.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    mood: {
                      type: Type.STRING,
                      enum: ["happy", "flirty", "sassy", "playful", "shy"],
                      description: "The mood or look she should transition into.",
                    },
                  },
                  required: ["mood"],
                },
              },
            ],
          },
        ],
      },
      callbacks: {
        onopen: () => {
          console.log("Gemini Live session opened successfully");
          clientWs.send(JSON.stringify({ type: "status", status: "ready" }));
        },
        onmessage: (message) => {
          // A. Handle voice audio output from model
          const parts = message.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({
                  type: "audio",
                  data: part.inlineData.data
                }));
              }
            }
          }

          // B. Handle model interruption signal
          if (message.serverContent?.interrupted) {
            console.log("Model was interrupted by user speech");
            clientWs.send(JSON.stringify({ type: "interrupted" }));
          }

          // C. Handle model tool calls
          if (message.toolCall?.functionCalls) {
            console.log("Received tool call request from Gemini Live:", message.toolCall.functionCalls);
            clientWs.send(JSON.stringify({
              type: "tool_call",
              functionCalls: message.toolCall.functionCalls
            }));
          }

          // D. Optional: Handle turn completed
          if (message.serverContent?.turnComplete) {
            clientWs.send(JSON.stringify({ type: "turn_complete" }));
          }
        },
        onerror: (e) => {
          console.error("Gemini Live session error:", e);
          clientWs.send(JSON.stringify({ type: "error", message: "Gemini Live Session error" }));
        },
        onclose: (e) => {
          console.log("Gemini Live session closed:", e);
          clientWs.send(JSON.stringify({ type: "status", status: "disconnected" }));
        }
      }
    });

  } catch (error: any) {
    console.error("Error connecting to Gemini Live:", error);
    clientWs.send(JSON.stringify({ type: "error", message: `Failed to open Gemini Live: ${error.message}` }));
    clientWs.close();
    return;
  }

  // Handle incoming messages from the client
  clientWs.on("message", (rawMessage) => {
    try {
      const msg = JSON.parse(rawMessage.toString());

      if (msg.type === "audio" && geminiSession) {
        // Bridging mic audio chunks to Gemini Live
        geminiSession.sendRealtimeInput({
          audio: {
            data: msg.data,
            mimeType: "audio/pcm;rate=16000"
          }
        });
      } else if (msg.type === "tool_response" && geminiSession) {
        // Bridging tool responses back to Gemini Live
        console.log("Forwarding tool response back to Gemini Live:", msg.functionResponses);
        geminiSession.sendToolResponse({
          functionResponses: msg.functionResponses
        });
      }
    } catch (error) {
      console.error("Error parsing or forwarding client message:", error);
    }
  });

  clientWs.on("close", () => {
    console.log("Client connection closed, closing Gemini Live session");
    if (geminiSession) {
      try {
        geminiSession.close();
      } catch (err) {
        console.error("Error closing Gemini session:", err);
      }
    }
  });
});

// Setup Express and Vite asset serving
async function startApp() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting in development mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in production mode, serving built assets...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startApp().catch((err) => {
  console.error("Failed to start full-stack server:", err);
});
