import { App, TFile, TFolder, normalizePath } from "obsidian";

const TEMP_FILE_BASENAME_REGEX = /_zhihu(?:_\d+)?$/;
const TEMP_ASSETS_FOLDER_NAME = "_zhihu_assets";

export function isTemporaryZhihuFile(file: TFile): boolean {
    return TEMP_FILE_BASENAME_REGEX.test(file.basename);
}

export async function cleanupTemporaryPublishArtifacts(
    app: App,
    tempFile: TFile,
): Promise<{ deletedImages: number; deletedFile: boolean }> {
    if (!isTemporaryZhihuFile(tempFile)) {
        return { deletedImages: 0, deletedFile: false };
    }

    const markdown = await app.vault.read(tempFile);
    const localAssetPaths = collectLocalAssetImagePaths(tempFile.path, markdown);

    let deletedImages = 0;
    for (const imagePath of localAssetPaths) {
        const imageFile = app.vault.getAbstractFileByPath(imagePath);
        if (imageFile instanceof TFile) {
            await app.vault.delete(imageFile, true);
            deletedImages += 1;
        }
    }

    let deletedFile = false;
    const existingTempFile = app.vault.getAbstractFileByPath(tempFile.path);
    if (existingTempFile instanceof TFile) {
        await app.vault.delete(existingTempFile, true);
        deletedFile = true;
    }

    const assetsFolderPath = getAssetsFolderPath(tempFile.path);
    await removeFolderIfEmpty(app, assetsFolderPath);

    return { deletedImages, deletedFile };
}

function getAssetsFolderPath(notePath: string): string {
    const dir = getDirPath(notePath);
    return normalizePath(
        dir ? `${dir}/${TEMP_ASSETS_FOLDER_NAME}` : TEMP_ASSETS_FOLDER_NAME,
    );
}

function getDirPath(filePath: string): string {
    const normalized = normalizePath(filePath);
    const idx = normalized.lastIndexOf("/");
    if (idx <= 0) return "";
    return normalized.slice(0, idx);
}

function collectLocalAssetImagePaths(notePath: string, markdown: string): string[] {
    const imageRegex = /!\[[^\]]*\]\(([^)\r\n]+)\)/g;
    const resolvedPaths = new Set<string>();

    for (const match of markdown.matchAll(imageRegex)) {
        const rawTarget = match[1] ?? "";
        const resolvedPath = resolveMarkdownTargetPath(notePath, rawTarget);
        if (!resolvedPath) continue;
        if (
            resolvedPath.includes(`/${TEMP_ASSETS_FOLDER_NAME}/`) ||
            resolvedPath.startsWith(`${TEMP_ASSETS_FOLDER_NAME}/`)
        ) {
            resolvedPaths.add(resolvedPath);
        }
    }

    return Array.from(resolvedPaths);
}

function resolveMarkdownTargetPath(
    notePath: string,
    target: string,
): string | undefined {
    let normalizedTarget = target.trim();
    if (!normalizedTarget) return undefined;

    if (normalizedTarget.startsWith("<") && normalizedTarget.endsWith(">")) {
        normalizedTarget = normalizedTarget.slice(1, -1).trim();
    }

    const [pathPart] = normalizedTarget.split(/\s+["']/);
    const cleanPath = (pathPart ?? "").replace(/^\.\/+/, "").trim();
    if (!cleanPath || cleanPath.startsWith("#")) return undefined;
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(cleanPath)) return undefined;

    if (cleanPath.startsWith("/")) {
        return normalizePath(cleanPath.slice(1));
    }
    const noteDir = getDirPath(notePath);
    return normalizePath(noteDir ? `${noteDir}/${cleanPath}` : cleanPath);
}

async function removeFolderIfEmpty(app: App, folderPath: string): Promise<void> {
    const folder = app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder && folder.children.length === 0) {
        await app.vault.delete(folder, true);
    }
}
