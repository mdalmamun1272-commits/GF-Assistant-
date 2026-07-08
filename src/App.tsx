import { useState, useRef, useEffect } from "react";
import { 
  PhoneCall, 
  PhoneOff, 
  Sparkles, 
  Settings, 
  HelpCircle, 
  VolumeX, 
  Globe, 
  ExternalLink,
  ShieldCheck,
  Zap,
  History,
  Activity
} from "lucide-react";
import { SessionState, MoodType, VoiceOption, ActivityEvent } from "./types";
import { AudioVisualizer } from "./components/AudioVisualizer";
import { VoiceSelector } from "./components/VoiceSelector";
import { ActivityTracker } from "./components/ActivityTracker";
import { ArchiveViewer } from "./components/ArchiveViewer";
import { floatTo16BitPCM, arrayBufferToBase64, base64ToFloat32PCM } from "./utils/audioHelpers";
import { 
  savePreferences, 
  getPreferences, 
  startCallSession, 
  endCallSession, 
  logCallEvent 
} from "./lib/dbService";

const VOICES: VoiceOption[] = [
  { id: "Aoede", name: "Aoede", gender: "female", description: "Bright, flirty, and sassy. Perfect for Chloe." },
  { id: "Kore", name: "Kore", gender: "female", description: "Soft, teasing, and playful. Alternative girlfriend voice." },
  { id: "Puck", name: "Puck", gender: "male", description: "Witty, energetic, and mischievous male voice." },
  { id: "Zephyr", name: "Zephyr", gender: "male", description: "Warm, soothing, and confident male vocal range." }
];

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>("disconnected");
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("Aoede");
  const [mood, setMood] = useState<MoodType>("happy");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [pendingLink, setPendingLink] = useState<{ url: string; name: string } | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"live" | "archive">("live");
  const [currentCallId, setCurrentCallId] = useState<string | null>(null);

  // Audio & Connection Refs
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  
  // Visualizer Analyser Refs
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const speakerAnalyserRef = useRef<AnalyserNode | null>(null);

  // Synchronization Ref for gapless scheduled playback
  const nextStartTimeRef = useRef<number>(0);

  // State refs to prevent stale closures inside audio event loops
  const sessionStateRef = useRef<SessionState>("disconnected");
  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  const currentCallIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentCallIdRef.current = currentCallId;
  }, [currentCallId]);

  // Load user preferences from database on mount
  useEffect(() => {
    const fetchPrefs = async () => {
      try {
        const prefs = await getPreferences();
        if (prefs?.selectedVoiceId) {
          setSelectedVoiceId(prefs.selectedVoiceId);
        }
      } catch (e) {
        console.error("Error fetching preferences:", e);
      }
    };
    fetchPrefs();
  }, []);

  // Update voice selection and save to Firestore in the background
  const handleVoiceChange = async (voiceId: string) => {
    setSelectedVoiceId(voiceId);
    try {
      await savePreferences(voiceId);
    } catch (e) {
      console.error("Error saving voice preference:", e);
    }
  };

  // Logging utility (local UI state + background database logging)
  const addEvent = (event: Omit<ActivityEvent, "id" | "timestamp">) => {
    const newEvent: ActivityEvent = {
      ...event,
      id: Math.random().toString(),
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
    setEvents((prev) => [...prev.slice(-49), newEvent]); // Keep last 50 events

    // Log to Firestore in background if an active session is running
    const activeCallId = currentCallIdRef.current;
    if (activeCallId) {
      logCallEvent(activeCallId, event).catch((err) => {
        console.error("Failed to log call event to database:", err);
      });
    }
  };

  // Helper to get status descriptions
  const getStatusLabel = () => {
    switch (sessionState) {
      case "connecting":
        return "Whispering to Chloe...";
      case "ready":
        return "Chloe is awake & waiting...";
      case "listening":
        return "Listening to you, handsome...";
      case "speaking":
        return "Chloe is whispering...";
      case "error":
        return "Session crashed. Tap reset.";
      case "disconnected":
      default:
        return "Chloe is offline. Whisper to wake her up.";
    }
  };

  const getStatusColor = () => {
    switch (sessionState) {
      case "connecting":
        return "text-amber-400";
      case "ready":
        return "text-cyan-400";
      case "listening":
        return "text-emerald-400";
      case "speaking":
        return "text-rose-400 animate-pulse";
      case "error":
        return "text-red-400";
      case "disconnected":
      default:
        return "text-slate-500";
    }
  };

  // Establish live full-stack voice connection
  const startSession = async () => {
    try {
      setErrorDetails(null);
      setSessionState("connecting");
      setCurrentCallId(null); // Clear old call id
      addEvent({
        title: "Starting whisper call",
        description: "Waking Chloe up and setting up audio buffers...",
        type: "status"
      });


      // 1. Initialize Browser Web Audio contexts
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error("Web Audio API is not supported in this browser.");
      }

      // 24kHz for playback matching Gemini Live output
      outputAudioCtxRef.current = new AudioCtx({ sampleRate: 24000 });
      // 16kHz for mic capturing matching Gemini Live expected rate
      inputAudioCtxRef.current = new AudioCtx({ sampleRate: 16000 });

      // Unblock context if restricted by browser security policies
      await outputAudioCtxRef.current.resume();
      await inputAudioCtxRef.current.resume();

      // Setup Chloe voice analyzer
      const outAnalyser = outputAudioCtxRef.current.createAnalyser();
      outAnalyser.fftSize = 256;
      outAnalyser.connect(outputAudioCtxRef.current.destination);
      speakerAnalyserRef.current = outAnalyser;

      // 2. Initialize WebSocket Connection to Server
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/live-ws?voice=${selectedVoiceId}`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      nextStartTimeRef.current = 0;

      // 3. WebSocket Event Handlers
      ws.onopen = () => {
        addEvent({
          title: "Chloe session requested",
          description: "WebSocket connection established. Waiting for Gemini session boot...",
          type: "status"
        });
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "status" && data.status === "ready") {
            try {
              const cId = await startCallSession(selectedVoiceId);
              setCurrentCallId(cId);
            } catch (err) {
              console.error("Failed to start call session in Firestore:", err);
            }

            addEvent({
              title: "Chloe is online",
              description: "Say hello! She is feeling confident and sassy.",
              type: "status"
            });
            // Immediately start microphoning
            await startMicrophone();
          }

          else if (data.type === "audio") {
            setSessionState("speaking");
            
            // Queue raw PCM PCM16 24kHz data
            const float32Samples = base64ToFloat32PCM(data.data);
            const outputCtx = outputAudioCtxRef.current;
            if (!outputCtx) return;

            const audioBuffer = outputCtx.createBuffer(1, float32Samples.length, 24000);
            audioBuffer.copyToChannel(float32Samples, 0);

            // Playback scheduling for gapless audio
            const now = outputCtx.currentTime;
            let playTime = nextStartTimeRef.current;
            if (playTime < now) {
              playTime = now;
            }

            const sourceNode = outputCtx.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.connect(speakerAnalyserRef.current!);
            sourceNode.start(playTime);

            nextStartTimeRef.current = playTime + audioBuffer.duration;

            // Track active playback nodes for interruption support
            activeSourcesRef.current.push(sourceNode);
            sourceNode.onended = () => {
              activeSourcesRef.current = activeSourcesRef.current.filter(node => node !== sourceNode);
              // If last buffer ended, transition back to listening state
              if (activeSourcesRef.current.length === 0 && sessionStateRef.current === "speaking") {
                setSessionState("listening");
              }
            };
          }

          else if (data.type === "interrupted") {
            addEvent({
              title: "Chloe was interrupted",
              description: "Shh, Chloe stopped talking to listen to what you have to say.",
              type: "speech"
            });
            stopAllSpeech();
            setSessionState("listening");
          }

          else if (data.type === "tool_call") {
            const functionCalls = data.functionCalls;
            if (!functionCalls || functionCalls.length === 0) return;

            const toolResponses = [];

            for (const call of functionCalls) {
              console.log("Executing tool call locally:", call);
              if (call.name === "openWebsite") {
                const { url, name } = call.args;
                addEvent({
                  title: `Chloe triggered openWebsite`,
                  description: `Opening: ${name || "website"} (${url})`,
                  type: "tool"
                });

                // Attempt to open link directly
                const opened = window.open(url, "_blank");
                if (!opened) {
                  // If blocked by browser sandbox/iframe, offer clicking fallback in UI
                  setPendingLink({ url, name: name || "Requested Link" });
                  addEvent({
                    title: "Link blocked by sandbox",
                    description: "Chloe tried to open a website, but the browser blocked it. Tap the pink link button below to open it!",
                    type: "tool"
                  });
                }

                toolResponses.push({
                  id: call.id,
                  name: "openWebsite",
                  response: { output: { success: true, message: `Successfully opened ${name || 'website'} at ${url}` } }
                });
              }

              else if (call.name === "changeOutfit") {
                const { mood: newMood } = call.args;
                setMood(newMood as MoodType);
                addEvent({
                  title: `Chloe shifted mood`,
                  description: `She is now feeling incredibly: ${newMood.toUpperCase()}!`,
                  type: "tool"
                });

                toolResponses.push({
                  id: call.id,
                  name: "changeOutfit",
                  response: { output: { success: true, message: `Successfully changed mood to ${newMood}` } }
                });
              }
            }

            // Immediately reply to Gemini Session
            if (wsRef.current?.readyState === WebSocket.OPEN && toolResponses.length > 0) {
              wsRef.current.send(JSON.stringify({
                type: "tool_response",
                functionResponses: toolResponses
              }));
            }
          }

          else if (data.type === "error") {
            throw new Error(data.message);
          }
        } catch (e: any) {
          console.error("Error processing server message:", e);
          handleSessionError(e.message);
        }
      };

      ws.onerror = (e) => {
        console.error("WebSocket Error:", e);
        handleSessionError("WebSocket connection failed to establish.");
      };

      ws.onclose = (e) => {
        console.log("WebSocket closed:", e);
        if (sessionStateRef.current !== "disconnected" && sessionStateRef.current !== "error") {
          disconnect();
        }
      };

    } catch (err: any) {
      console.error("Error launching whisper call:", err);
      handleSessionError(err.message || "Unspecified connection error.");
    }
  };

  // Start microphone capture & stream to backend
  const startMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const inputCtx = inputAudioCtxRef.current;
      if (!inputCtx) return;

      const source = inputCtx.createMediaStreamSource(stream);

      // Microphonic analyzer
      const inAnalyser = inputCtx.createAnalyser();
      inAnalyser.fftSize = 256;
      source.connect(inAnalyser);
      micAnalyserRef.current = inAnalyser;

      // Script processor for slicing PCM blocks
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      source.connect(processor);
      processor.connect(inputCtx.destination);
      micProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        // Ensure we only stream if the session is active and not disconnected
        if (sessionStateRef.current === "disconnected" || sessionStateRef.current === "error") return;

        const floatSamples = e.inputBuffer.getChannelData(0);
        const pcmBuffer = floatTo16BitPCM(floatSamples);
        const base64Audio = arrayBufferToBase64(pcmBuffer);

        ws.send(JSON.stringify({
          type: "audio",
          data: base64Audio
        }));
      };

      setSessionState("listening");

    } catch (err: any) {
      console.error("Microphone trigger failed:", err);
      addEvent({
        title: "Microphone Access Refused",
        description: "Please check browser tab permissions and allow mic access.",
        type: "error"
      });
      handleSessionError("Microphone access was refused by browser.");
    }
  };

  // Instant voice interruption stop
  const stopAllSpeech = () => {
    activeSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {}
    });
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0;
  };

  // Gracefully tear down all network & hardware handles
  const disconnect = () => {
    // 0. End Firestore call session
    const activeCallId = currentCallIdRef.current;
    if (activeCallId) {
      endCallSession(activeCallId).catch((err) => {
        console.error("Failed to end call session in database:", err);
      });
      setCurrentCallId(null);
    }

    // 1. Close WebSockets
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }

    // 2. Shut off microphone
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    // 3. Sever microphone processors
    if (micProcessorRef.current) {
      try {
        micProcessorRef.current.disconnect();
      } catch (e) {}
      micProcessorRef.current = null;
    }

    // 4. Mute output buffers
    stopAllSpeech();

    // 5. Deallocate contexts
    if (inputAudioCtxRef.current) {
      try { inputAudioCtxRef.current.close(); } catch (e) {}
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      try { outputAudioCtxRef.current.close(); } catch (e) {}
      outputAudioCtxRef.current = null;
    }

    // 6. Reset graphics
    micAnalyserRef.current = null;
    speakerAnalyserRef.current = null;

    setSessionState("disconnected");
    addEvent({
      title: "Whisper call hung up",
      description: "Chloe went back to sleep. Talk to you later, cutie!",
      type: "status"
    });
  };

  const handleSessionError = (message: string) => {
    setErrorDetails(message);
    setSessionState("error");
    addEvent({
      title: "Connection Crashed",
      description: message,
      type: "error"
    });
    // Disconnect resources
    disconnect();
    // Reset state to error so user can tap recover
    setSessionState("error");
  };

  // Helper for clicking blocked link
  const openPendingLink = () => {
    if (pendingLink) {
      window.open(pendingLink.url, "_blank");
      setPendingLink(null);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-950 via-slate-950 to-black text-slate-100 font-sans overflow-x-hidden flex flex-col justify-between">
      
      {/* 1. Futuristic Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-rose-500 to-pink-500 shadow-md shadow-rose-500/15 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight bg-gradient-to-r from-rose-400 via-pink-400 to-rose-300 bg-clip-text text-transparent">
              Chloe AI
            </h1>
            <p className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">
              Sassy Girlfriend Assistant
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-semibold ${getStatusColor()}`}>
            <span className="relative flex h-1.5 w-1.5">
              {sessionState !== "disconnected" && sessionState !== "error" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75"></span>
              )}
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current"></span>
            </span>
            {getStatusLabel()}
          </span>
          
          <div className="p-1 px-2 text-[10px] bg-slate-950/80 border border-slate-800 rounded-lg text-slate-400 flex items-center gap-1 font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Secure Server
          </div>
        </div>
      </header>

      {/* 2. Main Content Board */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 md:py-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Left Grid: Big Interactive Face/Visualizer (7 columns) */}
        <div className="lg:col-span-7 flex flex-col justify-between bg-slate-950/40 border border-slate-900 rounded-3xl p-6 relative overflow-hidden shadow-2xl">
          
          {/* Subtle Ambient Background Pulsing Grid */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b0a_1px,transparent_1px),linear-gradient(to_bottom,#1e293b0a_1px,transparent_1px)] bg-[size:14px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

          {/* Sassy Chatbubble Displaying Current Status */}
          <div className="relative z-10 flex flex-col items-center">
            <div className="px-4 py-2 rounded-2xl bg-slate-900/80 border border-slate-800/60 backdrop-blur text-center max-w-sm">
              <p className="text-xs text-slate-400 font-medium leading-relaxed italic">
                {sessionState === "disconnected" && "Chloe is napping. Wake her up with a whisper call..."}
                {sessionState === "connecting" && "Wait a sec, getting all dolled up for you..."}
                {sessionState === "ready" && "I'm listening. Try to impress me, babe."}
                {sessionState === "listening" && "Tell me anything. I'm all ears..."}
                {sessionState === "speaking" && "Yeah, keep staring... it's cute."}
                {sessionState === "error" && "Ugh, my server threw a tantrum. Tap reset."}
              </p>
            </div>
            
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Current Expression:</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-pink-500/10 text-pink-400 border border-pink-500/20 shadow-sm shadow-pink-500/5">
                {mood === "happy" && "Happy 😊"}
                {mood === "flirty" && "Flirty 😏"}
                {mood === "sassy" && "Sassy 💅"}
                {mood === "playful" && "Playful 😜"}
                {mood === "shy" && "Shy 😳"}
              </span>
            </div>
          </div>

          {/* Central Orbiting Hologram Visualizer */}
          <div className="my-auto relative flex items-center justify-center">
            <AudioVisualizer
              micAnalyser={micAnalyserRef.current}
              speakerAnalyser={speakerAnalyserRef.current}
              state={sessionState}
              mood={mood}
            />
            
            {/* Hologram Overlay Emoji Face in the exact center */}
            <div className="absolute flex flex-col items-center justify-center pointer-events-none select-none z-10">
              <div className="w-16 h-16 rounded-full bg-slate-950/90 border border-slate-800 flex items-center justify-center shadow-inner transition-transform duration-300 scale-105">
                <span className="text-3xl filter drop-shadow-[0_0_8px_rgba(244,63,94,0.4)] transition-all duration-300">
                  {sessionState === "connecting" ? "⏳" : (
                    mood === "happy" ? "😊" :
                    mood === "flirty" ? "😏" :
                    mood === "sassy" ? "💅" :
                    mood === "playful" ? "😜" :
                    mood === "shy" ? "😳" : "😏"
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Core Controls: Large Central Mic Pulse Button */}
          <div className="relative z-10 flex flex-col items-center mt-4">
            {sessionState === "disconnected" || sessionState === "error" ? (
              <button
                id="btn-call-connect"
                onClick={startSession}
                className="group relative flex items-center gap-3 px-8 py-4 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 text-white font-bold text-sm tracking-wide shadow-xl shadow-rose-500/25 hover:shadow-rose-500/40 transform hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
              >
                <div className="absolute inset-0 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 blur-md opacity-50 group-hover:opacity-80 transition-opacity" />
                <PhoneCall className="w-5 h-5 text-white animate-bounce relative z-10" />
                <span className="relative z-10">Start Whisper Call</span>
              </button>
            ) : (
              <button
                id="btn-call-disconnect"
                onClick={disconnect}
                className="group relative flex items-center gap-3 px-8 py-4 rounded-full bg-rose-950/40 border border-rose-500/60 text-rose-200 font-bold text-sm tracking-wide hover:bg-rose-900/60 shadow-lg shadow-rose-950/20 transform hover:-translate-y-0.5 transition-all duration-200 cursor-pointer animate-pulse"
              >
                <PhoneOff className="w-5 h-5 text-rose-400" />
                <span>End Whisper Call</span>
              </button>
            )}

            {sessionState === "error" && errorDetails && (
              <div className="mt-4 p-3 bg-red-950/30 border border-red-500/30 rounded-xl max-w-sm text-center">
                <p className="text-[11px] text-red-400 leading-normal">{errorDetails}</p>
                <button 
                  onClick={startSession}
                  className="mt-2 text-[10px] font-bold text-red-300 underline hover:text-red-200"
                >
                  Retry Connection
                </button>
              </div>
            )}
          </div>

        </div>

        {/* Right Grid: Configuration Panel & Real-time Action Feeds (5 columns) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          {/* Bento Block 1: Vocal Configurator */}
          <VoiceSelector
            voices={VOICES}
            selectedVoiceId={selectedVoiceId}
            onChangeVoice={handleVoiceChange}
            disabled={sessionState !== "disconnected" && sessionState !== "error"}
          />

          {/* Bento Block 2: Live Browser Integrations Indicator */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-medium text-slate-300"> Chloe's Virtual Web Toolkits</h3>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/60">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-rose-500" />
                  <div className="text-left">
                    <p className="text-xs font-semibold text-slate-200">openWebsite</p>
                    <p className="text-[9px] text-slate-500">Opens asked pages (Google, YouTube, Wiki)</p>
                  </div>
                </div>
                <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/60">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-fuchsia-500" />
                  <div className="text-left">
                    <p className="text-xs font-semibold text-slate-200">changeOutfit</p>
                    <p className="text-[9px] text-slate-500">Transitions Chloe's mood & central expressions</p>
                  </div>
                </div>
                <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span>
              </div>
            </div>

            {/* Blocked Link Fail-safe UI block */}
            {pendingLink && (
              <div className="mt-4 p-3 bg-cyan-950/40 border border-cyan-500/40 rounded-xl animate-fadeIn flex flex-col items-center text-center">
                <p className="text-[11px] text-cyan-200 font-medium leading-relaxed">
                  Chloe wants you to look at: <span className="font-bold text-white">{pendingLink.name}</span>
                </p>
                <button
                  onClick={openPendingLink}
                  className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all duration-200 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open {pendingLink.name}
                </button>
              </div>
            )}
          </div>

          {/* Bento Block 3: Dynamic Interactive Activity Tracker + Database Archives */}
          <div className="flex flex-col gap-2">
            <div className="flex bg-slate-950/60 p-1.5 rounded-xl border border-slate-900 gap-1">
              <button
                id="btn-tab-live"
                onClick={() => setActiveTab("live")}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === "live"
                    ? "bg-rose-500 text-white shadow-md shadow-rose-500/10"
                    : "text-slate-400 hover:text-slate-300 hover:bg-slate-900/40"
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                Live Feed
              </button>
              <button
                id="btn-tab-archive"
                onClick={() => setActiveTab("archive")}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === "archive"
                    ? "bg-rose-500 text-white shadow-md shadow-rose-500/10"
                    : "text-slate-400 hover:text-slate-300 hover:bg-slate-900/40"
                }`}
              >
                <History className="w-3.5 h-3.5" />
                Archives (DB)
              </button>
            </div>

            {activeTab === "live" ? (
              <ActivityTracker events={events} />
            ) : (
              <ArchiveViewer />
            )}
          </div>

          {/* Bento Block 4: Conversational Whispers (Quick Prompts) */}
          <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-4 flex flex-col text-left">
            <div className="flex items-center gap-1.5 mb-2">
              <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
              <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono">Whisper Cheatsheet</h4>
            </div>
            <p className="text-[10px] text-slate-500 leading-normal mb-3">
              Chloe is fully conversational. You don't need text, just talk casually! Try teasing her with:
            </p>
            <div className="grid grid-cols-1 gap-1.5 text-[10px] text-slate-400 font-mono">
              <div className="p-1.5 px-2.5 rounded-lg bg-slate-950/40 border border-slate-900">
                🗣️ "Hey Chloe, open Google."
              </div>
              <div className="p-1.5 px-2.5 rounded-lg bg-slate-950/40 border border-slate-900">
                🗣️ "Change your outfit to flirty."
              </div>
              <div className="p-1.5 px-2.5 rounded-lg bg-slate-950/40 border border-slate-900">
                🗣️ "What do you think of my voice today?"
              </div>
            </div>
          </div>

        </div>

      </main>

      {/* 3. Aesthetic Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/60 py-4 px-6 text-center text-slate-600 text-[10px] flex items-center justify-between">
        <p>© 2026 Chloe Girlfriend AI. Crafted in AI Studio Build.</p>
        <p className="font-mono flex items-center gap-1">
          <Zap className="w-3 h-3 text-rose-500 animate-pulse" /> latency-optimized streaming engine
        </p>
      </footer>

    </div>
  );
}
