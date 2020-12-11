import * as vscode from 'vscode';
import { GetPesterInvokeScript } from './powershellScripts';
import { PowerShellExtensionClient } from './powershellExtension';

export class PesterTaskInvoker {

    private currentTaskExecution: vscode.TaskExecution | undefined;

    constructor(
        private readonly powershellExtensionClient: PowerShellExtensionClient,
        private readonly outputPath: string) {

        // Since we pass the script path to PSES in single quotes to avoid issues with PowerShell
        // special chars like & $ @ () [], we do have to double up the interior single quotes.
        outputPath = outputPath.replace(/'/g, "''");
    }

    public async runTests(filePath: string, lineNumber?: string): Promise<void> {

        const pwshExePath: string = (await this.powershellExtensionClient.GetVersionDetails()).exePath;
        
        // terminate the current task if it is still running.
        this.currentTaskExecution?.terminate();
        const task = this.createTask(pwshExePath, filePath, this.outputPath, lineNumber);
        task.presentationOptions.echo = false;
        this.currentTaskExecution = await vscode.tasks.executeTask(task);
    }

    private createTask(
        pwshExePath: string,
        filePath: string,
        outputPath: string,
        lineNumber?: string): vscode.Task {

        // Since we pass the script path to PSES in single quotes to avoid issues with PowerShell
        // special chars like & $ @ () [], we do have to double up the interior single quotes.
        const scriptPath = filePath.replace(/'/g, "''");
        const shellExec = new vscode.ShellExecution(GetPesterInvokeScript(scriptPath, outputPath, lineNumber),
        {
            executable: pwshExePath,
            shellArgs: [ "-NoLogo","-NoProfile", "-NonInteractive","-Command" ]
        });

        return new vscode.Task(
            { type: "pester" },
            vscode.TaskScope.Workspace,
            "Pester",
            "Pester Test Explorer",
            shellExec,
            "$pester");
    }
}
