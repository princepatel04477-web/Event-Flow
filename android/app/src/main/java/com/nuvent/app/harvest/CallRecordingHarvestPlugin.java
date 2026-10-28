package com.nuvent.app.harvest;

import android.content.Intent;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.FileObserver;
import android.provider.Settings;
import android.util.Log;

import androidx.annotation.NonNull;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Call Recording Harvest — H1 + H2 (Capacitor plugin for Android 10+).
 *
 * H1: permission flow (MANAGE_EXTERNAL_STORAGE) and folder discovery.
 * H2: FileObserver for CLOSE_WRITE events on each discovered folder,
 *      resume scan on app resume, and per-file metadata retrieval.
 *
 * The plugin NEVER uploads, inserts DB rows, or writes recordings — it
 * detects new recording files and emits events. Matching and upload live
 * entirely on the web side.
 *
 * Sideloaded APK, so MANAGE_EXTERNAL_STORAGE is acceptable — it would
 * be rejected by Play Store review. The manifest comment says exactly that.
 */
@CapacitorPlugin(name = "CallRecordingHarvest")
public class CallRecordingHarvestPlugin extends Plugin {

    private static final String TAG = "HarvestPlugin";

    // H1 — known paths across common OEM dialers. The exact-hit fast path;
    // anything not listed here is found by scanForRecordingFolders() below.
    //
    // NOTE ON Android/data: the Google Dialer writes to
    // /storage/emulated/0/Android/data/com.google.android.dialer/files/CallRecordings
    // and that path USED to be in this list. It was removed, not forgotten.
    // Since Android 11 no app can read another app Android/data directory —
    // MANAGE_EXTERNAL_STORAGE does not lift that one — so the entry could
    // never match and only made the probe look thorough. Android/media is a
    // different case and IS readable, which is why the Samsung entry below
    // uses it.
    private static final String[] KNOWN_PATHS = {
        // Xiaomi / Redmi / POCO (MIUI, HyperOS)
        "/storage/emulated/0/MIUI/sound_recorder/call_rec",
        // Stock-ish Android, OnePlus, Nothing, Motorola
        "/storage/emulated/0/Recordings/Call",
        "/storage/emulated/0/Recordings/Call Recordings",
        // Samsung One UI
        "/storage/emulated/0/Sounds/CallRecord",
        "/storage/emulated/0/Sounds/Call Recordings",
        "/storage/emulated/0/Android/media/com.samsung.android.app.telephonyui/CallRecording",
        // Oppo / Realme / OnePlus (ColorOS, realme UI)
        "/storage/emulated/0/Record/PhoneRecord",
        "/storage/emulated/0/Record/Call",
        "/storage/emulated/0/ColorOS/Record/Call",
        "/storage/emulated/0/Music/Record/Call",
        // Vivo / iQOO (Funtouch, OriginOS)
        "/storage/emulated/0/Record/CallRecord",
        // Huawei / Honor (EMUI, MagicOS)
        "/storage/emulated/0/Recorder/call",
        // Generic / third-party recorders
        "/storage/emulated/0/PhoneRecord",
        "/storage/emulated/0/CallRecordings",
        "/storage/emulated/0/CallRecorder",
        "/storage/emulated/0/Call",
        "/storage/emulated/0/Music/Recordings",
    };

    /**
     * Roots the scan walks when the list above misses. Kept shallow and few:
     * a full walk of external storage on a phone with 20k photos takes long
     * enough that staff would believe the screen had hung.
     */
    private static final String[] SCAN_ROOTS = {
        "/storage/emulated/0",
        "/storage/emulated/0/Recordings",
        "/storage/emulated/0/Sounds",
        "/storage/emulated/0/Record",
        "/storage/emulated/0/Music",
        "/storage/emulated/0/Android/media",
    };

    /** Directories never worth descending — large, and never a dialer output. */
    private static final String[] SCAN_SKIP = {
        "Android/data", "Android/obb", "DCIM", "Pictures", "Movies", "Download",
        "WhatsApp", "Telegram", ".thumbnails", "tencent", "MIUI/Gallery",
    };

    private static final int SCAN_MAX_DEPTH = 3;
    private static final int SCAN_MAX_HITS = 12;

    /**
     * Find call-recording folders this build has never heard of.
     *
     * A hardcoded list only ever covers the handsets someone thought of, and
     * this app ships to whatever ten cheap Androids the client hands out. So
     * after the known paths, walk a few shallow roots looking for a directory
     * whose NAME says what it holds — "call_rec", "PhoneRecord",
     * "Call Recordings" and so on — and that actually contains audio.
     *
     * Requiring audio inside is what stops it matching an empty "Calls" folder
     * left by a messaging app. The depth, root and hit caps are what stop it
     * becoming a full-disk crawl on a phone full of photos.
     */
    private static void scanForRecordingFolders(File dir, int depth, List<String> out) {
        if (out.size() >= SCAN_MAX_HITS || depth > SCAN_MAX_DEPTH) return;
        if (dir == null || !dir.isDirectory() || !dir.canRead()) return;

        String abs = dir.getAbsolutePath();
        for (String skip : SCAN_SKIP) {
            if (abs.contains("/" + skip)) return;
        }

        File[] children = dir.listFiles();
        if (children == null) return;

        for (File child : children) {
            if (out.size() >= SCAN_MAX_HITS) return;
            if (!child.isDirectory() || !child.canRead()) continue;
            if (looksLikeCallRecordingDir(child.getName()) && containsAudio(child)) {
                String path = child.getAbsolutePath();
                if (!out.contains(path)) {
                    out.add(path);
                    Log.i(TAG, "Discovered by scan: " + path);
                }
                // Found it; its children are takes, not more folders.
                continue;
            }
            scanForRecordingFolders(child, depth + 1, out);
        }
    }

    /** "call_rec", "PhoneRecord", "Call Recordings" — same intent, many spellings. */
    private static boolean looksLikeCallRecordingDir(String name) {
        String n = name.toLowerCase().replace("_", "").replace("-", "").replace(" ", "");
        boolean mentionsCall = n.contains("call") || n.contains("phone");
        boolean mentionsRecording = n.contains("rec");
        return mentionsCall && mentionsRecording;
    }

    /** At least one audio file, so an empty lookalike folder is not reported. */
    private static boolean containsAudio(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return false;
        for (File f : files) {
            if (!f.isFile()) continue;
            String n = f.getName().toLowerCase();
            if (n.endsWith(".m4a") || n.endsWith(".mp3") || n.endsWith(".amr")
                || n.endsWith(".aac") || n.endsWith(".wav") || n.endsWith(".ogg")
                || n.endsWith(".3gp") || n.endsWith(".3gpp") || n.endsWith(".mp4")) {
                return true;
            }
        }
        return false;
    }

    // H2 — FileObservers, held as strong references so GC does not reclaim them.
    private final List<FileObserver> observers = new ArrayList<>();

    // H2 — paths being observed, so observers are registered exactly once.
    private final Set<String> observedPaths = new HashSet<>();

    // H1 — HAS PERMISSION
    @PluginMethod
    public void hasPermission(PluginCall call) {
        boolean granted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            granted = Environment.isExternalStorageManager();
        } else {
            granted = android.os.Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || getContext().checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE)
                    == android.content.pm.PackageManager.PERMISSION_GRANTED;
        }

        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    // H1 — REQUEST PERMISSION
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // API 30+: open the "All files access" settings page.
            // Cannot resolve the call here — the user returns from Settings.
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.fromParts("package", getContext().getPackageName(), null)
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(intent);
                Log.i(TAG, "Opened all-files-access settings");
            } catch (Exception e) {
                Log.e(TAG, "Failed to open all-files-access settings", e);
            }
        } else {
            // API 29 and below: request READ_EXTERNAL_STORAGE at runtime.
            // Capacitor does not support runtime permissions for non-annotated
            // permissions — we request via the Activity.
            String[] perms = { android.Manifest.permission.READ_EXTERNAL_STORAGE };
            bridge.getActivity().requestPermissions(perms, 3001);
        }

        // The caller must poll hasPermission() after returning from Settings.
        // We cannot resolve here because the user has not chosen yet.
        // Return the current state — callers re-check after resume.
        boolean granted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            ? Environment.isExternalStorageManager()
            : getContext().checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    // H1 — DISCOVER FOLDERS
    @PluginMethod
    public void discoverFolders(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            && !Environment.isExternalStorageManager()) {
            call.reject("Permission not granted — call requestPermission first");
            return;
        }

        List<String> found = new ArrayList<>();

        // Manual override from Capacitor Preferences (the JS layer passes it).
        String override = call.getString("folderOverride", null);
        if (override != null && !override.trim().isEmpty()) {
            File overrideDir = new File(override.trim());
            if (overrideDir.exists() && overrideDir.isDirectory() && overrideDir.canRead()) {
                found.add(overrideDir.getAbsolutePath());
                Log.i(TAG, "Using override folder: " + overrideDir.getAbsolutePath());
            } else {
                Log.w(TAG, "Override folder not found or not readable: " + override);
            }
        }

        // Probe known OEM paths first — exact hits, no walking.
        for (String path : KNOWN_PATHS) {
            File dir = new File(path);
            if (dir.exists() && dir.isDirectory() && dir.canRead()) {
                String abs = dir.getAbsolutePath();
                if (!found.contains(abs)) found.add(abs);
            }
        }

        // Then look for folders this build has never heard of. Runs even when
        // the known paths hit: a phone can have both a stock recorder folder
        // and a third-party one, and harvesting only the first would silently
        // miss every call made through the other.
        List<String> scanned = new ArrayList<>();
        for (String root : SCAN_ROOTS) {
            scanForRecordingFolders(new File(root), 0, scanned);
        }
        for (String path : scanned) {
            if (!found.contains(path)) found.add(path);
        }

        JSArray arr = new JSArray();
        for (String f : found) {
            arr.put(f);
        }
        JSObject result = new JSObject();
        result.put("folders", arr);
        call.resolve(result);
    }

    // H1 — LIST FILES IN A FOLDER (for the debug page)
    @PluginMethod
    public void listFiles(PluginCall call) {
        String folderPath = call.getString("folder");
        if (folderPath == null || folderPath.trim().isEmpty()) {
            call.reject("folder is required");
            return;
        }

        File dir = new File(folderPath.trim());
        if (!dir.exists() || !dir.isDirectory() || !dir.canRead()) {
            call.reject("Folder not found or not readable: " + folderPath);
            return;
        }

        File[] files = dir.listFiles();
        if (files == null) {
            call.resolve(new JSObject().put("files", new JSArray()));
            return;
        }

        // Sort by modified time, newest first.
        Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));

        JSArray arr = new JSArray();
        long now = System.currentTimeMillis();
        for (File f : files) {
            if (!f.isFile()) continue;
            long ageSec = (now - f.lastModified()) / 1000L;
            JSObject obj = new JSObject();
            obj.put("name", f.getName());
            obj.put("size", f.length());
            obj.put("mtime", f.lastModified());
            obj.put("path", f.getAbsolutePath());
            obj.put("ageSec", ageSec);
            arr.put(obj);
            if (arr.length() >= 50) break; // Cap for the debug listing.
        }

        JSObject result = new JSObject();
        result.put("path", dir.getAbsolutePath());
        result.put("files", arr);
        call.resolve(result);
    }

    // H2 — GET DURATION FROM A FILE
    @PluginMethod
    public void getDuration(PluginCall call) {
        String filePath = call.getString("path");
        if (filePath == null || filePath.trim().isEmpty()) {
            call.reject("path is required");
            return;
        }

        File file = new File(filePath.trim());
        if (!file.exists() || !file.canRead()) {
            call.reject("File not found or not readable: " + filePath);
            return;
        }

        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        Integer durationSec = null;
        try {
            mmr.setDataSource(file.getAbsolutePath());
            String durationStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (durationStr != null) {
                long ms = Long.parseLong(durationStr);
                if (ms > 0) durationSec = (int) (ms / 1000L);
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not read duration for " + file.getName() + ": " + e.getMessage());
        } finally {
            try { mmr.release(); } catch (Exception ignored) {}
        }

        JSObject result = new JSObject();
        result.put("path", file.getAbsolutePath());
        if (durationSec != null) {
            result.put("durationSec", durationSec);
        }
        call.resolve(result);
    }

    // H2 — START WATCHING FOLDERS + RESUME SCAN
    @PluginMethod
    public void startWatching(PluginCall call) {
        JSArray folderList = call.getArray("folders");
        if (folderList == null || folderList.length() == 0) {
            call.reject("folders is required");
            return;
        }

        try {
            for (int i = 0; i < folderList.length(); i++) {
                String path = folderList.getString(i);
                if (path == null || path.trim().isEmpty()) continue;
                watchFolder(path.trim());
            }
            Log.i(TAG, "Watching " + observers.size() + " folder(s)");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start watching", e);
            call.reject("Failed to start watching: " + e.getMessage());
        }
    }

    private void watchFolder(String folderPath) {
        // Never register a second observer on the same path.
        if (observedPaths.contains(folderPath)) return;

        File dir = new File(folderPath);
        if (!dir.exists() || !dir.isDirectory()) return;

        FileObserver observer = new FileObserver(dir, FileObserver.CLOSE_WRITE) {
            @Override
            public void onEvent(int event, String path) {
                if (path == null) return;
                File file = new File(dir, path);
                if (!file.isFile()) return;

                JSObject body = new JSObject();
                body.put("path", file.getAbsolutePath());
                body.put("name", file.getName());
                body.put("size", file.length());
                body.put("mtime", file.lastModified());
                notifyListeners("recordingDetected", body);
                Log.i(TAG, "Detected: " + file.getName() + " (" + file.length() + " bytes)");
            }
        };

        observer.startWatching();
        observers.add(observer);
        observedPaths.add(folderPath);
        Log.i(TAG, "Watching folder: " + folderPath);
    }

    // H2 — STOP ALL OBSERVERS
    @PluginMethod
    public void stopWatching(PluginCall call) {
        for (FileObserver o : observers) {
            o.stopWatching();
        }
        observers.clear();
        observedPaths.clear();
        Log.i(TAG, "Stopped all observers");
        call.resolve();
    }

    // H2 — HANDLE APP RESUME (called by the web layer via appStateChange)
    // The web layer re-runs discovery + ledger diff on resume. This is here
    // so the listFiles/getDuration methods are reloaded with fresh state.

    @Override
    protected void handleOnDestroy() {
        for (FileObserver o : observers) {
            o.stopWatching();
        }
        observers.clear();
        observedPaths.clear();
        super.handleOnDestroy();
    }
}
