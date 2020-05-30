import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as convert from 'xml-js';
import { spawn } from 'child_process';
import { TestSuiteInfo, TestInfo, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent } from 'vscode-test-adapter-api';
import { PowerShellExeFinder, getPlatformDetails } from './process';
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

	private powershellExeFinder = new PowerShellExeFinder(getPlatformDetails());

	public constructor(
		public readonly workspace: vscode.WorkspaceFolder,
		private readonly testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>,
		private readonly log: Log
	) {
		this.log.info('Initializing Pester test runner.');

		// TODO: Pull file path from settings
		this.testOutputLocation = path.join(this.workspace.uri.fsPath, 'TestExplorerResults.xml');
		this.watcher = vscode.workspace.createFileSystemWatcher(this.testOutputLocation, false, false, false);
		this.watcher.onDidChange((e: vscode.Uri) => this.loadTestFile(e));
	}

	public async loadPesterTests(): Promise<TestSuiteInfo> {
		const files = await vscode.workspace.findFiles(new vscode.RelativePattern(this.workspace, '**/*.Tests.ps1'));
		this.log.debug(`Found ${files.length} paths`);
	
		// TODO: Pull from settings
		const exePath = this.powershellExeFinder.getFirstAvailablePowerShellInstallation().exePath;

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

				vscode.workspace.findFiles(new vscode.RelativePattern(this.workspace, 'TestExplorerResults.xml')).then((files: vscode.Uri[]) => {
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
	
			for (const child of node.children) {
				this.runNode(child, testStatesEmitter, isDebug);
			}	
		} else {
			// node.type === 'test'
			testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'running' });
	
			const arr = node.id.split(':');
			const lineNumber = arr[arr.length - 1];
			const filePath = arr.slice(0, arr.length - 1).join('');
	
			vscode.commands.executeCommand(
				"PowerShell.RunPesterTests",
				filePath,
				isDebug,
				null,
				lineNumber,
				this.testOutputLocation);
		}
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
						if (child.label == xmlChild._attributes.description) {
							this.emitNodeUpdate(child, xmlChild);
						}
					}
				} else {
					if (child.label == xmlResults._attributes.description) {
						this.emitNodeUpdate(child, xmlResults);
					}
				}
			}
		} else {
			this.testStatesEmitter.fire(<TestEvent>{
				type: searchNode.type,
				test: searchNode.id,
				// TODO: Update this with map of NUnit -> Test Explorer state
				state: xmlNode._attributes.result == "Failure" ? "failed" : "passed"
			});
		}
	}
}
