import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as convert from 'xml-js';
import { spawn } from 'child_process';
import { TestSuiteInfo, TestInfo, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent } from 'vscode-test-adapter-api';
import { PowerShellExeFinder, getPlatformDetails, IPowerShellAdditionalExePathSettings, IPowerShellExeDetails } from './process';
import { getPesterScript } from './constants';
import { Log } from 'vscode-test-adapter-util';

export class PesterTestRunner {
	private readonly watcher: vscode.FileSystemWatcher;
	private readonly testOutputLocation: string;

	private pesterTestSuite: TestSuiteInfo = {
		type: 'suite',
		id: 'root',
		label: 'Pester',
		children: []
	}

	private readonly powershellExeFinder: PowerShellExeFinder;

	public constructor(
		public readonly workspace: vscode.WorkspaceFolder,
		private readonly testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>,
		private readonly log: Log
	) {
		this.log.info('Initializing Pester test runner.');

		const config = vscode.workspace.getConfiguration("powershell");
		const additionalPaths = config.get<Iterable<IPowerShellAdditionalExePathSettings>>("powerShellAdditionalExePaths");
		this.powershellExeFinder = new PowerShellExeFinder(getPlatformDetails(), additionalPaths);
		// TODO: Pull file path from settings
		this.testOutputLocation = path.join(this.workspace.uri.fsPath, 'TestExplorerResults.xml');
		this.watcher = vscode.workspace.createFileSystemWatcher(this.testOutputLocation, false, false, false);
		this.watcher.onDidChange((e: vscode.Uri) => this.loadTestFile(e));
	}

	public async loadPesterTests(): Promise<TestSuiteInfo> {
		const files = await vscode.workspace.findFiles(new vscode.RelativePattern(this.workspace, '**/*.Tests.ps1'));
		this.log.debug(`Found ${files.length} paths`);
	
		const exePath = this.getPowerShellExe();
		const ls = spawn(exePath, ['-Command', getPesterScript(files.map(uri => uri.fsPath))]);
	
		return new Promise<TestSuiteInfo>((resolve, reject) => {
			let strData: string = ""
			ls.stdout.on('data', (data) => {
				this.log.debug(`stdout: ${data}`);
				strData += data;
			});
		
			ls.stderr.on('data', (data) => {
				this.log.error(`stderr: ${data}`);
				reject(data);
			});
		
			ls.on('close', (code) => {
				this.log.debug(`child process exited with code ${code}`);
				this.pesterTestSuite = JSON.parse(strData) as TestSuiteInfo;

				const config = vscode.workspace.getConfiguration("pesterExplorer");
				const relativePath = config.get<string>("testFilePath")!;
				vscode.workspace.findFiles(new vscode.RelativePattern(this.workspace, relativePath)).then((files: vscode.Uri[]) => {
					if (files.length > 1) {
						throw new Error("More than one test file found.");
					}
		
					this.loadTestFile(files[0]);
				});
				resolve(this.pesterTestSuite);
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
				this.runNode(node, this.testStatesEmitter, isDebug);
			}
		}
	}

	private getPowerShellExe(): string {
		const config = vscode.workspace.getConfiguration("powershell");
		const defaultVersion = config.get<string>("powerShellDefaultVersion");
		let powerShellExeDetails: IPowerShellExeDetails | undefined;
		if (defaultVersion) {
			for (const details of this.powershellExeFinder.enumeratePowerShellInstallations()) {
				// Need to compare names case-insensitively, from https://stackoverflow.com/a/2140723
				if (defaultVersion.localeCompare(details.displayName, undefined, { sensitivity: "accent" }) === 0) {
					powerShellExeDetails = details;
					break;
				}
			}
		}

		const exe = powerShellExeDetails ||
                this.powershellExeFinder.getFirstAvailablePowerShellInstallation();

		if (!exe) {
			throw new Error("PowerShell is not installed.")
		}

		this.log.debug(`Using ${exe.displayName} at: ${exe.exePath}`);
		return exe.exePath;
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

	private runNode(
		node: TestSuiteInfo | TestInfo,
		testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>,
		isDebug: boolean
	): void {
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
			filePath = this.workspace.uri.fsPath;
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

		vscode.commands.executeCommand(
			"PowerShell.RunPesterTests",
			filePath,
			isDebug,
			null,
			lineNumber,
			this.testOutputLocation);
	}

	private loadTestFile(uri: vscode.Uri) {
		const content = fs.readFileSync(uri.fsPath).toString();
		const result = convert.xml2js(content, { compact: true }) as any;
		this.emitNodeUpdate(this.pesterTestSuite, result['test-results']["test-suite"]);
	}

	private emitNodeUpdate(searchNode: TestSuiteInfo | TestInfo, xmlNode: any): void {
		if (searchNode.type == 'suite') {
	
			this.testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: searchNode.id, state: 'completed' });
			
			const xmlResults = xmlNode.results['test-suite'] || xmlNode.results['test-case']
			for (const child of (searchNode as TestSuiteInfo).children) {
				if (Array.isArray(xmlResults)) {
					for (const xmlChild of xmlResults) {
						if (child.id == xmlChild._attributes.description || child.label == xmlChild._attributes.description) {
							this.emitNodeUpdate(child, xmlChild);
						}
					}
				} else {
					if (child.id == xmlResults._attributes.description || child.label == xmlResults._attributes.description) {
						this.emitNodeUpdate(child, xmlResults);
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
