package com.nuvent.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import com.nuvent.app.harvest.CallRecordingHarvestPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallPlugin.class);
        registerPlugin(CallRecordingHarvestPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
