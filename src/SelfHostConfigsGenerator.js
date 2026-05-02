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
    const nameMapping = {};
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

      // Чистим игнорируемые устройства от Amazfit
      allIgnoredDevices.push(
        ...ignoredDevices.map((name) => name.replace(/^Amazfit\s+/i, "")),
      );

      let finalBasename = row.name.replace(".zpk", "");
      let newFileName = row.name;

      if (isApp && row.platforms && row.platforms[0]) {
        const platform = row.platforms[0];
        const shapePrefix = platform.screenType[0];
        const cpu = platform.cpuPlatform.toUpperCase();
        const res = platform.screenResolution;
        finalBasename = `${shapePrefix}-${cpu}-${res}`;
        newFileName = `${finalBasename}.zpk`;
      }

      nameMapping[row.name] = newFileName;

      const downloadUrl = `${baseUrl}${basePath}/${newFileName}`;
      const qrUrl = qrUrlTemplate.replace("%basename%", finalBasename);

      // Обработка Watchface (упрощено)
      if (this.bundle.appType === "watchface") {
        files[`${finalBasename}.json`] = {
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
        // Убираем Amazfit из названия перед использованием в качестве ключа
        const cleanName = dev.name.replace(/^Amazfit\s+/i, "");

        if (
          !deviceQr[cleanName] ||
          (!deviceQr[cleanName].perfect && dev.perfect)
        ) {
          deviceQr[cleanName] = {
            url: qrUrl,
            perfect: dev.perfect,
          };
          debugLog(
            chalk.gray(
              `      [LOGIC] Assigned ${qrUrl} to ${cleanName} (Perfect: ${dev.perfect})`,
            ),
          );
        }
      }
    }

    // Сортировка device_qr по алфавиту (localeCompare учитывает числа в названиях)
    const sortedDeviceQrEntries = Object.entries(deviceQr).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    files["map.json"] = {
      device_qr: Object.fromEntries(
        sortedDeviceQrEntries.map(([name, obj]) => [name, obj.url]),
      ),
      source_redirect: sourceUrl,
      ignored_devices: [...new Set(allIgnoredDevices)].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
      soft_match_devices: Object.entries(deviceQr)
        .filter((it) => !it[1].perfect)
        .map((it) => it[0])
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    };

    return { files, nameMapping };
  }
}
