/*
 * Storage.cpp — NVS persistence for credentials + cached frames
 * ────────────────────────────────────────────────
 * Stores WiFi creds, server URL, device key, and the last rendered
 * frame (bitmap + quote) so it can display instantly on boot.
 */

#include "Storage.h"
#include <Preferences.h>

static Preferences prefs;

// ── Load WiFi + server credentials from NVS ─────────────────────────────────

void loadCredentials()
{
    prefs.begin(NVS_NS, true);  // read-only
    strlcpy(wifiSsid,  prefs.getString(NVS_SSID, "").c_str(), sizeof(wifiSsid));
    strlcpy(wifiPass,   prefs.getString(NVS_PASS, "").c_str(), sizeof(wifiPass));
    strlcpy(serverUrl,  prefs.getString(NVS_SRV,  "").c_str(), sizeof(serverUrl));
    strlcpy(deviceKey,  prefs.getString(NVS_KEY,  "").c_str(), sizeof(deviceKey));
    prefs.end();

    Serial.printf("[NVS] SSID='%s'  SRV='%s'  KEY='%.8s...'\n",
                  wifiSsid, serverUrl, deviceKey);
}

// ── Save WiFi + server credentials to NVS ───────────────────────────────────

void saveCredentials()
{
    prefs.begin(NVS_NS, false);
    prefs.putString(NVS_SSID, wifiSsid);
    prefs.putString(NVS_PASS, wifiPass);
    prefs.putString(NVS_SRV,  serverUrl);
    prefs.putString(NVS_KEY,  deviceKey);
    prefs.end();
    Serial.println("[NVS] Credentials saved");
}

// ── Load cached frame (bitmap + quote + settings) from NVS ──────────────────

void loadCachedFrame()
{
    prefs.begin(NVS_NS, true);
    hasCachedFrame = prefs.getBool(NVS_HAS_CACHE, false);

    if (hasCachedFrame)
    {
        size_t read = prefs.getBytes(NVS_BMP, imgBuf, BMP_SZ);
        if (read != BMP_SZ)
        {
            hasCachedFrame = false;
            Serial.printf("[NVS] Cached bitmap corrupt (%u/%u)\n", read, BMP_SZ);
        }
        else
        {
            strlcpy(quoteBuf, prefs.getString(NVS_QUOTE, "").c_str(), sizeof(quoteBuf));
            displayMode     = prefs.getUChar(NVS_MODE, 0);
            refreshInterval = prefs.getULong(NVS_INTERVAL, 60000);
            Serial.printf("[NVS] Cached frame loaded (mode=%u, interval=%lu)\n",
                          displayMode, refreshInterval);
        }
    }
    else
    {
        Serial.println("[NVS] No cached frame");
    }
    prefs.end();
}

// ── Save current frame + settings to NVS cache ─────────────────────────────

void saveCachedFrame()
{
    prefs.begin(NVS_NS, false);
    prefs.putBytes(NVS_BMP, imgBuf, BMP_SZ);
    prefs.putString(NVS_QUOTE, quoteBuf);
    prefs.putUChar(NVS_MODE, displayMode);
    prefs.putULong(NVS_INTERVAL, refreshInterval);
    prefs.putBool(NVS_HAS_CACHE, true);
    prefs.end();

    hasCachedFrame = true;
    Serial.println("[NVS] Frame cached");
}
