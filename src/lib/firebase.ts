import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore with custom database ID from config as second parameter
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || "(default)");

