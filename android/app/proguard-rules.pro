# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------
# Capacitor — reflection-based plugin registration.
#
# The Bridge instantiates plugins by class name and discovers their methods
# via the @CapacitorPlugin / @PluginMethod annotations. R8 sees no direct
# reference to any of it, so without these rules it strips the classes and
# the plugin simply does not exist at runtime — no crash, no log, the JS call
# just never resolves. That failure mode is invisible until a staff member
# taps something at the venue.
# ---------------------------------------------------------------------
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep class * extends com.getcapacitor.Plugin { *; }

# Our own native code, including the M6 dialer. Same reflection path.
-keep class com.nuvent.app.** { *; }

# capacitor-voice-recorder (H5 voice notes). The generic rules above already
# keep the @CapacitorPlugin class itself; this keeps its helper types
# (CustomMediaRecorder, RecordData) explicitly. They are only ever reached
# from the plugin class, so R8 should retain them anyway — but the failure
# mode if it does not is the silent one described above, discovered by a
# staff member mid-call rather than by a build error.
-keep class com.tchvu3.capacitorvoicerecorder.** { *; }

# Cordova plugins bridged through Capacitor.
-keep class org.apache.cordova.** { *; }

# The JS bridge interface must keep its member names — the WebView calls
# them by string.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Plugins commonly reflect over their own config/result models.
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod

# Sentry (@sentry/capacitor) — keep line numbers useful in release traces.
-keepattributes SourceFile,LineNumberTable
-keep class io.sentry.** { *; }
