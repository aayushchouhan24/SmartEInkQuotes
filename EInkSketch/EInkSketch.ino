/*
 * EInkSketch.ino — ESP32 E-Ink Smart Display  v2.1
 * ════════════════════════════════════════════════════
 *
 *  Boot flow:
 *    1.  Init display
 *    2.  Load credentials + cached frame from NVS
 *    3.  Start BLE (always advertising for web app)
 *    4.  If cached frame exists → show it instantly
 *    5.  If WiFi creds exist  → connect & fetch fresh frame from API
 *    6.  No config?           → show setup screen, wait for BLE
 *
 *  Loop:
 *    • Auto mode  (0) — refresh at server-configured interval
 *    • Static (1, 2)  — re-check every 5 min for setting changes
 *    • BLE REFRESH cmd — immediate fetch
 *    • BLE CONNECT cmd — reconnect WiFi
 *
 *  WiFi is used ONLY for internet (API calls).
 *  All configuration is done via BLE from the web app.
 */

#include "Config.h"
#include "Storage.h"
#include "BleHandler.h"
#include "DisplayHelper.h"
#include "WifiApi.h"

// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL STATE  (declared extern in Config.h)
// ══════════════════════════════════════════════════════════════════════════════

GxEPD2_BW<GxEPD2_290_T94, GxEPD2_290_T94::HEIGHT> display(
    GxEPD2_290_T94(DISPLAY_CS, DISPLAY_DC, DISPLAY_RST, DISPLAY_BUSY));

char     wifiSsid[64]    = "";
char     wifiPass[64]    = "";
char     serverUrl[128]  = "";
char     deviceKey[64]   = "";

uint8_t  imgBuf[BMP_SZ];
char     quoteBuf[160];

uint8_t  frameNum        = 0;
uint32_t refreshInterval = 60000;
uint8_t  displayMode     = 0;
uint32_t lastFetch       = 0;
bool     wifiOk          = false;
bool     hasCachedFrame  = false;

bool     bleConnected      = false;
bool     pendingRefresh    = false;
bool     pendingWifiConnect = false;
bool     pendingClear       = false;

// ══════════════════════════════════════════════════════════════════════════════
// SETUP
// ══════════════════════════════════════════════════════════════════════════════

void setup()
{
    DBG_BEGIN(115200);
    delay(100);
    DBG_PRINTLN("\n═══ EInk Smart Display v2.1 ═══");
    DBG_PRINTLN("    BLE + WiFi · Cached Boot\n");

    // 1. Display hardware
    initDisplay();

    // 2. Load saved credentials + cached frame from NVS
    loadCredentials();
    loadCachedFrame();

    // 3. Always start BLE for web-app connection
    initBLE();

    // 4. If we have a cached frame → show it NOW (instant boot)
    if (hasCachedFrame)
    {
        DBG_PRINTLN("[BOOT] Showing cached frame");
        showFrame();
    }

    // 5. If WiFi credentials exist → connect and fetch a fresh frame
    if (strlen(wifiSsid) > 0)
    {
        if (!hasCachedFrame)
            showMsg("Connecting...", wifiSsid);

        wifiOk = connectWifi();

        if (wifiOk && strlen(serverUrl) > 0 && strlen(deviceKey) > 0)
        {
            if (fetchFrame())
            {
                showFrame();
            }
            else if (!hasCachedFrame)
            {
                showMsg("API fetch failed", "Check server URL & key");
            }
            lastFetch = millis();
        }
        else if (!wifiOk && !hasCachedFrame)
        {
            showMsg("WiFi failed", "Connect via BLE to fix");
        }
    }
    else if (!hasCachedFrame)
    {
        // 6. First boot — no creds, no cache
        showSetupScreen();
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// LOOP
// ══════════════════════════════════════════════════════════════════════════════

void loop()
{
    // ── Handle BLE CONNECT command ──────────────────────────────────────────
    if (pendingWifiConnect)
    {
        pendingWifiConnect = false;
        DBG_PRINTLN("[CMD] WiFi reconnect");
        wifiOk = connectWifi();
        notifyStatus();
    }

    // ── Handle BLE CLEAR command ────────────────────────────────────────────
    if (pendingClear)
    {
        pendingClear = false;
        DBG_PRINTLN("[CMD] Clear screen via BLE");
        display.setFullWindow();
        display.fillScreen(GxEPD_WHITE);
        display.display(false);
        DBG_PRINTLN("[DISP] Screen cleared");
    }

    // ── Handle BLE REFRESH command ──────────────────────────────────────────
    if (pendingRefresh)
    {
        pendingRefresh = false;
        DBG_PRINTLN("[CMD] Refresh via BLE");

        if (WiFi.status() != WL_CONNECTED)
            wifiOk = connectWifi();

        if (wifiOk && fetchFrame())
        {
            showFrame();
            notifyStatus();
        }
        else
        {
            showMsg("Refresh failed", wifiOk ? "API error" : "No WiFi");
            notifyStatus();
        }
        lastFetch = millis();
    }

    // ── Auto-refresh timer ──────────────────────────────────────────────────
    bool canFetch = wifiOk && strlen(serverUrl) > 0 && strlen(deviceKey) > 0;

    // Mode 0 = auto at interval.  Modes 1,2 = check every 5 min for changes.
    uint32_t interval = (displayMode == 0)
                            ? refreshInterval
                            : max(refreshInterval, (uint32_t)STATIC_CHECK_MS);

    if (canFetch && millis() - lastFetch >= interval)
    {
        // Reconnect if WiFi dropped
        if (WiFi.status() != WL_CONNECTED)
            wifiOk = connectWifi();

        if (wifiOk && fetchFrame())
            showFrame();

        lastFetch = millis();
    }

    delay(50);
}
