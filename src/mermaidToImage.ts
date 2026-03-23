import { App, Notice } from "obsidian";
import { loadSettings } from "./settings";
import * as mermaid from "./mermaid";
import { getZhihuImg } from "./image_service";
import i18n, { type Lang } from "../locales";

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
            i + 1,
        );
        transformed += imgTag;
        nextIndex = matchStart + fullMatch.length;
    }

    transformed += markdown.slice(nextIndex);
    return transformed;
}

async function mermaidBlockToImgTag(
    app: App,
    code: string,
    scale: number,
    index: number,
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
        return `<img src="${src}" alt="mermaid-${index}" />`;
    } catch (error) {
        console.error(locale.error.errorHandlingMermaid, error);
        throw new Error(`${locale.error.uploadMermaidImgFailed}: ${error}`);
    }
}
