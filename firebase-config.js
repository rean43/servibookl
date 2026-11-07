import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Firebase Web configuration is public client metadata, not a service-account secret.
// Restrict the API key to this site's production and development HTTP referrers in Google Cloud.
export const firebaseConfig = {
    apiKey: "AIzaSyBaZ7_fJfyIfUJjgHcFtV_xn8K0QbsvXAQ",
    authDomain: "servibook-ed2ba.firebaseapp.com",
    projectId: "servibook-ed2ba",
    storageBucket: "servibook-ed2ba.firebasestorage.app",
    messagingSenderId: "826695411067",
    appId: "1:826695411067:web:f2b256335f1172c6f8c9de",
};

const app = getApps().find((firebaseApp) => firebaseApp.name === '[DEFAULT]')
    || initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

