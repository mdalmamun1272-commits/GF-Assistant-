import React from "react";
import { ActivityEvent } from "../types";
import { Sparkles, Globe, Heart, CheckCircle, Flame } from "lucide-react";

interface ActivityTrackerProps {
  events: ActivityEvent[];
}

export const ActivityTracker: React.FC<ActivityTrackerProps> = ({ events }) => {
  const getEventIcon = (type: ActivityEvent["type"]) => {
    switch (type) {
      case "tool":
        return <Globe className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />;
      case "speech":
        return <Heart className="w-3.5 h-3.5 text-rose-400 animate-bounce" />;
      case "error":
        return <Flame className="w-3.5 h-3.5 text-red-400" />;
      case "status":
      default:
        return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
    }
  };

  const getEventBg = (type: ActivityEvent["type"]) => {
    switch (type) {
      case "tool":
        return "border-cyan-500/20 bg-cyan-500/5";
      case "speech":
        return "border-rose-500/20 bg-rose-500/5";
      case "error":
        return "border-red-500/20 bg-red-500/5";
      case "status":
      default:
        return "border-emerald-500/20 bg-emerald-500/5";
    }
  };

  return (
    <div id="activity-tracker-panel" className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-4 w-full h-44 overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 mb-3 border-b border-slate-800/80 pb-2">
        <Sparkles className="w-4 h-4 text-rose-500" />
        <h3 className="text-sm font-semibold text-slate-300">Live Interactive Feed</h3>
      </div>

      <div id="activity-events-list" className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
        {events.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-xs text-slate-500 italic">No activity yet. Tap connect to start whispering...</span>
          </div>
        ) : (
          [...events].reverse().map((event) => (
            <div
              key={event.id}
              className={`flex items-start gap-3 p-2 rounded-xl border text-left transition-all duration-300 animate-fadeIn ${getEventBg(
                event.type
              )}`}
            >
              <div className="mt-0.5 p-1 rounded-lg bg-slate-950/60 flex-shrink-0">
                {getEventIcon(event.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-200 truncate">{event.title}</span>
                  <span className="text-[9px] font-mono text-slate-500">{event.timestamp}</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-normal mt-0.5 whitespace-pre-line">
                  {event.description}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
export default ActivityTracker;
