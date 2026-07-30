# Despliegue de un solo comando — publica el sitio a AMBOS destinos y actualiza los repos.
#   Cloudflare Pages (canónico) : https://smile-dental-intelligence.pages.dev
#   GitHub Pages (espejo)       : https://vvisuallaii-bit.github.io/Piloto/
#
# Uso (desde la carpeta Piloto):
#   powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1 "mensaje de commit opcional"
#
# Si pasas un mensaje, hace commit de todos los cambios antes de publicar.
# Requiere Node/wrangler y estar autenticado (npx wrangler login, una vez).

param([string]$Mensaje = "")

$ErrorActionPreference = "Stop"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

$repo = Split-Path -Parent $PSScriptRoot   # carpeta Piloto
Set-Location $repo

# 1. Commit opcional
if ($Mensaje -ne "") {
  git add -A
  $env:GIT_AUTHOR_NAME="vvisuallaii-bit"; $env:GIT_AUTHOR_EMAIL="287837855+vvisuallaii-bit@users.noreply.github.com"
  $env:GIT_COMMITTER_NAME="vvisuallaii-bit"; $env:GIT_COMMITTER_EMAIL="287837855+vvisuallaii-bit@users.noreply.github.com"
  git commit -q -m $Mensaje
  Write-Host "Commit creado: $Mensaje"
}

# 2. Empujar a los dos repos
Write-Host "`nPush a GitHub Pages (espejo)..."
git push pages master:main
Write-Host "Push a origin (respaldo)..."
git push origin master

# 3. Preparar solo los archivos estáticos y publicar a Cloudflare Pages
Write-Host "`nDesplegando a Cloudflare Pages..."
$stage = Join-Path $env:TEMP "cf-pages-deploy"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage "js") | Out-Null
foreach ($f in "index.html","styles.css","articles.json","pacientes.json","smile_dental_demo.csv") {
  Copy-Item (Join-Path $repo $f) (Join-Path $stage $f)
}
Copy-Item (Join-Path $repo "js\*.js") (Join-Path $stage "js")
npx --yes wrangler@latest pages deploy $stage --project-name smile-dental-intelligence --branch main --commit-dirty=true

Write-Host "`n✅ Listo. Sitio en:"
Write-Host "   https://smile-dental-intelligence.pages.dev/  (canónico)"
Write-Host "   https://vvisuallaii-bit.github.io/Piloto/     (espejo)"
