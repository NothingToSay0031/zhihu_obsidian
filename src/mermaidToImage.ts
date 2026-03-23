import { App, Notice, requestUrl } from "obsidian";
import { loadSettings } from "./settings";
import * as mermaid from "./mermaid";
import { getZhihuImg } from "./image_service";
import i18n, { type Lang } from "../locales";
import { createHash } from "crypto";
import { normalizePath } from "obsidian";

const locale: Lang = i18n.current;

/**
 * Convert all Mermaid fenced code blocks in markdown to uploaded Zhihu image tags.
 * The source markdown file is not modified; only the outgoing publish content is transformed.
 */
export async function convertMermaidBlocks(
    app: App,
    markdown: string,
): Promise<string> {
    const settings = await loadSettings(app.vault);
    const regex = /```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
    const matches = Array.from(markdown.matchAll(regex));
    if (matches.length === 0) return markdown;

    let nextIndex = 0;
    let transformed = "";
    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const matchStart = match.index ?? 0;
        const fullMatch = match[0];
        const mermaidCode = match[1] ?? "";

        transformed += markdown.slice(nextIndex, matchStart);
        new Notice(`Converting Mermaid (${i + 1}/${matches.length})`);
        const imgTag = await mermaidBlockToImgTag(
            app,
            mermaidCode,
            settings.mermaidScale,
        );
        transformed += imgTag;
        nextIndex = matchStart + fullMatch.length;
    }

    transformed += markdown.slice(nextIndex);
    return transformed;
}

/**
 * Convert mermaid code fences into local vault images and replace with wiki image links.
 * This keeps source note intact when used on a cloned _zhihu note and lets existing image
 * upload pipeline handle the final Zhihu upload.
 */
export async function convertMermaidBlocksToLocalImages(
    app: App,
    markdown: string,
    sourcePath: string,
): Promise<string> {
    const settings = await loadSettings(app.vault);
    const regex = /```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
    const matches = Array.from(markdown.matchAll(regex));
    if (matches.length === 0) return markdown;

    const sourceDir = getDirPath(sourcePath);
    const sourceName = getFileStem(sourcePath);
    const assetsDir = joinVaultPath(sourceDir, "_zhihu_assets");
    await ensureFolder(app, assetsDir);
    console.log(
        `[Zhihu][Mermaid] source=${sourcePath}, sourceDir=${sourceDir || "<root>"}, assetsDir=${assetsDir}, blocks=${matches.length}`,
    );
    let nextIndex = 0;
    let transformed = "";
    let converted = 0;
    let failed = 0;

    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const matchStart = match.index ?? 0;
        const fullMatch = match[0];
        const mermaidCode = match[1] ?? "";

        transformed += markdown.slice(nextIndex, matchStart);
        try {
            const localImagePath = await renderMermaidToLocalImage(
                app,
                mermaidCode,
                settings.mermaidScale,
                assetsDir,
                sourceName,
            );
            const relPath = toRelativePath(sourceDir, localImagePath);
            transformed += `![](${relPath})`;
            converted += 1;
            console.log(
                `[Zhihu][Mermaid] block=${i + 1} converted, local=${localImagePath}, rel=${relPath}`,
            );
        } catch (error) {
            console.error(locale.error.errorHandlingMermaid, error);
            console.error(
                `[Zhihu][Mermaid] block=${i + 1} failed, code-preview=${mermaidCode.slice(
                    0,
                    120,
                )}`,
            );
            transformed += fullMatch;
            failed += 1;
        }
        nextIndex = matchStart + fullMatch.length;
    }
    transformed += markdown.slice(nextIndex);
    new Notice(
        `[Zhihu] Mermaid converted: ${converted}, failed: ${failed}`,
        6000,
    );
    return transformed;
}

async function mermaidBlockToImgTag(
    app: App,
    code: string,
    scale: number,
): Promise<string> {
    try {
        const container = document.createElement("div");
        await mermaid.renderMermaid(code, container);
        const svgEl = container.querySelector("svg");
        if (!svgEl) {
            throw new Error("Mermaid rendered without svg output");
        }
        const svg = mermaid.cleanSvg(svgEl.outerHTML);
        const pngBuffer = await mermaid.svgToPngBuffer(svg, scale);
        const imgRes = await getZhihuImg(app.vault, pngBuffer);
        const src = `${imgRes.original_src}.png`;
        return `<img src="${src}" alt="" />`;
    } catch (error) {
        console.error(locale.error.errorHandlingMermaid, error);
        throw new Error(`${locale.error.uploadMermaidImgFailed}: ${error}`);
    }
}

async function renderMermaidToLocalImage(
    app: App,
    code: string,
    scale: number,
    targetDir: string,
    sourceName: string,
): Promise<string> {
    const effectiveScale = Math.max(3, Math.round(scale * 1.5));
    let pngBuffer: Buffer;
    try {
        const container = document.createElement("div");
        await mermaid.renderMermaid(code, container);
        const svgEl = container.querySelector("svg");
        if (!svgEl) {
            throw new Error("Mermaid rendered without svg output");
        }
        const svg = mermaid.cleanSvg(svgEl.outerHTML);
        pngBuffer = await mermaid.svgToPngBuffer(svg, effectiveScale);
    } catch (localError) {
        // Fallback to mermaid.ink when local render is unavailable.
        console.warn("[Zhihu][Mermaid] local render failed, fallback to mermaid.ink", localError);
        pngBuffer = await fetchMermaidPngFromInk(code);
    }

    const hash = createHash("md5").update(pngBuffer).digest("hex");
    const safeName = sourceName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileName = `mermaid_${safeName}_x${effectiveScale}_${hash}.png`;
    const fullPath = joinVaultPath(targetDir, fileName);
    const existing = app.vault.getAbstractFileByPath(fullPath);
    if (!existing) {
        const arrayBuffer = pngBuffer.buffer.slice(
            pngBuffer.byteOffset,
            pngBuffer.byteOffset + pngBuffer.byteLength,
        ) as ArrayBuffer;
        await app.vault.createBinary(fullPath, arrayBuffer);
        console.log(`[Zhihu][Mermaid] image written: ${fullPath}`);
    }
    return fullPath;
}

function getDirPath(filePath: string): string {
    const normalized = normalizePath(filePath);
    const idx = normalized.lastIndexOf("/");
    if (idx <= 0) return "";
    return normalized.slice(0, idx);
}

function getFileStem(filePath: string): string {
    const normalized = normalizePath(filePath);
    const name = normalized.split("/").pop() ?? "note";
    return name.replace(/\.md$/i, "");
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
    const parts = folderPath.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        const normalized = normalizePath(current);
        if (!app.vault.getAbstractFileByPath(normalized)) {
            await app.vault.createFolder(normalized);
        }
    }
}

function toRelativePath(baseDir: string, fullPath: string): string {
    if (!baseDir) return fullPath;
    if (fullPath.startsWith(`${baseDir}/`)) {
        return fullPath.slice(baseDir.length + 1);
    }
    return fullPath;
}

function joinVaultPath(...parts: string[]): string {
    const cleaned = parts
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => part.replace(/^\/+|\/+$/g, ""));
    return normalizePath(cleaned.join("/"));
}

async function fetchMermaidPngFromInk(code: string): Promise<Buffer> {
    const encoded = Buffer.from(code, "utf8").toString("base64url");
    const response = await requestUrl({
        url: `https://mermaid.ink/img/${encoded}`,
        method: "GET",
        contentType: undefined,
    });
    return Buffer.from(response.arrayBuffer);
}
