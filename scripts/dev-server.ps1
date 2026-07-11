$root = Split-Path -Parent $PSScriptRoot
$port = 8843
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving $root on http://localhost:$port/"

$mime = @{
  '.html' = 'text/html'
  '.js'   = 'application/javascript'
  '.css'  = 'text/css'
  '.json' = 'application/json'
  '.csv'  = 'text/csv'
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $req = $context.Request
  $res = $context.Response
  try {
    $localPath = $req.Url.LocalPath
    if ($localPath -eq '/') { $localPath = '/index.html' }
    $filePath = Join-Path $root ($localPath.TrimStart('/'))
    if (Test-Path $filePath -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($filePath)
      $contentType = $mime[$ext]
      if (-not $contentType) { $contentType = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $res.ContentType = $contentType
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("Not found: $localPath")
      $res.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.OutputStream.Close()
  }
}
