import chalk from "chalk";
import { getDevicesByParams, getPlatformToDeviceMap } from "./ZeppDevices.js";
import { debugLog } from "./helpers.js";

const platformToDevice = await getPlatformToDeviceMap();

export class SelfHostConfigsGenerator {
  static apply(bundle, baseURL = "https://example.com", withSubFolder = true) {
    return new SelfHostConfigsGenerator(bundle).generate(
      baseURL,
      withSubFolder,
    );
  }

  constructor(bundle) {
    this.bundle = bundle;
  }

  isVersionGreaterOrEqual(v1, v2) {
    const [v1p, v2p] = [v1, v2].map((v) =>
      v.split(".").map((c) => parseInt(c)),
    );

    let i = 0;
    for (; i < v1p.length || i < v2p.length; i++) {
      if ((v1p[i] ?? 0) > (v2p[i] ?? 0)) {
        return true;
      } else if ((v1p[i] ?? 0) < (v2p[i] ?? 0)) {
        return false;
      }
    }

    return (v1p[i - 1] ?? 0) === (v2p[i - 1] ?? 0);
  }

  async parsePlatform(input, deviceManifest) {
    const devices = [];
    const sources = [];
    const ignoredDevices = [];

    const runtimeMinVersion =
      deviceManifest?.runtime?.apiVersion?.minVersion ?? null;

    for (const row of input) {
      debugLog(
        chalk.blue(
          `\n[CHECKING PACKAGE] Res: ${row.screenResolution}, CPU: ${row.cpuPlatform}, Shape: ${row.screenType}`,
        ),
      );

      if (row.deviceSource) {
        // Easy mode
        const device = platformToDevice.get(row.deviceSource);
        if (!device) {
          debugLog(
            chalk.red(
              `[MISSING ID] Platform ID ${row.deviceSource} not found!`,
            ),
          );
          continue;
        }

        if (
          runtimeMinVersion &&
          !this.isVersionGreaterOrEqual(device.osVersion, runtimeMinVersion)
        ) {
          ignoredDevices.push(device.deviceName);
          continue;
        }

        devices.push({ name: device.deviceName, perfect: true });
        sources.push(row.deviceSource);
      } else if (row.screenType && row.screenResolution && row.cpuPlatform) {
        // Generic model
        const [w, h] = row.screenResolution.split("x").map((r) => parseInt(r));
        const results = await getDevicesByParams(
          row.screenType,
          w,
          h,
          row.cpuPlatform.toLowerCase(),
        );

        for (const res of results) {
          if (
            runtimeMinVersion &&
            !this.isVersionGreaterOrEqual(res.data.osVersion, runtimeMinVersion)
          ) {
            ignoredDevices.push(res.data.deviceName);
            continue;
          }

          devices.push({
            name: res.data.deviceName,
            perfect: res.perfect,
          });
          sources.push(...res.data.deviceSource);
        }
      }
    }

    return [devices, sources, ignoredDevices];
  }

  async generate(baseUrl, withSubFolder) {
    const sourceUrl = {};
    const deviceQr = {};
    const files = {};
    const allIgnoredDevices = [];

    const isApp = this.bundle.appType === "app";
    const transformedBaseUrl = baseUrl.replace(
      "https:",
      isApp ? "zpkd1:" : "watchface:",
    );
    const basePath = withSubFolder ? "/" + this.bundle.appId : "";
    const entryExtension = isApp ? "zpk" : "json";
    const qrUrlTemplate = `${transformedBaseUrl}${basePath}/%basename%.${entryExtension}`;

    for (const row of this.bundle.manifest.zpks) {
      const deviceManifest = this.bundle.packagesDeviceManifests[row.name];
      const [devices, sources, ignoredDevices] = await this.parsePlatform(
        row.platforms,
        deviceManifest,
      );
      allIgnoredDevices.push(...ignoredDevices);

      const basename = row.name.replace(".zpk", "");
      const downloadUrl = `${baseUrl}${basePath}/${row.name}`;
      const qrUrl = qrUrlTemplate.replace("%basename%", basename);

      // Обработка Watchface (упрощено)
      if (this.bundle.appType === "watchface") {
        files[`${basename}.json`] = {
          appid: this.bundle.appId,
          name: this.bundle.appName,
          updated_at: Date.now(),
          url: downloadUrl,
          devices: sources,
          // TODO: Иконка получше (вообще без неё толком не работает)
          preview: "https://mmk.pw/static/favicon/mmk.pw/favicon-120x120.png",
        };
      }

      // Наполнение source_redirect
      for (const pl of sources) {
        if (!sourceUrl[pl]) sourceUrl[pl] = downloadUrl;
      }

      // Наполнение device_qr с учетом ПРИОРИТЕТА
      for (const dev of devices) {
        // Если устройства еще нет ИЛИ текущее совпадение "идеальное", а старое было "мягким"
        if (
          !deviceQr[dev.name] ||
          (!deviceQr[dev.name].perfect && dev.perfect)
        ) {
          deviceQr[dev.name] = {
            url: qrUrl,
            perfect: dev.perfect,
          };
          debugLog(
            chalk.gray(
              `      [LOGIC] Assigned ${qrUrl} to ${dev.name} (Perfect: ${dev.perfect})`,
            ),
          );
        }
      }
    }

    files["map.json"] = {
      device_qr: Object.fromEntries(
        Object.entries(deviceQr).map(([name, obj]) => [name, obj.url]),
      ),
      source_redirect: sourceUrl,
      ignored_devices: [...new Set(allIgnoredDevices)],
      soft_match_devices: Object.entries(deviceQr).filter(it => !it[1].perfect).map(it => it[0]),
    };

    return files;
  }
}
