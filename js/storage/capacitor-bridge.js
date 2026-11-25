/**
 * Thin Capacitor native bridge for Android (#109).
 *
 * All calls are guarded by `isNativeAndroid()` so web/PWA and `node --test`
 * environments behave identically with zero runtime errors.
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';

const REST_NOTIF_ID = 1001;

export function isNativeAndroid() {
  try {
    return typeof window !== 'undefined' && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function uint8ToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Persist a copy of the SQLite AppDB to Android Documents/FitnessTrainer/
 * so training logs survive app reinstalls.
 *
 * @param {Uint8Array} bytes
 */
export async function backupAppDbToNativeFile(bytes) {
  if (!isNativeAndroid() || !bytes?.byteLength) return false;
  try {
    await Filesystem.writeFile({
      path: 'FitnessTrainer/fitness-trainer-latest.db',
      data: uint8ToBase64(bytes),
      directory: Directory.Documents,
      recursive: true
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Schedule an Android local notification for when a rest or hold timer ends
 * (fires even if the phone screen locks).
 *
 * @param {number} seconds
 * @param {string} label
 */
export async function scheduleRestNotification(seconds, label = 'Rest complete') {
  if (!isNativeAndroid() || !seconds || seconds <= 0) return false;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== 'granted') return false;
    }
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIF_ID }] });
    await LocalNotifications.schedule({
      notifications: [
        {
          id: REST_NOTIF_ID,
          title: 'Fitness Trainer',
          body: `${label} finished — time for your next set!`,
          schedule: { at: new Date(Date.now() + seconds * 1000) }
        }
      ]
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelRestNotifications() {
  if (!isNativeAndroid()) return false;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIF_ID }] });
    return true;
  } catch {
    return false;
  }
}
