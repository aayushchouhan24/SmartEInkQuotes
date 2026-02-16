/*
 * Storage.h — NVS persistence for credentials + cached frames
 * ────────────────────────────────────────────────
 */
#pragma once

#include "Config.h"

void loadCredentials();
void saveCredentials();
void loadCachedFrame();
void saveCachedFrame();
