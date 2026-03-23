import {
    App,
    ButtonComponent,
    FuzzySuggestModal,
    Modal,
    Setting,
    TFolder,
    ToggleComponent,
} from "obsidian";
import i18n, { type Lang } from "../locales";

const locale: Lang = i18n.current;

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
    private onChoose: (folder: TFolder) => void;

    constructor(app: App, onChoose: (folder: TFolder) => void) {
        super(app);
        this.onChoose = onChoose;
    }

    getItems(): TFolder[] {
        return this.app.vault
            .getAllLoadedFiles()
            .filter((item): item is TFolder => item instanceof TFolder);
    }

    getItemText(item: TFolder): string {
        return item.path || "/";
    }

    onChooseItem(item: TFolder): void {
        this.onChoose(item);
    }
}

export class BatchPublishConfigModal extends Modal {
    private selectedFolder: TFolder | null;
    private overwritePublished = false;
    private readonly onSubmit: (
        folder: TFolder,
        overwritePublished: boolean,
    ) => void;

    constructor(
        app: App,
        initialFolder: TFolder | null,
        onSubmit: (folder: TFolder, overwritePublished: boolean) => void,
    ) {
        super(app);
        this.selectedFolder = initialFolder;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: locale.ui.batchPublishConfigTitle });

        const folderText = contentEl.createEl("div", {
            text: this.selectedFolder?.path || "/",
        });
        folderText.addClass("setting-item-description");

        new Setting(contentEl)
            .setName(locale.ui.batchPublishSelectFolder)
            .addButton((button: ButtonComponent) => {
                button.setButtonText(locale.ui.batchPublishChooseFolder).onClick(() => {
                    new FolderSuggestModal(this.app, (folder) => {
                        this.selectedFolder = folder;
                        folderText.setText(folder.path || "/");
                    }).open();
                });
            });

        new Setting(contentEl)
            .setName(locale.ui.batchPublishOverwrite)
            .setDesc(locale.ui.batchPublishOverwriteDesc)
            .addToggle((toggle: ToggleComponent) => {
                toggle.setValue(false).onChange((value) => {
                    this.overwritePublished = value;
                });
            });

        new Setting(contentEl)
            .addButton((button: ButtonComponent) => {
                button
                    .setButtonText(locale.ui.batchPublishStart)
                    .setCta()
                    .onClick(() => {
                        if (!this.selectedFolder) return;
                        this.close();
                        this.onSubmit(
                            this.selectedFolder,
                            this.overwritePublished,
                        );
                    });
            })
            .addButton((button: ButtonComponent) =>
                button
                    .setButtonText(locale.ui.cancel)
                    .onClick(() => this.close()),
            );
    }

    onClose() {
        this.contentEl.empty();
    }
}
