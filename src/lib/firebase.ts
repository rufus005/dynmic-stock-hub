import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAQ-zVncSRduqQirjv1CikE5_KqwWHncBc",
  authDomain: "planning-with-ai-8bca4.firebaseapp.com",
  databaseURL: "https://planning-with-ai-8bca4-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "planning-with-ai-8bca4",
  storageBucket: "planning-with-ai-8bca4.firebasestorage.app",
  messagingSenderId: "67912606661",
  appId: "1:67912606661:web:eae0868aa026e8a3c0a1ac"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const PRODUCTS_PATH = 'products';
export const USERS_PATH = 'users';
export const PRODUCTION_HISTORY_PATH = 'production_history';
export const TRANSFER_HISTORY_PATH = 'transfer_history';
export const CATEGORIES_PATH = 'categories';
export const TAGS_PATH = 'tags';
