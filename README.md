# Pester Test Adapter for Visual Studio Code

This repository contains a [Pester](https://github.com/Pester/Pester) implementation of a `TestAdapter` extension that works with the
[Test Explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer) extension.

![screenshot](https://user-images.githubusercontent.com/2644648/83358111-12570900-a326-11ea-9a0e-d1449f824fbe.png)

More documentation can be found in the [Test Adapter API repository](https://github.com/hbenl/vscode-test-adapter-api).

## Roadmap

* [x] Running tests
* [x] Debugging tests
* [ ] implement the `cancel()` method (it should kill the child process that was started by `run()` or `debug()`)
* [ ] watch the configuration for any changes that may affect the loading of test definitions and reload the test definitions if necessary
* [ ] watch the workspace for any changes to the test files and reload the test definitions if necessary
* [ ] watch the configuration for any changes that may affect the results of running the tests and emit an `autorun` event if necessary
* [ ] watch the workspace for any changes to the source files and emit an `autorun` event if necessary
* [ ] ensure that only one test run is active at a time

## Local development

* install the [Test Explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer) extension
* fork and clone this repository and open it in VS Code
* run `npm install`
* run `npm run watch` or start the watch Task in VS Code
* start the debugger

You should now see a second VS Code window, the Extension Development Host.
Open a folder in this window and click the "Test" icon in the Activity bar.
Now you should see the test suite in the side panel:
