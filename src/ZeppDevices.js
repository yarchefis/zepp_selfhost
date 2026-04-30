import chalk from "chalk";
import storage from "./storage.js";
import packageJson from "../package.json" with { type: "json" };
import { debugLog } from "./helpers.js";

let cachedDevices = null;
const CACHE_LIFETIME = 1000 * 3600 * 24 * 3; // 3d

export async function getZeppDevices() {
  if (!cachedDevices) {
    if (
      !(await storage.getItem("devices")) ||
      (await storage.getItem("devicesExpire")) <= Date.now() ||
      (await storage.getItem("appRelease")) !== packageJson.version
    ) {
      console.log("Downloading new zepp_devices.json...");
      const r = await fetch(
        "https://github.com/melianmiko/ZeppOS-DevicesList/raw/main/zepp_devices.json",
      );
      if (r.status !== 200)
        throw new Error(
          `Can't fetch zepp_devices.json map, status=${r.status}`,
        );
      cachedDevices = await r.json();
      debugLog(`Loaded ${cachedDevices.length} devices from GitHub`);
      await storage.setItem("devices", JSON.stringify(cachedDevices));
      await storage.setItem("devicesExpire", Date.now() + CACHE_LIFETIME);
      await storage.setItem("appRelease", packageJson.version);
    } else {
      cachedDevices = JSON.parse(await storage.getItem("devices"));
      debugLog(`Loaded ${cachedDevices.length} devices from local cache`);
    }
  }

  return cachedDevices;
}

export async function getDevicesByParams(screenType, width, height, chipset) {
  // Convert to ZeppDevices variant
  if (screenType === "bar") screenType = "band";

  // Mi Band 7 zeus fix
  if (chipset === "dialog" && width === 192 && height === 349) height = 490;

  const devices = [];
  const allDevices = await getZeppDevices();

  for (const dev of allDevices) {
    if (dev.screenWidth === width && dev.screenHeight === height) {
      const shapeMatch = dev.screenShape === screenType;

      if (shapeMatch) {
        const isPerfect = dev.chipset === chipset;
        if (isPerfect) {
          debugLog(
            chalk.green(`  [MATCH FOUND] ${dev.deviceName} matches perfectly!`),
          );
        } else {
          debugLog(
            chalk.yellow(
              `  [SOFT MATCH] ${dev.deviceName}: Resolution OK, but chipset ZAB(${chipset}) != DB(${dev.chipset})`,
            ),
          );
        }

        // Возвращаем объект с флагом качества совпадения
        devices.push({
          data: dev,
          perfect: isPerfect,
        });
      }
    }
  }

  return devices;
}

export async function getAllKnownDeviceNames() {
  return (await getZeppDevices()).map((row) => row.deviceName);
}

export async function getPlatformToDeviceMap() {
  const data = await getZeppDevices();
  const out = new Map();
  for (const row of data) {
    for (const source of row.deviceSource) out.set(source, row);
  }
  return out;
}
