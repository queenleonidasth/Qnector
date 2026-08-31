Add-Type -AssemblyName System.Drawing

$srcImage = "C:\Users\QUEEN\.gemini\antigravity-cli\brain\4a796c4f-96b5-49d4-956e-eb876327f84c\qnector_app_logo_1788000624282.jpg"
$outDir = "C:\Users\QUEEN\qnector\apps\desktop\resources"

if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$bmpOriginal = [System.Drawing.Bitmap]::FromFile($srcImage)

function Resize-Bitmap {
    param(
        [System.Drawing.Bitmap]$source,
        [int]$width,
        [int]$height
    )
    $dest = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($source, 0, 0, $width, $height)
    $g.Dispose()
    return $dest
}

# 1. Generate icon.png (512x512)
$bmp512 = Resize-Bitmap $bmpOriginal 512 512
$bmp512.Save((Join-Path $outDir "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp512.Dispose()

# 2. Generate tray-icon.png (32x32) and tray-icon@2x.png (64x64)
$bmpTray32 = Resize-Bitmap $bmpOriginal 32 32
$bmpTray32.Save((Join-Path $outDir "tray-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmpTray32.Dispose()

$bmpTray64 = Resize-Bitmap $bmpOriginal 64 64
$bmpTray64.Save((Join-Path $outDir "tray-icon@2x.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmpTray64.Dispose()

# 3. Generate multi-resolution icon.ico
$sizes = @(256, 128, 64, 48, 32, 16)
$pngBytesList = @()

foreach ($s in $sizes) {
    $resized = Resize-Bitmap $bmpOriginal $s $s
    $ms = New-Object System.IO.MemoryStream
    $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytesList += ,@($s, $ms.ToArray())
    $resized.Dispose()
    $ms.Dispose()
}

$bmpOriginal.Dispose()

# Build ICO Binary
$icoFile = Join-Path $outDir "icon.ico"
$fs = [System.IO.File]::Create($icoFile)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR Header (6 bytes)
$bw.Write([UInt16]0) # Reserved
$bw.Write([UInt16]1) # Type (1 = ICO)
$bw.Write([UInt16]$sizes.Count) # Image count

$offset = 6 + (16 * $sizes.Count)

# Write Directory Entries
foreach ($item in $pngBytesList) {
    $sz = $item[0]
    $bytes = $item[1]
    $w = if ($sz -ge 256) { 0 } else { [byte]$sz }
    $h = if ($sz -ge 256) { 0 } else { [byte]$sz }
    
    $bw.Write([byte]$w)            # Width
    $bw.Write([byte]$h)            # Height
    $bw.Write([byte]0)             # Color count
    $bw.Write([byte]0)             # Reserved
    $bw.Write([UInt16]1)           # Color planes
    $bw.Write([UInt16]32)          # Bits per pixel
    $bw.Write([UInt32]$bytes.Length) # Image bytes
    $bw.Write([UInt32]$offset)     # Offset
    
    $offset += $bytes.Length
}

# Write PNG Payload
foreach ($item in $pngBytesList) {
    $bytes = $item[1]
    $bw.Write($bytes)
}

$bw.Flush()
$bw.Close()
$fs.Close()

Write-Output "Successfully generated icon.png, icon.ico, and tray-icon.png in $outDir"
