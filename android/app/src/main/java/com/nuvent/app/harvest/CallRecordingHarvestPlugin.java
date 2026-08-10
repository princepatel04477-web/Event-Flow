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

    // H1 — known paths across common OEM dialers.
    private static final String[] KNOWN_PATHS = {
        "/storage/emulated/0/MIUI/sound_recorder/call_rec",
        "/storage/emulated/0/Recordings/Call",
        "/storage/emulated/0/Record/PhoneRecord",
        "/storage/emulated/0/Sounds/CallRecord",
        "/storage/emulated/0/PhoneRecord",
        "/storage/emulated/0/Music/Recordings",
        "/storage/emulated/0/Android/data/com.google.android.dialer/files/CallRecordings",
    };

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

        // Probe known OEM paths.
        for (String path : KNOWN_PATHS) {
            File dir = new File(path);
            if (dir.exists() && dir.isDirectory() && dir.canRead()) {
                found.add(dir.getAbsolutePath());
            }
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
