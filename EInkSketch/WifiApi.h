/*
 * WifiApi.h — WiFi connection + Vercel API frame fetching
 * ────────────────────────────────────────────────
 */
#pragma once

#include "Config.h"

bool connectWifi();
bool fetchFrame();     // Fetch new frame from API, fills imgBuf + quoteBuf
