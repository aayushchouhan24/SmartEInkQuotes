/*
 * BleHandler.cpp — BLE server, characteristic callbacks, status
 * ────────────────────────────────────────────────
 * Runs always. Web app connects via Web Bluetooth to:
 *   • Read/write WiFi SSID, password, server URL + device key
 *   • Send commands (REFRESH, CONNECT, STATUS)
 *   • Receive status notifications
 */

#include "BleHandler.h"
#include "Storage.h"

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <WiFi.h>

// Characteristic pointers (module-local)
static BLEServer         *pServer   = nullptr;
static BLECharacteristic *pCharSsid = nullptr;
static BLECharacteristic *pCharPass = nullptr;
static BLECharacteristic *pCharSrv  = nullptr;
static BLECharacteristic *pCharCmd  = nullptr;
static BLECharacteristic *pCharStat = nullptr;

// ══════════════════════════════════════════════════════════════════════════════
// STATUS NOTIFICATION
// ══════════════════════════════════════════════════════════════════════════════

void notifyStatus()
{
    if (!bleConnected || !pCharStat) return;

    String s = "WIFI:";
    s += (WiFi.status() == WL_CONNECTED) ? "OK" : "OFF";
    s += "|IP:";
    s += (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "0.0.0.0";
    s += "|SSID:";  s += wifiSsid;
    s += "|SRV:";   s += serverUrl;
    s += "|KEY:";   s += deviceKey;
    s += "|MODE:";  s += String(displayMode);
    s += "|INT:";   s += String(refreshInterval / 1000);

    pCharStat->setValue(s.c_str());
    pCharStat->notify();
    DBG_PRINTF("[BLE] Status \u2192 %s\n", s.c_str());
}

// ══════════════════════════════════════════════════════════════════════════════
// CALLBACKS
// ══════════════════════════════════════════════════════════════════════════════

class ServerCB : public BLEServerCallbacks
{
    void onConnect(BLEServer *) override
    {
        bleConnected = true;
        DBG_PRINTLN("[BLE] Client connected");
        // Push current values so web app can read them
        pCharSsid->setValue(wifiSsid);
        pCharPass->setValue(wifiPass);
        pCharSrv->setValue(serverUrl);
        delay(200);
        notifyStatus();
    }

    void onDisconnect(BLEServer *) override
    {
        bleConnected = false;
        DBG_PRINTLN("[BLE] Client disconnected \u2014 re-advertising");
        BLEDevice::startAdvertising();
    }
};

class ConfigCB : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *c) override
    {
        String val  = c->getValue().c_str();
        String uuid = c->getUUID().toString().c_str();

        if (uuid == CHAR_SSID_UUID)
        {
            strlcpy(wifiSsid, val.c_str(), sizeof(wifiSsid));
            DBG_PRINTF("[BLE] SSID → %s\n", wifiSsid);
        }
        else if (uuid == CHAR_PASS_UUID)
        {
            strlcpy(wifiPass, val.c_str(), sizeof(wifiPass));
            DBG_PRINTLN("[BLE] Password → ****");
        }
        else if (uuid == CHAR_SRV_UUID)
        {
            // Format: "serverUrl|deviceKey"
            int pipe = val.indexOf('|');
            if (pipe > 0)
            {
                strlcpy(serverUrl, val.substring(0, pipe).c_str(), sizeof(serverUrl));
                strlcpy(deviceKey, val.substring(pipe + 1).c_str(), sizeof(deviceKey));
            }
            else
            {
                strlcpy(serverUrl, val.c_str(), sizeof(serverUrl));
            }
            DBG_PRINTF("[BLE] Server → %s  Key → %.8s...\n", serverUrl, deviceKey);
        }

        saveCredentials();
        notifyStatus();
    }
};

class CmdCB : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *c) override
    {
        String cmd = c->getValue().c_str();
        cmd.trim();
        DBG_PRINTF("[BLE] CMD: '%s'\n", cmd.c_str());

        if (cmd == "REFRESH")
            pendingRefresh = true;
        else if (cmd == "CONNECT")
            pendingWifiConnect = true;
        else if (cmd == "CLEAR")
            pendingClear = true;
        else if (cmd == "STATUS")
            notifyStatus();
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════════

void initBLE()
{
    BLEDevice::init(BLE_NAME);
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new ServerCB());

    BLEService *svc = pServer->createService(SERVICE_UUID);

    // SSID (R/W)
    pCharSsid = svc->createCharacteristic(CHAR_SSID_UUID,
                    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE);
    pCharSsid->setCallbacks(new ConfigCB());
    pCharSsid->setValue(wifiSsid);

    // Password (R/W)
    pCharPass = svc->createCharacteristic(CHAR_PASS_UUID,
                    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE);
    pCharPass->setCallbacks(new ConfigCB());
    pCharPass->setValue(wifiPass);

    // Server URL + Device Key (R/W)
    pCharSrv = svc->createCharacteristic(CHAR_SRV_UUID,
                   BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE);
    pCharSrv->setCallbacks(new ConfigCB());
    pCharSrv->setValue(serverUrl);

    // Command (W)
    pCharCmd = svc->createCharacteristic(CHAR_CMD_UUID,
                   BLECharacteristic::PROPERTY_WRITE);
    pCharCmd->setCallbacks(new CmdCB());

    // Status (R + Notify)
    pCharStat = svc->createCharacteristic(CHAR_STATUS_UUID,
                    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharStat->addDescriptor(new BLE2902());
    pCharStat->setValue("READY");

    svc->start();

    BLEAdvertising *adv = BLEDevice::getAdvertising();
    adv->addServiceUUID(SERVICE_UUID);
    adv->setScanResponse(true);
    adv->setMinPreferred(0x06);
    BLEDevice::startAdvertising();

    DBG_PRINTF("[BLE] Advertising as '%s'\n", BLE_NAME);
}
