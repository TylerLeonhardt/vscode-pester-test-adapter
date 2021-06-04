import * as vscode from 'vscode';
import { TestHub, testExplorerExtensionId } from 'vscode-test-adapter-api';
import { Log, TestAdapterRegistrar } from 'vscode-test-adapter-util';
import { PesterAdapter } from './adapter';
import { PowerShellExtensionClient } from './powershellExtension';
import { spawn } from 'child_process';

export async function getPesterStatus() {
	var powershellExtensionClient = new PowerShellExtensionClient();
	powershellExtensionClient.RegisterExtension('TylerLeonhardt.vscode-pester-test-adapter')

	const pwshExePath: string = (await (powershellExtensionClient.GetVersionDetails())).exePath;
	var process = spawn(pwshExePath, [
		'-NonInteractive',
		'-NoLogo',
		'-NoProfile',
		'-Command', 'Get-InstalledModule Pester | ConvertTo-Json'
	]);

	return new Promise<boolean>((resolve, reject) => {
		let status: boolean = false

		process.stdout.on('data', (data) => {
			status = true

			let major = '';
			let minor = '';
			let patch = '';

			let pesterInfo = JSON.parse(data)
			if (pesterInfo.Version) {
				[major, minor, patch] = pesterInfo.Version.split('.')

				if (parseInt(major) == 5 && parseInt(minor) < 2) {
					vscode.window.showWarningMessage('Pester version 5.2.0+ is recommended and will be required in a future release of the Pester Test Explorer extension.')
				}
			}
		})

		process.stderr.on('data', (data) => {
			vscode.window.showErrorMessage('The Pester PowerShell module is not installed.  Click the Help button to learn how to get started with Pester.', 'Help')
				.then(selection => {
					if (selection === 'Help') {
					vscode.env.openExternal(vscode.Uri.parse(
						'https://pester-docs.netlify.app/docs/quick-start'));
					};
				});
		})

		process.on('close', (code) => {
			// Unregistering the PowerShell Extension Client to not conflict with PesterTestRunner
			powershellExtensionClient.UnregisterExtension();
			resolve(status);
		})
	})
}

export async function activate(context: vscode.ExtensionContext) {

	const powershellExtension = vscode.extensions.getExtension("ms-vscode.PowerShell-Preview") || vscode.extensions.getExtension("ms-vscode.PowerShell");
	if(!powershellExtension) {
		await vscode.window.showErrorMessage('Please install either the PowerShell or PowerShell Preview extension and then reload the window to use the Pester Test Explorer.');
		const activatedEvent = vscode.extensions.onDidChange(() => {
			if (vscode.extensions.getExtension('ms-vscode.PowerShell') || vscode.extensions.getExtension('ms-vscode.PowerShell-Preview')) {
				activate(context);
				activatedEvent.dispose();
			}
		});
		return;
	}

	if (!powershellExtension.isActive) {
		await powershellExtension.activate();
	}

	const pesterInstalled = await getPesterStatus()

	const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];

	// create a simple logger that can be configured with the configuration variables
	// `pesterExplorer.logpanel` and `pesterExplorer.logfile`
	const log = new Log('pesterExplorer', workspaceFolder, 'Pester Explorer Log');
	context.subscriptions.push(log);

	// get the Test Explorer extension
	const testExplorerExtension = vscode.extensions.getExtension<TestHub>(testExplorerExtensionId);
	if (log.enabled) log.info(`Test Explorer ${testExplorerExtension ? '' : 'not '}found`);

	if (testExplorerExtension && pesterInstalled) {
		const testHub = testExplorerExtension.exports;
		const autoDiscover = vscode.workspace.getConfiguration('pesterExplorer').get<boolean>('autoDiscoverOnOpen');

		if (!autoDiscover) {
			const choice = await vscode.window.showInformationMessage(
				"Pester test discovery requires the code outside of 'Describe' blocks in all '*.Tests.ps1' file to be executed. Would you like to run Pester test discovery?",
				'Yes', 'No', 'Always');

			if(!choice || choice === 'No') {
				return
			} else if (choice === 'Always') {
				vscode.workspace
					.getConfiguration('pesterExplorer')
					.update('autoDiscoverOnOpen', true, vscode.ConfigurationTarget.Global);
			}
		}

		// this will register an PesterTestAdapter for each WorkspaceFolder
		context.subscriptions.push(new TestAdapterRegistrar(
			testHub,
			workspaceFolder => new PesterAdapter(workspaceFolder, log),
			log
		));
	}
 }
