// Eventually something like this would go in an npm package

import * as vscode from 'vscode';

export interface IExternalPowerShellDetails {
    exePath: string;
    version: string;
    displayName: string;
    architecture: string;
}

export interface IPowerShellExtensionClient {
    registerExternalExtension(id: string, apiVersion?: string): string;
    unregisterExternalExtension(uuid: string): boolean;
    getPowerShellVersionDetails(uuid: string): Promise<IExternalPowerShellDetails>;
}

export class PowerShellExtensionClient {
    private internalPowerShellExtensionClient: IPowerShellExtensionClient
    constructor() {
        const powershellExtension = vscode.extensions.getExtension<IPowerShellExtensionClient>("ms-vscode.PowerShell-Preview") || vscode.extensions.getExtension<IPowerShellExtensionClient>("ms-vscode.PowerShell");
        this.ExtensionPath = powershellExtension?.extensionPath ?? "";
        this.internalPowerShellExtensionClient = powershellExtension!.exports as IPowerShellExtensionClient;
    }
    private _sessionId: string | undefined;
    private get sessionId(): string | undefined {
        if (!this._sessionId) {
            throw new Error("Client is not registered. You must run client.RegisterExtension(extensionId) first before using any other APIs.");
        }

        return this._sessionId;
    }

    private set sessionId(id: string | undefined) {
        this._sessionId = id;
    }

    public readonly ExtensionPath: string;

    public get IsConnected() {
        return this._sessionId != null;
    }

    /**
     * RegisterExtension
     * https://github.com/PowerShell/vscode-powershell/blob/2d30df76eec42a600f97f2cc28105a9793c9821b/src/features/ExternalApi.ts#L25-L38
     */
    public RegisterExtension(extensionId: string) {
        this.sessionId = this.internalPowerShellExtensionClient.registerExternalExtension(extensionId);
    }

    /**
     * UnregisterExtension
     * https://github.com/PowerShell/vscode-powershell/blob/2d30df76eec42a600f97f2cc28105a9793c9821b/src/features/ExternalApi.ts#L42-L54
     */
    public UnregisterExtension() {
        this.internalPowerShellExtensionClient.unregisterExternalExtension(this.sessionId as string);
        this.sessionId = undefined;
    }

    /**
     * GetVersionDetails
     * https://github.com/PowerShell/vscode-powershell/blob/master/src/features/ExternalApi.ts#L58-L76
     */
    public GetVersionDetails(): Thenable<IExternalPowerShellDetails> {
        return this.internalPowerShellExtensionClient.getPowerShellVersionDetails(this.sessionId as string);
    }
}
