import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAX92CZhBW0PX4MGGmsYjVYxFs3zPBOwBo",
  authDomain: "gen-lang-client-0340679998.firebaseapp.com",
  databaseURL: "https://gen-lang-client-0340679998-default-rtdb.firebaseio.com",
  projectId: "gen-lang-client-0340679998",
  storageBucket: "gen-lang-client-0340679998.firebasestorage.app",
  messagingSenderId: "494262517667",
  appId: "1:494262517667:web:7bb22a00c8bed1a7b52416",
  measurementId: "G-NCGN7K721Q"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

/** GIS renderButton에서 받은 ID token으로 Firebase Google 로그인 */
export async function signInToFirebaseWithIdToken(idToken: string): Promise<void> {
  const credential = GoogleAuthProvider.credential(idToken);
  await signInWithCredential(auth, credential);
}
