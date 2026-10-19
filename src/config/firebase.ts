
import {
  initializeApp,
  getApps,
  type FirebaseApp,
} from 'firebase/app';

import {
  getAuth,
  type Auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';

import {
  getFirestore,
  type Firestore,
  doc,
  getDoc,
  getDocFromServer,
} from 'firebase/firestore';

import firebaseConfigJson from '../../firebase-applet-config.json';

// Target Firebase project
export const TARGET_PROJECT_ID = 'ons-healthcar';

// Resolve Firebase configuration from single unified source
const isConfigJsonTarget =
  firebaseConfigJson.projectId === TARGET_PROJECT_ID;

const isEnvTarget =
  import.meta?.env?.VITE_FIREBASE_PROJECT_ID === TARGET_PROJECT_ID;

const resolvedConfig = {
  apiKey: isConfigJsonTarget
    ? firebaseConfigJson.apiKey
    : isEnvTarget
      ? import.meta?.env?.VITE_FIREBASE_API_KEY
      : firebaseConfigJson.apiKey,

  authDomain: isConfigJsonTarget
    ? firebaseConfigJson.authDomain
    : isEnvTarget
      ? import.meta?.env?.VITE_FIREBASE_AUTH_DOMAIN
      : 'ons-healthcar.firebaseapp.com',

  projectId: isConfigJsonTarget
    ? firebaseConfigJson.projectId
    : isEnvTarget
      ? import.meta?.env?.VITE_FIREBASE_PROJECT_ID
      : TARGET_PROJECT_ID,

  storageBucket: isConfigJsonTarget
    ? firebaseConfigJson.storageBucket
    : isEnvTarget
      ? import.meta?.env?.VITE_FIREBASE_STORAGE_BUCKET
      : 'ons-healthcar.firebasestorage.app',

  messagingSenderId: isConfigJsonTarget
    ? firebaseConfigJson.messagingSenderId
    : isEnvTarget
      ? import.meta?.env?.VITE_FIREBASE_MESSAGING_SENDER_ID
      : '173733124198',

  appId: isConfigJsonTarget
    ? firebaseConfigJson.appId
    : isEnvTarget
      ? import.meta?.env?.VITE_FIREBASE_APP_ID
      : '1:173733124198:web:18dbe21569e683be5775a7',
};

// Validate target project configuration
export const isConfigValid = Boolean(
  resolvedConfig.apiKey &&
    resolvedConfig.projectId &&
    resolvedConfig.projectId === TARGET_PROJECT_ID &&
    (isConfigJsonTarget || isEnvTarget)
);

if (!isConfigValid) {
  console.error(
    `[Firebase Error] App missing authentic configuration for target project "${TARGET_PROJECT_ID}". Please update firebase-applet-config.json with your Firebase Console credentials.`
  );
}

// Authorized admin email list
const envAdminEmails =
  import.meta?.env?.VITE_ADMIN_EMAILS ||
  import.meta?.env?.VITE_OWNER_EMAIL;

export const CONFIGURED_ADMIN_EMAILS = (
  envAdminEmails
    ? envAdminEmails
    : 'hamzadiab500@gmail.com'
)
  .split(',')
  .map((email: string) => email.toLowerCase().trim())
  .filter(Boolean);

export const CONFIGURED_OWNER_EMAIL =
  CONFIGURED_ADMIN_EMAILS[0] || 'hamzadiab500@gmail.com';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentAuth = auth;
  const user = currentAuth?.currentUser;

  const errInfo: FirestoreErrorInfo = {
    error:
      error instanceof Error
        ? error.message
        : String(error),

    authInfo: {
      userId: user?.uid,
      email: user?.email,
      emailVerified: user?.emailVerified,
      isAnonymous: user?.isAnonymous,
      tenantId: user?.tenantId,

      providerInfo:
        user?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },

    operationType,
    path,
  };

  console.error(
    'Firestore Error: ',
    JSON.stringify(errInfo)
  );

  throw new Error(JSON.stringify(errInfo));
}

// Initialize Firebase App
const app: FirebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(resolvedConfig);

// IMPORTANT:
// Always use the DEFAULT Firestore database.
// Do not use firebaseConfigJson.firestoreDatabaseId here.
export const db: Firestore = getFirestore(app);

// Initialize Authentication
export const auth: Auth = getAuth(app);

export const isFirebaseConfigured = isConfigValid;
export const firebaseApp = app;

/**
 * Test Firestore connection on boot
 */
async function testConnection() {
  if (!isFirebaseConfigured) return;

  try {
    await getDocFromServer(
      doc(db, 'test', 'connection')
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.warn(
        'Firestore offline notice. Please check network connection.'
      );
    }
  }
}

testConnection();

/**
 * Sign in using Google Provider
 */
export async function signInWithGoogle(): Promise<User | null> {
  const provider = new GoogleAuthProvider();

  provider.setCustomParameters({
    prompt: 'select_account',
  });

  const result = await signInWithPopup(auth, provider);

  return result.user;
}

/**
 * Sign out current authenticated user
 */
export async function logOut(): Promise<void> {
  await fbSignOut(auth);
}

/**
 * Verify owner authorization using configured email
 * or an admin document in Firestore.
 */
export async function verifyOwnerAuthorization(
  user: User | null
): Promise<boolean> {
  if (!user || !user.email) return false;

  const userEmail = user.email.toLowerCase().trim();

  const isDirectConfiguredAdmin =
    CONFIGURED_ADMIN_EMAILS.includes(userEmail);

  if (isDirectConfiguredAdmin) {
    return true;
  }

  if (user.uid) {
    try {
      const adminDocRef = doc(
        db,
        'admins',
        user.uid
      );

      const snap = await getDoc(adminDocRef);

      if (snap.exists()) {
        const data = snap.data();

        if (
          data.role === 'owner' ||
          data.role === 'admin'
        ) {
          return true;
        }
      }
    } catch {
      return false;
    }
  }

  return false;
}
