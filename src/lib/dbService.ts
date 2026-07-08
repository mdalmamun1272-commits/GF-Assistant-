import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  addDoc, 
  updateDoc, 
  query, 
  where, 
  orderBy, 
  getDocs, 
  serverTimestamp,
  Timestamp,
  increment
} from "firebase/firestore";
import { db } from "./firebase";
import { MoodType, ActivityEvent } from "../types";

// Generate or retrieve a unique device identifier
export function getDeviceId(): string {
  let deviceId = localStorage.getItem("chloe_device_id");
  if (!deviceId) {
    deviceId = "device_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem("chloe_device_id", deviceId);
  }
  return deviceId;
}

export interface UserPreferences {
  selectedVoiceId: string;
  updatedAt?: any;
}

// Save user preferences to Firestore
export async function savePreferences(voiceId: string): Promise<void> {
  const deviceId = getDeviceId();
  try {
    const prefRef = doc(db, "preferences", deviceId);
    await setDoc(prefRef, {
      selectedVoiceId: voiceId,
      updatedAt: serverTimestamp()
    }, { merge: true });
    console.log("Saved preferences to Firestore for device:", deviceId);
  } catch (error) {
    console.error("Error saving preferences to Firestore:", error);
  }
}

// Get user preferences from Firestore
export async function getPreferences(): Promise<UserPreferences | null> {
  const deviceId = getDeviceId();
  try {
    const prefRef = doc(db, "preferences", deviceId);
    const snap = await getDoc(prefRef);
    if (snap.exists()) {
      return snap.data() as UserPreferences;
    }
  } catch (error) {
    console.error("Error fetching preferences from Firestore:", error);
  }
  return null;
}

export interface CallSession {
  id: string;
  deviceId: string;
  voice: string;
  startTime: Timestamp | Date | any;
  endTime?: Timestamp | Date | any | null;
  eventsCount: number;
}

// Start a new call session document
export async function startCallSession(voice: string): Promise<string> {
  const deviceId = getDeviceId();
  const callId = "call_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();
  
  try {
    const callRef = doc(db, "calls", callId);
    await setDoc(callRef, {
      id: callId,
      deviceId,
      voice,
      startTime: serverTimestamp(),
      endTime: null,
      eventsCount: 0
    });
    console.log("Started call session in Firestore:", callId);
    return callId;
  } catch (error) {
    console.error("Error starting call session:", error);
    return callId; // Return standard generated ID as fallback
  }
}

// End a call session document
export async function endCallSession(callId: string): Promise<void> {
  try {
    const callRef = doc(db, "calls", callId);
    await updateDoc(callRef, {
      endTime: serverTimestamp()
    });
    console.log("Ended call session in Firestore:", callId);
  } catch (error) {
    console.error("Error ending call session:", error);
  }
}

// Log a call event to the subcollection of the call session
export async function logCallEvent(callId: string, event: Omit<ActivityEvent, "id" | "timestamp">): Promise<void> {
  try {
    // 1. Add event to the subcollection
    const eventsColRef = collection(db, "calls", callId, "events");
    await addDoc(eventsColRef, {
      title: event.title,
      description: event.description,
      type: event.type,
      timestamp: serverTimestamp() // Use server timestamp for reliable sorting
    });

    // 2. Increment event counter on the parent call document
    const callRef = doc(db, "calls", callId);
    await updateDoc(callRef, {
      eventsCount: increment(1)
    });
  } catch (error) {
    console.error("Error logging call event to Firestore:", error);
  }
}

// Fetch list of call sessions for this device
export async function getCallSessions(): Promise<CallSession[]> {
  const deviceId = getDeviceId();
  try {
    const callsColRef = collection(db, "calls");
    const q = query(
      callsColRef,
      where("deviceId", "==", deviceId),
      orderBy("startTime", "desc")
    );
    const querySnapshot = await getDocs(q);
    const sessions: CallSession[] = [];
    querySnapshot.forEach((docSnap) => {
      sessions.push(docSnap.data() as CallSession);
    });
    return sessions;
  } catch (error) {
    console.error("Error fetching call sessions:", error);
    return [];
  }
}

export interface CallEventData {
  id: string;
  title: string;
  description: string;
  type: ActivityEvent["type"];
  timestamp: any;
}

// Fetch the events of a specific call session
export async function getCallEvents(callId: string): Promise<CallEventData[]> {
  try {
    const eventsColRef = collection(db, "calls", callId, "events");
    const q = query(eventsColRef, orderBy("timestamp", "asc"));
    const querySnapshot = await getDocs(q);
    const eventsList: CallEventData[] = [];
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      eventsList.push({
        id: docSnap.id,
        title: data.title,
        description: data.description,
        type: data.type,
        timestamp: data.timestamp
      });
    });
    return eventsList;
  } catch (error) {
    console.error("Error fetching call events:", error);
    return [];
  }
}
