import * as vscode from 'vscode';
import { TestHub, testExplorerExtensionId } from 'vscode-test-adapter-api';
import { Log, TestAdapterRegistrar } from 'vscode-test-adapter-util';
import { PesterAdapter } from './adapter';

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

	const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];

	// create a simple logger that can be configured with the configuration variables
	// `pesterExplorer.logpanel` and `pesterExplorer.logfile`
	const log = new Log('pesterExplorer', workspaceFolder, 'Pester Explorer Log');
	context.subscriptions.push(log);

	// get the Test Explorer extension
	const testExplorerExtension = vscode.extensions.getExtension<TestHub>(testExplorerExtensionId);
	if (log.enabled) log.info(`Test Explorer ${testExplorerExtension ? '' : 'not '}found`);

	if (testExplorerExtension) {

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
