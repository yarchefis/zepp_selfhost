import path from "node:path";
import fs from "node:fs";
import { SelfHostConfigsGenerator } from "./SelfHostConfigsGenerator.js";

export class SelfHostFolderGenerate {
  static async apply(bundle, baseUrl, withSubFolder) {
    return await new SelfHostFolderGenerate(bundle).apply(
      baseUrl,
      withSubFolder,
    );
  }

  /**
   * @param {ZeppBundle} bundle
   */
  constructor(bundle) {
    this.bundle = bundle;
  }

  async apply(baseUrl, withSubFolder) {
    // 1. Сначала получаем данные конфигов и карту имен
    const { files, nameMapping } = await SelfHostConfigsGenerator.apply(
      this.bundle,
      baseUrl,
      withSubFolder,
    );

    // Подготовка директории для раздачи
    const rootDir = path.dirname(this.bundle.fileLocation) + "/serve";
    const serveDir = withSubFolder
      ? `${rootDir}/${this.bundle.appId}`
      : rootDir;

    if (fs.existsSync(rootDir))
      await fs.promises.rm(rootDir, { recursive: true });
    await fs.promises.mkdir(serveDir, { recursive: true });

    // 2. Записываем все пакеты (ZPK)
    for (const [pkgName, pkgData] of Object.entries(this.bundle.packages)) {
      const pkgFile = this.bundle.buildPackage(pkgData);

      // Используем человекоподобное имя из маппинга.
      // Если его нет, оставляем оригинальное имя pkgName.
      const finalFileName = nameMapping[pkgName] || pkgName;

      await fs.promises.writeFile(`${serveDir}/${finalFileName}`, pkgFile);
    }

    // 3. Записываем файлы конфигурации (map.json и прочие)
    for (const [fileName, fileData] of Object.entries(files)) {
      await fs.promises.writeFile(
        `${serveDir}/${fileName}`,
        Buffer.from(JSON.stringify(fileData)),
      );
    }

    return files["map.json"];
  }
}
