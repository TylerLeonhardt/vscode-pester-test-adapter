import * as vscode from 'vscode';
import { PowerShellExtensionClient } from './powershellExtension';

export class PesterTaskInvoker {

    private currentTaskExecution: vscode.TaskExecution | undefined;

    constructor(
        private readonly powershellExtensionClient: PowerShellExtensionClient,
        private readonly outputPath: string) {
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
        const shellExec = new vscode.ShellExecution(this.GetPesterScript(scriptPath, outputPath, lineNumber),
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

    private GetPesterScript(scriptPath: string, outputPath: string, lineNumber?: string): string {
        if (!lineNumber) {
            lineNumber = ""
        }

        return `
$ScriptPath = '${scriptPath}'
$LineNumber = '${lineNumber}'
$OutputPath = '${outputPath}'
$pesterModule = Microsoft.PowerShell.Core\\Get-Module Pester;
Write-Host '';
if (!$pesterModule) {
    Write-Host "Importing Pester module...";
    $pesterModule = Microsoft.PowerShell.Core\\Import-Module Pester -ErrorAction Ignore -PassThru -MinimumVersion 5.0.0;
    if (!$pesterModule) {
        Write-Warning "Failed to import Pester. You must install Pester module (version 5.0.0 or newer) to run or debug Pester tests.";
        return;
    };
};

if ($LineNumber -match '\\d+') {
    $configuration = @{
        Run = @{
            Path = $ScriptPath;
        };
        Filter = @{
            Line = "\${ScriptPath}:$LineNumber";
        };
    };
    if ("FromPreference" -ne $Output) {
        $configuration.Add('Output', @{ Verbosity = $Output });
    };

    if ($OutputPath) {
        $configuration.Add('TestResult', @{
            Enabled = $true;
            OutputFormat = "NUnit2.5";
            OutputPath = $OutputPath;
        });
    };

    Pester\\Invoke-Pester -Configuration $configuration | Out-Null;
} else {
    $configuration = @{
        Run = @{
            Path = $ScriptPath;
        };
    };

    if ($OutputPath) {
        $configuration.Add('TestResult', @{
            Enabled = $true;
            OutputFormat = "NUnit2.5";
            OutputPath = $OutputPath;
        });
    }
    Pester\\Invoke-Pester -Configuration $configuration | Out-Null;
};
`
    }
}
