package com.hyeni.calendar;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "KakaoMapLauncher")
public class KakaoMapLauncherPlugin extends Plugin {

    @PluginMethod
    public void openRouteFoot(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("opened", false);
        ret.put("reason", "external_route_disabled");
        call.resolve(ret);
    }
}
