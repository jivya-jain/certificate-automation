param (
    [string]$Action,
    [string]$InputPath,
    [string]$OutputPath,
    [string]$BatchJsonPath
)

# Set action default
if (-not $Action) {
    Write-Error "Action parameter is required ('thumbnail', 'pdf', or 'batch-pdf')"
    exit 1
}

# Start PowerPoint Application
try {
    $ppt = New-Object -ComObject PowerPoint.Application
    # Prevent alert dialogs
    $ppt.DisplayAlerts = 1 # ppAlertsNone
} catch {
    Write-Error "Failed to start PowerPoint COM application. Ensure Microsoft PowerPoint is installed. Error: $_"
    exit 1
}

try {
    if ($Action -eq "thumbnail") {
        if (-not $InputPath -or -not $OutputPath) {
            Write-Error "InputPath and OutputPath are required for action 'thumbnail'"
            exit 1
        }
        # Resolve to absolute paths
        $absInputPath = [System.IO.Path]::GetFullPath($InputPath)
        $absOutputPath = [System.IO.Path]::GetFullPath($OutputPath)

        # Open presentation readonly without window
        $presentation = $ppt.Presentations.Open($absInputPath, -1, 0, 0) # ReadOnly=True, Untitled=False, WithWindow=False
        
        # Ensure target directory exists
        $parentDir = Split-Path -Parent $absOutputPath
        if (-not (Test-Path $parentDir)) {
            New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
        }

        # Export Slide 1 to PNG
        $presentation.Slides.Item(1).Export($absOutputPath, "PNG")
        $presentation.Close()
        Write-Output "Successfully generated thumbnail: $absOutputPath"
    }
    elseif ($Action -eq "pdf") {
        if (-not $InputPath -or -not $OutputPath) {
            Write-Error "InputPath and OutputPath are required for action 'pdf'"
            exit 1
        }
        $absInputPath = [System.IO.Path]::GetFullPath($InputPath)
        $absOutputPath = [System.IO.Path]::GetFullPath($OutputPath)

        # Open presentation readonly without window
        $presentation = $ppt.Presentations.Open($absInputPath, -1, 0, 0)
        
        $parentDir = Split-Path -Parent $absOutputPath
        if (-not (Test-Path $parentDir)) {
            New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
        }

        # Save as PDF (32 = ppSaveAsPDF)
        $presentation.SaveAs($absOutputPath, 32)
        $presentation.Close()
        Write-Output "Successfully generated PDF: $absOutputPath"
    }
    elseif ($Action -eq "batch-pdf") {
        if (-not $BatchJsonPath -or -not (Test-Path $BatchJsonPath)) {
            Write-Error "Valid BatchJsonPath is required for action 'batch-pdf'"
            exit 1
        }
        $absBatchJsonPath = [System.IO.Path]::GetFullPath($BatchJsonPath)
        
        # Parse batch configuration
        $batch = Get-Content -Raw -Path $absBatchJsonPath | ConvertFrom-Json
        
        foreach ($item in $batch) {
            $itemInput = [System.IO.Path]::GetFullPath($item.input)
            $itemOutput = [System.IO.Path]::GetFullPath($item.output)
            
            $parentDir = Split-Path -Parent $itemOutput
            if (-not (Test-Path $parentDir)) {
                New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
            }

            $presentation = $ppt.Presentations.Open($itemInput, -1, 0, 0)
            $presentation.SaveAs($itemOutput, 32)
            $presentation.Close()
            Write-Output "Batch successfully generated: $itemOutput"
        }
    }
    else {
        Write-Error "Unknown action: $Action"
        exit 1
    }
} catch {
    Write-Error "An error occurred during PowerPoint automation: $_"
    exit 1
} finally {
    # Ensure PowerPoint quits cleanly and COM object is released
    if ($ppt) {
        $ppt.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
        Remove-Variable ppt -ErrorAction SilentlyContinue
    }
}
