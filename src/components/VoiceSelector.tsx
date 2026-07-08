import React from "react";
import { VoiceOption } from "../types";
import { Volume2, User } from "lucide-react";

interface VoiceSelectorProps {
  voices: VoiceOption[];
  selectedVoiceId: string;
  onChangeVoice: (id: string) => void;
  disabled: boolean;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  voices,
  selectedVoiceId,
  onChangeVoice,
  disabled,
}) => {
  return (
    <div id="voice-selector-panel" className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 w-full">
      <div className="flex items-center gap-2 mb-3">
        <Volume2 className="w-4 h-4 text-rose-500" />
        <h3 className="text-sm font-medium text-slate-300">Choose Chloe's Vocal Range</h3>
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        {voices.map((voice) => {
          const isSelected = voice.id === selectedVoiceId;
          return (
            <button
              id={`btn-voice-${voice.id}`}
              key={voice.id}
              onClick={() => onChangeVoice(voice.id)}
              disabled={disabled}
              className={`flex flex-col items-start text-left p-3 rounded-xl border transition-all duration-200 ${
                isSelected
                  ? "bg-rose-500/10 border-rose-500 text-rose-100 shadow-lg shadow-rose-500/5"
                  : "bg-slate-950/40 border-slate-800/80 text-slate-400 hover:border-slate-700 hover:bg-slate-900/40"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <span className="font-semibold text-xs text-slate-200">{voice.name}</span>
                <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md ${
                  voice.gender === "female" ? "bg-rose-500/20 text-rose-300" : "bg-blue-500/20 text-blue-300"
                }`}>
                  {voice.gender}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 leading-tight line-clamp-1">
                {voice.description}
              </p>
            </button>
          );
        })}
      </div>
      {disabled && (
        <p className="text-[10px] text-slate-500 text-center mt-2.5">
          Disconnect current call to change vocal ranges.
        </p>
      )}
    </div>
  );
};
