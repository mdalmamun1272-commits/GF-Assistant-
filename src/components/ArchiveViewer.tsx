import React, { useEffect, useState } from "react";
import { getCallSessions, getCallEvents, CallSession, CallEventData } from "../lib/dbService";
import { History, Calendar, Volume2, ChevronRight, ArrowLeft, Loader2, ListCollapse } from "lucide-react";

interface ArchiveViewerProps {
  onEventSelect?: (event: any) => void;
}

export const ArchiveViewer: React.FC<ArchiveViewerProps> = () => {
  const [sessions, setSessions] = useState<CallSession[]>([]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [selectedCallEvents, setSelectedCallEvents] = useState<CallEventData[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingEvents, setLoadingEvents] = useState<boolean>(false);

  // Load call sessions from database
  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await getCallSessions();
      setSessions(data);
    } catch (err) {
      console.error("Failed to load archive sessions", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  // Fetch events for selected session
  const handleSelectSession = async (callId: string) => {
    setSelectedCallId(callId);
    setLoadingEvents(true);
    try {
      const data = await getCallEvents(callId);
      setSelectedCallEvents(data);
    } catch (err) {
      console.error("Failed to load call events", err);
    } finally {
      setLoadingEvents(false);
    }
  };

  // Convert Firebase Timestamp or JS Date to human readable string
  const formatTime = (timeInput: any) => {
    if (!timeInput) return "N/A";
    let dateObj: Date;
    
    if (timeInput.seconds) {
      dateObj = new Date(timeInput.seconds * 1000);
    } else if (timeInput instanceof Date) {
      dateObj = timeInput;
    } else {
      dateObj = new Date(timeInput);
    }
    
    return dateObj.toLocaleString([], { 
      month: "short", 
      day: "numeric", 
      hour: "2-digit", 
      minute: "2-digit" 
    });
  };

  const getEventEmoji = (type: string) => {
    switch (type) {
      case "tool": return "🌐";
      case "speech": return "💖";
      case "error": return "🔥";
      case "status":
      default: return "🟢";
    }
  };

  return (
    <div id="archive-viewer-panel" className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-4 w-full h-44 overflow-hidden flex flex-col">
      
      {/* Title Bar */}
      <div className="flex items-center justify-between mb-2.5 border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-1.5">
          <History className="w-4 h-4 text-rose-500" />
          <h3 className="text-sm font-semibold text-slate-300">
            {selectedCallId ? "Session Logs" : "Saved Whisper Archives"}
          </h3>
        </div>
        
        {selectedCallId ? (
          <button
            id="btn-archive-back"
            onClick={() => setSelectedCallId(null)}
            className="flex items-center gap-1 text-[10px] text-rose-400 hover:text-rose-300 transition-colors cursor-pointer bg-rose-500/10 px-2 py-0.5 rounded-md"
          >
            <ArrowLeft className="w-3 h-3" /> Back
          </button>
        ) : (
          <button
            id="btn-archive-refresh"
            onClick={loadSessions}
            className="text-[10px] text-slate-400 hover:text-slate-300 transition-colors cursor-pointer"
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh 🔄"}
          </button>
        )}
      </div>

      {/* Content Container */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
        {selectedCallId ? (
          /* SESSION EVENTS VIEW */
          loadingEvents ? (
            <div className="h-full flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 text-rose-500 animate-spin" />
              <span className="text-xs text-slate-500 font-mono">Retrieving logs...</span>
            </div>
          ) : selectedCallEvents.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <span className="text-xs text-slate-500 italic">No events recorded in this session.</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {selectedCallEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="flex items-start gap-2.5 p-1.5 rounded-lg bg-slate-950/40 border border-slate-900 text-left"
                >
                  <span className="text-xs">{getEventEmoji(evt.type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center gap-2">
                      <p className="text-[10px] font-bold text-slate-200 truncate">{evt.title}</p>
                      <p className="text-[8px] font-mono text-slate-500">
                        {evt.timestamp ? new Date(evt.timestamp.seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "just now"}
                      </p>
                    </div>
                    <p className="text-[9px] text-slate-400 leading-snug">{evt.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          /* SESSIONS LIST VIEW */
          loading ? (
            <div className="h-full flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 text-rose-500 animate-spin" />
              <span className="text-xs text-slate-500 font-mono">Connecting to archive...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center px-4">
              <span className="text-xs text-slate-500 italic">No archived sessions found yet. Let's make a call first!</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {sessions.map((session) => (
                <button
                  id={`btn-session-row-${session.id}`}
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-950/40 border border-slate-850 hover:border-slate-700/80 hover:bg-slate-900/30 transition-all text-left group cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-1.5 rounded-lg bg-slate-900 flex-shrink-0">
                      <Calendar className="w-3.5 h-3.5 text-rose-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-slate-200 truncate">
                        {formatTime(session.startTime)}
                      </p>
                      <p className="text-[9px] text-slate-500 flex items-center gap-1">
                        <Volume2 className="w-2.5 h-2.5 text-slate-600" /> {session.voice || "Aoede"} voice • {session.eventsCount || 0} events
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-rose-400 transition-colors flex-shrink-0" />
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
};
