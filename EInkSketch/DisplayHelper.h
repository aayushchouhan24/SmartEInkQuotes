/*
 * DisplayHelper.h — E-ink display rendering
 * ────────────────────────────────────────────────
 */
#pragma once

#include "Config.h"

void initDisplay();
void showMsg(const char *a, const char *b = nullptr);
void drawQuote(const char *txt);
void showFrame();          // Render imgBuf + quoteBuf to display
void showSetupScreen();    // "Connect via BLE" first-boot screen
