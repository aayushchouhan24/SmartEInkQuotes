/*
 * Config.h — Constants, pins, UUIDs, shared state
 * ────────────────────────────────────────────────
 */
#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <GxEPD2_BW.h>

// ══════════════════════════════════════════════════════════════════════════════
// HARDWARE
// ══════════════════════════════════════════════════════════════════════════════

#define PWR_PIN       5      // E-ink power pin (-1 if unused)
#define DISPLAY_CS    10
#define DISPLAY_DC    13
#define DISPLAY_RST   14
#define DISPLAY_BUSY  4

constexpr uint16_t DISP_W  = 296;
constexpr uint16_t DISP_H  = 128;
constexpr size_t   BMP_SZ  = DISP_W * DISP_H / 8;  // 4736 bytes

// ══════════════════════════════════════════════════════════════════════════════
// BLE UUIDs — Must match web app (public/js/app.js)
// ══════════════════════════════════════════════════════════════════════════════

#define BLE_NAME            "EInk Display"
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHAR_SSID_UUID      "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define CHAR_PASS_UUID      "beb5483f-36e1-4688-b7f5-ea07361b26a8"
#define CHAR_SRV_UUID       "beb54840-36e1-4688-b7f5-ea07361b26a8"
#define CHAR_CMD_UUID       "beb54841-36e1-4688-b7f5-ea07361b26a8"
#define CHAR_STATUS_UUID    "beb54842-36e1-4688-b7f5-ea07361b26a8"

// ══════════════════════════════════════════════════════════════════════════════
// TIMING
// ══════════════════════════════════════════════════════════════════════════════

#define WIFI_TIMEOUT_MS     15000
#define HTTP_TIMEOUT_MS     45000
#define STREAM_TIMEOUT_MS   30000
#define MIN_INTERVAL_MS     10000
#define STATIC_CHECK_MS     300000   // 5 min check for static modes
#define FULL_REFRESH_EVERY  5        // full e-ink refresh every N frames

// ══════════════════════════════════════════════════════════════════════════════
// NVS NAMESPACE & KEYS
// ══════════════════════════════════════════════════════════════════════════════

#define NVS_NS       "eink"
#define NVS_SSID     "ssid"
#define NVS_PASS     "pass"
#define NVS_SRV      "srv"
#define NVS_KEY      "key"
#define NVS_BMP      "bmp"
#define NVS_QUOTE    "quote"
#define NVS_MODE     "mode"
#define NVS_INTERVAL "intv"
#define NVS_HAS_CACHE "cached"

// ══════════════════════════════════════════════════════════════════════════════
// SHARED STATE  (defined in EInkSketch.ino, extern everywhere else)
// ══════════════════════════════════════════════════════════════════════════════

// Display object
extern GxEPD2_BW<GxEPD2_290_T94, GxEPD2_290_T94::HEIGHT> display;

// Credentials (persisted in NVS, writable via BLE)
extern char wifiSsid[64];
extern char wifiPass[64];
extern char serverUrl[128];
extern char deviceKey[64];

// Frame buffers
extern uint8_t imgBuf[BMP_SZ];
extern char    quoteBuf[160];

// Runtime state
extern uint8_t  frameNum;
extern uint32_t refreshInterval;
extern uint8_t  displayMode;
extern uint32_t lastFetch;
extern bool     wifiOk;
extern bool     hasCachedFrame;

// BLE flags
extern bool bleConnected;
extern bool pendingRefresh;
extern bool pendingWifiConnect;
