# Pester Test Adapter for Visual Studio Code

:warning: This extension is now deprecated in favor of the extension provided by the Pester team: https://github.com/pester/vscode-adapter :warning:

![logo](img/test-explorer-pester.png)

This repository contains a [Pester](https://github.com/Pester/Pester) implementation of a `TestAdapter` extension that works with the
[Test Explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer) extension for [Visual Studio Code](http://code.visualstudio.com/).

![screenshot](https://user-images.githubusercontent.com/2644648/83358111-12570900-a326-11ea-9a0e-d1449f824fbe.png)

It currently supports running and debugging Pester tests as the workspace, file, `Describe`, or `It` level!

It leverages the [PowerShell extension for VS Code](https://github.com/PowerShell/vscode-powershell) to run and debug.

## Local development

* install the [Test Explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer) extension
* fork and clone this repository and open it in VS Code
* run `npm install`
* run `npm run watch` or start the watch Task in VS Code
* start the debugger

You should now see a second VS Code window, the Extension Development Host.
Open a folder in this window and click the "Test" icon in the Activity bar.
Now you should see the test suite in the side panel:
