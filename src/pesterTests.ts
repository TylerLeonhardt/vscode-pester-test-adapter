import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as convert from 'xml-js';
import { spawn } from 'child_process';
import { TestSuiteInfo, TestInfo, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent } from 'vscode-test-adapter-api';
import { getPesterDiscoveryScript } from './powershellScripts';
import { getPesterVersion } from './powershellScripts';
import { PowerShellExtensionClient } from './powershellExtension';
import { PesterTaskInvoker } from './pesterTaskInvoker';
import { Log } from 'vscode-test-adapter-util';

export class PesterTestRunner {
	private readonly testOutputWatcher: vscode.FileSystemWatcher;
	private readonly testOutputLocation: string;

	private readonly powershellExtensionClient: PowerShellExtensionClient;
	private readonly pesterInvoker: PesterTaskInvoker;

	private testRootDirectory: string | undefined;
	private pesterTestSuite: TestSuiteInfo = {
		type: 'suite',
		id: 'root',
		label: 'Pester',
		children: []
	}

	public constructor(
		public readonly workspace: vscode.WorkspaceFolder,
		private readonly testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>,
		private readonly log: Log
	) {
		this.log.info('Initializing Pester test runner.');
		this.powershellExtensionClient = new PowerShellExtensionClient();
		this.powershellExtensionClient.RegisterExtension('TylerLeonhardt.vscode-pester-test-adapter');

		const relativePath = vscode.workspace
			.getConfiguration("pesterExplorer")
			.get<string>("testResultsFilePath")!;
		this.testOutputLocation = path.join(this.workspace.uri.fsPath, relativePath);

		this.pesterInvoker = new PesterTaskInvoker(this.powershellExtensionClient, this.testOutputLocation);
		this.testOutputWatcher = vscode.workspace.createFileSystemWatcher(this.testOutputLocation, false, false, false);
		this.testOutputWatcher.onDidChange((e: vscode.Uri) => this.loadTestFile(e));
	}

	public getRootTestSuite(): TestSuiteInfo {
		return this.pesterTestSuite;
	}

	public async loadPesterTests(files?: vscode.Uri[], skipLoadingResults?: boolean): Promise<TestSuiteInfo> {
		files ??= await vscode.workspace.findFiles(new vscode.RelativePattern(this.getTestRootDirectory(), '**/*.[tT]ests.ps1'));
		this.log.debug(`Found ${files.length} paths`);
	
		const exePath = await this.getPowerShellExe();

		const pesterVersionScript = getPesterVersion();
		this.log.debug(pesterVersionScript);
		const pesterVersion = spawn(exePath, [
			'-NonInteractive',
			'-NoLogo',
			'-NoProfile',
			'-Command', pesterVersionScript]);
		pesterVersion.stdout.on('data', (data) => {
			const version = data.toString().replace(/[\n\r]+/g, '');
			if ( (parseInt(version.split('.')[0]) == 5 && parseInt(version.split('.')[1]) < 2) || parseInt(version.split('.')[0]) < 5) {
				vscode.window.showWarningMessage("Pester v5.2.0+ will be required for future versions of Pester Test Explorer.", 'OK');
			}
		})

		const script = getPesterDiscoveryScript(files.map(uri => uri.fsPath));
		this.log.debug(script);
		const ls = spawn(exePath, [
			'-NonInteractive',
			'-NoLogo',
			'-NoProfile',
			'-Command', script]);

		return new Promise<TestSuiteInfo>((resolve, reject) => {
			let strData: string = ""

			ls.stdout.on('data', (data: Buffer) => {
				this.log.debug(`stdout: ${data}`);
				strData += data;
			});
		
			ls.stderr.on('data', (data) => {
				const err: string = data.toString();
				this.log.error(`stderr: ${err}`);

				if (err.includes("no valid module file")) {
					vscode.window.showErrorMessage("Pester version '5.0.0' or higher was not found in any module directory. Make sure you have Pester v5+ installed: Install-Module Pester -MinimumVersion 5.0")
					resolve(this.pesterTestSuite);
				}
			});

			ls.on('close', (code) => {
				this.log.debug(`child process exited with code ${code}`);

				let testSuiteInfo = null;
				try {
					const results = /{.+?"type": "suite",\s+"id": "root",\s+"label": "Pester",\s+"children".+}\s*$/si.exec(strData);
					if(!results || !results[0]) {
						throw new Error('Regex does not match');
					}

					testSuiteInfo = JSON.parse(results[0]) as TestSuiteInfo;
				} catch (e) {
					this.log.error(`Unable to parse JSON data from Pester test discovery script. Contents: ${strData}`);
					testSuiteInfo = this.pesterTestSuite;
				}

				outer: for (const newChild of testSuiteInfo.children) {
					for (let i = 0; i < this.pesterTestSuite.children.length; i++) {
						const oldChild = this.pesterTestSuite.children[i];
						if (newChild.id === oldChild.id) {
							this.pesterTestSuite.children[i] = newChild;
							continue outer;
						}
					}
					this.pesterTestSuite.children.push(newChild);
				}

				if (!skipLoadingResults) {
					const relativePath = vscode.workspace
						.getConfiguration("pesterExplorer")
						.get<string>("testResultsFilePath")!;
					vscode.workspace.findFiles(new vscode.RelativePattern(this.workspace, relativePath)).then((files: vscode.Uri[]) => {
						if (!files.length) {
							this.log.debug('No test files found.');
							return;
						}

						this.loadTestFile(files[0]);
					});
				}

				resolve(testSuiteInfo);
			});
		});
	}

	public async runPesterTests(
		tests: string[],
		isDebug: boolean
	): Promise<void> {
		for (const suiteOrTestId of tests) {
			const node = this.findNode(this.pesterTestSuite, suiteOrTestId);
			if (node) {
				await this.runNode(node, this.testStatesEmitter, isDebug);
			}
		}
	}

	public stopPesterTests(): void {
		this.pesterInvoker.stopTests();
	}

	public getTestRootDirectory(): string {
		if (this.testRootDirectory) {
			return this.testRootDirectory;
		}

		let testRootDirectory = vscode.workspace
			.getConfiguration('pesterExplorer')
			.get<string>('testRootDirectory');

		if (testRootDirectory) {
			if (!path.isAbsolute(testRootDirectory)) {
				// We were given a relative path.
				testRootDirectory = path.join(this.workspace.uri.fsPath, testRootDirectory);
			}

			if (!fs.existsSync(testRootDirectory)) {
				vscode.window.showErrorMessage("Invalid 'pesterExplorer.testRootDirectory' configuration. Please make sure this directory exists on the filesystem.");
				testRootDirectory = this.workspace.uri.fsPath;
			}
		} else {
			// Try to discover a test/tests folder.
			testRootDirectory = this.workspace.uri.fsPath;

			const dirs = fs.readdirSync(this.workspace.uri.fsPath, {
				withFileTypes: true
			});

			for (const dir of dirs) {
				if (dir.isDirectory() && dir.name.match(/^[Tt]ests?$/)) {
					testRootDirectory = path.join(this.workspace.uri.fsPath, dir.name);
					break;
				}
			}
		}

		this.testRootDirectory = testRootDirectory;
		return testRootDirectory;
	}

	private async getPowerShellExe(): Promise<string> {
		const details = await this.powershellExtensionClient.GetVersionDetails();
		this.log.debug(`Using ${details.displayName} at: ${details.exePath}`);
		return details.exePath;
	}

	private findNode(searchNode: TestSuiteInfo | TestInfo, id: string): TestSuiteInfo | TestInfo | undefined {
		if (searchNode.id === id) {
			return searchNode;
		} else if (searchNode.type === 'suite') {
			for (const child of searchNode.children) {
				const found = this.findNode(child, id);
				if (found) return found;
			}
		}
		return undefined;
	}

	private async runNode(
		node: TestSuiteInfo | TestInfo,
		testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>,
		isDebug: boolean
	): Promise<void> {
		if (node.type === 'suite') {
			testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'running' });
		} else {
			// node.type === 'test'
			testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'running' });
		}

		let filePath: string;
		let lineNumber: string;
		if (node.id === 'root') {
			// Run all of the files in a workspace.
			filePath = this.getTestRootDirectory();
			lineNumber = "";
		} else if (node.id.indexOf(';') !== -1) {
			// Run a section of a file.
			const arr = node.id.split(';');
			filePath = arr.slice(0, arr.length - 1).join('');
			lineNumber = arr[arr.length - 1];
		} else {
			// Run the whole file.
			filePath = node.id;
			lineNumber = "";
		}

		if (isDebug) {
			vscode.commands.executeCommand(
				"PowerShell.RunPesterTests",
				vscode.Uri.file(filePath),
				isDebug,
				null,
				lineNumber,
				this.testOutputLocation);

			return;
		}

		await this.pesterInvoker.runTests(filePath, lineNumber);
	}

	private loadTestFile(uri: vscode.Uri) {
		const content = fs.readFileSync(uri.fsPath).toString();
		const result = convert.xml2js(content, { compact: true }) as any;
		this.emitNodeUpdate(this.pesterTestSuite, result['test-results']["test-suite"]);
	}

	private emitNodeUpdate(searchNode: TestSuiteInfo | TestInfo, xmlNode: any): void {
		if (searchNode.type == 'suite') {
	
			this.testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: searchNode.id, state: 'completed' });

			let xmlResults: any[] = [];
			if (xmlNode.results['test-suite']) {
				if(Array.isArray(xmlNode.results['test-suite'])) {
					xmlResults.push(...xmlNode.results['test-suite']);
				} else {
					xmlResults.push(xmlNode.results['test-suite']);
				}
			}

			if (xmlNode.results['test-case']) {
				if(Array.isArray(xmlNode.results['test-case'])) {
					xmlResults.push(...xmlNode.results['test-case']);
				} else {
					xmlResults.push(xmlNode.results['test-case']);
				}
			}

			for (const child of (searchNode as TestSuiteInfo).children) {
				for (const xmlChild of xmlResults) {
					if (child.id == xmlChild._attributes.description
						|| child.label == xmlChild._attributes.description
						|| `${searchNode.label}.${child.label}` === xmlChild._attributes.description) {
						this.emitNodeUpdate(child, xmlChild);
					}
				}
			}
		} else {
			if (!xmlNode._attributes.result) {
				// This test wasn't run, so we skip it.
				return;
			}

			let state: string;
			// This maps the result possibilities in Pester found here: https://github.com/pester/Pester/blob/edb9acb73461b55df397ef974d0da2a4bea6921f/src/functions/TestResults.ps1#L783-L796
			// and the state possibilities in Test Explorer UI.
			switch (xmlNode._attributes.result) {
				case 'Failure':
					state = 'failed';
					break;
				case 'Ignored':
					state = 'skipped';
					break;
				case 'Inconclusive':
					state = 'skipped';
					break;
				case 'Success':
					state = 'passed';
					break;
				default:
					// Skipped is probably closest to "I don't recognize the result".
					// This would only happen if Pester changed it's results.
					state = 'skipped';
					break;
			}

			this.testStatesEmitter.fire(<TestEvent>{
				type: searchNode.type,
				test: searchNode.id,
				state: state
			});
		}
	}
}
