package com.eventops.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.telephony.PhoneStateListener;
import android.telephony.TelephonyCallback;
import android.telephony.TelephonyManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Native dialing + automatic call-state tracking (M6).
 *
 * - dial(phoneNumber): fires ACTION_CALL (direct dial, no confirm screen)
 *   when CALL_PHONE is granted; falls back to ACTION_DIAL (system dialer,
 *   confirm screen) when denied — a staff member must always be able to
 *   make the call.
 * - Listens for the IDLE -> OFFHOOK -> IDLE transition and emits
 *   'callStarted' / 'callEnded' events with a duration in seconds. A call
 *   that goes RINGING -> IDLE without OFFHOOK, or OFFHOOK for under 5s,
 *   is reported with connected=false so the web layer can mark the outcome
 *   'not_connected' rather than 'connected'.
 *
 * Sideloaded APK, so the Play Store restricted-permission policy does not
 * apply. We deliberately do NOT request READ_CALL_LOG.
 */
@CapacitorPlugin(
    name = "Call",
    permissions = {
        @Permission(strings = {Manifest.permission.CALL_PHONE}, alias = "callPhone"),
        @Permission(strings = {Manifest.permission.READ_PHONE_STATE}, alias = "phoneState")
    }
)
public class CallPlugin extends Plugin {

    private static final String TAG = "EventOpsCall";

    private TelephonyManager telephonyManager;
    private PhoneStateListener legacyListener;
    private TelephonyCallback modernCallback;
    private boolean wasOffhook = false;
    private long offhookStartMs = 0L;

    @PluginMethod
    public void dial(PluginCall call) {
        String phoneNumber = call.getString("phoneNumber");
        if (phoneNumber == null || phoneNumber.trim().isEmpty()) {
            call.reject("phoneNumber is required");
            return;
        }

        // Normalise: tel: URI handles spaces/dashes fine; strip a leading '+'.
        String number = phoneNumber.trim();

        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CALL_PHONE)
                == PackageManager.PERMISSION_GRANTED) {
            // Direct dial — no confirm screen.
            Intent intent = new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(number)));
            try {
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "ACTION_CALL failed", e);
                call.reject("Could not start the call: " + e.getMessage());
            }
        } else {
            // Fall back to the system dialer (confirm screen) — never fail
            // silently, the staff member still needs to make the call.
            Log.i(TAG, "CALL_PHONE not granted — using system dialer");
            Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number)));
            getContext().startActivity(intent);
            call.resolve();
        }
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        telephonyManager = (TelephonyManager) getContext().getSystemService(android.content.Context.TELEPHONY_SERVICE);
        if (telephonyManager == null) {
            call.reject("Telephony service unavailable");
            return;
        }

        boolean hasPermission = ContextCompat.checkSelfPermission(getContext(),
                Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED;
        if (!hasPermission) {
            // Call-state tracking is a nice-to-have; the web layer still works
            // with manual outcome logging. Request, and if denied, proceed
            // without the listener.
            requestPermissionForAlias("phoneState", call, "phoneStatePermsCallback");
            return;
        }

        registerListener();
        call.resolve();
    }

    @PermissionCallback
    private void phoneStatePermsCallback(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_PHONE_STATE)
                == PackageManager.PERMISSION_GRANTED) {
            registerListener();
        } else {
            Log.w(TAG, "READ_PHONE_STATE denied — call-state tracking off");
        }
        call.resolve();
    }

    private void registerListener() {
        if (telephonyManager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            modernCallback = new CallStateCallback();
            telephonyManager.registerTelephonyCallback(getContext().getMainExecutor(), modernCallback);
        } else {
            legacyListener = new PhoneStateListener() {
                @Override
                public void onCallStateChanged(int state, String phoneNumber) {
                    handleCallState(state);
                }
            };
            telephonyManager.listen(legacyListener, PhoneStateListener.LISTEN_CALL_STATE);
        }
    }

    private void handleCallState(int state) {
        switch (state) {
            case TelephonyManager.CALL_STATE_IDLE:
                if (wasOffhook) {
                    long durationSec = (System.currentTimeMillis() - offhookStartMs) / 1000L;
                    boolean connected = durationSec >= 5L;
                    JSObject obj = new JSObject();
                    obj.put("durationSec", durationSec);
                    obj.put("connected", connected);
                    notifyListeners("callEnded", obj);
                    Log.i(TAG, "callEnded duration=" + durationSec + " connected=" + connected);
                } else {
                    // RINGING -> IDLE without a connect: unanswered.
                    JSObject obj = new JSObject();
                    obj.put("durationSec", 0L);
                    obj.put("connected", false);
                    notifyListeners("callEnded", obj);
                }
                wasOffhook = false;
                offhookStartMs = 0L;
                break;
            case TelephonyManager.CALL_STATE_OFFHOOK:
                if (!wasOffhook) {
                    wasOffhook = true;
                    offhookStartMs = System.currentTimeMillis();
                    notifyListeners("callStarted", new JSObject());
                }
                break;
            case TelephonyManager.CALL_STATE_RINGING:
            default:
                break;
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (telephonyManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && modernCallback != null) {
                telephonyManager.unregisterTelephonyCallback(modernCallback);
            } else if (legacyListener != null) {
                telephonyManager.listen(legacyListener, PhoneStateListener.LISTEN_NONE);
            }
        }
        super.handleOnDestroy();
    }

    /**
     * Named inner class for the API 31+ call-state listener. TelephonyCallback
     * is a base class and CallStateListener is a nested interface; an anonymous
     * class cannot extend one and implement the other in a single expression,
     * so this is declared by name.
     */
    private class CallStateCallback extends TelephonyCallback
            implements TelephonyCallback.CallStateListener {
        @Override
        public void onCallStateChanged(int state) {
            handleCallState(state);
        }
    }
}
