package com.nuvent.app;

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

    private static final String TAG = "NuventCall";

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

        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CALL_PHONE)
                == PackageManager.PERMISSION_GRANTED) {
            placeCall(call);
            return;
        }

        // CALL_PHONE is a runtime permission and nothing ever ASKED for it —
        // dial() only checked, so direct dial could never be reached and every
        // call was permanently downgraded to the confirm-screen dialer. Ask
        // once; whatever the answer, dialAfterPermission still dials.
        Log.i(TAG, "CALL_PHONE not granted — requesting");
        requestPermissionForAlias("callPhone", call, "dialPermsCallback");
    }

    @PermissionCallback
    private void dialPermsCallback(PluginCall call) {
        placeCall(call);
    }

    /**
     * Direct dial when CALL_PHONE is granted, system dialer otherwise.
     *
     * Both branches are wrapped. The ACTION_DIAL fallback previously was not:
     * an ActivityNotFoundException escaped, the PluginCall was never resolved
     * or rejected, and the JS promise hung forever — a dial button that spins
     * with no error. With no <queries> entry for tel: (now added to the
     * manifest) that exception was a live possibility on API 30+.
     */
    private void placeCall(PluginCall call) {
        String number = call.getString("phoneNumber", "").trim();
        boolean canDirectDial = ContextCompat.checkSelfPermission(
                getContext(), Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED;

        String action = canDirectDial ? Intent.ACTION_CALL : Intent.ACTION_DIAL;
        Intent intent = new Intent(action, Uri.parse("tel:" + Uri.encode(number)));
        // getContext() can be a non-Activity context; without NEW_TASK that
        // throws AndroidRuntimeException instead of starting the dialer.
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getContext().startActivity(intent);
            Log.i(TAG, "dialed via " + action);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, action + " failed", e);
            if (canDirectDial) {
                // Direct dial refused (some OEM builds, or a work profile) —
                // try the plain dialer before giving up.
                try {
                    Intent fallback = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number)));
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(fallback);
                    Log.i(TAG, "fell back to ACTION_DIAL");
                    call.resolve();
                    return;
                } catch (Exception inner) {
                    Log.e(TAG, "ACTION_DIAL fallback failed", inner);
                }
            }
            // Reject so the web layer falls through to its own system handoff
            // rather than believing the call was placed.
            call.reject("Could not open the dialer: " + e.getMessage());
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
