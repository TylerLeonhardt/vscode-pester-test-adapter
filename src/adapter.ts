import * as vscode from 'vscode';
import { TestAdapter, TestLoadStartedEvent, TestLoadFinishedEvent, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent, RetireEvent } from 'vscode-test-adapter-api';
import { Log } from 'vscode-test-adapter-util';
import { PesterTestRunner } from './pesterTests';

/**
 * This class is intended as a starting point for implementing a "real" TestAdapter.
 * The file `README.md` contains further instructions.
 */
export class PesterAdapter implements TestAdapter {

	private disposables: { dispose(): void }[] = [];

	private readonly testsEmitter = new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
	private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();
	private readonly autorunEmitter = new vscode.EventEmitter<void>();
	private readonly retireEmitter = new vscode.EventEmitter<RetireEvent>();
	private readonly pesterTestRunner: PesterTestRunner;

	get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> { return this.testsEmitter.event; }
	get testStates(): vscode.Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> { return this.testStatesEmitter.event; }
	get autorun(): vscode.Event<void> | undefined { return this.autorunEmitter.event; }
	get retire(): vscode.Event<RetireEvent> | undefined { return this.retireEmitter.event; }

	constructor(
		public readonly workspace: vscode.WorkspaceFolder,
		private readonly log: Log
	) {

		this.log.info('Initializing Pester adapter');

		this.disposables.push(this.testsEmitter);
		this.disposables.push(this.testStatesEmitter);
		this.disposables.push(this.autorunEmitter);
		this.pesterTestRunner = new PesterTestRunner(workspace, this.testStatesEmitter, log);

		const rel = new vscode.RelativePattern(this.pesterTestRunner.getTestRootDirectory(), '**/*.[tT]ests.ps1');
		const testFilesWatcher = vscode.workspace.createFileSystemWatcher(rel, false, false, false);
		testFilesWatcher.onDidChange(async (e: vscode.Uri) => {
			this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
			const loadedTests = await this.pesterTestRunner.loadPesterTests([e], true);
			this.retireEmitter.fire({
				tests: loadedTests.children.map(c => c.id),
			});
			this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: this.pesterTestRunner.getRootTestSuite() });
		});

		testFilesWatcher.onDidDelete(async (e: vscode.Uri) => {
			this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
			const loadedTests = await this.pesterTestRunner.loadPesterTests();
			this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: loadedTests });
		});

		this.disposables.push(testFilesWatcher);
	}

	async load(): Promise<void> {

		this.log.info('Loading Pester tests');

		this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
		const loadedTests = await this.pesterTestRunner.loadPesterTests();
		this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: loadedTests });
	}

	async run(tests: string[]): Promise<void> {

		this.log.info(`Running Pester tests ${JSON.stringify(tests)}`);

		this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });

		// in a "real" TestAdapter this would start a test run in a child process
		await this.pesterTestRunner.runPesterTests(tests, false);

		this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });

	}

	async debug(tests: string[]): Promise<void> {
		this.log.info(`Debugging Pester tests ${JSON.stringify(tests)}`);

		this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });

		// in a "real" TestAdapter this would start a test run in a child process
		await this.pesterTestRunner.runPesterTests(tests, true);

		this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
	}

	cancel(): void {
		// in a "real" TestAdapter this would kill the child process for the current test run (if there is any)
		throw new Error("Method not implemented.");
	}

	dispose(): void {
		this.cancel();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables = [];
	}
}
