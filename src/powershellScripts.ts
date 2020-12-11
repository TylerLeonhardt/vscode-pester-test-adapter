export function getPesterDiscoveryScript(paths: string[]): string {
    return `
$Path = @(
"${paths.join('"\n"')}"
)

Import-Module Pester -MinimumVersion 5.0.0 -ErrorAction Stop
function Discover-Test 
{
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [String[]] $Path,
        [String[]] $ExcludePath
    )
    & (Get-Module Pester) { 
        param (
            $Path, 
            $ExcludePath,
            $SessionState)
        
        Reset-TestSuiteState
        # to avoid Describe thinking that we run in interactive mode
        $invokedViaInvokePester = $true
        $files = Find-File -Path $Path -ExcludePath $ExcludePath -Extension $PesterPreference.Run.TestExtension.Value
        $containers = foreach ($f in $files) {
            New-BlockContainerObject -File (Get-Item $f)
        }
        Find-Test -BlockContainer $containers -SessionState $SessionState } -Path $Path -ExcludePath $ExcludePath -SessionState $PSCmdlet.SessionState
}

function New-SuiteObject ($Block) { 
    [PSCustomObject]@{
        type = 'suite'
        id = "$($Block.ScriptBlock.File);$($Block.ScriptBlock.StartPosition.StartLine)"
        file = $Block.ScriptBlock.File
        line = $Block.ScriptBlock.StartPosition.StartLine - 1
        label = $Block.Name
        children = [Collections.Generic.List[Object]]@()
    }
}

function New-TestObject ($Test) { 
    [PSCustomObject]@{
        type = 'test'
        id = "$($Test.ScriptBlock.File);$($Test.ScriptBlock.StartPosition.StartLine)"
        file = $Test.ScriptBlock.File
        line = $Test.ScriptBlock.StartPosition.StartLine - 1
        label = $Test.Name
    }
}

function fold ($children, $Block) {
    foreach ($b in $Block.Blocks) { 
        $o = (New-SuiteObject $b)
        $children.Add($o)
        fold $o.children $b
    }
    foreach ($t in $Block.Tests) { 
        $children.Add((New-TestObject $t))
    }
}

$found = Discover-Test -Path $Path

# whole suite
$suite = [PSCustomObject]@{
    Blocks = [Collections.Generic.List[Object]] $found
    Tests = [Collections.Generic.List[Object]]@()
}

$testSuiteInfo = [PSCustomObject]@{
    type = 'suite'
    id = 'root'
    label = 'Pester'
    children = [Collections.Generic.List[Object]]@()
}

foreach ($file in $found) {
    $fileSuite = [PSCustomObject]@{
        type = 'suite'
        id = $file.BlockContainer.Item.FullName
        file = $file.BlockContainer.Item.FullName
        label = $file.BlockContainer.Item.Name
        children = [Collections.Generic.List[Object]]@()
    }
    $testSuiteInfo.children.Add($fileSuite)
    fold $fileSuite.children $file
}

$testSuiteInfo | ConvertTo-Json -Depth 100
`;
}

export function GetPesterInvokeScript(scriptPath: string, outputPath: string, lineNumber?: string): string {
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
Write-Host 'Importing Pester module...';
$pesterModule = Microsoft.PowerShell.Core\\Import-Module Pester -ErrorAction Ignore -PassThru -MinimumVersion 5.0.0;
if (!$pesterModule) {
    Write-Warning 'Failed to import Pester. You must install Pester module (version 5.0.0 or newer) to run or debug Pester tests.';
    return;
};
};

if ($LineNumber -match '\\d+') {
$configuration = @{
    Run = @{
        Path = $ScriptPath;
    };
    Filter = @{
        Line = $ScriptPath + ':' + $LineNumber;
    };
};
if ('FromPreference' -ne $Output) {
    $configuration.Add('Output', @{ Verbosity = $Output });
};

if ($OutputPath) {
    $configuration.Add('TestResult', @{
        Enabled = $true;
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
        OutputPath = $OutputPath;
    });
}
Pester\\Invoke-Pester -Configuration $configuration | Out-Null;
};
`
}
