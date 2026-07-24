# pad-og.ps1 — pad any image to social/OG ratio (1.91:1) so shares don't crop the bottom.
# AI generators won't output this ratio on request, so we pad afterward.
# Usage:  powershell -File pad-og.ps1 -Src "C:\Users\bigji\Downloads\foo.jpg" -Out "C:\...\site\xyz-vault-og.jpg"
param(
  [Parameter(Mandatory=$true)][string]$Src,
  [Parameter(Mandatory=$true)][string]$Out,
  [double]$Ratio = 1.905
)
Add-Type -AssemblyName System.Drawing
if (-not (Test-Path $Src)) { Write-Output "MISSING: $Src"; exit 1 }
$img = [System.Drawing.Image]::FromFile($Src)
$w = $img.Width; $h = $img.Height
$tw = [int][Math]::Round($h * $Ratio)
if ($tw -le $w) { Copy-Item $Src $Out -Force; Write-Output "$w x $h already wide enough -> copied"; $img.Dispose(); exit 0 }
$canvas = New-Object System.Drawing.Bitmap($tw, $h)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
# blurred side-fill: downscale to 50px then cover-upscale
$sw = 50; $sh = [int]([Math]::Max(1, 50.0 * $h / $w))
$small = New-Object System.Drawing.Bitmap($sw, $sh)
$gs = [System.Drawing.Graphics]::FromImage($small)
$gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
$gs.DrawImage($img, 0, 0, $sw, $sh); $gs.Dispose()
$coverH = [int]($tw * $sh / $sw)
$g.DrawImage($small, 0, [int](($h - $coverH)/2), $tw, $coverH); $small.Dispose()
# dark overlay so the soft fill recedes
$b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90,3,12,6))
$g.FillRectangle($b, 0, 0, $tw, $h); $b.Dispose()
# sharp original centered on top
$g.DrawImage($img, [int](($tw - $w)/2), 0, $w, $h); $g.Dispose()
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]90)
$canvas.Save($Out, $enc, $ep); $ep.Dispose()
Write-Output "$Out : $w x $h -> $tw x $h ($([Math]::Round($tw/$h,3)):1)"
$canvas.Dispose(); $img.Dispose()
