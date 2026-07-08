export type SessionState = "disconnected" | "connecting" | "ready" | "listening" | "speaking" | "error";

export type MoodType = "happy" | "flirty" | "sassy" | "playful" | "shy";

export interface VoiceOption {
  id: string;
  name: string;
  gender: "female" | "male";
  description: string;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  title: string;
  description: string;
  type: "status" | "tool" | "speech" | "error";
}
