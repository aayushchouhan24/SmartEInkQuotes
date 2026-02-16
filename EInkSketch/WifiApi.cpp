/*
 * WifiApi.cpp — WiFi connection + HTTP frame fetching
 * ────────────────────────────────────────────────
 * WiFi is used ONLY for internet (fetching frames from Vercel API).
 * All device config is done over BLE.
 */

#include "WifiApi.h"
#include "Storage.h"

#include <WiFi.h>
#include <HTTPClient.h>

// ══════════════════════════════════════════════════════════════════════════════
// WIFI CONNECTION
// ══════════════════════════════════════════════════════════════════════════════

bool connectWifi()
{
    if (strlen(wifiSsid) == 0)
    {
        Serial.println("[WiFi] No SSID — configure via BLE");
        return false;
    }

    Serial.printf("[WiFi] Connecting to '%s'...\n", wifiSsid);
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSsid, wifiPass);

    uint32_t t = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t < WIFI_TIMEOUT_MS)
    {
        delay(250);
        Serial.print(".");
    }
    Serial.println();

    wifiOk = (WiFi.status() == WL_CONNECTED);
    if (wifiOk)
        Serial.printf("[WiFi] OK — %s\n", WiFi.localIP().toString().c_str());
    else
        Serial.println("[WiFi] Failed");

    return wifiOk;
}

// ══════════════════════════════════════════════════════════════════════════════
// FETCH FRAME FROM VERCEL API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/frame?key=DEVICE_KEY
 * Response: [4736 bytes bitmap][quote UTF-8 text]
 * Headers:  X-Display-Mode, X-Duration (seconds)
 *
 * On success: fills imgBuf, quoteBuf, displayMode, refreshInterval
 *             and caches everything to NVS for next boot.
 */
bool fetchFrame()
{
    if (strlen(serverUrl) == 0 || strlen(deviceKey) == 0)
    {
        Serial.println("[API] No server/key — configure via BLE");
        return false;
    }

    String url = String(serverUrl) + "/api/frame?key=" + deviceKey;
    Serial.printf("[API] GET %s\n", url.c_str());

    HTTPClient http;
    if (!http.begin(url))
    {
        Serial.println("[API] begin() failed");
        return false;
    }

    http.setTimeout(HTTP_TIMEOUT_MS);

    const char *hdrs[] = {"X-Display-Mode", "X-Duration"};
    http.collectHeaders(hdrs, 2);

    int code = http.GET();
    if (code != 200)
    {
        Serial.printf("[API] HTTP %d\n", code);
        http.end();
        return false;
    }

    // Parse headers
    if (http.hasHeader("X-Display-Mode"))
        displayMode = http.header("X-Display-Mode").toInt();
    if (http.hasHeader("X-Duration"))
        refreshInterval = max((uint32_t)MIN_INTERVAL_MS,
                              (uint32_t)http.header("X-Duration").toInt() * 1000);

    WiFiClient *stream = http.getStreamPtr();

    // ── Read bitmap (exactly BMP_SZ bytes) ──────────────────────────────────
    size_t n = 0;
    uint32_t t = millis();
    while (n < BMP_SZ && millis() - t < STREAM_TIMEOUT_MS)
    {
        if (stream->available())
        {
            int c = stream->read();
            if (c < 0) break;
            imgBuf[n++] = c;
        }
        else delay(1);
    }

    if (n != BMP_SZ)
    {
        Serial.printf("[API] Bitmap short: %u/%u\n", n, BMP_SZ);
        http.end();
        return false;
    }

    // ── Read remaining bytes as quote text ──────────────────────────────────
    size_t q = 0;
    while (millis() - t < STREAM_TIMEOUT_MS + 5000)
    {
        if (stream->available())
        {
            int c = stream->read();
            if (c < 0) break;
            if (q < sizeof(quoteBuf) - 1) quoteBuf[q++] = c;
        }
        else
        {
            if (q > 0) break;   // finished reading quote
            delay(1);
        }
    }
    quoteBuf[q] = '\0';

    http.end();
    Serial.printf("[API] OK: %u bmp + %u quote  mode=%u  int=%lu\n",
                  n, q, displayMode, refreshInterval);

    // ── Cache to NVS so next boot shows instantly ───────────────────────────
    saveCachedFrame();
    return true;
}
