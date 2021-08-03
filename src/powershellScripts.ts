import * as os from "os";

export function getPesterDiscoveryScript(paths: string[]): string {
    const pathStr = "'" + paths.map(p => p.replace(/'/g, "''")).join(`'${os.EOL}'`) + "'"
    return `
$Path = @(
    ${pathStr}
)

# defect-51 - Test Explorer does not show tests
#   ignore invalid argument - changed to SilentlyContinue or Continue as appropriate
#   https://github.com/craiglemon

$VerbosePreference = 'SilentlyContinue'
$WarningPreference = 'Continue'
$DebugPreference = 'SilentlyContinue'

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
        
        # defect-51 - Test Explorer does not show tests
        #   Reset-TestSuiteState deprecated in pester 5.2 and above, so only call if available
        #   https://github.com/craiglemon
        if ( Get-Command Reset-TestSuiteState -ErrorAction SilentlyContinue ) { 
            Reset-TestSuiteState    
        }

        # to avoid Describe thinking that we run in interactive mode
        $invokedViaInvokePester = $true
        $files = Find-File -Path $Path -ExcludePath $ExcludePath -Extension $PesterPreference.Run.TestExtension.Value
        $containers = foreach ($f in $files) {
            <# HACK: We check to see if there is a single Describe block in the file so that we don't accidentally execute code that shouldn't need to be executed. #>
            if (!(Select-String -Path $f -SimpleMatch 'Describe')) {
                continue
            }
            New-BlockContainerObject -File (Get-Item $f)
        }
        Find-Test -BlockContainer $containers -SessionState $SessionState } -Path $Path -ExcludePath $ExcludePath -SessionState $PSCmdlet.SessionState
}

function New-SuiteObject ($Block) { 
    [PSCustomObject]@{
        type = 'suite'
        id = $Block.ScriptBlock.File + ';' + $Block.StartLine
        file = $Block.ScriptBlock.File
        line = $Block.StartLine - 1
        label = $Block.Name
        children = [Collections.Generic.List[Object]]@()
    }
}

function New-TestObject ($Test) { 
    [PSCustomObject]@{
        type = 'test'
        id = $Test.ScriptBlock.File + ';' + $Test.StartLine
        file = $Test.ScriptBlock.File
        line = $Test.StartLine - 1
        label = $Test.Name
    }
}

function fold ($children, $Block) {
    foreach ($b in $Block.Blocks) { 
        $o = (New-SuiteObject $b)
        $children.Add($o)
        fold $o.children $b
    }

    $hashset = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($t in $Block.Tests) {
        $key = "$($t.ExpandedPath):$($t.StartLine)"
        if ($hashset.Contains($key)) {
            continue
        }
        $children.Add((New-TestObject $t))
        $hashset.Add($key) | Out-Null
    }
    $hashset.Clear() | Out-Null
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

# defect-51 - Test Explorer does not show tests
#   Version 5.2 of pester changed the definition of the Discover-Test return type.  Here we determine the latest installed version
#       of pester and act appropriately - use BlockContaione ( < 5.2 ) or not ( >= 5.2 )
#   https://github.com/craiglemon
$version = ( @( Get-Module -Name "Pester" -ErrorAction "SilentlyContinue" )[0] ).Version

if ( $version -lt [version] "5.2" ) {
    # Latest installed pester version is less than 5.2
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
}
else {
    # Latest installed pester version is 5.2 or above
    foreach ($file in $found) {
        $fileSuite = [PSCustomObject]@{
            type = 'suite'
            id = $file.Item.FullName
            file = $file.Item.FullName
            label = $file.Item.Name
            children = [Collections.Generic.List[Object]]@()
        }
        $testSuiteInfo.children.Add($fileSuite)
        fold $fileSuite.children $file
    }
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
