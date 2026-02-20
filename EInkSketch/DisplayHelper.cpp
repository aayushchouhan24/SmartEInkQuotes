/*
 * DisplayHelper.cpp — E-ink rendering helpers
 * ────────────────────────────────────────────────
 */

#include "DisplayHelper.h"
#include <SPI.h>

// ── Hardware init ───────────────────────────────────────────────────────────

void initDisplay()
{
    // Explicit SPI pins so the same code works on C3, S3, and classic ESP32
    SPI.begin(DISPLAY_CLK, -1 /* no MISO */, DISPLAY_DIN, DISPLAY_CS);

    display.init(115200);
    display.setRotation(1);
    display.setTextColor(GxEPD_BLACK);
    display.setFont(nullptr);
}

// ── Show 1-2 line text message ──────────────────────────────────────────────

void showMsg(const char *a, const char *b)
{
    display.setFullWindow();
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);
    display.setTextSize(1);
    display.setCursor(4, 24);
    display.print(a);
    if (b)
    {
        display.setCursor(4, 44);
        display.print(b);
    }
    display.display(false);
}

// ── Word-wrapped quote in bottom strip ──────────────────────────────────────

void drawQuote(const char *txt)
{
    const uint16_t y0 = DISP_H - 36;
    display.fillRect(0, y0, DISP_W, 36, GxEPD_WHITE);
    display.drawLine(0, y0, DISP_W, y0, GxEPD_BLACK);
    display.setTextColor(GxEPD_BLACK);
    display.setTextSize(1);

    uint16_t cy  = y0 + 11;
    uint8_t  col = 0, ln = 0;
    const char *p = txt;
    uint16_t total = 0;

    while (*p && ln < 3 && total < 144)
    {
        uint8_t wl = 0;
        while (p[wl] && p[wl] != ' ') wl++;

        if (col && col + 1 + wl > 48)
        {
            ln++; cy += 11; col = 0;
            if (ln >= 3) break;
        }

        if (col) col++;
        display.setCursor(3 + col * 6, cy);
        for (uint8_t i = 0; i < wl && total < 144; i++, total++)
            display.print(p[i]);

        col += wl;
        p += wl;
        while (*p == ' ') p++;
    }
}

// ── Render current imgBuf + quoteBuf to e-ink ───────────────────────────────

void showFrame()
{
    display.setFullWindow();
    display.fillScreen(GxEPD_WHITE);
    display.drawBitmap(0, 0, imgBuf, DISP_W, DISP_H, GxEPD_BLACK);

    if (quoteBuf[0])
        drawQuote(quoteBuf);

    // Full hardware refresh every N frames to reduce ghosting
    bool partial = (frameNum % FULL_REFRESH_EVERY != 0);
    display.display(partial);
    frameNum++;
    DBG_PRINTF("[DISP] Frame #%u rendered\n", frameNum);
}

// ── First-boot / no config screen ───────────────────────────────────────────

void showSetupScreen()
{
    display.setFullWindow();
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);

    display.setTextSize(2);
    display.setCursor(30, 30);
    display.print("EInk Display");

    display.setTextSize(1);
    display.setCursor(30, 64);
    display.print("Open web app & connect via BLE");
    display.setCursor(30, 80);
    display.print("to configure WiFi & server.");

    display.drawRoundRect(20, 10, DISP_W - 40, DISP_H - 20, 6, GxEPD_BLACK);
    display.display(false);
}
