// Firebase project configuration
// ─────────────────────────────────────────────────────────────────────────────
// HOW TO FILL THIS IN:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project (e.g. "majors-golf-pool")
// 3. Add a Web App to the project
// 4. Copy the firebaseConfig object Firebase gives you and paste it below
// 5. Enable Firestore Database (start in test mode, then add security rules)
// 6. Enable Authentication > Sign-in method > Email/Password
// 7. Create one admin user under Authentication > Users
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyCf2VYqyhCRyf8hljnWyYhTDrbeQXlcfLg",
  authDomain: "basic-bros-majors-golf.firebaseapp.com",
  projectId: "basic-bros-majors-golf",
  storageBucket: "basic-bros-majors-golf.firebasestorage.app",
  messagingSenderId: "660646220283",
  appId: "1:660646220283:web:dd4f5ee6597da17c91bb5e",
  measurementId: "G-GFCG02339G"
};

let app, db, auth;

export function initFirebase() {
  if (app) return; // only init once
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
}

export function getDb() { return db; }
export function getAuthInstance() { return auth; }
